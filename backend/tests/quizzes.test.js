// Online quizzes (Batch 9) tests: quiz creation, questions and the answer
// key, publishing into a Written Works column, the public link (which
// never sends the answer key), automatic checking, one attempt per
// learner, resetting an attempt, closing and reopening, and deleting a
// quiz together with its Grades column. Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

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
let learnerC;

async function signup(overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'Quiz',
      last_name: `Teacher${counter}`,
      email: `quizteacher${counter}@test.local`,
      mobile: '09171234567',
      school_id: overrides.school_id || schoolId,
      password: 'QuizPass123',
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
    .send({ name: `QuizSubject${counter}`, grade_level: 10 });
  assert.equal(subject.status, 201, JSON.stringify(subject.body));
  const response = await api()
    .post('/api/teacher/classes')
    .set(bearer(token))
    .send({
      subject_id: subject.body.subject.id,
      grade_level: 10,
      section_name: `QuizSection${counter}`,
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
    .send({ first_name: 'Learner', last_name: `Quiz${counter}`, sex: 'Female', ...overrides, learner_id: `STU-2026-${2000 + counter}` });
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

async function createQuiz(token, overrides = {}) {
  const response = await api()
    .post('/api/teacher/quizzes')
    .set(bearer(token))
    .send({ class_id: klass.id, quarter: 1, quiz_number: 1, title: 'Quiz 1', instructions: 'Answer all questions.', ...overrides });
  return response;
}

async function addQuestion(token, quizId, body) {
  return api()
    .post(`/api/teacher/quizzes/${quizId}/questions`)
    .set(bearer(token))
    .send(body);
}

async function publishableQuiz(token, overrides = {}, questions = null) {
  const created = await createQuiz(token, overrides);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const quiz = created.body.quiz;
  const list =
    questions ||
    [
      { question_type: 'mcq', question_text: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correct_index: 1, points: 2 },
      { question_type: 'true_false', question_text: 'The sun rises in the west.', correct_index: 1, points: 1 },
      { question_type: 'mcq', question_text: 'Which is a fruit?', options: ['Carrot', 'Potato', 'Apple'], correct_index: 2, points: 1 },
    ];
  for (const question of list) {
    const added = await addQuestion(token, quiz.id, question);
    assert.equal(added.status, 201, JSON.stringify(added.body));
  }
  return quiz;
}

async function getSheet(token, classId, quarter = 1) {
  const response = await api().get(`/api/teacher/grades/${classId}?quarter=${quarter}`).set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

before(async () => {
  await resetDatabase();
  adminToken = await signIn(ADMIN);
  await signIn(SUPER);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Quiz Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const otherSchool = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Other Quiz School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(otherSchool.status, 201, JSON.stringify(otherSchool.body));
  otherSchoolId = otherSchool.body.school.id;

  teacherToken = (await signup({ first_name: 'Melvin', last_name: 'Reston' })).token;
  otherTeacherToken = (await signup({ first_name: 'John', last_name: 'Maniago' })).token;
  otherSchoolTeacherToken = (await signup({ first_name: 'Elmer', last_name: 'Datalayta', school_id: otherSchoolId })).token;

  klass = await makeClass(teacherToken);
  learnerA = await makeLearner(teacherToken, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
  learnerB = await makeLearner(teacherToken, { first_name: 'Isabella', last_name: 'Flores', sex: 'Female' });
  learnerC = await makeLearner(otherSchoolTeacherToken, { first_name: 'Other', last_name: 'Learner', sex: 'Female' });
  await enrol(teacherToken, klass.id, learnerA.id);
  await enrol(teacherToken, klass.id, learnerB.id);
});

after(async () => {
  await pool.end();
});

describe('quiz creation', () => {
  test('a quiz starts as a draft and the link does not work yet', async () => {
    const created = await createQuiz(teacherToken, { quiz_number: 11 });
    assert.equal(created.status, 201);
    assert.equal(created.body.quiz.status, 'draft');
    assert.ok(created.body.quiz.code);
    const pub = await api().get(`/api/quiz/${created.body.quiz.code}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.quiz.open, false);
    assert.deepEqual(pub.body.questions, []);
  });

  test('a duplicate quiz number for the same class and period is refused', async () => {
    const first = await createQuiz(teacherToken, { quiz_number: 12 });
    assert.equal(first.status, 201);
    const second = await createQuiz(teacherToken, { quiz_number: 12 });
    assert.equal(second.status, 409, JSON.stringify(second.body));
  });

  test('Term 4 does not exist under DO 015, and a quiz for another teacher class is refused', async () => {
    const term4 = await createQuiz(teacherToken, { quarter: 4, quiz_number: 13 });
    assert.equal(term4.status, 400, JSON.stringify(term4.body));
    const otherClass = await makeClass(otherTeacherToken);
    const wrong = await api()
      .post('/api/teacher/quizzes')
      .set(bearer(teacherToken))
      .send({ class_id: otherClass.id, quarter: 1, quiz_number: 1, title: 'Quiz 1' });
    assert.equal(wrong.status, 404, JSON.stringify(wrong.body));
  });

  test('publishing needs at least one question', async () => {
    const created = await createQuiz(teacherToken, { quiz_number: 14 });
    const published = await api().post(`/api/teacher/quizzes/${created.body.quiz.id}/publish`).set(bearer(teacherToken));
    assert.equal(published.status, 400, JSON.stringify(published.body));
  });
});

describe('questions and the answer key', () => {
  test('question rules: 2 to 5 choices, the correct answer must be one of them', async () => {
    const created = await createQuiz(teacherToken, { quiz_number: 15 });
    const quizId = created.body.quiz.id;
    const oneChoice = await addQuestion(teacherToken, quizId, {
      question_type: 'mcq', question_text: 'One?', options: ['Only'], correct_index: 0, points: 1,
    });
    assert.equal(oneChoice.status, 400, JSON.stringify(oneChoice.body));
    const badCorrect = await addQuestion(teacherToken, quizId, {
      question_type: 'mcq', question_text: 'Two?', options: ['A', 'B'], correct_index: 2, points: 1,
    });
    assert.equal(badCorrect.status, 400, JSON.stringify(badCorrect.body));
    const tf = await addQuestion(teacherToken, quizId, {
      question_type: 'true_false', question_text: 'True or false?', options: ['Yes', 'No', 'Maybe'], correct_index: 0, points: 1,
    });
    assert.equal(tf.status, 201, JSON.stringify(tf.body));
    assert.deepEqual(tf.body.question.options, ['True', 'False']);
  });
});

describe('publishing and the Grades column', () => {
  test('publishing creates one Written Works column labelled Quiz 1, after the standard columns', async () => {
    const quiz = await publishableQuiz(teacherToken, { quiz_number: 2, title: 'Quiz 2' });
    const published = await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(teacherToken));
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.quiz.status, 'published');
    assert.ok(published.body.quiz.grade_column_id);

    const sheet = await getSheet(teacherToken, klass.id, 1);
    // DO 015 defaults: WW1–WW4, PT1–PT4, ST1/ST2/Term Exam (11), plus the quiz column.
    assert.equal(sheet.columns.length, 12, JSON.stringify(sheet.columns.map((c) => c.name)));
    const quizColumn = sheet.columns.find((column) => column.name === 'Quiz 2');
    assert.ok(quizColumn, JSON.stringify(sheet.columns.map((c) => c.name)));
    assert.equal(quizColumn.component, 'WW');
    assert.equal(quizColumn.position, 5);
    assert.equal(quizColumn.highest_possible, 4);
    assert.equal(quizColumn.quiz_id, quiz.id);
  });

  test('a quiz column cannot be changed or deleted from the Grades page', async () => {
    const sheet = await getSheet(teacherToken, klass.id, 1);
    const quizColumn = sheet.columns.find((column) => column.name === 'Quiz 2');
    const updated = await api()
      .patch(`/api/teacher/grades/${klass.id}/columns/${quizColumn.id}`)
      .set(bearer(teacherToken))
      .send({ highest_possible: 10 });
    assert.equal(updated.status, 400, JSON.stringify(updated.body));
    const deleted = await api()
      .delete(`/api/teacher/grades/${klass.id}/columns/${quizColumn.id}`)
      .set(bearer(teacherToken));
    assert.equal(deleted.status, 400, JSON.stringify(deleted.body));
  });
});

describe('the public link', () => {
  let quiz;

  before(async () => {
    quiz = await publishableQuiz(teacherToken, { quiz_number: 3, title: 'Quiz 3' });
    const published = await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(teacherToken));
    assert.equal(published.status, 200, JSON.stringify(published.body));
    quiz = published.body.quiz;
  });

  test('the public read sends the questions without the answer key', async () => {
    const pub = await api().get(`/api/quiz/${quiz.code}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.quiz.open, true);
    assert.equal(pub.body.quiz.total_points, 4);
    assert.equal(pub.body.questions.length, 3);
    for (const question of pub.body.questions) {
      assert.equal('correct_index' in question, false, JSON.stringify(question));
      assert.ok(question.points >= 1);
    }
    const bad = await api().get('/api/quiz/not-a-code');
    assert.equal(bad.status, 404);
  });

  test('lookup confirms an enrolled learner and refuses the others', async () => {
    const found = await api().get(`/api/quiz/${quiz.code}/lookup`).query({ learner_id: learnerA.learner_id.toLowerCase() });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.body.learner.last_name, 'Rivera');
    assert.equal(found.body.already_submitted, false);
    const otherSchool = await api().get(`/api/quiz/${quiz.code}/lookup`).query({ learner_id: learnerC.learner_id });
    assert.equal(otherSchool.status, 404, JSON.stringify(otherSchool.body));
    const unknown = await api().get(`/api/quiz/${quiz.code}/lookup`).query({ learner_id: 'STU-9999' });
    assert.equal(unknown.status, 404);
  });

  test('submitting checks from the answer key and writes the score into Grades', async () => {
    const pub = await api().get(`/api/quiz/${quiz.code}`);
    const [q1, q2, q3] = pub.body.questions;
    // Q1 right (2 points), Q2 wrong (0 of 1), Q3 right (1 point): 3 of 4.
    const submitted = await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({
        learner_id: learnerA.learner_id,
        answers: [
          { question_id: q1.id, selected_index: 1 },
          { question_id: q2.id, selected_index: 0 },
          { question_id: q3.id, selected_index: 2 },
        ],
      });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.score, 3);
    assert.equal(submitted.body.total_points, 4);
    assert.equal(submitted.body.correct_count, 2);

    const sheet = await getSheet(teacherToken, klass.id, 1);
    const quizColumn = sheet.columns.find((column) => column.name === 'Quiz 3');
    const row = sheet.learners.find((learner) => learner.learner_id === learnerA.learner_id);
    assert.equal(row.scores[quizColumn.id], 3);

    const detail = await api().get(`/api/teacher/quizzes/${quiz.id}`).set(bearer(teacherToken));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.attempts.length, 1);
    assert.equal(detail.body.roster.find((r) => r.learner_id === learnerA.learner_id).attempt.score, 3);
    assert.equal(detail.body.roster.find((r) => r.learner_id === learnerB.learner_id).attempt, null);
    const q1Stats = detail.body.question_stats.find((s) => s.question_id === q1.id);
    assert.equal(q1Stats.attempts, 1);
    assert.equal(q1Stats.correct, 1);
  });

  test('a blank answer earns nothing, and a second submit is refused', async () => {
    const pub = await api().get(`/api/quiz/${quiz.code}`);
    const [q1, q2, q3] = pub.body.questions;
    const blank = await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({
        learner_id: learnerB.learner_id,
        answers: [
          { question_id: q1.id, selected_index: null },
          { question_id: q2.id, selected_index: 1 },
          { question_id: q3.id, selected_index: 0 },
        ],
      });
    assert.equal(blank.status, 201, JSON.stringify(blank.body));
    assert.equal(blank.body.score, 1);

    const again = await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({ learner_id: learnerB.learner_id, answers: [{ question_id: q1.id, selected_index: 1 }] });
    assert.equal(again.status, 409, JSON.stringify(again.body));

    const lookup = await api().get(`/api/quiz/${quiz.code}/lookup`).query({ learner_id: learnerB.learner_id });
    assert.equal(lookup.body.already_submitted, true);
    assert.equal(lookup.body.attempt.score, 1);
  });

  test('questions are locked once anyone has taken the quiz', async () => {
    const added = await addQuestion(teacherToken, quiz.id, {
      question_type: 'mcq', question_text: 'Late?', options: ['A', 'B'], correct_index: 0, points: 1,
    });
    assert.equal(added.status, 400, JSON.stringify(added.body));
    const detail = await api().get(`/api/teacher/quizzes/${quiz.id}`).set(bearer(teacherToken));
    const questionId = detail.body.questions[0].id;
    const updated = await api()
      .patch(`/api/teacher/quizzes/${quiz.id}/questions/${questionId}`)
      .set(bearer(teacherToken))
      .send({ question_type: 'mcq', question_text: 'Changed?', options: ['A', 'B'], correct_index: 0, points: 1 });
    assert.equal(updated.status, 400, JSON.stringify(updated.body));
    const deleted = await api()
      .delete(`/api/teacher/quizzes/${quiz.id}/questions/${questionId}`)
      .set(bearer(teacherToken));
    assert.equal(deleted.status, 400, JSON.stringify(deleted.body));
  });

  test('resetting an attempt removes its Grades score and allows a retake', async () => {
    const detail = await api().get(`/api/teacher/quizzes/${quiz.id}`).set(bearer(teacherToken));
    const attempt = detail.body.attempts.find((a) => a.learner_code === learnerB.learner_id);
    const reset = await api()
      .post(`/api/teacher/quizzes/${quiz.id}/attempts/${attempt.id}/reset`)
      .set(bearer(teacherToken));
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    const sheet = await getSheet(teacherToken, klass.id, 1);
    const quizColumn = sheet.columns.find((column) => column.name === 'Quiz 3');
    const row = sheet.learners.find((learner) => learner.learner_id === learnerB.learner_id);
    assert.equal(row.scores[quizColumn.id], null);

    const pub = await api().get(`/api/quiz/${quiz.code}`);
    const [q1, q2, q3] = pub.body.questions;
    const retake = await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({
        learner_id: learnerB.learner_id,
        answers: [
          { question_id: q1.id, selected_index: 1 },
          { question_id: q2.id, selected_index: 1 },
          { question_id: q3.id, selected_index: 2 },
        ],
      });
    assert.equal(retake.status, 201, JSON.stringify(retake.body));
    assert.equal(retake.body.score, 4);
  });

  test('an answer for a question in another quiz, or out of range, is refused', async () => {
    const fresh = await makeLearner(teacherToken, { first_name: 'Fresh', last_name: 'Learner', sex: 'Male' });
    await enrol(teacherToken, klass.id, fresh.id);
    const other = await publishableQuiz(teacherToken, { quiz_number: 4, title: 'Quiz 4' });
    await api().post(`/api/teacher/quizzes/${other.id}/publish`).set(bearer(teacherToken));
    const otherDetail = await api().get(`/api/teacher/quizzes/${other.id}`).set(bearer(teacherToken));
    const foreign = otherDetail.body.questions[0];
    const foreignAnswer = await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({ learner_id: fresh.learner_id, answers: [{ question_id: foreign.id, selected_index: 0 }] });
    assert.equal(foreignAnswer.status, 400, JSON.stringify(foreignAnswer.body));

    const pub = await api().get(`/api/quiz/${quiz.code}`);
    const outOfRange = await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({ learner_id: fresh.learner_id, answers: [{ question_id: pub.body.questions[0].id, selected_index: 4 }] });
    assert.equal(outOfRange.status, 400, JSON.stringify(outOfRange.body));
  });
});

describe('closing, deadlines, ownership and deletion', () => {
  test('closing stops the link, reopening reuses the same Grades column', async () => {
    const quiz = await publishableQuiz(teacherToken, { quiz_number: 5, title: 'Quiz 5' });
    const published = await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(teacherToken));
    const columnId = published.body.quiz.grade_column_id;
    const closed = await api().post(`/api/teacher/quizzes/${quiz.id}/close`).set(bearer(teacherToken));
    assert.equal(closed.status, 200);
    assert.equal(closed.body.quiz.status, 'closed');
    const pub = await api().get(`/api/quiz/${quiz.code}`);
    assert.equal(pub.body.quiz.open, false);
    const pubClosed = await api().get(`/api/quiz/${quiz.code}`);
    assert.deepEqual(pubClosed.body.questions, []);
    const submitted = await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({ learner_id: learnerA.learner_id, answers: [{ question_id: 1, selected_index: 0 }] });
    assert.equal(submitted.status, 400, JSON.stringify(submitted.body));

    const reopened = await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(teacherToken));
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.quiz.grade_column_id, columnId);
    const sheet = await getSheet(teacherToken, klass.id, 1);
    assert.equal(sheet.columns.filter((c) => c.name === 'Quiz 5').length, 1);
  });

  test('a past deadline closes the link, and clearing it opens it again', async () => {
    const quiz = await publishableQuiz(teacherToken, { quiz_number: 6, title: 'Quiz 6' });
    await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(teacherToken));
    const past = new Date(Date.now() - 1000).toISOString();
    const updated = await api()
      .patch(`/api/teacher/quizzes/${quiz.id}`)
      .set(bearer(teacherToken))
      .send({ deadline: past });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    const pub = await api().get(`/api/quiz/${quiz.code}`);
    assert.equal(pub.body.quiz.open, false);
    const cleared = await api()
      .patch(`/api/teacher/quizzes/${quiz.id}`)
      .set(bearer(teacherToken))
      .send({ clear_deadline: true });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.quiz.deadline, null);
    const openAgain = await api().get(`/api/quiz/${quiz.code}`);
    assert.equal(openAgain.body.quiz.open, true);
  });

  test('another teacher cannot see, change, publish or delete a quiz', async () => {
    const quiz = await publishableQuiz(teacherToken, { quiz_number: 7, title: 'Quiz 7' });
    const seen = await api().get(`/api/teacher/quizzes/${quiz.id}`).set(bearer(otherTeacherToken));
    assert.equal(seen.status, 404);
    const changed = await api()
      .patch(`/api/teacher/quizzes/${quiz.id}`)
      .set(bearer(otherTeacherToken))
      .send({ title: 'Taken over' });
    assert.equal(changed.status, 404);
    const published = await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(otherTeacherToken));
    assert.equal(published.status, 404);
    const deleted = await api().delete(`/api/teacher/quizzes/${quiz.id}`).set(bearer(otherTeacherToken));
    assert.equal(deleted.status, 404);
    const list = await api().get('/api/teacher/quizzes').set(bearer(otherTeacherToken));
    assert.equal(list.body.items.some((item) => item.id === quiz.id), false);
  });

  test('deleting a quiz removes its Written Works column from the Grades page', async () => {
    const quiz = await publishableQuiz(teacherToken, { quiz_number: 8, title: 'Quiz 8' });
    await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(teacherToken));
    const before = await getSheet(teacherToken, klass.id, 1);
    assert.ok(before.columns.some((c) => c.name === 'Quiz 8'));
    const deleted = await api().delete(`/api/teacher/quizzes/${quiz.id}`).set(bearer(teacherToken));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    const after = await getSheet(teacherToken, klass.id, 1);
    assert.equal(after.columns.some((c) => c.name === 'Quiz 8'), false);
    const gone = await api().get(`/api/teacher/quizzes/${quiz.id}`).set(bearer(teacherToken));
    assert.equal(gone.status, 404);
  });

  test('the results download lists every enrolled learner with their score', async () => {
    const quiz = await publishableQuiz(teacherToken, { quiz_number: 9, title: 'Quiz 9' });
    await api().post(`/api/teacher/quizzes/${quiz.id}/publish`).set(bearer(teacherToken));
    const pub = await api().get(`/api/quiz/${quiz.code}`);
    const [q1, q2, q3] = pub.body.questions;
    await api()
      .post(`/api/quiz/${quiz.code}/submit`)
      .send({
        learner_id: learnerA.learner_id,
        answers: [
          { question_id: q1.id, selected_index: 1 },
          { question_id: q2.id, selected_index: 1 },
          { question_id: q3.id, selected_index: 2 },
        ],
      });
    const csv = await api()
      .get(`/api/teacher/quizzes/${quiz.id}?format=csv`)
      .set(bearer(teacherToken));
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Rivera, Alex/);
    assert.match(csv.text, /STU-2026/);
    assert.match(csv.text, /Flores, Isabella/);
  });
});
