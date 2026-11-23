// Batch 8 fix 13 tests: the top-bar academic-year filter. The filter is
// view-only — it never changes the admin's global academic year — so the
// dashboard, schedules, manual subjects, report-card comments and SF2 all
// answer for the year the teacher is viewing, and an invalid year is refused.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

const CURRENT = '2026-2027';
const PAST = '2025-2026';
const TEACHER_PASSWORD = 'TeacherPass123';

let adminToken;
let schoolId;
let counter = 0;

before(async () => {
  await resetDatabase();
  await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Viewing Year Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;
});

after(async () => {
  await pool.end();
});

async function signup(overrides = {}) {
  counter += 1;
  const email = `viewingteacher${counter}@test.local`;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'Viewing',
      last_name: `Teacher${counter}`,
      email,
      mobile: '09171234567',
      school_id: overrides.school_id || schoolId,
      password: TEACHER_PASSWORD,
      terms_accepted: true,
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { ...response.body, email };
}

async function makeSubject(token, name) {
  counter += 1;
  const response = await api()
    .post('/api/teacher/subjects')
    .set(bearer(token))
    .send({ name: name || `Subject${counter}`, grade_level: 10 });
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
      grade_level: 10,
      section_name: overrides.section_name || 'Luke',
      room: 'Room 1',
      academic_year: CURRENT,
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
    .send({ first_name: 'Learner', last_name: `Test${counter}`, learner_id: `STU-VY-${1000 + counter}`, sex: 'Female', ...overrides });
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

describe('Academic years list', () => {
  test('a teacher with no classes only sees the current year', async () => {
    const { token } = await signup();
    const response = await api().get('/api/teacher/academic-years').set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.current_academic_year, CURRENT);
    assert.deepEqual(response.body.academic_years, [CURRENT]);
  });

  test("years from the teacher's own classes are listed, newest first", async () => {
    const { token } = await signup();
    await makeClass(token, { academic_year: PAST });
    await makeClass(token, { academic_year: CURRENT, section_name: 'Matthew' });
    const response = await api().get('/api/teacher/academic-years').set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.current_academic_year, CURRENT);
    assert.deepEqual(response.body.academic_years, [CURRENT, PAST]);
  });

  test("an adviser's section classes in another teacher's list add their years too", async () => {
    const adviser = await signup();
    const other = await signup();
    await setAdviser(adviser.token, 10, 'Luke');
    await makeClass(other.token, { academic_year: PAST, section_name: 'Luke' });
    const response = await api().get('/api/teacher/academic-years').set(bearer(adviser.token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.academic_years, [CURRENT, PAST]);
  });
});

describe('Dashboard and validation', () => {
  test('the dashboard defaults to the current year and reports both years', async () => {
    const { token } = await signup();
    await makeClass(token, { academic_year: PAST });
    await makeClass(token, { academic_year: CURRENT, section_name: 'Matthew' });
    const response = await api().get('/api/teacher/dashboard').set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.academic_year, CURRENT);
    assert.equal(response.body.current_academic_year, CURRENT);
    assert.equal(response.body.class_count, 1);
  });

  test('a past year filters the class count and empties today-classes', async () => {
    const { token } = await signup();
    await makeClass(token, { academic_year: PAST });
    await makeClass(token, { academic_year: CURRENT, section_name: 'Matthew' });
    const response = await api().get(`/api/teacher/dashboard?academic_year=${PAST}`).set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.academic_year, PAST);
    assert.equal(response.body.current_academic_year, CURRENT);
    assert.equal(response.body.class_count, 1);
    assert.deepEqual(response.body.today_classes, []);
  });

  test('an invalid academic year is refused', async () => {
    const { token } = await signup();
    const dashboard = await api().get('/api/teacher/dashboard?academic_year=2026').set(bearer(token));
    assert.equal(dashboard.status, 400, JSON.stringify(dashboard.body));
    const consolidation = await api().get('/api/teacher/consolidation?quarter=1&academic_year=2026').set(bearer(token));
    assert.equal(consolidation.status, 400, JSON.stringify(consolidation.body));
    const years = await api().get('/api/teacher/academic-years?academic_year=2026').set(bearer(token));
    assert.equal(years.status, 200, JSON.stringify(years.body));
  });
});

describe('Schedules', () => {
  test('a week shows only the meetings of the year being viewed', async () => {
    const { token } = await signup();
    const pastClass = await makeClass(token, { academic_year: PAST });
    const currentClass = await makeClass(token, { academic_year: CURRENT, section_name: 'Matthew' });
    const pastMeeting = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: pastClass.id, day_of_week: 1, start_time: '07:30', end_time: '08:30', room: 'Room 1' });
    assert.equal(pastMeeting.status, 201, JSON.stringify(pastMeeting.body));
    const currentMeeting = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: currentClass.id, day_of_week: 1, start_time: '08:30', end_time: '09:30', room: 'Room 2' });
    assert.equal(currentMeeting.status, 201, JSON.stringify(currentMeeting.body));

    const pastWeek = await api().get(`/api/teacher/schedules?week_start=2025-11-03&academic_year=${PAST}`).set(bearer(token));
    assert.equal(pastWeek.status, 200, JSON.stringify(pastWeek.body));
    assert.equal(pastWeek.body.meetings.length, 1);
    assert.equal(pastWeek.body.meetings[0].date, '2025-11-03');

    // Meetings repeat every week, so the current year's meeting shows on any
    // week's Monday — the year filter is about the class's year, not the date.
    const currentWeek = await api().get(`/api/teacher/schedules?week_start=2025-11-03&academic_year=${CURRENT}`).set(bearer(token));
    assert.equal(currentWeek.status, 200, JSON.stringify(currentWeek.body));
    assert.equal(currentWeek.body.meetings.length, 1);
    assert.equal(currentWeek.body.meetings[0].class_id, currentClass.id);
    assert.equal(pastWeek.body.meetings[0].class_id, pastClass.id);
  });
});

describe('Manual subjects', () => {
  test('a manual subject files under the year being viewed and lists only under that year', async () => {
    const { token } = await signup();
    await setAdviser(token, 10, 'Luke');
    const created = await api()
      .post('/api/teacher/consolidation/manual-subjects')
      .set(bearer(token))
      .send({ subject_name: 'Values Education', teacher_name: 'Ms. No Account', academic_year: PAST });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.manual_subject.academic_year, PAST);

    const currentList = await api().get('/api/teacher/consolidation/manual-subjects').set(bearer(token));
    assert.equal(currentList.status, 200, JSON.stringify(currentList.body));
    assert.equal(currentList.body.manual_subjects.length, 0);

    const pastList = await api().get(`/api/teacher/consolidation/manual-subjects?academic_year=${PAST}`).set(bearer(token));
    assert.equal(pastList.status, 200, JSON.stringify(pastList.body));
    assert.equal(pastList.body.manual_subjects.length, 1);
    assert.equal(pastList.body.manual_subjects[0].id, created.body.manual_subject.id);
  });

  test('creating without a year files under the current year', async () => {
    const { token } = await signup();
    await setAdviser(token, 10, 'Luke');
    const created = await api()
      .post('/api/teacher/consolidation/manual-subjects')
      .set(bearer(token))
      .send({ subject_name: 'Values Education', teacher_name: 'Ms. No Account' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.manual_subject.academic_year, CURRENT);
  });
});

describe('Report card comments', () => {
  test('a comment saved under a past year never shows on the current year card', async () => {
    const { token } = await signup();
    await setAdviser(token, 10, 'Luke');
    const pastClass = await makeClass(token, { academic_year: PAST });
    const currentClass = await makeClass(token, { academic_year: CURRENT });
    const learner = await makeLearner(token, { learner_id: 'STU-VY-9001' });
    await enrol(token, pastClass.id, learner.id);
    await enrol(token, currentClass.id, learner.id);

    const saved = await api()
      .put('/api/teacher/report-card/comments')
      .set(bearer(token))
      .send({ learner_id: learner.learner_id, period: 1, comment: 'Steady work last year.', academic_year: PAST });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const pastCards = await api().get(`/api/teacher/report-card?academic_year=${PAST}`).set(bearer(token));
    assert.equal(pastCards.status, 200, JSON.stringify(pastCards.body));
    const pastLearner = pastCards.body.learners.find((row) => row.learner_id === learner.learner_id);
    assert.ok(pastLearner);
    assert.equal(pastLearner.comments['1'], 'Steady work last year.');

    const currentCards = await api().get('/api/teacher/report-card').set(bearer(token));
    assert.equal(currentCards.status, 200, JSON.stringify(currentCards.body));
    const currentLearner = currentCards.body.learners.find((row) => row.learner_id === learner.learner_id);
    assert.ok(currentLearner);
    assert.equal(currentLearner.comments['1'], undefined);
  });
});

describe('SF2 calendar scoping', () => {
  test("a past-year month is not emptied by the current year's first day of classes", async () => {
    const teacher = await signup();
    const { token } = teacher;
    await pool.query(
      "UPDATE teachers SET classes_start_date = '2026-06-15', classes_end_date = '2027-04-30' WHERE email = $1",
      [teacher.email]
    );
    const pastClass = await makeClass(token, { academic_year: PAST });
    const learner = await makeLearner(token, { learner_id: 'STU-VY-9002' });
    await enrol(token, pastClass.id, learner.id);

    const report = await api().get(`/api/teacher/attendance/sf2?class_id=${pastClass.id}&month=2025-11`).set(bearer(token));
    assert.equal(report.status, 200, JSON.stringify(report.body));
    assert.ok(report.body.days.some((day) => day.date === '2025-11-03'), JSON.stringify(report.body.days));
    assert.ok(report.body.days.length > 0);
    assert.ok(report.body.summary.days_of_classes > 0);
  });
});
