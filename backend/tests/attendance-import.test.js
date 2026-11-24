// Batch 8 fix 15 tests: uploading past attendance records as a CSV grid.
// A teacher who joined AcadSync after classes started fills in earlier
// months from a paper record book. Marks import exactly like a saved roll,
// nothing already saved is overwritten, and marks on non-school days or
// after today are skipped and reported.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

const TEACHER_PASSWORD = 'TeacherPass123';

let adminToken;
let schoolId;
let counter = 0;

// Manila today, worked out the same way the API does it.
function manilaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

before(async () => {
  await resetDatabase();
  await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Attendance Import Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;
});

after(async () => {
  await pool.end();
});

async function signup(overrides = {}) {
  counter += 1;
  const email = `importteacher${counter}@test.local`;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'Import',
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

async function makeSubject(token) {
  counter += 1;
  const response = await api()
    .post('/api/teacher/subjects')
    .set(bearer(token))
    .send({ name: `Subject${counter}`, grade_level: 10 });
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
    .send({ first_name: 'Learner', last_name: `Test${counter}`, learner_id: `STU-IMP-${1000 + counter}`, sex: 'Female', ...overrides });
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

async function setCalendar(email, start, end, holidays = []) {
  await pool.query('UPDATE teachers SET classes_start_date = $2, classes_end_date = $3 WHERE email = $1', [email, start, end]);
  const teacher = await pool.query('SELECT id FROM teachers WHERE email = $1', [email]);
  for (const holiday of holidays) {
    await pool.query('INSERT INTO teacher_holidays (teacher_id, date, name) VALUES ($1, $2, $3)', [teacher.rows[0].id, holiday.date, holiday.name]);
  }
}

async function makeClassWithLearners(token, learnerCount = 2) {
  const klass = await makeClass(token);
  const learners = [];
  for (let i = 0; i < learnerCount; i += 1) {
    const learner = await makeLearner(token);
    await enrol(token, klass.id, learner.id);
    learners.push(learner);
  }
  return { klass, learners };
}

async function importRecords(token, classId, records) {
  return api().post('/api/teacher/attendance/import').set(bearer(token)).send({ class_id: classId, records });
}

async function getRoll(token, classId, date) {
  return api().get(`/api/teacher/attendance?class_id=${classId}&date=${date}`).set(bearer(token));
}

describe('Import template', () => {
  test('the template lists the roster with one column per school day of the month', async () => {
    const teacher = await signup();
    await setCalendar(teacher.email, '2026-06-15', '2027-04-30', [{ date: '2026-11-04', name: 'Test Holiday' }]);
    const { klass, learners } = await makeClassWithLearners(teacher.token);

    const response = await api()
      .get(`/api/teacher/attendance/import-template?class_id=${klass.id}&month=2026-11`)
      .set(bearer(teacher.token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.match(response.headers['content-type'], /text\/csv/);
    const text = response.text.replace(/^\uFEFF/, '');
    const lines = text.trim().split('\r\n');
    const header = lines[0].split(',');
    // Monday 2026-11-02 is in, Saturday 2026-11-07 and the holiday are out.
    assert.ok(header.includes('2026-11-02'), header.join(','));
    assert.ok(!header.includes('2026-11-07'), header.join(','));
    assert.ok(!header.includes('2026-11-04'), header.join(','));
    assert.equal(header[0], 'Learner ID');
    assert.equal(header[1], 'Student Name');
    for (const learner of learners) {
      assert.ok(lines.some((line) => line.startsWith(learner.learner_id)), text);
    }
  });

  test("a teacher who never set calendar dates gets every weekday of the month", async () => {
    const { token } = await signup();
    const { klass } = await makeClassWithLearners(token);
    const response = await api()
      .get(`/api/teacher/attendance/import-template?class_id=${klass.id}&month=2026-11`)
      .set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const header = response.text.replace(/^\uFEFF/, '').trim().split('\r\n')[0].split(',');
    assert.ok(header.includes('2026-11-02'));
    assert.ok(header.includes('2026-11-30'));
  });

  test("another teacher's class and a signed-out request are refused", async () => {
    const { token } = await signup();
    const { klass } = await makeClassWithLearners(token);
    const other = await signup();
    const refused = await api()
      .get(`/api/teacher/attendance/import-template?class_id=${klass.id}&month=2026-11`)
      .set(bearer(other.token));
    assert.equal(refused.status, 404, JSON.stringify(refused.body));
    const anon = await api().get(`/api/teacher/attendance/import-template?class_id=${klass.id}&month=2026-11`);
    assert.equal(anon.status, 401, JSON.stringify(anon.body));
  });
});

describe('Import', () => {
  test('marks from several months import and show on the roll and SF2', async () => {
    const { token } = await signup();
    const { klass, learners } = await makeClassWithLearners(token);
    const [first, second] = learners;

    const response = await importRecords(token, klass.id, [
      { learner_id: first.id, date: '2026-06-15', status: 'present' },
      { learner_id: first.id, date: '2026-06-16', status: 'late' },
      { learner_id: first.id, date: '2026-07-01', status: 'absent' },
      { learner_id: second.id, date: '2026-06-15', status: 'excused' },
    ]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.imported, 4);
    assert.deepEqual(response.body.skipped, []);

    const roll = await getRoll(token, klass.id, '2026-06-15');
    assert.equal(roll.status, 200, JSON.stringify(roll.body));
    const firstMark = roll.body.learners.find((row) => row.id === first.id).mark;
    assert.equal(firstMark.status, 'present');
    assert.equal(firstMark.method, 'manual');
    assert.equal(firstMark.time_in, null);
    const secondMark = roll.body.learners.find((row) => row.id === second.id).mark;
    assert.equal(secondMark.status, 'excused');

    const sf2 = await api().get(`/api/teacher/attendance/sf2?class_id=${klass.id}&month=2026-06`).set(bearer(token));
    assert.equal(sf2.status, 200, JSON.stringify(sf2.body));
    const sf2Learner = sf2.body.learners.find((row) => row.id === first.id);
    assert.equal(sf2Learner.marks['2026-06-15'], 'present');
    assert.equal(sf2Learner.marks['2026-06-16'], 'late');
  });

  test('a day already saved is skipped and the saved mark is left alone', async () => {
    const { token } = await signup();
    const { klass, learners } = await makeClassWithLearners(token);
    const [first] = learners;

    const saved = await api()
      .post('/api/teacher/attendance')
      .set(bearer(token))
      .send({ class_id: klass.id, date: '2026-06-15', marks: [{ learner_id: first.id, status: 'present', method: 'manual', time_in: '07:32' }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const response = await importRecords(token, klass.id, [
      { learner_id: first.id, date: '2026-06-15', status: 'absent' },
      { learner_id: first.id, date: '2026-06-16', status: 'present' },
    ]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.imported, 1);
    assert.equal(response.body.skipped.length, 1);
    assert.equal(response.body.skipped[0].reason, 'already_saved');
    assert.equal(response.body.skipped[0].date, '2026-06-15');

    const roll = await getRoll(token, klass.id, '2026-06-15');
    const mark = roll.body.learners.find((row) => row.id === first.id).mark;
    assert.equal(mark.status, 'present');
    assert.equal(mark.time_in, '07:32');
  });

  test('weekends, holidays and days outside the school calendar are skipped', async () => {
    const teacher = await signup();
    await setCalendar(teacher.email, '2026-06-15', '2027-04-30', [{ date: '2026-06-17', name: 'Test Holiday' }]);
    const { klass, learners } = await makeClassWithLearners(teacher.token);
    const [first] = learners;

    const response = await importRecords(teacher.token, klass.id, [
      { learner_id: first.id, date: '2026-06-15', status: 'present' },
      { learner_id: first.id, date: '2026-06-17', status: 'present' },
      { learner_id: first.id, date: '2026-06-20', status: 'present' },
      { learner_id: first.id, date: '2026-06-14', status: 'present' },
    ]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.imported, 1);
    assert.deepEqual(
      response.body.skipped.map((row) => row.reason),
      ['not_a_school_day', 'not_a_school_day', 'not_a_school_day']
    );
  });

  test('a future date is skipped, and a duplicate row in the file is skipped once', async () => {
    const { token } = await signup();
    const { klass, learners } = await makeClassWithLearners(token);
    const [first] = learners;
    const future = addDays(manilaToday(), 1);

    const response = await importRecords(token, klass.id, [
      { learner_id: first.id, date: '2026-06-15', status: 'present' },
      { learner_id: first.id, date: '2026-06-15', status: 'late' },
      { learner_id: first.id, date: future, status: 'present' },
    ]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.imported, 1);
    assert.deepEqual(
      response.body.skipped.map((row) => row.reason),
      ['duplicate_in_file', 'future_date']
    );
    const roll = await getRoll(token, klass.id, '2026-06-15');
    assert.equal(roll.body.learners.find((row) => row.id === first.id).mark.status, 'present');
  });

  test('a learner who is not enrolled in the class is skipped', async () => {
    const { token } = await signup();
    const { klass, learners } = await makeClassWithLearners(token);
    const outsider = await makeLearner(token);

    const response = await importRecords(token, klass.id, [
      { learner_id: learners[0].id, date: '2026-06-15', status: 'present' },
      { learner_id: outsider.id, date: '2026-06-15', status: 'present' },
    ]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.imported, 1);
    assert.equal(response.body.skipped.length, 1);
    assert.equal(response.body.skipped[0].reason, 'not_enrolled');
  });

  test('invalid marks, an empty file and another teacher\u2019s class are refused', async () => {
    const { token } = await signup();
    const { klass, learners } = await makeClassWithLearners(token);
    const [first] = learners;

    const badStatus = await importRecords(token, klass.id, [{ learner_id: first.id, date: '2026-06-15', status: 'sleeping' }]);
    assert.equal(badStatus.status, 400, JSON.stringify(badStatus.body));
    const badDate = await importRecords(token, klass.id, [{ learner_id: first.id, date: '2026-02-31', status: 'present' }]);
    assert.equal(badDate.status, 400, JSON.stringify(badDate.body));
    const empty = await importRecords(token, klass.id, []);
    assert.equal(empty.status, 400, JSON.stringify(empty.body));

    const other = await signup();
    const refused = await importRecords(other.token, klass.id, [{ learner_id: first.id, date: '2026-06-15', status: 'present' }]);
    assert.equal(refused.status, 404, JSON.stringify(refused.body));
    const anon = await api().post('/api/teacher/attendance/import').send({ class_id: klass.id, records: [{ learner_id: first.id, date: '2026-06-15', status: 'present' }] });
    assert.equal(anon.status, 401, JSON.stringify(anon.body));

    // Nothing was stored by the refused attempts.
    const roll = await getRoll(token, klass.id, '2026-06-15');
    assert.equal(roll.body.learners.find((row) => row.id === first.id).mark, null);
  });
});
