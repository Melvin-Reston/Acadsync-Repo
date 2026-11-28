// Test Item Analysis (Batch 12) tests: the analysis is computed from
// the saved checked sheets — median-split groups, difficulty and
// discrimination indices with the sheet's bands, distractor rules,
// and ownership. No migration: exam_scans.answers already holds one
// reviewed answer per question per learner. Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN, removeTestUploads } = require('./helpers');

let adminToken;
let schoolId;
let counter = 0;
let teacherToken;
let otherTeacherToken;
let klass;
const learners = [];

async function signup(overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'Analysis',
      last_name: `Teacher${counter}`,
      email: `analysisteacher${counter}@test.local`,
      mobile: '09171234567',
      school_id: overrides.school_id || schoolId,
      password: 'TestPass123',
      terms_accepted: true,
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function makeClass(token) {
  counter += 1;
  const subject = await api()
    .post('/api/teacher/subjects')
    .set(bearer(token))
    .send({ name: `AnalysisSubject${counter}`, grade_level: 9 });
  assert.equal(subject.status, 201, JSON.stringify(subject.body));
  const response = await api()
    .post('/api/teacher/classes')
    .set(bearer(token))
    .send({
      subject_id: subject.body.subject.id,
      grade_level: 9,
      section_name: `AnalysisSection${counter}`,
      room: 'Room 1',
      academic_year: '2026-2027',
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.class;
}

async function makeLearner(token, lastName) {
  counter += 1;
  const response = await api()
    .post('/api/teacher/learners')
    .set(bearer(token))
    .send({ first_name: 'Learner', last_name: lastName, sex: 'Female', learner_id: `STU-2026-${4000 + counter}` });
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

async function createExam(token, classId, overrides = {}) {
  const response = await api()
    .post('/api/teacher/exams')
    .set(bearer(token))
    .send({
      class_id: classId,
      quarter: 1,
      exam_number: overrides.exam_number || 1,
      title: overrides.title || 'Exam 1',
      instructions: 'Shade one circle per number.',
      question_count: overrides.question_count || 5,
      points_each: overrides.points_each || 1,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.exam;
}

async function saveKey(token, examId, questions) {
  const response = await api().put(`/api/teacher/exams/${examId}/key`).set(bearer(token)).send({ questions });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

async function saveScan(token, examId, learnerId, selected) {
  const response = await api()
    .post(`/api/teacher/exams/${examId}/scans`)
    .set(bearer(token))
    .send({
      learner_id: learnerId,
      answers: selected.map((entry) => ({ selected: entry, uncertain: false, multiple: false })),
      source: 'manual',
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
}

async function analysis(token, examId) {
  const response = await api().get(`/api/teacher/exams/${examId}/item-analysis`).set(bearer(token));
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
    .send({ name: 'Analysis Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  teacherToken = (await signup()).token;
  otherTeacherToken = (await signup()).token;
  klass = await makeClass(teacherToken);
  for (const lastName of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
    const learner = await makeLearner(teacherToken, lastName);
    await enrol(teacherToken, klass.id, learner.id);
    learners.push(learner);
  }
});

after(async () => {
  await pool.end();
  removeTestUploads();
});

describe('Test Item Analysis', () => {
  test('no checked sheets yet: not ready, and another teacher cannot read it', async () => {
    const exam = await createExam(teacherToken, klass.id, { exam_number: 11, title: 'Empty Exam' });
    const body = await analysis(teacherToken, exam.id);
    assert.equal(body.takers, 0);
    assert.equal(body.ready, false);
    assert.equal(body.roster_size, 4);
    assert.equal(body.groups.upper_size, 0);
    assert.equal(body.groups.lower_size, 0);
    assert.equal(body.header.school_name, 'Analysis Test School');
    assert.equal(body.header.has_school_seal, false);

    const other = await api().get(`/api/teacher/exams/${exam.id}/item-analysis`).set(bearer(otherTeacherToken));
    assert.equal(other.status, 404, JSON.stringify(other.body));
    const missing = await api().get('/api/teacher/exams/999999/item-analysis').set(bearer(teacherToken));
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
  });

  test('difficulty, discrimination and distractors from the saved sheets', async () => {
    const exam = await createExam(teacherToken, klass.id, { exam_number: 12, title: 'Four Sheet Exam' });
    // Q1 mcq 4 choices key A, Q2 True/False key False, Q3 mcq 3 choices
    // key A, Q4 mcq 2 choices key B, Q5 mcq 2 choices key A (answered
    // right by everyone, so it does not change the upper/lower split).
    await saveKey(teacherToken, exam.id, [
      { choices: 4, correct: 0, kind: 'mcq' },
      { choices: 2, correct: 1, kind: 'true_false' },
      { choices: 3, correct: 0, kind: 'mcq' },
      { choices: 2, correct: 1, kind: 'mcq' },
      { choices: 2, correct: 0, kind: 'mcq' },
    ]);
    // Scores 5, 4, 1, 2: upper = the 5 and the 4, lower = the 2 and the 1.
    await saveScan(teacherToken, exam.id, learners[0].id, [0, 1, 0, 1, 0]);
    await saveScan(teacherToken, exam.id, learners[1].id, [0, 1, 0, 0, 0]);
    await saveScan(teacherToken, exam.id, learners[2].id, [1, 0, 1, 0, 0]);
    await saveScan(teacherToken, exam.id, learners[3].id, [0, 0, 2, 0, 0]);

    const body = await analysis(teacherToken, exam.id);
    assert.equal(body.takers, 4);
    assert.equal(body.ready, true);
    assert.equal(body.groups.upper_size, 2);
    assert.equal(body.groups.lower_size, 2);
    assert.equal(body.groups.method, 'median');
    assert.equal(body.mean_score, 3);
    assert.equal(body.mean_percent, 60);

    const [q1, q2, q3, q4] = body.items;
    assert.equal(q1.difficulty, 0.75);
    assert.equal(q1.difficulty_label, 'Easy');
    assert.equal(q1.difficulty_action, 'Retain');
    assert.equal(q1.discrimination, 0.5);
    assert.equal(q1.discrimination_label, 'Very Good Item');
    assert.equal(q1.blank_count, 0);
    assert.equal(q2.difficulty, 0.5);
    assert.equal(q2.difficulty_label, 'Moderately Difficult');
    assert.equal(q2.discrimination, 1);
    assert.equal(q2.correct_label, 'False');
    assert.equal(q3.difficulty, 0.5);
    assert.equal(q3.discrimination, 1);
    assert.equal(q4.difficulty, 0.25);
    assert.equal(q4.difficulty_label, 'Difficult');
    assert.equal(q4.discrimination, 0.5);

    // Q1: option D was chosen by nobody — a non-functioning distractor.
    const q1d = q1.distractors.find((option) => option.label === 'D');
    assert.equal(q1d.total, 0);
    assert.equal(q1d.action, 'Replace or rewrite');
    assert.match(q1d.remark, /non-functioning/);
    assert.match(q1d.plausibility_remark, /non-functioning/);
    assert.equal(q1d.direction_remark, '—');
    const q1a = q1.distractors.find((option) => option.label === 'A');
    assert.equal(q1a.is_correct, true);
    assert.equal(q1a.remark, 'Correct Answer');
    assert.equal(q1a.plausibility_remark, 'Correct Answer');
    assert.equal(q1a.direction_remark, '—');
    // Q1 option B: chosen only by the lower group — a good distractor.
    const q1b = q1.distractors.find((option) => option.label === 'B');
    assert.equal(q1b.upper, 0);
    assert.equal(q1b.lower, 1);
    assert.equal(q1b.direction, -1);
    assert.equal(q1b.action, 'Retain');
    assert.equal(q1b.plausibility_remark, 'Plausible');
    assert.equal(q1b.direction_remark, 'Retain: Good distractor');

    assert.deepEqual(body.summary.difficulty_counts, {
      'Very Easy': 1,
      Easy: 1,
      'Moderately Difficult': 2,
      Difficult: 1,
      'Very Difficult': 0,
    });
    assert.equal(body.summary.distractor_counts.replace, 3);
    assert.deepEqual(body.summary.most_learned, [5]);
    assert.deepEqual(body.summary.least_learned, [4]);
    assert.deepEqual(body.summary.negative_items, []);
  });

  test('a negative discrimination flags the key, and a distractor the upper group likes is rephrased', async () => {
    const exam = await createExam(teacherToken, klass.id, { exam_number: 13, title: 'Negative Exam', question_count: 5 });
    await saveKey(teacherToken, exam.id, [
      { choices: 3, correct: 0, kind: 'mcq' },
      { choices: 3, correct: 0, kind: 'mcq' },
      { choices: 3, correct: 0, kind: 'mcq' },
      { choices: 3, correct: 0, kind: 'mcq' },
      { choices: 3, correct: 0, kind: 'mcq' },
    ]);
    // Scores 4, 3, 2, 2: upper = the 4 and the 3, lower = the two 2s.
    // Everyone in the lower group got Q1 right; nobody in the upper
    // group did, while the upper group won the exam on the other items.
    await saveScan(teacherToken, exam.id, learners[0].id, [1, 0, 0, 0, 0]);
    await saveScan(teacherToken, exam.id, learners[1].id, [1, 0, 0, 1, 0]);
    await saveScan(teacherToken, exam.id, learners[2].id, [0, 1, 1, 1, 0]);
    await saveScan(teacherToken, exam.id, learners[3].id, [0, 1, 1, 0, 0]);

    const body = await analysis(teacherToken, exam.id);
    const q1 = body.items[0];
    assert.equal(q1.difficulty, 0.5);
    assert.equal(q1.discrimination, -1);
    assert.equal(q1.negative, true);
    assert.equal(q1.discrimination_label, 'Potentially Very Poor');
    assert.equal(q1.discrimination_action, 'Reject');
    assert.deepEqual(body.summary.negative_items, [1]);

    const wrong = q1.distractors.find((option) => option.label === 'B');
    assert.equal(wrong.upper, 2);
    assert.equal(wrong.lower, 0);
    assert.equal(wrong.direction, 2);
    assert.equal(wrong.action, 'Rephrase or check');
    assert.match(wrong.remark, /misleading/);
    assert.equal(wrong.plausibility_remark, 'Plausible');
    assert.match(wrong.direction_remark, /misleading/);
  });

  test('re-checking a sheet updates the analysis, and a blank answer counts as wrong', async () => {
    const exam = await createExam(teacherToken, klass.id, { exam_number: 14, title: 'Recheck Exam', question_count: 5 });
    await saveKey(teacherToken, exam.id, [
      { choices: 2, correct: 0, kind: 'mcq' },
      { choices: 2, correct: 0, kind: 'mcq' },
      { choices: 2, correct: 0, kind: 'mcq' },
      { choices: 2, correct: 0, kind: 'mcq' },
      { choices: 2, correct: 0, kind: 'mcq' },
    ]);
    await saveScan(teacherToken, exam.id, learners[0].id, [0, 0, 0, 0, 0]);
    await saveScan(teacherToken, exam.id, learners[1].id, [0, 0, 0, 0, 0]);
    let body = await analysis(teacherToken, exam.id);
    assert.equal(body.items[0].difficulty, 1);

    // The second learner is re-checked with Q1 blank and Q2 wrong.
    await saveScan(teacherToken, exam.id, learners[1].id, [null, 1, 0, 0, 0]);
    body = await analysis(teacherToken, exam.id);
    assert.equal(body.takers, 2);
    assert.equal(body.items[0].difficulty, 0.5);
    assert.equal(body.items[0].blank_count, 1);
    assert.equal(body.items[1].difficulty, 0.5);
  });

  test('a distractor chosen by under 5% of a large group is too obvious', async () => {
    const bigClass = await makeClass(teacherToken);
    const bigLearners = [];
    for (let index = 0; index < 21; index += 1) {
      const learner = await makeLearner(teacherToken, `Big${index}`);
      await enrol(teacherToken, bigClass.id, learner.id);
      bigLearners.push(learner);
    }
    const exam = await createExam(teacherToken, bigClass.id, { exam_number: 15, title: 'Big Exam', question_count: 5 });
    await saveKey(teacherToken, exam.id, [
      { choices: 4, correct: 0, kind: 'mcq' },
      { choices: 4, correct: 0, kind: 'mcq' },
      { choices: 4, correct: 0, kind: 'mcq' },
      { choices: 4, correct: 0, kind: 'mcq' },
      { choices: 4, correct: 0, kind: 'mcq' },
    ]);
    for (let index = 0; index < bigLearners.length; index += 1) {
      // One learner picks the fourth option on Q1; everyone else
      // answers every question correctly.
      await saveScan(teacherToken, exam.id, bigLearners[index].id, index === 20 ? [3, 0, 0, 0, 0] : [0, 0, 0, 0, 0]);
    }
    const body = await analysis(teacherToken, exam.id);
    assert.equal(body.takers, 21);
    assert.equal(body.groups.upper_size, 11);
    assert.equal(body.groups.lower_size, 10);
    const odd = body.items[0].distractors.find((option) => option.label === 'D');
    assert.equal(odd.total, 1);
    assert.equal(odd.plausibility, 0.05);
    assert.equal(odd.action, 'Replace or rewrite');
    assert.match(odd.remark, /too obvious/);
  });
});
