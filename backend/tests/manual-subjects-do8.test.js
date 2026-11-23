// Teacher Batch 8 fix 10 tests, DO 8 year: the manual-subject template
// and filing generalise to the year's grading profile — a DO 8 year uses
// four quarters, and the profile frozen on the subject at creation is the
// one its grades keep even if the year's system is switched later. This
// file switches the current year (2026-2027) to DO 8 in its own fresh
// database, so it never runs against a year with filings already in it.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

let superToken;
let adminToken;
let schoolId;
let counter = 0;

const TEACHER_PASSWORD = 'TeacherPass123';

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Manual Subjects DO8 Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  // The current year starts with no filings, so the switch is allowed.
  const switched = await api()
    .put('/api/settings/grading-system')
    .set(bearer(adminToken))
    .send({ academic_year: '2026-2027', profile: 'do8_2015' });
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  assert.equal(switched.body.grading_profile, 'do8_2015');
});

after(async () => {
  await pool.end();
});

async function signup(overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'Manual',
      last_name: `Teacher${counter}`,
      email: `manualdo8teacher${counter}@test.local`,
      mobile: '09171234567',
      school_id: overrides.school_id || schoolId,
      password: TEACHER_PASSWORD,
      terms_accepted: true,
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function makeSubject(token, overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher/subjects')
    .set(bearer(token))
    .send({ name: `Subject${counter}`, grade_level: 10, ...overrides });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.subject;
}

async function makeClass(token, overrides = {}) {
  const subject = overrides.subject || (await makeSubject(token));
  const response = await api()
    .post('/api/teacher/classes')
    .set(bearer(token))
    .send({
      subject_id: subject.id,
      grade_level: subject.grade_level,
      section_name: `Section${counter}`,
      room: 'Room 1',
      academic_year: '2026-2027',
      ...overrides,
      subject_id: overrides.subject_id ?? subject.id,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.class;
}

async function makeLearner(token, overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher/learners')
    .set(bearer(token))
    .send({ first_name: 'Learner', last_name: `Test${counter}`, sex: 'Female', ...overrides, learner_id: `STU-2026-${1000 + counter}` });
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

async function setAdviser(token, grade, section) {
  const response = await api()
    .patch('/api/teacher/me/adviser')
    .set(bearer(token))
    .send({ is_adviser: true, advisory_grade: grade, advisory_section: section });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.teacher;
}

describe('Manual subjects under DO 8', () => {
  test('the template uses Quarter 1..Quarter 4, filing accepts Quarter 4, and no floor is applied', async () => {
    counter += 1;
    const section = `Luke${counter}`;
    const adviserToken = (await signup({ first_name: 'Melvin', last_name: 'Reston' })).token;
    await setAdviser(adviserToken, 10, section);

    const subject = await makeSubject(adviserToken, { name: 'Sacraments' });
    const klass = await makeClass(adviserToken, { subject, section_name: section });
    const alex = await makeLearner(adviserToken, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    await enrol(adviserToken, klass.id, alex.id);

    const created = await api()
      .post('/api/teacher/consolidation/manual-subjects')
      .set(bearer(adviserToken))
      .send({ subject_name: 'Values Education', teacher_name: 'Ms. No Account' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    // The profile in force at creation is frozen on the subject.
    assert.equal(created.body.manual_subject.profile_code, 'do8_2015');
    const manual = created.body.manual_subject;

    const template = await api()
      .get(`/api/teacher/consolidation/manual-subjects/${manual.id}/template`)
      .set(bearer(adviserToken));
    assert.equal(template.status, 200, JSON.stringify(template.body));
    const text = template.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const lines = text.trim().split('\n');
    assert.equal(lines[0], 'Learner ID,Student Name,Quarter 1,Quarter 2,Quarter 3,Quarter 4');
    assert.equal(lines.length, 2);
    assert.match(lines[1], new RegExp(`^${alex.learner_id},"Rivera, Alex",,,,$`));

    // Quarter 4 files, and a grade below 60 files too: no floor is enforced.
    const filed = await api()
      .post(`/api/teacher/consolidation/manual-subjects/${manual.id}/grades`)
      .set(bearer(adviserToken))
      .send({
        grades: [
          { learner_id: alex.learner_id, quarter: 1, grade: 55 },
          { learner_id: alex.learner_id, quarter: 2, grade: 70 },
          { learner_id: alex.learner_id, quarter: 3, grade: 80 },
          { learner_id: alex.learner_id, quarter: 4, grade: 90 },
        ],
      });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    assert.deepEqual(filed.body.manual_subject.periods_with_grades, [1, 2, 3, 4]);

    const view = await api().get('/api/teacher/consolidation?quarter=4').set(bearer(adviserToken));
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.grading.code, 'do8_2015');
    assert.equal(view.body.grading.period_label, 'Quarter');
    const card = view.body.subjects.find((subject) => subject.subject_name === 'Values Education');
    assert.equal(card.average, 90);
    assert.equal(view.body.learners.find((row) => row.learner_id === alex.learner_id).grades['Values Education'], 90);

    const finals = await api().get('/api/teacher/consolidation?scope=final').set(bearer(adviserToken));
    assert.equal(finals.status, 200, JSON.stringify(finals.body));
    assert.deepEqual(finals.body.periods, [1, 2, 3, 4]);
    const alexFinal = finals.body.learners.find((row) => row.learner_id === alex.learner_id);
    assert.equal(alexFinal.grades['Values Education'], 74); // (55 + 70 + 80 + 90) / 4, rounded

    // Filed manual grades lock the year's grading system, like filed
    // submissions do: switching back is refused, and the frozen profile
    // on the subject is unchanged.
    const switchedBack = await api()
      .put('/api/settings/grading-system')
      .set(bearer(adminToken))
      .send({ academic_year: '2026-2027', profile: 'do015_adjusted' });
    assert.equal(switchedBack.status, 400, JSON.stringify(switchedBack.body));

    const listed = await api().get('/api/teacher/consolidation/manual-subjects').set(bearer(adviserToken));
    assert.equal(listed.body.manual_subjects[0].profile_code, 'do8_2015');
  });
});
