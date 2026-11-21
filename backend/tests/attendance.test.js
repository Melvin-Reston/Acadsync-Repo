// Teacher Batch 3 tests: the daily roll sheet (save/load/update, one row per
// learner per date, time-in stamping, future-date refusal, CSV), the QR
// check-in (lookup, confirm, refusals for non-enrolled and other teachers'
// learners), and ownership scoping for every resource.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

let superToken;
let adminToken;
let schoolId;
let otherSchoolId;
let counter = 0;

const TEACHER_PASSWORD = 'TeacherPass123';

// Manila time, worked out the same way the API does it.
function manilaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Attendance Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const other = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Other Attendance School', category: 'Secondary', school_type: 'Private', city_region: 'Other City', principal_contact: 'Other Principal' });
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
      first_name: 'Attendance',
      last_name: `Teacher${counter}`,
      email: `attendanceteacher${counter}@test.local`,
      mobile: '09171234567',
      school_id: overrides.school_id || schoolId,
      password: TEACHER_PASSWORD,
      terms_accepted: true,
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
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
    .send({ first_name: 'Learner', last_name: `Test${counter}`, learner_id: `STU-2026-${2000 + counter}`, sex: 'Female', ...overrides });
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

// A class with two enrolled learners, ready for a roll.
async function makeClassWithLearners(token) {
  const klass = await makeClass(token);
  const first = await makeLearner(token);
  const second = await makeLearner(token);
  await enrol(token, klass.id, first.id);
  await enrol(token, klass.id, second.id);
  return { klass, first, second };
}

async function getRoll(token, classId, date) {
  const response = await api()
    .get(`/api/teacher/attendance?class_id=${classId}&date=${date}`)
    .set(bearer(token));
  return response;
}

async function saveRoll(token, classId, date, marks) {
  return api()
    .post('/api/teacher/attendance')
    .set(bearer(token))
    .send({ class_id: classId, date, marks });
}

// ---------- The roll ----------

describe('Roll', () => {
  test('an empty roll lists the enrolled learners with no marks, and saving marks them', async () => {
    const { token } = await signup();
    const { klass, first, second } = await makeClassWithLearners(token);
    const today = manilaNow().date;

    const empty = await getRoll(token, klass.id, today);
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.learners.length, 2);
    assert.equal(empty.body.saved, false);
    assert.equal(empty.body.learners[0].mark, null);
    assert.equal(empty.body.class.subject_name, klass.subject_name);

    const saved = await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'present', method: 'manual', time_in: '07:32' },
      { learner_id: second.id, status: 'late', method: 'manual', time_in: '07:45' },
    ]);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.saved, 2);

    const loaded = await getRoll(token, klass.id, today);
    assert.equal(loaded.body.saved, true);
    const firstMark = loaded.body.learners.find((row) => row.id === first.id).mark;
    assert.equal(firstMark.status, 'present');
    assert.equal(firstMark.time_in, '07:32');
    assert.equal(firstMark.method, 'manual');
    const secondMark = loaded.body.learners.find((row) => row.id === second.id).mark;
    assert.equal(secondMark.status, 'late');
    assert.equal(secondMark.time_in, '07:45');
  });

  test('re-saving a date replaces it, keeps the time-in when the status did not change, and clears a mark that is dropped', async () => {
    const { token } = await signup();
    const { klass, first, second } = await makeClassWithLearners(token);
    const today = manilaNow().date;

    await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'present', method: 'manual', time_in: '07:30' },
      { learner_id: second.id, status: 'absent', method: 'manual' },
    ]);

    // Same status for the first learner (no time sent): the 07:30 time-in stays.
    // The second learner is dropped from the roll: their mark is cleared.
    const resaved = await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'present', method: 'manual' },
    ]);
    assert.equal(resaved.status, 200, JSON.stringify(resaved.body));

    const loaded = await getRoll(token, klass.id, today);
    const firstMark = loaded.body.learners.find((row) => row.id === first.id).mark;
    assert.equal(firstMark.time_in, '07:30');
    assert.equal(loaded.body.learners.find((row) => row.id === second.id).mark, null);

    // The first learner is now late: a new time-in is stamped.
    await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'late', method: 'manual', time_in: '08:05' },
    ]);
    const changed = await getRoll(token, klass.id, today);
    assert.equal(changed.body.learners.find((row) => row.id === first.id).mark.time_in, '08:05');
  });

  test('present and late without a time-in are stamped with the current Manila time; absent and excused have no time-in', async () => {
    const { token } = await signup();
    const { klass, first, second } = await makeClassWithLearners(token);
    const today = manilaNow().date;
    const now = manilaNow().time;

    await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'present', method: 'manual' },
      { learner_id: second.id, status: 'excused', method: 'manual' },
    ]);
    const loaded = await getRoll(token, klass.id, today);
    const firstMark = loaded.body.learners.find((row) => row.id === first.id).mark;
    assert.equal(firstMark.time_in, now);
    assert.equal(loaded.body.learners.find((row) => row.id === second.id).mark.time_in, null);
  });

  test('a future date is refused for reading and saving, and an invalid date is refused', async () => {
    const { token } = await signup();
    const { klass, first } = await makeClassWithLearners(token);
    const tomorrow = addDays(manilaNow().date, 1);

    const read = await getRoll(token, klass.id, tomorrow);
    assert.equal(read.status, 400, JSON.stringify(read.body));

    const saved = await saveRoll(token, klass.id, tomorrow, [{ learner_id: first.id, status: 'present' }]);
    assert.equal(saved.status, 400, JSON.stringify(saved.body));

    const invalid = await saveRoll(token, klass.id, '2026-02-31', [{ learner_id: first.id, status: 'present' }]);
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
  });

  test('a learner who is not enrolled cannot be in the roll, and the same learner twice is refused', async () => {
    const { token } = await signup();
    const { klass, first } = await makeClassWithLearners(token);
    const outsider = await makeLearner(token);
    const today = manilaNow().date;

    const notEnrolled = await saveRoll(token, klass.id, today, [{ learner_id: outsider.id, status: 'present' }]);
    assert.equal(notEnrolled.status, 400, JSON.stringify(notEnrolled.body));

    const twice = await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'present' },
      { learner_id: first.id, status: 'late' },
    ]);
    assert.equal(twice.status, 400, JSON.stringify(twice.body));
  });

  test('attendance survives unenrolling the learner (the history is kept)', async () => {
    const { token } = await signup();
    const { klass, first, second } = await makeClassWithLearners(token);
    const today = manilaNow().date;

    await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'present', method: 'manual', time_in: '07:30' },
      { learner_id: second.id, status: 'present', method: 'manual', time_in: '07:31' },
    ]);
    const removed = await api()
      .delete(`/api/teacher/classes/${klass.id}/learners/${first.id}`)
      .set(bearer(token));
    assert.equal(removed.status, 200, JSON.stringify(removed.body));

    const rows = await pool.query('SELECT status FROM attendance WHERE class_id = $1 AND date = $2', [klass.id, today]);
    assert.equal(rows.rowCount, 2);
    assert.deepEqual(rows.rows.map((row) => row.status).sort(), ['present', 'present']);
  });

  test('a class with no learners shows an empty roll', async () => {
    const { token } = await signup();
    const klass = await makeClass(token);
    const today = manilaNow().date;
    const roll = await getRoll(token, klass.id, today);
    assert.equal(roll.status, 200, JSON.stringify(roll.body));
    assert.equal(roll.body.learners.length, 0);
    assert.equal(roll.body.saved, false);
  });

  test('the CSV day sheet lists every learner with status, time-in and method', async () => {
    const { token } = await signup();
    const { klass, first, second } = await makeClassWithLearners(token);
    const today = manilaNow().date;

    await saveRoll(token, klass.id, today, [
      { learner_id: first.id, status: 'present', method: 'qr', time_in: '07:32' },
      { learner_id: second.id, status: 'absent', method: 'manual' },
    ]);
    const csv = await api()
      .get(`/api/teacher/attendance?class_id=${klass.id}&date=${today}&format=csv`)
      .set(bearer(token));
    assert.equal(csv.status, 200, JSON.stringify(csv.body).slice(0, 200));
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /Learner ID,Last name,First name,Sex,Status,Time in,Method/);
    assert.match(csv.text, new RegExp(first.learner_id));
    assert.match(csv.text, /Present,7:32 AM,QR/);
    assert.match(csv.text, /Absent,,Manual/);
  });

  test('another teacher cannot read or save my roll, and a teacher token is required', async () => {
    const first = await signup();
    const second = await signup();
    const { klass, first: learner } = await makeClassWithLearners(first.token);
    const today = manilaNow().date;

    const read = await getRoll(second.token, klass.id, today);
    assert.equal(read.status, 404, JSON.stringify(read.body));

    const saved = await saveRoll(second.token, klass.id, today, [{ learner_id: learner.id, status: 'present' }]);
    assert.equal(saved.status, 404, JSON.stringify(saved.body));

    const noToken = await api().get(`/api/teacher/attendance?class_id=${klass.id}&date=${today}`);
    assert.equal(noToken.status, 401, JSON.stringify(noToken.body));
  });
});

// ---------- QR check-in ----------

describe('QR check-in', () => {
  test('lookup by QR payload and by bare ID, then confirm marks Present via QR with a stamped time-in', async () => {
    const { token } = await signup();
    const { klass, first } = await makeClassWithLearners(token);
    const today = manilaNow().date;
    const now = manilaNow().time;

    const byPayload = await api()
      .get(`/api/teacher/attendance/lookup?class_id=${klass.id}&date=${today}&code=${encodeURIComponent(`acadsync:${first.learner_id}`)}`)
      .set(bearer(token));
    assert.equal(byPayload.status, 200, JSON.stringify(byPayload.body));
    assert.equal(byPayload.body.learner.id, first.id);
    assert.equal(byPayload.body.mark, null);

    const byBareId = await api()
      .get(`/api/teacher/attendance/lookup?class_id=${klass.id}&date=${today}&code=${encodeURIComponent(first.learner_id)}`)
      .set(bearer(token));
    assert.equal(byBareId.status, 200, JSON.stringify(byBareId.body));

    const confirmed = await api()
      .post('/api/teacher/attendance/check-in')
      .set(bearer(token))
      .send({ class_id: klass.id, date: today, learner_id: first.id });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.mark.status, 'present');
    assert.equal(confirmed.body.mark.method, 'qr');
    assert.equal(confirmed.body.mark.time_in, now);
    assert.equal(confirmed.body.already_checked_in, false);

    // Confirming again does not move the time-in.
    const again = await api()
      .post('/api/teacher/attendance/check-in')
      .set(bearer(token))
      .send({ class_id: klass.id, date: today, learner_id: first.id });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.already_checked_in, true);
    assert.equal(again.body.mark.time_in, now);

    const roll = await getRoll(token, klass.id, today);
    assert.equal(roll.body.learners.find((row) => row.id === first.id).mark.method, 'qr');
  });

  test('lookup refuses an unknown ID and a learner who is not enrolled in this class', async () => {
    const { token } = await signup();
    const { klass } = await makeClassWithLearners(token);
    const outsider = await makeLearner(token);
    const today = manilaNow().date;

    const unknown = await api()
      .get(`/api/teacher/attendance/lookup?class_id=${klass.id}&date=${today}&code=STU-2026-9999`)
      .set(bearer(token));
    assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
    assert.match(unknown.body.message, /No learner with the ID/);

    const notEnrolled = await api()
      .get(`/api/teacher/attendance/lookup?class_id=${klass.id}&date=${today}&code=${encodeURIComponent(outsider.learner_id)}`)
      .set(bearer(token));
    assert.equal(notEnrolled.status, 404, JSON.stringify(notEnrolled.body));
    assert.match(notEnrolled.body.message, /is not enrolled in/);

    const checkIn = await api()
      .post('/api/teacher/attendance/check-in')
      .set(bearer(token))
      .send({ class_id: klass.id, date: today, learner_id: outsider.id });
    assert.equal(checkIn.status, 404, JSON.stringify(checkIn.body));
  });

  test('a QR check-in replaces a manual absent mark, and a future date is refused', async () => {
    const { token } = await signup();
    const { klass, first } = await makeClassWithLearners(token);
    const today = manilaNow().date;
    const tomorrow = addDays(today, 1);

    await saveRoll(token, klass.id, today, [{ learner_id: first.id, status: 'absent', method: 'manual' }]);
    const confirmed = await api()
      .post('/api/teacher/attendance/check-in')
      .set(bearer(token))
      .send({ class_id: klass.id, date: today, learner_id: first.id });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.mark.status, 'present');
    assert.equal(confirmed.body.mark.method, 'qr');

    const future = await api()
      .post('/api/teacher/attendance/check-in')
      .set(bearer(token))
      .send({ class_id: klass.id, date: tomorrow, learner_id: first.id });
    assert.equal(future.status, 400, JSON.stringify(future.body));
  });

  test('another teacher cannot look up or check in my learners', async () => {
    const first = await signup();
    const second = await signup();
    const { klass, first: learner } = await makeClassWithLearners(first.token);
    const today = manilaNow().date;

    const lookup = await api()
      .get(`/api/teacher/attendance/lookup?class_id=${klass.id}&date=${today}&code=${encodeURIComponent(learner.learner_id)}`)
      .set(bearer(second.token));
    assert.equal(lookup.status, 404, JSON.stringify(lookup.body));

    const checkIn = await api()
      .post('/api/teacher/attendance/check-in')
      .set(bearer(second.token))
      .send({ class_id: klass.id, date: today, learner_id: learner.id });
    assert.equal(checkIn.status, 404, JSON.stringify(checkIn.body));
  });

  test('today-classes now carries the class id, so the roll can default to the class meeting today', async () => {
    const { token } = await signup();
    const klass = await makeClass(token);
    const today = manilaNow().date;
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    // Only on a school day: a meeting in progress today shows up with its class id.
    if (weekday >= 1 && weekday <= 5) {
      // A meeting around the current Manila time, so it is the class in progress.
      const [hour, minute] = manilaNow().time.split(':').map(Number);
      const total = hour * 60 + minute;
      const start = Math.max(0, total - 30);
      const end = Math.min(23 * 60 + 59, total + 30);
      const hm = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
      await api()
        .post('/api/teacher/meetings')
        .set(bearer(token))
        .send({ class_id: klass.id, day_of_week: weekday, start_time: hm(start), end_time: hm(end), room: 'Room 1' });
      const response = await api().get('/api/teacher/today-classes').set(bearer(token));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.items.length, 1);
      assert.equal(response.body.items[0].class_id, klass.id);
      assert.equal(response.body.items[0].status, 'now');
    }
  });
});
