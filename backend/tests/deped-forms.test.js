// Teacher Batch 8 tests: the DepEd print forms — migration 010 and the
// teacher-entered school details on the profile, the filed-only final
// grades data (period_grades) behind the Final Grades tab, and the SF2
// daily attendance report. Batch 8 fix 2 adds: migration 011 (school head
// name), Male-then-Female ordering, the Combined TOTAL Per Day row, and the
// footer summary computations.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

let superToken;
let adminToken;
let schoolId;
let otherSchoolId;
let counter = 0;

const TEACHER_PASSWORD = ['Teacher', 'Pass', '123'].join('');

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'DepEd Forms Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const other = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Other DepEd Forms School', category: 'Secondary', school_type: 'Private', city_region: 'Other City', principal_contact: 'Other Principal' });
  otherSchoolId = other.body.school.id;
});

after(async () => {
  await pool.end();
});

// ---------- Small helpers ----------

async function signup(overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'DepEd',
      last_name: `Teacher${counter}`,
      email: `depedteacher${counter}@test.local`,
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

async function getSheet(token, classId, quarter = 1) {
  const response = await api().get(`/api/teacher/grades/${classId}?quarter=${quarter}`).set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

function scoresFor(sheet, learner, values) {
  const byKey = new Map(sheet.columns.map((column) => [`${column.component}:${column.position}`, column]));
  const out = [];
  for (const [component, list] of Object.entries(values)) {
    list.forEach((score, index) => {
      out.push({ column_id: byKey.get(`${component.toUpperCase()}:${index + 1}`).id, learner_id: learner.id, score });
    });
  }
  return out;
}

async function saveScores(token, classId, quarter, scores) {
  const response = await api()
    .post(`/api/teacher/grades/${classId}/scores`)
    .set(bearer(token))
    .send({ quarter, scores });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function submitQuarter(token, classId, quarter) {
  const response = await api()
    .post(`/api/teacher/grades/${classId}/submit`)
    .set(bearer(token))
    .send({ quarter, confirm_blanks: true });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function saveRoll(token, classId, date, marks) {
  const response = await api()
    .post('/api/teacher/attendance')
    .set(bearer(token))
    .send({ class_id: classId, date, marks });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function getSf2(token, classId, month) {
  return api().get(`/api/teacher/attendance/sf2?class_id=${classId}&month=${month}`).set(bearer(token));
}

// The worked example under the default profile for 2026-2027 (DO 015
// adjusted, core weights 20/50/30): initial 88.01, term grade 90.
const WORKED = { ww: [20, 22, 25, 18], pt: [45, 48, 50, 40], ex: [42, 45, 40] };
const LOW = { ww: [10, 10, 10, 10], pt: [20, 20, 20, 20], ex: [20, 20, 20] }; // initial 40 -> term grade 68
const PERFECT = { ww: [25, 25, 25, 25], pt: [50, 50, 50, 50], ex: [50, 50, 50] }; // initial 100 -> 100

// ---------- Migration 010: school details on the teacher profile ----------

describe('School details for DepEd forms', () => {
  test('the profile returns the three school detail fields, null when unset', async () => {
    const { token } = await signup();
    const me = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.teacher.region, null);
    assert.equal(me.body.teacher.division, null);
    assert.equal(me.body.teacher.deped_school_id, null);
  });

  test('the teacher can save school details through the profile update, and they come back on the next read', async () => {
    const { token } = await signup();
    const updated = await api()
      .patch('/api/teacher/me')
      .set(bearer(token))
      .send({ region: 'Region VIII', division: 'Leyte', deped_school_id: '502717' });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.teacher.region, 'Region VIII');
    assert.equal(updated.body.teacher.division, 'Leyte');
    assert.equal(updated.body.teacher.deped_school_id, '502717');

    const me = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(me.body.teacher.region, 'Region VIII');
    assert.equal(me.body.teacher.division, 'Leyte');
    assert.equal(me.body.teacher.deped_school_id, '502717');
  });

  test('updating one detail leaves the others alone, and an empty string clears a detail back to null', async () => {
    const { token } = await signup();
    await api().patch('/api/teacher/me').set(bearer(token)).send({ region: 'Region VIII', division: 'Leyte', deped_school_id: '502717' });

    const one = await api().patch('/api/teacher/me').set(bearer(token)).send({ division: 'Tacloban City' });
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.teacher.region, 'Region VIII');
    assert.equal(one.body.teacher.division, 'Tacloban City');
    assert.equal(one.body.teacher.deped_school_id, '502717');

    const cleared = await api().patch('/api/teacher/me').set(bearer(token)).send({ region: '' });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.teacher.region, null);
    assert.equal(cleared.body.teacher.division, 'Tacloban City');
  });

  test('the locked-fields rule still holds: school and assignment cannot change through the profile update', async () => {
    const { token } = await signup();
    const refused = await api().patch('/api/teacher/me').set(bearer(token)).send({ school_id: otherSchoolId });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));

    const me = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(me.body.teacher.school_id, schoolId);
  });

  test('overlong school details are refused', async () => {
    const { token } = await signup();
    const longRegion = await api().patch('/api/teacher/me').set(bearer(token)).send({ region: 'R'.repeat(61) });
    assert.equal(longRegion.status, 400, JSON.stringify(longRegion.body));
    const longId = await api().patch('/api/teacher/me').set(bearer(token)).send({ deped_school_id: '1'.repeat(21) });
    assert.equal(longId.status, 400, JSON.stringify(longId.body));
  });
});

// ---------- Migration 011: school head name for the SF2 footer ----------

describe('School head name for the SF2 footer', () => {
  test('the profile returns the school head name, null when unset', async () => {
    const { token } = await signup();
    const me = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.teacher.school_head_name, null);
  });

  test('the teacher can save the school head name, clear it, and it prints on the SF2 report with the adviser name', async () => {
    const { token } = await signup();
    const updated = await api()
      .patch('/api/teacher/me')
      .set(bearer(token))
      .send({ school_head_name: 'Jonathan D. Bacallo' });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.teacher.school_head_name, 'Jonathan D. Bacallo');

    const me = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(me.body.teacher.school_head_name, 'Jonathan D. Bacallo');

    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    await enrol(token, klass.id, alex.id);
    const report = await getSf2(token, klass.id, '2026-07');
    assert.equal(report.status, 200, JSON.stringify(report.body));
    assert.equal(report.body.school.school_head_name, 'Jonathan D. Bacallo');
    assert.equal(report.body.adviser_name, `${me.body.teacher.first_name} ${me.body.teacher.last_name}`);

    const cleared = await api().patch('/api/teacher/me').set(bearer(token)).send({ school_head_name: '' });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.teacher.school_head_name, null);
  });

  test('an overlong school head name is refused', async () => {
    const { token } = await signup();
    const refused = await api()
      .patch('/api/teacher/me')
      .set(bearer(token))
      .send({ school_head_name: 'N'.repeat(101) });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
  });
});

// ---------- Final grades data (filed-only) ----------

describe('Final grades data', () => {
  test('period_grades follow the filed-only rule under the active profile, and no final appears until every period is filed', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, isabella.id);

    const sheet = await getSheet(token, klass.id, 1);
    assert.equal(sheet.grading.code, 'do015_adjusted');
    assert.deepEqual(sheet.grading.periods, [1, 2, 3]);

    // Only Term 1 filed, for Alex only.
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));
    await submitQuarter(token, klass.id, 1);

    const afterOne = await getSheet(token, klass.id, 1);
    assert.equal(afterOne.finals.filed_periods, 1);
    assert.equal(afterOne.finals.total_periods, 3);
    assert.deepEqual(afterOne.finals.period_grades[alex.id], { 1: 90, 2: null, 3: null });
    assert.deepEqual(afterOne.finals.period_grades[isabella.id], { 1: null, 2: null, 3: null });
    assert.equal(afterOne.finals.grades[alex.id], null);
    assert.equal(afterOne.finals.grades[isabella.id], null);

    // File Terms 2 and 3 for Alex: the final appears as the mean.
    const sheet2 = await getSheet(token, klass.id, 2);
    await saveScores(token, klass.id, 2, scoresFor(sheet2, alex, WORKED));
    await submitQuarter(token, klass.id, 2);
    const sheet3 = await getSheet(token, klass.id, 3);
    await saveScores(token, klass.id, 3, scoresFor(sheet3, alex, WORKED));
    await submitQuarter(token, klass.id, 3);

    const filed = await getSheet(token, klass.id, 1);
    assert.equal(filed.finals.filed_periods, 3);
    assert.deepEqual(filed.finals.period_grades[alex.id], { 1: 90, 2: 90, 3: 90 });
    assert.equal(filed.finals.grades[alex.id], 90);
    assert.equal(filed.finals.grades[isabella.id], null);

    // Editing Term 1 after filing clears that term and the final until re-filed.
    const edited = scoresFor(sheet, alex, WORKED);
    edited[0].score = 10;
    await saveScores(token, klass.id, 1, edited);
    const cleared = await getSheet(token, klass.id, 1);
    assert.equal(cleared.finals.period_grades[alex.id][1], null);
    assert.equal(cleared.finals.period_grades[alex.id][2], 90);
    assert.equal(cleared.finals.grades[alex.id], null);
  });

  test('the final grade is the rounded mean of the filed period grades', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    // Term grades 90, 68 and 100 -> mean 86.
    const sheet1 = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet1, alex, WORKED));
    await submitQuarter(token, klass.id, 1);
    const sheet2 = await getSheet(token, klass.id, 2);
    await saveScores(token, klass.id, 2, scoresFor(sheet2, alex, LOW));
    await submitQuarter(token, klass.id, 2);
    const sheet3 = await getSheet(token, klass.id, 3);
    await saveScores(token, klass.id, 3, scoresFor(sheet3, alex, PERFECT));
    await submitQuarter(token, klass.id, 3);

    const filed = await getSheet(token, klass.id, 1);
    assert.deepEqual(filed.finals.period_grades[alex.id], { 1: 90, 2: 68, 3: 100 });
    assert.equal(filed.finals.grades[alex.id], 86);
  });
});

// ---------- SF2 ----------

describe('SF2 daily attendance report', () => {
  test('day columns are Monday–Friday only, with the right weekday letters, and weekend rolls never appear', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { grade_level: 7 });
    const klass = await makeClass(token, { subject, section_name: 'Luke', grade_level: 7 });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    // July 2026: the 1st is a Wednesday. Rolls saved on the weekend too —
    // the report must still exclude them.
    await saveRoll(token, klass.id, '2026-07-03', [{ learner_id: alex.id, status: 'present', method: 'manual', time_in: '07:30' }]);
    await saveRoll(token, klass.id, '2026-07-04', [{ learner_id: alex.id, status: 'absent', method: 'manual' }]);
    await saveRoll(token, klass.id, '2026-07-05', [{ learner_id: alex.id, status: 'absent', method: 'manual' }]);
    await saveRoll(token, klass.id, '2026-07-06', [{ learner_id: alex.id, status: 'absent', method: 'manual' }]);

    const response = await getSf2(token, klass.id, '2026-07');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const report = response.body;
    assert.equal(report.days.length, 23);
    assert.deepEqual(report.days[0], { date: '2026-07-01', day: 1, weekday: 'W' });
    assert.deepEqual(report.days[2], { date: '2026-07-03', day: 3, weekday: 'F' });
    assert.deepEqual(report.days[3], { date: '2026-07-06', day: 6, weekday: 'M' });
    assert.ok(!report.days.some((day) => day.date === '2026-07-04' || day.date === '2026-07-05'));

    const row = report.learners.find((learner) => learner.id === alex.id);
    assert.equal(row.marks['2026-07-03'], 'present');
    assert.equal(row.marks['2026-07-06'], 'absent');
    assert.equal(row.marks['2026-07-04'], undefined);
    assert.equal(row.marks['2026-07-05'], undefined);
    // The weekend absences are out of the totals too; every other July
    // school day is blank, and blank counts as present.
    assert.deepEqual(row.totals, { present: 22, absent: 1 });
  });

  test('marks and totals follow the blank-means-present rule: excused is separate, blank days count as present', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { grade_level: 7 });
    const klass = await makeClass(token, { subject, section_name: 'Luke', grade_level: 7 });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, isabella.id);

    await saveRoll(token, klass.id, '2026-07-06', [
      { learner_id: alex.id, status: 'present', method: 'manual', time_in: '07:30' },
      { learner_id: isabella.id, status: 'excused', method: 'manual' },
    ]);
    await saveRoll(token, klass.id, '2026-07-07', [
      { learner_id: alex.id, status: 'excused', method: 'manual' },
      { learner_id: isabella.id, status: 'late', method: 'manual', time_in: '07:45' },
    ]);
    await saveRoll(token, klass.id, '2026-07-08', [
      { learner_id: alex.id, status: 'absent', method: 'manual' },
    ]);
    // 2026-07-09: no roll saved at all.

    const response = await getSf2(token, klass.id, '2026-07');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const alexRow = response.body.learners.find((learner) => learner.id === alex.id);
    const isabellaRow = response.body.learners.find((learner) => learner.id === isabella.id);

    assert.equal(alexRow.marks['2026-07-06'], 'present');
    assert.equal(alexRow.marks['2026-07-07'], 'excused');
    assert.equal(alexRow.marks['2026-07-08'], 'absent');
    assert.equal(alexRow.marks['2026-07-09'], undefined);
    assert.deepEqual(alexRow.totals, { present: 21, absent: 1 });

    // Blank days count as present: the total is the month's 23 school days
    // minus absent and excused days. Late counts as present; the excused
    // day is in neither total.
    assert.equal(isabellaRow.marks['2026-07-06'], 'excused');
    assert.equal(isabellaRow.marks['2026-07-07'], 'late');
    assert.equal(isabellaRow.marks['2026-07-08'], undefined);
    assert.deepEqual(isabellaRow.totals, { present: 22, absent: 0 });
  });

  test('the report carries the class, school and month header fields, including the teacher-entered school details', async () => {
    const { token } = await signup();
    await api().patch('/api/teacher/me').set(bearer(token)).send({ region: 'Region VIII', division: 'Leyte', deped_school_id: '502717' });
    const subject = await makeSubject(token, { grade_level: 7 });
    const klass = await makeClass(token, { subject, section_name: 'Tatus', grade_level: 7 });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const response = await getSf2(token, klass.id, '2026-07');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const report = response.body;
    assert.equal(report.month, '2026-07');
    assert.equal(report.month_label, 'JULY');
    assert.equal(report.school_year, '2026 - 2027');
    assert.equal(report.school.name, 'DepEd Forms Test School');
    assert.equal(report.school.region, 'Region VIII');
    assert.equal(report.school.division, 'Leyte');
    assert.equal(report.school.deped_school_id, '502717');
    assert.equal(report.class.grade_level, 7);
    assert.equal(report.class.section_name, 'Tatus');
    // No rolls saved: every mark blank, and blank counts as present, so
    // all 23 July school days are present.
    assert.deepEqual(report.learners[0].totals, { present: 23, absent: 0 });
    assert.equal(Object.keys(report.learners[0].marks).length, 0);
  });

  test('learners are Male first, then Female, each group alphabetical by last name', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const zed = await makeLearner(token, { first_name: 'Zed', last_name: 'Zulu', sex: 'Male' });
    const amy = await makeLearner(token, { first_name: 'Amy', last_name: 'Abad', sex: 'Female' });
    const bob = await makeLearner(token, { first_name: 'Bob', last_name: 'Mora', sex: 'Male' });
    const eve = await makeLearner(token, { first_name: 'Eve', last_name: 'Aquino', sex: 'Female' });
    await enrol(token, klass.id, zed.id);
    await enrol(token, klass.id, amy.id);
    await enrol(token, klass.id, bob.id);
    await enrol(token, klass.id, eve.id);

    const response = await getSf2(token, klass.id, '2026-07');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(
      response.body.learners.map((learner) => `${learner.last_name} (${learner.sex})`),
      ['Mora (Male)', 'Zulu (Male)', 'Abad (Female)', 'Aquino (Female)'],
    );
  });

  test('the Combined TOTAL Per Day row counts present and late per day, and its totals sum the month', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, isabella.id);

    await saveRoll(token, klass.id, '2026-07-06', [
      { learner_id: alex.id, status: 'present', method: 'manual', time_in: '07:30' },
      { learner_id: isabella.id, status: 'late', method: 'manual', time_in: '07:45' },
    ]);
    await saveRoll(token, klass.id, '2026-07-07', [
      { learner_id: alex.id, status: 'absent', method: 'manual' },
      { learner_id: isabella.id, status: 'excused', method: 'manual' },
    ]);
    // 2026-07-08: no roll saved at all.

    const response = await getSf2(token, klass.id, '2026-07');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const { combined } = response.body;
    assert.equal(combined.present_by_day['2026-07-06'], 2);
    assert.equal(combined.present_by_day['2026-07-07'], 0);
    // No roll on 2026-07-08: both learners are blank, and blank counts as
    // present. The month total is 2 + 0 + 21 days x 2 learners.
    assert.equal(combined.present_by_day['2026-07-08'], 2);
    assert.deepEqual(combined.totals, { present: 44, absent: 1 });
  });

  test('the footer summary follows the form formulas: registered, average daily attendance, percentage, five consecutive days', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    const bob = await makeLearner(token, { first_name: 'Bob', last_name: 'Mora', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, bob.id);
    await enrol(token, klass.id, isabella.id);

    const present = (learner_id) => ({ learner_id, status: 'present', method: 'manual', time_in: '07:30' });
    const absent = (learner_id) => ({ learner_id, status: 'absent', method: 'manual' });
    const late = (learner_id) => ({ learner_id, status: 'late', method: 'manual', time_in: '07:45' });
    const excused = (learner_id) => ({ learner_id, status: 'excused', method: 'manual' });
    // July 2026 has 23 Monday–Friday days. Alex: 5 present, then 5 absent
    // in a row (13–17 July), then 1 present. Bob: 3 present, 3 absent over
    // a weekend (9, 10, 13 July — consecutive school days, but only 3), 1
    // excused. Isabella: 6 days, one of them late.
    await saveRoll(token, klass.id, '2026-07-06', [present(alex.id), present(bob.id), late(isabella.id)]);
    await saveRoll(token, klass.id, '2026-07-07', [present(alex.id), present(bob.id), present(isabella.id)]);
    await saveRoll(token, klass.id, '2026-07-08', [present(alex.id), present(bob.id), present(isabella.id)]);
    await saveRoll(token, klass.id, '2026-07-09', [present(alex.id), absent(bob.id), present(isabella.id)]);
    await saveRoll(token, klass.id, '2026-07-10', [present(alex.id), absent(bob.id), present(isabella.id)]);
    await saveRoll(token, klass.id, '2026-07-13', [absent(alex.id), absent(bob.id), present(isabella.id)]);
    await saveRoll(token, klass.id, '2026-07-14', [absent(alex.id), excused(bob.id)]);
    await saveRoll(token, klass.id, '2026-07-15', [absent(alex.id)]);
    await saveRoll(token, klass.id, '2026-07-16', [absent(alex.id)]);
    await saveRoll(token, klass.id, '2026-07-17', [absent(alex.id)]);
    await saveRoll(token, klass.id, '2026-07-20', [present(alex.id)]);

    const response = await getSf2(token, klass.id, '2026-07');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const { summary } = response.body;
    assert.equal(summary.days_of_classes, 23);
    // Registered: 2 male, 1 female. Present-days under blank-means-
    // present: male 37 (Alex 18 + Bob 19), female 23.
    assert.deepEqual(summary.male, {
      registered: 2,
      average_daily_attendance: 1.6,
      percentage_of_attendance: 80.4,
      absent_five_days: 1,
    });
    assert.deepEqual(summary.female, {
      registered: 1,
      average_daily_attendance: 1,
      percentage_of_attendance: 100,
      absent_five_days: 0,
    });
    assert.deepEqual(summary.total, {
      registered: 3,
      average_daily_attendance: 2.6,
      percentage_of_attendance: 87,
      absent_five_days: 1,
    });
  });

  test('the gender TOTAL rows count their own group per day, and the combined row is their sum', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    const bob = await makeLearner(token, { first_name: 'Bob', last_name: 'Mora', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, bob.id);
    await enrol(token, klass.id, isabella.id);

    await saveRoll(token, klass.id, '2026-07-06', [
      { learner_id: alex.id, status: 'present', method: 'manual', time_in: '07:30' },
      { learner_id: bob.id, status: 'absent', method: 'manual' },
      { learner_id: isabella.id, status: 'excused', method: 'manual' },
    ]);
    await saveRoll(token, klass.id, '2026-07-07', [
      { learner_id: alex.id, status: 'absent', method: 'manual' },
      { learner_id: bob.id, status: 'present', method: 'manual', time_in: '07:30' },
      { learner_id: isabella.id, status: 'late', method: 'manual', time_in: '07:45' },
    ]);
    // No other rolls: every other July school day is blank, and blank
    // counts as present.

    const response = await getSf2(token, klass.id, '2026-07');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const { totals_by_gender: gender, combined } = response.body;

    // Male: 1 present on each marked day, 2 on each of the other 21 days.
    assert.equal(gender.male.present_by_day['2026-07-06'], 1);
    assert.equal(gender.male.present_by_day['2026-07-07'], 1);
    assert.equal(gender.male.present_by_day['2026-07-08'], 2);
    assert.deepEqual(gender.male.totals, { present: 44, absent: 2 });
    // Female: excused on the 6th, late on the 7th, blank (present) after.
    assert.equal(gender.female.present_by_day['2026-07-06'], 0);
    assert.equal(gender.female.present_by_day['2026-07-07'], 1);
    assert.equal(gender.female.present_by_day['2026-07-08'], 1);
    assert.deepEqual(gender.female.totals, { present: 22, absent: 0 });
    // The combined row is the sum of the two gender rows, day by day.
    for (const date of Object.keys(combined.present_by_day)) {
      assert.equal(
        combined.present_by_day[date],
        gender.male.present_by_day[date] + gender.female.present_by_day[date],
      );
    }
    assert.deepEqual(combined.totals, {
      present: gender.male.totals.present + gender.female.totals.present,
      absent: gender.male.totals.absent + gender.female.totals.absent,
    });
    // Learner totals follow the same rule.
    const rows = Object.fromEntries(response.body.learners.map((learner) => [learner.id, learner]));
    assert.deepEqual(rows[alex.id].totals, { present: 22, absent: 1 });
    assert.deepEqual(rows[bob.id].totals, { present: 22, absent: 1 });
    assert.deepEqual(rows[isabella.id].totals, { present: 22, absent: 0 });
  });

  test('a gender with no learners has no total row', async () => {
    const { token } = await signup();
    const boys = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    await enrol(token, boys.id, alex.id);
    const girls = await makeClass(token, { section_name: 'Mark' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', sex: 'Female' });
    await enrol(token, girls.id, isabella.id);

    const boysReport = await getSf2(token, boys.id, '2026-07');
    assert.equal(boysReport.status, 200, JSON.stringify(boysReport.body));
    assert.notEqual(boysReport.body.totals_by_gender.male, null);
    assert.equal(boysReport.body.totals_by_gender.female, null);
    assert.deepEqual(boysReport.body.totals_by_gender.male.totals, { present: 23, absent: 0 });

    const girlsReport = await getSf2(token, girls.id, '2026-07');
    assert.equal(girlsReport.status, 200, JSON.stringify(girlsReport.body));
    assert.equal(girlsReport.body.totals_by_gender.male, null);
    assert.notEqual(girlsReport.body.totals_by_gender.female, null);
    assert.deepEqual(girlsReport.body.totals_by_gender.female.totals, { present: 23, absent: 0 });
  });

  test('SF2 refuses a bad month, another teacher’s class, and anonymous requests', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const badMonth = await getSf2(token, klass.id, '2026-13');
    assert.equal(badMonth.status, 400, JSON.stringify(badMonth.body));
    const wordMonth = await getSf2(token, klass.id, 'July');
    assert.equal(wordMonth.status, 400, JSON.stringify(wordMonth.body));
    const missingMonth = await api().get(`/api/teacher/attendance/sf2?class_id=${klass.id}`).set(bearer(token));
    assert.equal(missingMonth.status, 400, JSON.stringify(missingMonth.body));

    const other = await signup({ school_id: otherSchoolId });
    const foreign = await getSf2(other.token, klass.id, '2026-07');
    assert.equal(foreign.status, 404, JSON.stringify(foreign.body));

    const anon = await api().get(`/api/teacher/attendance/sf2?class_id=${klass.id}&month=2026-07`);
    assert.equal(anon.status, 401, JSON.stringify(anon.body));
  });
});
