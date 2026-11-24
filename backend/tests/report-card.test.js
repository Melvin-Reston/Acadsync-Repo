// Teacher Batch 5 tests: the Report Card (DepEd School Form 9) — cards built
// from real consolidated grades and attendance, plus the teacher's comments.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');
const deped = require('../src/utils/deped');
const { schoolYearMonths, ageOnJune1 } = require('../src/controllers/reportCard.controller');

let superToken;
let adminToken;
let schoolId;
let counter = 0;

const TEACHER_PASSWORD = 'TeacherPass123';

let melvinToken;
let johnToken;
let elmerToken;
let plainToken;

let sacramentsClass;
let musicClass;
let algebraClass;
let etechClass;

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Report Card Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const melvin = await signup('Melvin', 'Reston');
  melvinToken = melvin.token;
  const john = await signup('John', 'Maniago');
  johnToken = john.token;
  const elmer = await signup('Elmer', 'Datalayta');
  elmerToken = elmer.token;
  const plain = await signup('Plain', 'Teacher');
  plainToken = plain.token;
  await setAdviser(melvinToken, 10, 'Luke');

  // One section, three subject teachers, the same two learners by learner ID.
  sacramentsClass = await makeClass(melvinToken, { subjectName: 'Sacraments', section_name: 'Luke', room: 'Annex A' });
  musicClass = await makeClass(johnToken, { subjectName: 'Music and Arts', section_name: 'Luke', room: 'Room 8' });
  algebraClass = await makeClass(elmerToken, { subjectName: 'Intro to Algebra', section_name: 'Luke', room: 'Room 5' });
  etechClass = await makeClass(johnToken, { subjectName: 'Empowerment Technologies', section_name: 'Luke', room: 'Room 2' });

  // The learners are created once and enrolled into every class: the
  // shared school directory means every teacher enrols the same rows.
  const learners = await makeLearners(melvinToken);
  await enrol(melvinToken, sacramentsClass.id, learners.alex.id);
  await enrol(melvinToken, sacramentsClass.id, learners.isabella.id);
  await enrol(johnToken, musicClass.id, learners.alex.id);
  await enrol(johnToken, musicClass.id, learners.isabella.id);
  await enrol(johnToken, etechClass.id, learners.alex.id);
  await enrol(johnToken, etechClass.id, learners.isabella.id);
  await enrol(elmerToken, algebraClass.id, learners.alex.id);
  await enrol(elmerToken, algebraClass.id, learners.isabella.id);

  // Grades: Sacraments and Music and Arts filed for all three terms,
  // Intro to Algebra filed for Term 1 only, Empowerment Technologies
  // never filed — so it must not appear on the card at all.
  await fileSubject(melvinToken, sacramentsClass.id, [1, 2, 3]);
  await fileSubject(johnToken, musicClass.id, [1, 2, 3]);
  await fileSubject(elmerToken, algebraClass.id, [1]);

  // Attendance: June and July 2026, across two classes on the same day,
  // so one day can carry a present mark in one class and an absent mark
  // in another.
  await saveRoll(melvinToken, sacramentsClass.id, '2026-06-02', [
    { learner_id: learnerPk(melvinToken, 'Alex'), status: 'present' },
    { learner_id: learnerPk(melvinToken, 'Isabella'), status: 'absent' },
  ]);
  await saveRoll(melvinToken, sacramentsClass.id, '2026-06-03', [
    { learner_id: learnerPk(melvinToken, 'Alex'), status: 'late' },
    { learner_id: learnerPk(melvinToken, 'Isabella'), status: 'present' },
  ]);
  await saveRoll(melvinToken, sacramentsClass.id, '2026-06-04', [
    { learner_id: learnerPk(melvinToken, 'Alex'), status: 'excused' },
    { learner_id: learnerPk(melvinToken, 'Isabella'), status: 'excused' },
  ]);
  await saveRoll(melvinToken, sacramentsClass.id, '2026-07-01', [
    { learner_id: learnerPk(melvinToken, 'Alex'), status: 'present' },
    { learner_id: learnerPk(melvinToken, 'Isabella'), status: 'present' },
  ]);
  await saveRoll(johnToken, musicClass.id, '2026-06-02', [
    { learner_id: learnerPk(johnToken, 'Alex'), status: 'absent' },
    { learner_id: learnerPk(johnToken, 'Isabella'), status: 'present' },
  ]);
});

after(async () => {
  await pool.end();
});

// ---------- Small helpers ----------

const learnerPks = new Map(); // `${token}:${first}` -> learner database id

async function signup(first, last) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: first,
      last_name: last,
      email: `reportcard${counter}@test.local`,
      mobile: '09171234567',
      school_id: schoolId,
      password: TEACHER_PASSWORD,
      terms_accepted: true,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function makeSubject(token, name) {
  const response = await api()
    .post('/api/teacher/subjects')
    .set(bearer(token))
    .send({ name, grade_level: 10 });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.subject;
}

async function makeClass(token, overrides = {}) {
  const subject = await makeSubject(token, overrides.subjectName);
  const response = await api()
    .post('/api/teacher/classes')
    .set(bearer(token))
    .send({
      subject_id: subject.id,
      grade_level: 10,
      section_name: overrides.section_name || 'Luke',
      room: overrides.room || 'Room 1',
      academic_year: overrides.academic_year || '2026-2027',
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
  learnerPks.set(overrides.first_name, response.body.learner.id);
  return response.body.learner;
}

function learnerPk(_token, first) {
  return learnerPks.get(first);
}

async function makeLearners(token) {
  const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
  const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', learner_id: 'STU-2026-1039', sex: 'Female' });
  return { alex, isabella };
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

async function getSheet(token, classId, quarter) {
  const response = await api().get(`/api/teacher/grades/${classId}?quarter=${quarter}`).set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

// The worked example, checked by hand, under DO 015 adjusted (core weights
// 20/50/30): WW 20,22,25,18 /25; PT 45,48,50,40 /50; EX 42,45,40 /50 ->
// initial 88.01, term grade 90. Under MAPEH weights (20/60/20) the same
// scores give initial 88.74, still term grade 90.
// LOW: initial 40 -> term grade 68.
const WORKED = { ww: [20, 22, 25, 18], pt: [45, 48, 50, 40], ex: [42, 45, 40] };
const LOW = { ww: [10, 10, 10, 10], pt: [20, 20, 20, 20], ex: [20, 20, 20] };
// The same worked example under DO 8 (one QA column, weights 30/50/20):
// initial 88.05 -> QG 92. LOW under DO 8: initial 40 -> QG 70.
const WORKED_DO8 = { ww: [20, 22, 25, 18], pt: [45, 48, 50, 40], ex: [42] };
const LOW_DO8 = { ww: [10, 10, 10, 10], pt: [20, 20, 20, 20], ex: [20] };

function scoresFor(sheet, learnerId, values) {
  const byKey = new Map(sheet.columns.map((column) => [`${column.component}:${column.position}`, column]));
  const out = [];
  for (const [component, list] of Object.entries(values)) {
    list.forEach((score, index) => {
      out.push({ column_id: byKey.get(`${component.toUpperCase()}:${index + 1}`).id, learner_id: learnerId, score });
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
}

// File one subject for the given periods: both learners' scores, then submit.
async function fileSubject(token, classId, periods, values = { alex: WORKED, isabella: LOW }) {
  for (const period of periods) {
    const sheet = await getSheet(token, classId, period);
    const alex = sheet.learners.find((learner) => learner.learner_id === 'STU-2026-1048');
    const isabella = sheet.learners.find((learner) => learner.learner_id === 'STU-2026-1039');
    await saveScores(token, classId, period, [
      ...scoresFor(sheet, alex.id, values.alex),
      ...scoresFor(sheet, isabella.id, values.isabella),
    ]);
    const filed = await api().post(`/api/teacher/grades/${classId}/submit`).set(bearer(token)).send({ quarter: period });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
  }
}

async function saveRoll(token, classId, date, marks) {
  const response = await api()
    .post('/api/teacher/attendance')
    .set(bearer(token))
    .send({ class_id: classId, date, marks });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

async function getCards(token) {
  const response = await api().get('/api/teacher/report-card').set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

function cardFor(cards, learnerId) {
  return cards.learners.find((learner) => learner.learner_id === learnerId);
}

function subjectRow(card, subjectName) {
  return card.subjects.find((subject) => subject.subject_name === subjectName);
}

// ---------- Helpers (unit) ----------

describe('Report card helpers', () => {
  test('the school year runs Jun to Apr', () => {
    const months = schoolYearMonths('2026-2027');
    assert.equal(months.length, 11);
    assert.deepEqual(months[0], { key: '2026-06', label: 'Jun' });
    assert.deepEqual(months[6], { key: '2026-12', label: 'Dec' });
    assert.deepEqual(months[7], { key: '2027-01', label: 'Jan' });
    assert.deepEqual(months[10], { key: '2027-04', label: 'Apr' });
  });

  test('descriptor table under DO 015: Advancing down to Emerging', () => {
    const table = deped.descriptorTable('do015_adjusted');
    assert.equal(table.length, 5);
    assert.deepEqual(table[0], { range: '90–100', descriptor: 'Advancing', remarks: 'Passed' });
    assert.deepEqual(table[2], { range: '75–79', descriptor: 'Connecting', remarks: 'Passed' });
    assert.deepEqual(table[4], { range: '0–64', descriptor: 'Emerging', remarks: 'Failed' });
  });

  test('age on June 1 of the school year, from the birthdate', () => {
    assert.equal(ageOnJune1('2010-05-20', '2026-2027'), 16);
    assert.equal(ageOnJune1('2010-06-01', '2026-2027'), 16);
    assert.equal(ageOnJune1('2010-06-02', '2026-2027'), 15);
    assert.equal(ageOnJune1('2012-02-29', '2026-2027'), 14);
    assert.equal(ageOnJune1('2010-05-20', '2025-2026'), 15);
    assert.equal(ageOnJune1(null, '2026-2027'), null);
    assert.equal(ageOnJune1('', '2026-2027'), null);
    assert.equal(ageOnJune1('2010-05-20', ''), null);
  });

  test('descriptor table under DO 8: Outstanding down to Did Not Meet Expectations', () => {
    const table = deped.descriptorTable('do8_2015');
    assert.equal(table.length, 5);
    assert.deepEqual(table[0], { range: '90–100', descriptor: 'Outstanding', remarks: 'Passed' });
    assert.deepEqual(table[3], { range: '75–79', descriptor: 'Fairly Satisfactory', remarks: 'Passed' });
    assert.deepEqual(table[4], { range: 'Below 75', descriptor: 'Did Not Meet Expectations', remarks: 'Failed' });
  });
});

// ---------- The card, from real grades ----------

describe('Report card data', () => {
  test('the card names the adviser, the school and the grading system', async () => {
    const cards = await getCards(melvinToken);
    assert.equal(cards.has_advisory, true);
    assert.equal(cards.adviser.grade, 10);
    assert.equal(cards.adviser.section, 'Luke');
    assert.equal(cards.adviser.name, 'Reston, Melvin');
    assert.equal(cards.school_name, 'Report Card Test School');
    assert.equal(cards.school_head_name, 'Test Principal');
    assert.equal(cards.academic_year, '2026-2027');
    assert.equal(cards.grading.code, 'do015_adjusted');
    assert.deepEqual(cards.grading.periods, [1, 2, 3]);
    assert.equal(cards.grading.period_label, 'Term');
    assert.equal(cards.descriptors[0].descriptor, 'Advancing');
    assert.equal(cards.months.length, 11);
    assert.equal(cards.months[0].key, '2026-06');
  });

  test('only subjects with filed grades appear, in consolidation order', async () => {
    const cards = await getCards(melvinToken);
    assert.deepEqual(
      cards.subjects.map((subject) => subject.subject_name),
      ['Intro to Algebra', 'Music and Arts', 'Sacraments']
    );
    assert.equal(cards.subjects[1].teacher_name, 'Maniago, John');
  });

  test('learners come in roster order, last name first', async () => {
    const cards = await getCards(melvinToken);
    assert.deepEqual(
      cards.learners.map((learner) => learner.learner_id),
      ['STU-2026-1039', 'STU-2026-1048']
    );
    assert.equal(cards.learners[0].last_name, 'Flores');
    assert.equal(cards.learners[0].sex, 'Female');
  });

  test('final grades are the mean of the filed term grades, with Passed and Failed remarks', async () => {
    const cards = await getCards(melvinToken);
    const alex = cardFor(cards, 'STU-2026-1048');
    const sacraments = subjectRow(alex, 'Sacraments');
    assert.deepEqual(sacraments.period_grades, [90, 90, 90]);
    assert.equal(sacraments.final_grade, 90);
    assert.equal(sacraments.remarks, 'Passed');
    const music = subjectRow(alex, 'Music and Arts');
    assert.deepEqual(music.period_grades, [90, 90, 90]);
    assert.equal(music.final_grade, 90);
    assert.equal(music.remarks, 'Passed');

    const isabella = cardFor(cards, 'STU-2026-1039');
    const isabellaSacraments = subjectRow(isabella, 'Sacraments');
    assert.deepEqual(isabellaSacraments.period_grades, [68, 68, 68]);
    assert.equal(isabellaSacraments.final_grade, 68);
    assert.equal(isabellaSacraments.remarks, 'Failed');
  });

  test('a partially filed subject shows — for the missing terms and no final grade', async () => {
    const cards = await getCards(melvinToken);
    const alex = cardFor(cards, 'STU-2026-1048');
    const algebra = subjectRow(alex, 'Intro to Algebra');
    assert.deepEqual(algebra.period_grades, [90, null, null]);
    assert.equal(algebra.final_grade, null);
    assert.equal(algebra.remarks, null);
  });

  test('the general average stays blank until every subject has a final grade', async () => {
    const cards = await getCards(melvinToken);
    const alex = cardFor(cards, 'STU-2026-1048');
    assert.equal(alex.general_average, null);
    assert.equal(alex.general_average_remarks, null);
    const isabella = cardFor(cards, 'STU-2026-1039');
    assert.equal(isabella.general_average, null);
  });

  test('attendance counts real days: present or late is present, excused is its own count', async () => {
    const cards = await getCards(melvinToken);
    const alex = cardFor(cards, 'STU-2026-1048');
    // Jun 2: present in Sacraments, absent in Music and Arts — one present day.
    // Jun 3: late. Jun 4: excused. Jul 1: present.
    assert.deepEqual(alex.attendance.months['2026-06'], { class_days: 3, present: 2, absent: 0, excused: 1 });
    assert.deepEqual(alex.attendance.months['2026-07'], { class_days: 1, present: 1, absent: 0, excused: 0 });
    assert.equal(alex.attendance.months['2026-08'], null);
    assert.equal(alex.attendance.months['2027-04'], null);
    assert.deepEqual(alex.attendance.totals, { class_days: 4, present: 3, absent: 0, excused: 1 });

    const isabella = cardFor(cards, 'STU-2026-1039');
    // Jun 2: absent in Sacraments, present in Music and Arts — one present day.
    assert.deepEqual(isabella.attendance.months['2026-06'], { class_days: 3, present: 2, absent: 0, excused: 1 });
    assert.deepEqual(isabella.attendance.totals, { class_days: 4, present: 3, absent: 0, excused: 1 });
  });

  test('a learner with no attendance records has no totals', async () => {
    // A learner enrolled but never marked: add a third learner to one class.
    const third = await makeLearner(melvinToken, { first_name: 'Third', last_name: 'Learner', learner_id: 'STU-2026-1050', sex: 'Male' });
    await enrol(melvinToken, sacramentsClass.id, third.id);
    const cards = await getCards(melvinToken);
    const row = cardFor(cards, 'STU-2026-1050');
    assert.ok(row);
    assert.equal(row.attendance.months['2026-06'], null);
    assert.equal(row.attendance.totals, null);
    assert.deepEqual(subjectRow(row, 'Sacraments').period_grades, [null, null, null]);
  });

  test('age comes from the birthdate; no birthdate means no age', async () => {
    const aged = await makeLearner(melvinToken, { first_name: 'Aged', last_name: 'Learner', learner_id: 'STU-2026-1060', sex: 'Male', birthdate: '2010-05-20' });
    await enrol(melvinToken, sacramentsClass.id, aged.id);
    const cards = await getCards(melvinToken);
    assert.equal(cardFor(cards, 'STU-2026-1060').age, 16);
    // Alex has no birthdate on file.
    assert.equal(cardFor(cards, 'STU-2026-1048').age, null);
  });
});

// ---------- Access ----------

describe('Report card access', () => {
  test('a teacher with no advisory assignment gets NO_ADVISORY', async () => {
    const response = await api().get('/api/teacher/report-card').set(bearer(plainToken));
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'NO_ADVISORY');
  });

  test('a subject teacher who is not the adviser cannot open the cards', async () => {
    const response = await api().get('/api/teacher/report-card').set(bearer(johnToken));
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'NO_ADVISORY');
  });

  test('an adviser of another section only sees their own section', async () => {
    await setAdviser(elmerToken, 10, 'Matthew');
    const cards = await getCards(elmerToken);
    assert.equal(cards.adviser.section, 'Matthew');
    assert.deepEqual(cards.subjects, []);
    assert.deepEqual(cards.learners, []);
    // Put Elmer back: he is a subject teacher of Luke, not its adviser.
    await api().patch('/api/teacher/me/adviser').set(bearer(elmerToken)).send({ is_adviser: false });
  });

  test('a signed-out request is refused', async () => {
    const response = await api().get('/api/teacher/report-card');
    assert.equal(response.status, 401, JSON.stringify(response.body));
  });
});

// ---------- Teacher's comments ----------

describe("Teacher's comments", () => {
  test('a comment saves per learner per period and comes back on the card', async () => {
    const saved = await api()
      .put('/api/teacher/report-card/comments')
      .set(bearer(melvinToken))
      .send({ learner_id: 'STU-2026-1048', period: 1, comment: 'Steady work this term.' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.comment, 'Steady work this term.');

    const cards = await getCards(melvinToken);
    assert.equal(cardFor(cards, 'STU-2026-1048').comments['1'], 'Steady work this term.');
    assert.equal(cardFor(cards, 'STU-2026-1039').comments['1'], undefined);
  });

  test('saving again replaces the comment, and a blank comment clears it', async () => {
    await api().put('/api/teacher/report-card/comments').set(bearer(melvinToken))
      .send({ learner_id: 'STU-2026-1048', period: 2, comment: 'First draft.' });
    const replaced = await api().put('/api/teacher/report-card/comments').set(bearer(melvinToken))
      .send({ learner_id: 'STU-2026-1048', period: 2, comment: 'Kept improving.' });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.equal(replaced.body.comment, 'Kept improving.');

    const cleared = await api().put('/api/teacher/report-card/comments').set(bearer(melvinToken))
      .send({ learner_id: 'STU-2026-1048', period: 2, comment: '   ' });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.comment, null);

    const cards = await getCards(melvinToken);
    assert.equal(cardFor(cards, 'STU-2026-1048').comments['2'], undefined);
    assert.equal(cardFor(cards, 'STU-2026-1048').comments['1'], 'Steady work this term.');
  });

  test('a comment for a period the profile does not have is refused', async () => {
    const response = await api().put('/api/teacher/report-card/comments').set(bearer(melvinToken))
      .send({ learner_id: 'STU-2026-1048', period: 4, comment: 'Too late.' });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  test('a comment over 1000 characters is refused', async () => {
    const response = await api().put('/api/teacher/report-card/comments').set(bearer(melvinToken))
      .send({ learner_id: 'STU-2026-1048', period: 1, comment: 'x'.repeat(1001) });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  test('a comment for a learner outside the advisory section is refused', async () => {
    const response = await api().put('/api/teacher/report-card/comments').set(bearer(melvinToken))
      .send({ learner_id: 'STU-2026-9999', period: 1, comment: 'Not mine.' });
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  test('a teacher who is not the adviser cannot save a comment', async () => {
    const response = await api().put('/api/teacher/report-card/comments').set(bearer(johnToken))
      .send({ learner_id: 'STU-2026-1048', period: 1, comment: 'Not mine.' });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'NO_ADVISORY');
  });
});

// ---------- DO 8 (quarters) ----------

describe('Report card under DO 8', () => {
  test('quarters 1–4, QA grades, DO 8 descriptors and a whole-number general average', async () => {
    const switched = await api().put('/api/settings/academic-year').set(bearer(adminToken))
      .send({ academic_year: '2025-2026' });
    assert.equal(switched.status, 200, JSON.stringify(switched.body));
    try {
      const klass = await makeClass(melvinToken, { subjectName: 'Christian Living', section_name: 'Luke', room: 'Room 3', academic_year: '2025-2026' });
      // Melvin's learner rows from the 2026-2027 setup: the same learners,
      // enrolled in this year's class too.
      const alex = { id: learnerPk(melvinToken, 'Alex') };
      const isabella = { id: learnerPk(melvinToken, 'Isabella') };
      await enrol(melvinToken, klass.id, alex.id);
      await enrol(melvinToken, klass.id, isabella.id);
      await fileSubject(melvinToken, klass.id, [1, 2, 3, 4], { alex: WORKED_DO8, isabella: LOW_DO8 });

      const cards = await getCards(melvinToken);
      assert.equal(cards.academic_year, '2025-2026');
      assert.equal(cards.grading.code, 'do8_2015');
      assert.deepEqual(cards.grading.periods, [1, 2, 3, 4]);
      assert.equal(cards.grading.period_label, 'Quarter');
      assert.equal(cards.descriptors[0].descriptor, 'Outstanding');
      assert.equal(cards.descriptors[4].descriptor, 'Did Not Meet Expectations');
      assert.deepEqual(cards.subjects.map((s) => s.subject_name), ['Christian Living']);
      assert.equal(cards.months[0].key, '2025-06');
      assert.equal(cards.months[10].key, '2026-04');

      const alexCard = cardFor(cards, 'STU-2026-1048');
      const row = subjectRow(alexCard, 'Christian Living');
      assert.deepEqual(row.period_grades, [92, 92, 92, 92]);
      assert.equal(row.final_grade, 92);
      assert.equal(row.remarks, 'Passed');
      assert.equal(alexCard.general_average, 92);
      assert.equal(alexCard.general_average_remarks, 'Passed');

      const isabellaCard = cardFor(cards, 'STU-2026-1039');
      const isabellaRow = subjectRow(isabellaCard, 'Christian Living');
      assert.deepEqual(isabellaRow.period_grades, [70, 70, 70, 70]);
      assert.equal(isabellaRow.final_grade, 70);
      assert.equal(isabellaRow.remarks, 'Failed');
      assert.equal(isabellaCard.general_average, 70);
      assert.equal(isabellaCard.general_average_remarks, 'Failed');
    } finally {
      const restored = await api().put('/api/settings/academic-year').set(bearer(adminToken))
        .send({ academic_year: '2026-2027' });
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
    }
  });
});
