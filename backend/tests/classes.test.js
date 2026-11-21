// Teacher Batch 2 tests: subjects, classes, learners, enrolment, meetings and
// conflicts, the weekly timetable and CSV, today-classes, and ownership scoping.
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

function manilaWeekday(dateStr) {
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday; // 1 is Monday, 7 is Sunday
}

function mondayOf(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const back = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Classes Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const other = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Other Test School', category: 'Secondary', school_type: 'Private', city_region: 'Other City', principal_contact: 'Other Principal' });
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
      first_name: 'Class',
      last_name: `Teacher${counter}`,
      email: `classteacher${counter}@test.local`,
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
    .send({ first_name: 'Learner', last_name: `Test${counter}`, learner_id: `STU-2026-${1000 + counter}`, sex: 'Female', ...overrides });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.learner;
}

async function makeMeeting(token, classId, overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher/meetings')
    .set(bearer(token))
    .send({ class_id: classId, day_of_week: 1, start_time: '07:30', end_time: '08:30', room: `Room ${100 + counter}`, ...overrides });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.meeting;
}

// ---------- Subjects ----------

describe('Subjects', () => {
  test('create, list and update a subject; the same name in another grade is a different subject', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Music and Arts', grade_level: 10 });
    assert.equal(subject.class_count, 0);

    const otherGrade = await makeSubject(token, { name: 'Music and Arts', grade_level: 9 });
    assert.notEqual(otherGrade.id, subject.id);

    const list = await api().get('/api/teacher/subjects').set(bearer(token));
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 2);

    const updated = await api().patch(`/api/teacher/subjects/${subject.id}`).set(bearer(token)).send({ name: 'Music & Arts', grade_level: 10 });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.subject.name, 'Music & Arts');
  });

  test('the same subject name and grade twice is refused', async () => {
    const { token } = await signup();
    await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const again = await api().post('/api/teacher/subjects').set(bearer(token)).send({ name: 'Sacraments', grade_level: 10 });
    assert.equal(again.status, 409, JSON.stringify(again.body));
  });

  test('a subject used by a class cannot be deleted, and its grade cannot be changed', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Thinking and Study Skills', grade_level: 10 });
    await makeClass(token, { subject });

    const deleted = await api().delete(`/api/teacher/subjects/${subject.id}`).set(bearer(token));
    assert.equal(deleted.status, 409, JSON.stringify(deleted.body));

    const changed = await api().patch(`/api/teacher/subjects/${subject.id}`).set(bearer(token)).send({ name: 'Thinking and Study Skills', grade_level: 9 });
    assert.equal(changed.status, 400, JSON.stringify(changed.body));
  });

  test('an unused subject can be deleted, and another teacher cannot see or touch my subjects', async () => {
    const first = await signup();
    const second = await signup();
    const subject = await makeSubject(first.token, { name: 'Unused Subject', grade_level: 10 });

    const list = await api().get('/api/teacher/subjects').set(bearer(second.token));
    assert.equal(list.body.items.length, 0);

    const seen = await api().get(`/api/teacher/subjects/${subject.id}`).set(bearer(second.token));
    assert.equal(seen.status, 404);

    const deleted = await api().delete(`/api/teacher/subjects/${subject.id}`).set(bearer(first.token));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  });

  test('subject validation: name and a grade from 7 to 12 are required', async () => {
    const { token } = await signup();
    const bad = await api().post('/api/teacher/subjects').set(bearer(token)).send({ name: '', grade_level: 13 });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.ok(bad.body.errors.name);
    assert.ok(bad.body.errors.grade_level);
  });
});

// ---------- Classes ----------

describe('Classes', () => {
  test('create a class with an existing subject and with a new subject created on the spot', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke', room: 'Annex A' });
    assert.equal(klass.subject_name, 'Sacraments');
    assert.equal(klass.grade_level, 10);
    assert.equal(klass.section_name, 'Luke');
    assert.equal(klass.learner_count, 0);
    assert.equal(klass.meeting_count, 0);

    const fresh = await api()
      .post('/api/teacher/classes')
      .set(bearer(token))
      .send({ new_subject_name: 'Music and Arts', grade_level: 10, section_name: 'Luke', room: 'Room 8', academic_year: '2026-2027' });
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    assert.equal(fresh.body.class.subject_name, 'Music and Arts');

    const subjects = await api().get('/api/teacher/subjects').set(bearer(token));
    assert.equal(subjects.body.items.length, 2);
  });

  test('the same section twice in one subject, grade and year is refused', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    await makeClass(token, { subject, section_name: 'Luke' });
    const again = await api()
      .post('/api/teacher/classes')
      .set(bearer(token))
      .send({ subject_id: subject.id, grade_level: 10, section_name: 'Luke', room: 'Room 2', academic_year: '2026-2027' });
    assert.equal(again.status, 409, JSON.stringify(again.body));

    // The same section in another year is fine.
    const nextYear = await api()
      .post('/api/teacher/classes')
      .set(bearer(token))
      .send({ subject_id: subject.id, grade_level: 10, section_name: 'Luke', room: 'Room 2', academic_year: '2027-2028' });
    assert.equal(nextYear.status, 201, JSON.stringify(nextYear.body));
  });

  test('a class grade that does not match its subject is refused', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const response = await api()
      .post('/api/teacher/classes')
      .set(bearer(token))
      .send({ subject_id: subject.id, grade_level: 9, section_name: 'Luke', room: 'Room 2', academic_year: '2026-2027' });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  test('list filters by search, grade and academic year; counts are real enrolment counts', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Music and Arts', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const learner = await makeLearner(token);
    await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token)).send({ learner_id: learner.id });

    const list = await api().get('/api/teacher/classes').set(bearer(token));
    assert.equal(list.body.items[0].learner_count, 1);

    const byGrade = await api().get('/api/teacher/classes?grade=9').set(bearer(token));
    assert.equal(byGrade.body.items.length, 0);

    const bySearch = await api().get('/api/teacher/classes?search=luke').set(bearer(token));
    assert.equal(bySearch.body.items.length, 1);

    const byYear = await api().get('/api/teacher/classes?academic_year=2025-2026').set(bearer(token));
    assert.equal(byYear.body.items.length, 0);
  });

  test('class detail shows its learners and meetings; update and delete work', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke', room: 'Annex A' });
    const learner = await makeLearner(token);
    await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token)).send({ learner_id: learner.id });
    await makeMeeting(token, klass.id);

    const detail = await api().get(`/api/teacher/classes/${klass.id}`).set(bearer(token));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.class.learners.length, 1);
    assert.equal(detail.body.class.meetings.length, 1);
    assert.equal(detail.body.class.meetings[0].day_name, 'Monday');

    const updated = await api()
      .patch(`/api/teacher/classes/${klass.id}`)
      .set(bearer(token))
      .send({ subject_id: subject.id, section_name: 'Luke', room: 'Room 9', academic_year: '2026-2027' });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.class.room, 'Room 9');

    const deleted = await api().delete(`/api/teacher/classes/${klass.id}`).set(bearer(token));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    const gone = await api().get(`/api/teacher/classes/${klass.id}`).set(bearer(token));
    assert.equal(gone.status, 404);
    const meetings = await api().get('/api/teacher/meetings').set(bearer(token));
    assert.equal(meetings.body.items.length, 0, 'deleting a class deletes its meetings');
  });

  test('another teacher cannot see, edit or delete my classes', async () => {
    const first = await signup();
    const second = await signup();
    const subject = await makeSubject(first.token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(first.token, { subject, section_name: 'Luke' });

    assert.equal((await api().get('/api/teacher/classes').set(bearer(second.token))).body.items.length, 0);
    assert.equal((await api().get(`/api/teacher/classes/${klass.id}`).set(bearer(second.token))).status, 404);
    assert.equal(
      (await api().patch(`/api/teacher/classes/${klass.id}`).set(bearer(second.token)).send({ subject_id: subject.id, section_name: 'Luke', room: 'X', academic_year: '2026-2027' })).status,
      404
    );
    assert.equal((await api().delete(`/api/teacher/classes/${klass.id}`).set(bearer(second.token))).status, 404);
  });
});

// ---------- Learners and enrolment ----------

describe('Learners and enrolment', () => {
  test('create, list, update and delete a learner; the learner ID is unique per school, and a birthdate can be kept', async () => {
    const { token } = await signup();
    const learner = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male', birthdate: '2010-05-14' });
    assert.equal(learner.learner_id, 'STU-2026-1048');
    assert.equal(learner.birthdate, '2010-05-14');
    assert.ok(learner.school_name);

    const again = await api()
      .post('/api/teacher/learners')
      .set(bearer(token))
      .send({ first_name: 'Other', last_name: 'Person', learner_id: 'STU-2026-1048', sex: 'Female' });
    assert.equal(again.status, 409, JSON.stringify(again.body));

    // Another teacher of the same school may NOT use the same learner ID:
    // learners belong to the school, not to the teacher who added them.
    const other = await signup();
    const sameId = await api()
      .post('/api/teacher/learners')
      .set(bearer(other.token))
      .send({ first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    assert.equal(sameId.status, 409, JSON.stringify(sameId.body));

    // A teacher of another school may use the same learner ID.
    const elsewhere = await signup({ school_id: otherSchoolId });
    const sameIdThere = await makeLearner(elsewhere.token, { learner_id: 'STU-2026-1048' });
    assert.ok(sameIdThere.id);

    const updated = await api()
      .patch(`/api/teacher/learners/${learner.id}`)
      .set(bearer(token))
      .send({ first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male', birthdate: '2010-05-15' });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.learner.birthdate, '2010-05-15');

    // A future birthdate is refused.
    const future = await api()
      .patch(`/api/teacher/learners/${learner.id}`)
      .set(bearer(token))
      .send({ first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male', birthdate: '2999-01-01' });
    assert.equal(future.status, 400, JSON.stringify(future.body));

    const deleted = await api().delete(`/api/teacher/learners/${learner.id}`).set(bearer(token));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  });

  test('a learner with enrolments, attendance or grades cannot be deleted', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const learner = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera' });
    await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token)).send({ learner_id: learner.id });

    const refused = await api().delete(`/api/teacher/learners/${learner.id}`).set(bearer(token));
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match(refused.body.message, /enrolled/);

    // Once removed from the class, the learner has no records and can be deleted.
    await api().delete(`/api/teacher/classes/${klass.id}/learners/${learner.id}`).set(bearer(token));
    const deleted = await api().delete(`/api/teacher/learners/${learner.id}`).set(bearer(token));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  });

  test('enrol and remove learners; the class count follows the enrolment', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const first = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera' });
    const second = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores' });

    const enrolled = await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token)).send({ learner_id: first.id });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.body));
    assert.equal(enrolled.body.class.learner_count, 1);

    const twice = await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token)).send({ learner_id: first.id });
    assert.equal(twice.status, 409, JSON.stringify(twice.body));

    await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token)).send({ learner_id: second.id });
    const listed = await api().get(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token));
    assert.equal(listed.body.items.length, 2);
    assert.equal(listed.body.items[0].last_name, 'Flores');

    const removed = await api().delete(`/api/teacher/classes/${klass.id}/learners/${first.id}`).set(bearer(token));
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.class.learner_count, 1);

    const removedAgain = await api().delete(`/api/teacher/classes/${klass.id}/learners/${first.id}`).set(bearer(token));
    assert.equal(removedAgain.status, 404, JSON.stringify(removedAgain.body));
  });

  test('a teacher of the same school can enrol another teacher’s learner; a teacher of another school cannot', async () => {
    const first = await signup();
    const second = await signup();
    const subject = await makeSubject(second.token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(second.token, { subject, section_name: 'Luke' });
    const learner = await makeLearner(first.token);

    // The shared school directory: the learner is visible to the second teacher.
    const listed = await api().get(`/api/teacher/learners?search=${learner.learner_id}`).set(bearer(second.token));
    assert.equal(listed.body.items.length, 1, JSON.stringify(listed.body));
    assert.equal(listed.body.items[0].id, learner.id);

    const response = await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(second.token)).send({ learner_id: learner.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));

    // A teacher of another school cannot see or enrol the learner.
    const elsewhere = await signup({ school_id: otherSchoolId });
    const hidden = await api().get(`/api/teacher/learners?search=${learner.learner_id}`).set(bearer(elsewhere.token));
    assert.equal(hidden.body.items.length, 0, JSON.stringify(hidden.body));
    const subjectThere = await makeSubject(elsewhere.token, { name: 'Sacraments', grade_level: 10 });
    const klassThere = await makeClass(elsewhere.token, { subject: subjectThere, section_name: 'Luke' });
    const refused = await api()
      .post(`/api/teacher/classes/${klassThere.id}/learners`)
      .set(bearer(elsewhere.token))
      .send({ learner_id: learner.id });
    assert.equal(refused.status, 404, JSON.stringify(refused.body));
  });

  test('learner validation: sex must be Male or Female', async () => {
    const { token } = await signup();
    const bad = await api()
      .post('/api/teacher/learners')
      .set(bearer(token))
      .send({ first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-1', sex: 'Other' });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
  });
});

// ---------- Whole-week meetings ----------

describe('Whole-week meetings', () => {
  test('repeat for the whole week creates one meeting per weekday', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });

    const response = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: klass.id, day_of_week: 1, start_time: '14:00', end_time: '15:00', room: 'Room W1', repeat_week: true });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.meetings.length, 5);
    assert.deepEqual(
      response.body.meetings.map((meeting) => meeting.day_of_week),
      [1, 2, 3, 4, 5]
    );
    assert.equal(response.body.skipped.length, 0);

    const listed = await api().get('/api/teacher/meetings').set(bearer(token));
    assert.equal(listed.body.items.length, 5);
  });

  test('a day that would conflict is skipped and reported, and the other days are still added', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const other = await makeClass(token, { subject, section_name: 'Saint Augustine' });
    // Wednesday 14:00 is already taken by the other class of the same teacher.
    await makeMeeting(token, other.id, { day_of_week: 3, start_time: '14:00', end_time: '15:00', room: 'Room W2' });

    const response = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: klass.id, day_of_week: 1, start_time: '14:00', end_time: '15:00', room: 'Room W2', repeat_week: true });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.meetings.length, 4);
    assert.deepEqual(
      response.body.meetings.map((meeting) => meeting.day_of_week),
      [1, 2, 4, 5]
    );
    assert.equal(response.body.skipped.length, 1);
    assert.equal(response.body.skipped[0].day_of_week, 3);
    assert.match(response.body.skipped[0].reason, /Wednesday/);
    assert.match(response.body.message, /Skipped: Wednesday/);
  });

  test('when every day conflicts, nothing is added and the reason is plain', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const other = await makeClass(token, { subject, section_name: 'Saint Augustine' });
    await makeMeeting(token, other.id, { day_of_week: 1, start_time: '14:00', end_time: '15:00', room: 'Room W3', repeat_week: true });

    const response = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: klass.id, day_of_week: 1, start_time: '14:00', end_time: '15:00', room: 'Room W3', repeat_week: true });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(response.body.message, /No meeting was added/);
  });
});

// ---------- Bulk learner upload ----------

describe('Bulk learner upload', () => {
  const csv = (rows) => `first_name,last_name,learner_id,sex,birthdate\n${rows.join('\n')}\n`;

  test('the template downloads with the five columns and no rows', async () => {
    const { token } = await signup();
    const response = await api().get('/api/teacher/learners/upload-template').set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.match(response.headers['content-type'], /text\/csv/);
    assert.equal(response.text.replace(/^\uFEFF/, '').trim(), 'first_name,last_name,learner_id,sex,birthdate');
  });

  test('a valid file adds every learner, and uploading it again skips them all as duplicates', async () => {
    const { token } = await signup();
    const file = csv([
      'Alex,Rivera,STU-2026-2001,Male,2010-05-14',
      'Isabella,Flores,STU-2026-2002,Female,2010-08-02',
      '"Reyes, Jr.",Santos,STU-2026-2003,Male,',
    ]);

    const first = await api()
      .post('/api/teacher/learners/upload')
      .set(bearer(token))
      .attach('file', Buffer.from(file), 'learners.csv');
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(first.body.summary, { added: 3, skipped: 0, failed: 0, total: 3 });
    assert.equal(first.body.results[0].status, 'added');
    assert.equal(first.body.results[2].status, 'added'); // a quoted name with a comma works

    const listed = await api().get('/api/teacher/learners').set(bearer(token));
    const byId = (id) => listed.body.items.find((row) => row.learner_id === id);
    assert.ok(byId('STU-2026-2001'));
    assert.equal(byId('STU-2026-2001').birthdate, '2010-05-14');
    assert.equal(byId('STU-2026-2003').first_name, 'Reyes, Jr.');

    const second = await api()
      .post('/api/teacher/learners/upload')
      .set(bearer(token))
      .attach('file', Buffer.from(file), 'learners.csv');
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.deepEqual(second.body.summary, { added: 0, skipped: 3, failed: 0, total: 3 });
    assert.ok(second.body.results.every((row) => row.status === 'skipped'));
    assert.match(second.body.results[0].message, /already exists/);
  });

  test('bad rows are reported with their reason and never stop the good rows; nothing is overwritten', async () => {
    const { token } = await signup();
    const file = csv([
      'Alex,Rivera,STU-2026-2101,Male,2010-05-14',
      ',Flores,STU-2026-2102,Female,2010-08-02',
      'Bad,Sex,STU-2026-2103,Other,2010-01-01',
      'Bad,Date,STU-2026-2104,Male,2026-02-31',
      'Future,Born,STU-2026-2105,Female,2999-01-01',
    ]);

    const response = await api()
      .post('/api/teacher/learners/upload')
      .set(bearer(token))
      .attach('file', Buffer.from(file), 'learners.csv');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.deepEqual(response.body.summary, { added: 1, skipped: 0, failed: 4, total: 5 });
    assert.equal(response.body.results[0].status, 'added');
    assert.equal(response.body.results[1].status, 'error');
    assert.match(response.body.results[1].message, /required/);
    assert.match(response.body.results[2].message, /Male or Female/);
    assert.match(response.body.results[3].message, /real date/);
    assert.match(response.body.results[4].message, /future/);
    assert.equal(response.body.results[1].row, 3);
    assert.equal(response.body.results[4].row, 6);
  });

  test('a non-CSV file and a file with the wrong columns are refused', async () => {
    const { token } = await signup();

    const wrongType = await api()
      .post('/api/teacher/learners/upload')
      .set(bearer(token))
      .attach('file', Buffer.from('hello'), 'learners.txt');
    assert.equal(wrongType.status, 400, JSON.stringify(wrongType.body));

    const wrongColumns = await api()
      .post('/api/teacher/learners/upload')
      .set(bearer(token))
      .attach('file', Buffer.from('name,id\nAlex,STU-1\n'), 'learners.csv');
    assert.equal(wrongColumns.status, 400, JSON.stringify(wrongColumns.body));
    assert.match(wrongColumns.body.message, /first_name, last_name, learner_id, sex, birthdate/);

    const noFile = await api().post('/api/teacher/learners/upload').set(bearer(token));
    assert.equal(noFile.status, 400, JSON.stringify(noFile.body));
  });

  test('learners uploaded by one teacher are visible to another teacher of the same school', async () => {
    const first = await signup();
    const second = await signup();
    const file = csv(['Alex,Rivera,STU-2026-2201,Male,2010-05-14']);

    const uploaded = await api()
      .post('/api/teacher/learners/upload')
      .set(bearer(first.token))
      .attach('file', Buffer.from(file), 'learners.csv');
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));

    const listed = await api().get('/api/teacher/learners?search=STU-2026-2201').set(bearer(second.token));
    assert.equal(listed.body.items.length, 1);
    assert.equal(listed.body.items[0].learner_id, 'STU-2026-2201');
  });
});

describe('Meetings and conflicts', () => {
  test('create and list meetings; a meeting needs an end after its start', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const meeting = await makeMeeting(token, klass.id, { day_of_week: 3, start_time: '11:00', end_time: '12:00', room: 'Annex A' });
    assert.equal(meeting.subject_name, 'Sacraments');
    assert.equal(meeting.section_name, 'Luke');
    assert.equal(meeting.day_name, 'Wednesday');

    const bad = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: klass.id, day_of_week: 3, start_time: '12:00', end_time: '11:00', room: 'Annex A' });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));

    const listed = await api().get('/api/teacher/meetings?day_of_week=3').set(bearer(token));
    assert.equal(listed.body.items.length, 1);
  });

  test('an overlapping meeting of the same teacher is refused, but back-to-back is fine', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const first = await makeClass(token, { subject, section_name: 'Luke' });
    const second = await makeClass(token, { subject, section_name: 'Saint Augustine' });
    await makeMeeting(token, first.id, { day_of_week: 1, start_time: '07:30', end_time: '08:30', room: 'Room 5' });

    const overlap = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: second.id, day_of_week: 1, start_time: '08:00', end_time: '09:00', room: 'Room 6' });
    assert.equal(overlap.status, 409, JSON.stringify(overlap.body));

    const backToBack = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: second.id, day_of_week: 1, start_time: '08:30', end_time: '09:30', room: 'Room 6' });
    assert.equal(backToBack.status, 201, JSON.stringify(backToBack.body));

    const otherDay = await api()
      .post('/api/teacher/meetings')
      .set(bearer(token))
      .send({ class_id: second.id, day_of_week: 2, start_time: '07:30', end_time: '08:30', room: 'Room 6' });
    assert.equal(otherDay.status, 201, JSON.stringify(otherDay.body));
  });

  test('a room booked by another teacher of the same school is refused, but not by a teacher of another school', async () => {
    const first = await signup();
    const second = await signup();
    const third = await signup({ school_id: otherSchoolId });
    const subjectA = await makeSubject(first.token, { name: 'Sacraments', grade_level: 10 });
    const subjectB = await makeSubject(second.token, { name: 'Sacraments', grade_level: 10 });
    const subjectC = await makeSubject(third.token, { name: 'Sacraments', grade_level: 10 });
    const classA = await makeClass(first.token, { subject: subjectA, section_name: 'Luke' });
    const classB = await makeClass(second.token, { subject: subjectB, section_name: 'Luke' });
    const classC = await makeClass(third.token, { subject: subjectC, section_name: 'Luke' });
    await makeMeeting(first.token, classA.id, { day_of_week: 1, start_time: '07:30', end_time: '08:30', room: 'Room 7' });

    const sameSchool = await api()
      .post('/api/teacher/meetings')
      .set(bearer(second.token))
      .send({ class_id: classB.id, day_of_week: 1, start_time: '07:30', end_time: '08:30', room: 'Room 7' });
    assert.equal(sameSchool.status, 409, JSON.stringify(sameSchool.body));
    assert.ok(!JSON.stringify(sameSchool.body).includes('Sacraments'), 'the refusal must not name the other teacher’s class');

    const otherSchool = await api()
      .post('/api/teacher/meetings')
      .set(bearer(third.token))
      .send({ class_id: classC.id, day_of_week: 1, start_time: '07:30', end_time: '08:30', room: 'Room 7' });
    assert.equal(otherSchool.status, 201, JSON.stringify(otherSchool.body));
  });

  test('changing a meeting into a conflict is refused; deleting a meeting works', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const first = await makeMeeting(token, klass.id, { day_of_week: 1, start_time: '07:30', end_time: '08:30', room: 'Room 9' });
    const second = await makeMeeting(token, klass.id, { day_of_week: 1, start_time: '09:30', end_time: '10:30', room: 'Room 9' });

    const intoConflict = await api()
      .patch(`/api/teacher/meetings/${second.id}`)
      .set(bearer(token))
      .send({ day_of_week: 1, start_time: '08:00', end_time: '09:00', room: 'Room 9' });
    assert.equal(intoConflict.status, 409, JSON.stringify(intoConflict.body));

    const moved = await api()
      .patch(`/api/teacher/meetings/${second.id}`)
      .set(bearer(token))
      .send({ day_of_week: 2, start_time: '08:00', end_time: '09:00', room: 'Room 9' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    const deleted = await api().delete(`/api/teacher/meetings/${first.id}`).set(bearer(token));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  });

  test('another teacher cannot see or change my meetings', async () => {
    const first = await signup();
    const second = await signup();
    const subject = await makeSubject(first.token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(first.token, { subject, section_name: 'Luke' });
    const meeting = await makeMeeting(first.token, klass.id);

    assert.equal((await api().get('/api/teacher/meetings').set(bearer(second.token))).body.items.length, 0);
    assert.equal((await api().delete(`/api/teacher/meetings/${meeting.id}`).set(bearer(second.token))).status, 404);
  });
});

// ---------- Weekly timetable, CSV and today-classes ----------

describe('Schedules and today-classes', () => {
  test('the weekly timetable returns Monday to Friday with dates on each meeting', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    await makeMeeting(token, klass.id, { day_of_week: 1, start_time: '11:00', end_time: '12:00', room: 'Annex A' });

    const week = await api().get('/api/teacher/schedules?week_start=2026-11-04').set(bearer(token));
    assert.equal(week.status, 200, JSON.stringify(week.body));
    assert.equal(week.body.week_start, '2026-11-02', 'a Wednesday snaps back to its Monday');
    assert.equal(week.body.week_end, '2026-11-06');
    assert.equal(week.body.days.length, 5);
    assert.equal(week.body.days[0].day_name, 'Monday');
    assert.equal(week.body.days[4].day_name, 'Friday');
    assert.equal(week.body.meetings.length, 1);
    assert.equal(week.body.meetings[0].date, '2026-11-02');
    assert.equal(week.body.meetings[0].day_name, 'Monday');
  });

  test('the CSV download lists every meeting of the week', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Music and Arts', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    await makeMeeting(token, klass.id, { day_of_week: 2, start_time: '13:15', end_time: '14:15', room: 'Room 8' });

    const csv = await api().get('/api/teacher/schedules?week_start=2026-11-02&format=csv').set(bearer(token));
    assert.equal(csv.status, 200, JSON.stringify(csv.body));
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.headers['content-disposition'], /timetable-2026-11-02\.csv/);
    assert.ok(csv.text.includes('Day,Date,Start time,End time,Subject,Section,Room'));
    assert.ok(csv.text.includes('Music and Arts'));
    assert.ok(csv.text.includes('2026-11-03'));
  });

  test('today-classes shows the class in progress and the next one, in Manila time', async () => {
    const { token } = await signup();
    const { date, time } = manilaNow();
    const weekday = manilaWeekday(date);
    if (weekday > 5) {
      // Saturday or Sunday: nobody has classes today.
      const today = await api().get('/api/teacher/today-classes').set(bearer(token));
      assert.equal(today.body.items.length, 0);
      return;
    }

    const subject = await makeSubject(token, { name: 'Thinking and Study Skills', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    // A meeting later today is the "next" class. Late at night there is no later
    // time left today, so the list is honestly empty instead.
    if (time < '22:00') {
      await makeMeeting(token, klass.id, { day_of_week: weekday, start_time: '23:00', end_time: '23:30', room: 'Room 6' });

      const today = await api().get('/api/teacher/today-classes').set(bearer(token));
      assert.equal(today.status, 200, JSON.stringify(today.body));
      assert.equal(today.body.items.length, 1);
      assert.equal(today.body.items[0].status, 'next');
      assert.equal(today.body.items[0].title, 'Thinking and Study Skills · Luke');
      assert.equal(today.body.items[0].room, 'Room 6');
    } else {
      const today = await api().get('/api/teacher/today-classes').set(bearer(token));
      assert.equal(today.body.items.length, 0);
    }
    assert.ok(time, 'the test ran with a real Manila time');
  });

  test('today-classes shows "now" for the class in progress and the next one after it', async () => {
    const { token } = await signup();
    const { date } = manilaNow();
    const weekday = manilaWeekday(date);
    if (weekday > 5) {
      const today = await api().get('/api/teacher/today-classes').set(bearer(token));
      assert.equal(today.body.items.length, 0);
      return;
    }

    const subject = await makeSubject(token, { name: 'Music and Arts', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    // 00:00–23:59 covers the whole day, so it is always the class in progress.
    await makeMeeting(token, klass.id, { day_of_week: weekday, start_time: '00:00', end_time: '23:59', room: 'Room 8' });

    const today = await api().get('/api/teacher/today-classes').set(bearer(token));
    assert.equal(today.body.items.length, 1);
    assert.equal(today.body.items[0].status, 'now');
  });

  test('today-classes is empty when the teacher has no meetings today', async () => {
    const { token } = await signup();
    const today = await api().get('/api/teacher/today-classes').set(bearer(token));
    assert.equal(today.status, 200);
    assert.deepEqual(today.body.items, []);
  });

  test('today-classes needs a teacher token', async () => {
    const response = await api().get('/api/teacher/today-classes');
    assert.equal(response.status, 401);
  });

  test('the dashboard carries class counts and today’s classes', async () => {
    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    const klass = await makeClass(token, { subject, section_name: 'Luke' });
    const learner = await makeLearner(token);
    await api().post(`/api/teacher/classes/${klass.id}/learners`).set(bearer(token)).send({ learner_id: learner.id });

    const dashboard = await api().get('/api/teacher/dashboard').set(bearer(token));
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
    assert.equal(dashboard.body.class_count, 1);
    assert.equal(dashboard.body.learner_count, 1);
    assert.ok(Array.isArray(dashboard.body.today_classes));
  });
});
