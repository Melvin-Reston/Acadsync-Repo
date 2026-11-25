// Paper exam checker (Batch 10) tests: exam creation, the answer key
// with one choice count per question, saving a checked sheet (the
// score is recomputed from the stored key), the Examinations column
// in the Grades page, re-checking a learner, deleting a checked
// sheet, the key lock after a save, and deleting an exam together
// with its Grades column. Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN, removeTestUploads } = require('./helpers');

let adminToken;
let schoolId;
let otherSchoolId;
let counter = 0;
let teacherToken;
let otherTeacherToken;
let otherSchoolTeacherToken;
let klass;
let learnerA;
let learnerB;

async function signup(overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'Exam',
      last_name: `Teacher${counter}`,
      email: `examteacher${counter}@test.local`,
      mobile: '09171234567',
      school_id: overrides.school_id || schoolId,
      password: 'ExamPass123',
      terms_accepted: true,
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function makeClass(token, overrides = {}) {
  counter += 1;
  const subject = await api()
    .post('/api/teacher/subjects')
    .set(bearer(token))
    .send({ name: `ExamSubject${counter}`, grade_level: 10 });
  assert.equal(subject.status, 201, JSON.stringify(subject.body));
  const response = await api()
    .post('/api/teacher/classes')
    .set(bearer(token))
    .send({
      subject_id: subject.body.subject.id,
      grade_level: 10,
      section_name: `ExamSection${counter}`,
      room: 'Room 1',
      academic_year: '2026-2027',
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.class;
}

async function makeLearner(token, overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher/learners')
    .set(bearer(token))
    .send({ first_name: 'Learner', last_name: `Exam${counter}`, sex: 'Female', ...overrides, learner_id: `STU-2026-${3000 + counter}` });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.learner;
}

async function enrol(token, classId, learnerId) {
  const response = await api()
    .post(`/api/teacher/classes/${classId}/learners`)
    .set(bearer(token))
    .send({ learner_id: learnerId });
  assert.equal(response.status, 201, JSON.stringify(response.body));
}

async function createExam(token, overrides = {}) {
  return api()
    .post('/api/teacher/exams')
    .set(bearer(token))
    .send({
      class_id: klass.id,
      quarter: 1,
      exam_number: 1,
      title: 'Exam 1',
      instructions: 'Shade one circle per number.',
      question_count: 5,
      points_each: 2,
      ...overrides,
    });
}

async function getSheet(token, classId, quarter = 1) {
  const response = await api().get(`/api/teacher/grades/${classId}?quarter=${quarter}`).set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

// One key entry per question: its own choice count, its correct
// answer, and whether it is True/False. The default key mixes them:
// 5 choices, a True/False question, 3 choices, 4 choices, 2 choices.
function keyQuestions(correct = [0, 1, 2, 3, 0], counts = [5, 2, 3, 4, 2], kinds = ['mcq', 'true_false', 'mcq', 'mcq', 'mcq']) {
  return correct.map((entry, index) => ({ choices: counts[index], correct: entry, kind: kinds[index] }));
}

function answersFor(key, overrides = {}) {
  return key.map((correct, index) => ({
    selected: overrides[index] !== undefined ? overrides[index] : correct,
    uncertain: false,
    multiple: false,
  }));
}

before(async () => {
  await resetDatabase();
  adminToken = await signIn(ADMIN);
  await signIn(SUPER);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Exam Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const otherSchool = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Other Exam School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(otherSchool.status, 201, JSON.stringify(otherSchool.body));
  otherSchoolId = otherSchool.body.school.id;

  teacherToken = (await signup()).token;
  otherTeacherToken = (await signup()).token;
  otherSchoolTeacherToken = (await signup({ school_id: otherSchoolId })).token;
  klass = await makeClass(teacherToken);
  learnerA = await makeLearner(teacherToken);
  learnerB = await makeLearner(teacherToken);
  await enrol(teacherToken, klass.id, learnerA.id);
  await enrol(teacherToken, klass.id, learnerB.id);
});

after(async () => {
  await pool.end();
  removeTestUploads();
});

describe('creating an exam', () => {
  test('an exam starts with an empty key and is not ready to check', async () => {
    const created = await createExam(teacherToken, { exam_number: 1, title: 'Exam 1' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(
      created.body.exam.questions,
      Array.from({ length: 5 }, () => ({ choices: 4, correct: null, kind: 'mcq' }))
    );
    assert.equal(created.body.exam.key_complete, false);
    assert.equal(created.body.exam.total_points, 10);
  });

  test('the same exam number twice in one class and period is refused', async () => {
    const again = await createExam(teacherToken, { exam_number: 1, title: 'Again' });
    assert.equal(again.status, 409, JSON.stringify(again.body));
  });

  test('Term 4 does not exist under DO 015', async () => {
    const term4 = await createExam(teacherToken, { exam_number: 2, quarter: 4 });
    assert.equal(term4.status, 400, JSON.stringify(term4.body));
  });

  test('another teacher cannot see the exam, and a learner outside the school cannot be checked', async () => {
    const created = await createExam(teacherToken, { exam_number: 3, title: 'Exam 3' });
    const examId = created.body.exam.id;
    const other = await api().get(`/api/teacher/exams/${examId}`).set(bearer(otherTeacherToken));
    assert.equal(other.status, 404, JSON.stringify(other.body));
    const otherSchool = await api().get(`/api/teacher/exams/${examId}`).set(bearer(otherSchoolTeacherToken));
    assert.equal(otherSchool.status, 404, JSON.stringify(otherSchool.body));
  });
});

describe('the answer key', () => {
  let examId;

  before(async () => {
    const created = await createExam(teacherToken, { exam_number: 4, title: 'Exam 4' });
    examId = created.body.exam.id;
  });

  test('a partial key saves, a wrong-length key and a True/False question with 4 choices are refused, and a complete mixed key is ready', async () => {
    const partial = await api()
      .put(`/api/teacher/exams/${examId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions([0, 1, null, null, null]) });
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.equal(partial.body.exam.key_complete, false);

    const short = await api()
      .put(`/api/teacher/exams/${examId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions([0, 1]).slice(0, 2) });
    assert.equal(short.status, 400, JSON.stringify(short.body));

    const past = await api()
      .put(`/api/teacher/exams/${examId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions([0, 1, 2, 4, 0], [5, 2, 3, 4, 2]) });
    assert.equal(past.status, 400, JSON.stringify(past.body));

    const trueFalse = await api()
      .put(`/api/teacher/exams/${examId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions([0, 1, 2, 3, 0], [5, 4, 3, 4, 2], ['mcq', 'true_false', 'mcq', 'mcq', 'mcq']) });
    assert.equal(trueFalse.status, 400, JSON.stringify(trueFalse.body));

    const complete = await api()
      .put(`/api/teacher/exams/${examId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions() });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    assert.equal(complete.body.exam.key_complete, true);
    assert.deepEqual(complete.body.exam.questions, keyQuestions());
  });

  test('growing the question count pads the key and shrinking it trims the key', async () => {
    const created = await createExam(teacherToken, { exam_number: 7, title: 'Exam 7' });
    const freshId = created.body.exam.id;
    await api().put(`/api/teacher/exams/${freshId}/key`).set(bearer(teacherToken)).send({ questions: keyQuestions() });
    const grown = await api().patch(`/api/teacher/exams/${freshId}`).set(bearer(teacherToken)).send({ question_count: 6 });
    assert.equal(grown.status, 200, JSON.stringify(grown.body));
    assert.equal(grown.body.exam.questions.length, 6);
    assert.deepEqual(grown.body.exam.questions[5], { choices: 4, correct: null, kind: 'mcq' });
    assert.equal(grown.body.exam.key_complete, false);
    const shrunk = await api().patch(`/api/teacher/exams/${freshId}`).set(bearer(teacherToken)).send({ question_count: 5 });
    assert.equal(shrunk.status, 200, JSON.stringify(shrunk.body));
    assert.equal(shrunk.body.exam.questions.length, 5);
    assert.equal(shrunk.body.exam.key_complete, true);
  });

  test('no sheet can be saved while the key is incomplete', async () => {
    const created = await createExam(teacherToken, { exam_number: 5, title: 'Exam 5' });
    const freshId = created.body.exam.id;
    await api()
      .put(`/api/teacher/exams/${freshId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions([0, 1, null, null, null]) });
    const saved = await api()
      .post(`/api/teacher/exams/${freshId}/scans`)
      .set(bearer(teacherToken))
      .send({ learner_id: learnerA.id, answers: answersFor([0, 1, 2, 3, 0]), source: 'photo' });
    assert.equal(saved.status, 400, JSON.stringify(saved.body));
  });
});

describe('checking sheets and the Grades column', () => {
  let examId;

  before(async () => {
    const created = await createExam(teacherToken, { exam_number: 6, title: 'Exam 6' });
    examId = created.body.exam.id;
    const keyed = await api()
      .put(`/api/teacher/exams/${examId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions() });
    assert.equal(keyed.status, 200, JSON.stringify(keyed.body));
  });

  test('saving a sheet recomputes the score from the key and creates one Examinations column labelled Exam 6', async () => {
    // 3 right of 5, at 2 points each = 6 of 10. One blank answer earns
    // nothing, and one wrong answer on the 2-choice question earns nothing.
    const saved = await api()
      .post(`/api/teacher/exams/${examId}/scans`)
      .set(bearer(teacherToken))
      .send({ learner_id: learnerA.id, answers: answersFor([0, 1, 2, 3, 0], { 3: null, 4: 1 }), source: 'photo' });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal(saved.body.score, 6);
    assert.equal(saved.body.total_points, 10);
    assert.equal(saved.body.correct_count, 3);

    const sheet = await getSheet(teacherToken, klass.id, 1);
    const examColumn = sheet.columns.find((column) => column.name === 'Exam 6');
    assert.ok(examColumn, JSON.stringify(sheet.columns.map((c) => c.name)));
    assert.equal(examColumn.component, 'EX');
    assert.equal(examColumn.highest_possible, 10);
    assert.equal(examColumn.exam_id, examId);
    const row = sheet.learners.find((learner) => learner.id === learnerA.id);
    assert.equal(row.scores[examColumn.id], 6);
  });

  test('an answer past its own question\'s choice count and a wrong number of answers are refused', async () => {
    // Question 2 has only 2 choices, so choice 2 there is past its count.
    const past = await api()
      .post(`/api/teacher/exams/${examId}/scans`)
      .set(bearer(teacherToken))
      .send({ learner_id: learnerB.id, answers: answersFor([0, 1, 2, 3, 0], { 1: 2 }), source: 'photo' });
    assert.equal(past.status, 400, JSON.stringify(past.body));
    const short = await api()
      .post(`/api/teacher/exams/${examId}/scans`)
      .set(bearer(teacherToken))
      .send({ learner_id: learnerB.id, answers: answersFor([0, 1]), source: 'photo' });
    assert.equal(short.status, 400, JSON.stringify(short.body));
  });

  test('checking the same learner again replaces the score, and the key and setup are now locked', async () => {
    const again = await api()
      .post(`/api/teacher/exams/${examId}/scans`)
      .set(bearer(teacherToken))
      .send({ learner_id: learnerA.id, answers: answersFor([0, 1, 2, 3, 0]), source: 'manual' });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal(again.body.score, 10);

    const detail = await api().get(`/api/teacher/exams/${examId}`).set(bearer(teacherToken));
    assert.equal(detail.body.scans.length, 1, JSON.stringify(detail.body.scans));
    assert.equal(detail.body.question_stats[0].correct, 1);

    const keyed = await api()
      .put(`/api/teacher/exams/${examId}/key`)
      .set(bearer(teacherToken))
      .send({ questions: keyQuestions([1, 1, 2, 3, 0]) });
    assert.equal(keyed.status, 400, JSON.stringify(keyed.body));
    const resized = await api().patch(`/api/teacher/exams/${examId}`).set(bearer(teacherToken)).send({ question_count: 6 });
    assert.equal(resized.status, 400, JSON.stringify(resized.body));
  });

  test('an exam column cannot be changed or deleted from the Grades page', async () => {
    const sheet = await getSheet(teacherToken, klass.id, 1);
    const examColumn = sheet.columns.find((column) => column.name === 'Exam 6');
    const updated = await api()
      .patch(`/api/teacher/grades/${klass.id}/columns/${examColumn.id}`)
      .set(bearer(teacherToken))
      .send({ highest_possible: 20 });
    assert.equal(updated.status, 400, JSON.stringify(updated.body));
    const deleted = await api().delete(`/api/teacher/grades/${klass.id}/columns/${examColumn.id}`).set(bearer(teacherToken));
    assert.equal(deleted.status, 400, JSON.stringify(deleted.body));
  });

  test('deleting a checked sheet removes its score, and the CSV lists the rest', async () => {
    const savedB = await api()
      .post(`/api/teacher/exams/${examId}/scans`)
      .set(bearer(teacherToken))
      .send({ learner_id: learnerB.id, answers: answersFor([0, 1, 2, 3, 0], { 4: 1 }), source: 'photo' });
    assert.equal(savedB.status, 201, JSON.stringify(savedB.body));

    const detail = await api().get(`/api/teacher/exams/${examId}`).set(bearer(teacherToken));
    const scanB = detail.body.scans.find((scan) => scan.learner_id === learnerB.id);
    const removed = await api().delete(`/api/teacher/exams/${examId}/scans/${scanB.id}`).set(bearer(teacherToken));
    assert.equal(removed.status, 200, JSON.stringify(removed.body));

    const sheet = await getSheet(teacherToken, klass.id, 1);
    const examColumn = sheet.columns.find((column) => column.name === 'Exam 6');
    const rowB = sheet.learners.find((learner) => learner.id === learnerB.id);
    assert.equal(rowB.scores[examColumn.id], null);

    const csv = await api().get(`/api/teacher/exams/${examId}?format=csv`).set(bearer(teacherToken));
    assert.equal(csv.status, 200, JSON.stringify(csv.body));
    assert.match(csv.text, /Exam/);
    assert.match(csv.text, /10/);
  });

  test('deleting the exam removes its Examinations column from the Grades page', async () => {
    const before = await getSheet(teacherToken, klass.id, 1);
    assert.ok(before.columns.some((c) => c.name === 'Exam 6'));
    const removed = await api().delete(`/api/teacher/exams/${examId}`).set(bearer(teacherToken));
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const after = await getSheet(teacherToken, klass.id, 1);
    assert.equal(after.columns.some((c) => c.name === 'Exam 6'), false);
  });
});
