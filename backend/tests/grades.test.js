// Teacher Batch 4 tests: DepEd computation, grade sheets, columns, weights,
// submission to the adviser, and Academic Consolidation across teachers.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');
const deped = require('../src/utils/deped');

let superToken;
let adminToken;
let schoolId;
let counter = 0;

const TEACHER_PASSWORD = 'TeacherPass123';

let adviserToken;
let subjectToken;
let otherToken;

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Grades Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;
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
      first_name: 'Grade',
      last_name: `Teacher${counter}`,
      email: `gradeteacher${counter}@test.local`,
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

async function getSheet(token, classId, quarter = 1) {
  const response = await api().get(`/api/teacher/grades/${classId}?quarter=${quarter}`).set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

// The worked example, checked by hand, under the default profile for
// 2026-2027 (DO 015 adjusted, core weights 20/50/30): WW 20,22,25,18 /25;
// PT 45,48,50,40 /50; EX ST1 42, ST2 45, Term Exam 40 /50 ->
// PS 85 / 91.5 / 84.2, WS 17 / 45.75 / 25.26, initial 88.01, term grade 90.
const WORKED = { ww: [20, 22, 25, 18], pt: [45, 48, 50, 40], ex: [42, 45, 40] };
const LOW = { ww: [10, 10, 10, 10], pt: [20, 20, 20, 20], ex: [20, 20, 20] }; // initial 40 -> term grade 68
const PERFECT = { ww: [25, 25, 25, 25], pt: [50, 50, 50, 50], ex: [50, 50, 50] }; // initial 100 -> 100
// The same worked example under DO 8 (one QA column, weights 30/50/20):
// PS 85 / 91.5 / 84, WS 25.5 / 45.75 / 16.8, initial 88.05, QG 92.
const WORKED_DO8 = { ww: [20, 22, 25, 18], pt: [45, 48, 50, 40], ex: [42] };

function scoresFor(sheet, learner, values) {
  // Columns are found by component and position: the EX columns are named
  // "Summative Test 1" and friends under DO 015, and "QA1" under DO 8.
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

// ---------- DepEd computation (unit) ----------

describe('DepEd computation', () => {
  test('transmutation anchors: 100 -> 100, 60 -> 75, 0 -> 60 (DO 8)', () => {
    assert.equal(deped.transmute(100), 100);
    assert.equal(deped.transmute(99.99), 99);
    assert.equal(deped.transmute(98.4), 99);
    assert.equal(deped.transmute(96.8), 98);
    assert.equal(deped.transmute(84), 90);
    assert.equal(deped.transmute(60), 75);
    assert.equal(deped.transmute(59.99), 74);
    assert.equal(deped.transmute(56), 74);
    assert.equal(deped.transmute(4), 61);
    assert.equal(deped.transmute(3.99), 60);
    assert.equal(deped.transmute(0), 60);
    assert.equal(deped.transmute(null), null);
  });

  test('DO 015 adjusted anchors: 99.50 -> 100, 70 -> 75, 0 -> 60', () => {
    assert.equal(deped.transmute(100, 'do015_adjusted'), 100);
    assert.equal(deped.transmute(99.5, 'do015_adjusted'), 100);
    assert.equal(deped.transmute(99.49, 'do015_adjusted'), 99);
    assert.equal(deped.transmute(98.32, 'do015_adjusted'), 99);
    assert.equal(deped.transmute(87.95, 'do015_adjusted'), 90);
    assert.equal(deped.transmute(70, 'do015_adjusted'), 75);
    assert.equal(deped.transmute(69.99, 'do015_adjusted'), 74);
    assert.equal(deped.transmute(65.34, 'do015_adjusted'), 74);
    assert.equal(deped.transmute(60.67, 'do015_adjusted'), 73);
    assert.equal(deped.transmute(40, 'do015_adjusted'), 68);
    assert.equal(deped.transmute(4.68, 'do015_adjusted'), 61);
    assert.equal(deped.transmute(4.67, 'do015_adjusted'), 60);
    assert.equal(deped.transmute(0, 'do015_adjusted'), 60);
  });

  test('DO 015 zero-based: the term grade is the initial grade, rounded, with no floor', () => {
    assert.equal(deped.transmute(100, 'do015_zero_based'), 100);
    assert.equal(deped.transmute(87.95, 'do015_zero_based'), 88);
    assert.equal(deped.transmute(74.5, 'do015_zero_based'), 75);
    assert.equal(deped.transmute(74.4, 'do015_zero_based'), 74);
    assert.equal(deped.transmute(40, 'do015_zero_based'), 40);
    assert.equal(deped.transmute(0, 'do015_zero_based'), 0);
  });

  test('the floor is the profile default, and a set floor only ever raises the lowest grade', () => {
    assert.equal(deped.defaultFloor('do8_2015'), 60);
    assert.equal(deped.defaultFloor('do015_adjusted'), 60);
    assert.equal(deped.defaultFloor('do015_zero_based'), 0);
    // Adjusted: a floor below 60 changes nothing — the table bottoms at 60.
    assert.equal(deped.transmute(0, 'do015_adjusted', 0), 60);
    assert.equal(deped.transmute(0, 'do015_adjusted', 50), 60);
    // A raised floor lifts the lowest grades: 0 -> 70, and a grade that
    // would transmute to 68 is lifted to 70 as well.
    assert.equal(deped.transmute(0, 'do015_adjusted', 70), 70);
    assert.equal(deped.transmute(40, 'do015_adjusted', 70), 70);
    assert.equal(deped.transmute(70, 'do015_adjusted', 70), 75);
    // Zero-based: no table, so the floor does the work.
    assert.equal(deped.transmute(0, 'do015_zero_based', 0), 0);
    assert.equal(deped.transmute(40, 'do015_zero_based', 60), 60);
    assert.equal(deped.transmute(88, 'do015_zero_based', 60), 88);
  });

  test('worked example under DO 8: initial 88.05 transmutes to 92', () => {
    const columns = [
      ...[25, 25, 25, 25].map((max, i) => ({ id: i + 1, component: 'WW', highest_possible: max })),
      ...[50, 50, 50, 50].map((max, i) => ({ id: 10 + i, component: 'PT', highest_possible: max })),
      { id: 20, component: 'EX', highest_possible: 50 },
    ];
    const scores = new Map([
      [1, 20], [2, 22], [3, 25], [4, 18],
      [10, 45], [11, 48], [12, 50], [13, 40],
      [20, 42],
    ]);
    const result = deped.computeLearnerGrade(columns, scores, { ww: 30, pt: 50, ex: 20, floor: 60 }, 'do8_2015');
    assert.equal(result.components.WW.ps, 85);
    assert.equal(result.components.WW.ws, 25.5);
    assert.equal(result.components.PT.ps, 91.5);
    assert.equal(result.components.PT.ws, 45.75);
    assert.equal(result.components.EX.ps, 84);
    assert.equal(result.components.EX.ws, 16.8);
    assert.equal(result.initial, 88.05);
    assert.equal(result.qg, 92);
    assert.equal(result.descriptor, 'Outstanding');
    assert.equal(result.status, 'Complete · Passed');
  });

  test('worked example under DO 015 adjusted: Examinations are sub-weighted, initial 88.01 -> 90', () => {
    const columns = [
      ...[25, 25, 25, 25].map((max, i) => ({ id: i + 1, component: 'WW', highest_possible: max, sub_weight: null, label: null })),
      ...[50, 50, 50, 50].map((max, i) => ({ id: 10 + i, component: 'PT', highest_possible: max, sub_weight: null, label: null })),
      { id: 20, component: 'EX', highest_possible: 50, sub_weight: 30, label: 'Summative Test 1' },
      { id: 21, component: 'EX', highest_possible: 50, sub_weight: 30, label: 'Summative Test 2' },
      { id: 22, component: 'EX', highest_possible: 50, sub_weight: 40, label: 'Term Exam' },
    ];
    const scores = new Map([
      [1, 20], [2, 22], [3, 25], [4, 18],
      [10, 45], [11, 48], [12, 50], [13, 40],
      [20, 42], [21, 45], [22, 40],
    ]);
    const result = deped.computeLearnerGrade(columns, scores, deped.defaultWeights('do015_adjusted', 'core'), 'do015_adjusted');
    assert.equal(result.components.WW.ps, 85);
    assert.equal(result.components.WW.ws, 17);
    assert.equal(result.components.PT.ps, 91.5);
    assert.equal(result.components.PT.ws, 45.75);
    assert.equal(result.components.EX.ps, 84.2); // (84*30 + 90*30 + 80*40) / 100
    assert.equal(result.components.EX.ws, 25.26);
    assert.equal(result.initial, 88.01);
    assert.equal(result.qg, 90);
    assert.equal(result.descriptor, 'Advancing');
    assert.equal(result.status, 'Complete · Passed');
  });

  test('an Examinations column with no sub-weight shares equally when none has one', () => {
    const columns = [
      { id: 1, component: 'WW', highest_possible: 25, sub_weight: null, label: null },
      { id: 2, component: 'PT', highest_possible: 50, sub_weight: null, label: null },
      { id: 3, component: 'EX', highest_possible: 50, sub_weight: null, label: null },
      { id: 4, component: 'EX', highest_possible: 50, sub_weight: null, label: null },
    ];
    const scores = new Map([[1, 25], [2, 50], [3, 50], [4, 25]]);
    const result = deped.computeLearnerGrade(columns, scores, deped.defaultWeights('do015_adjusted', 'core'), 'do015_adjusted');
    assert.equal(result.components.EX.ps, 75); // (100 + 50) / 2
    assert.equal(result.initial, 92.5);
    assert.equal(result.qg, 94);
  });

  test('blank is not zero: a partial record has no PS where nothing is encoded', () => {
    const columns = [
      { id: 1, component: 'WW', highest_possible: 25 },
      { id: 2, component: 'WW', highest_possible: 25 },
      { id: 3, component: 'PT', highest_possible: 50 },
      { id: 4, component: 'EX', highest_possible: 50 },
    ];
    const result = deped.computeLearnerGrade(columns, new Map([[1, 20]]), deped.DEFAULT_WEIGHTS);
    // Only the encoded column counts in the denominator.
    assert.equal(result.components.WW.ps, 80);
    assert.equal(result.components.WW.ws, 24);
    assert.equal(result.components.PT.ps, null);
    assert.equal(result.components.EX.ps, null);
    assert.equal(result.initial, null);
    assert.equal(result.qg, null);
    assert.equal(result.status, 'Incomplete');
    assert.equal(result.complete, false);
  });

  test('honors bands follow DepEd Order No. 36, s. 2016 (DO 8)', () => {
    assert.equal(deped.honorsFor(98), 'With Highest Honors');
    assert.equal(deped.honorsFor(100), 'With Highest Honors');
    assert.equal(deped.honorsFor(95), 'With High Honors');
    assert.equal(deped.honorsFor(97.99), 'With High Honors');
    assert.equal(deped.honorsFor(90), 'With Honors');
    assert.equal(deped.honorsFor(94.99), 'With Honors');
    assert.equal(deped.honorsFor(89.99), null);
    assert.equal(deped.honorsFor(null), null);
  });

  test('honors under DO 015: Academic Excellence Award needs GA 90+ and no grade below 80', () => {
    assert.equal(deped.honorsFor(95, [92, 100], 'do015_adjusted'), 'Academic Excellence Award');
    assert.equal(deped.honorsFor(90, [90, 90], 'do015_adjusted'), 'Academic Excellence Award');
    assert.equal(deped.honorsFor(95, [79, 100], 'do015_adjusted'), null);
    assert.equal(deped.honorsFor(89.99, [92, 100], 'do015_adjusted'), null);
    assert.equal(deped.honorsFor(96, [], 'do015_adjusted'), null);
    assert.equal(deped.honorsFor(null, [92, 100], 'do015_adjusted'), null);
  });

  test('default weights follow the profile and the subject group', () => {
    assert.deepEqual(deped.defaultWeights('do8_2015', 'core'), { ww: 30, pt: 50, ex: 20 });
    assert.deepEqual(deped.defaultWeights('do8_2015', 'mapeh'), { ww: 30, pt: 50, ex: 20 });
    assert.deepEqual(deped.defaultWeights('do015_adjusted', 'core'), { ww: 20, pt: 50, ex: 30 });
    assert.deepEqual(deped.defaultWeights('do015_adjusted', 'mapeh'), { ww: 20, pt: 60, ex: 20 });
    assert.deepEqual(deped.defaultWeights('do015_adjusted', 'epp_tle'), { ww: 20, pt: 60, ex: 20 });
    assert.deepEqual(deped.defaultWeights('do015_zero_based', 'core'), { ww: 20, pt: 50, ex: 30 });
  });

  test('default columns: three Examinations columns under DO 015, one under DO 8', () => {
    const adjusted = deped.defaultColumns('do015_adjusted').filter((column) => column.component === 'EX');
    assert.deepEqual(adjusted, [
      { component: 'EX', highest_possible: 50, sub_weight: 30, label: 'Summative Test 1' },
      { component: 'EX', highest_possible: 50, sub_weight: 30, label: 'Summative Test 2' },
      { component: 'EX', highest_possible: 50, sub_weight: 40, label: 'Term Exam' },
    ]);
    const do8 = deped.defaultColumns('do8_2015').filter((column) => column.component === 'EX');
    assert.deepEqual(do8, [{ component: 'EX', highest_possible: 50, sub_weight: null, label: null }]);
  });

  test('descriptors: DO 015 Table 11, and the DO 8 descriptors', () => {
    assert.equal(deped.descriptorFor(95, 'do015_adjusted'), 'Advancing');
    assert.equal(deped.descriptorFor(85, 'do015_adjusted'), 'Benchmarking');
    assert.equal(deped.descriptorFor(76, 'do015_adjusted'), 'Connecting');
    assert.equal(deped.descriptorFor(70, 'do015_adjusted'), 'Developing');
    assert.equal(deped.descriptorFor(60, 'do015_adjusted'), 'Emerging');
    assert.equal(deped.descriptorFor(95, 'do8_2015'), 'Outstanding');
    assert.equal(deped.descriptorFor(87, 'do8_2015'), 'Very Satisfactory');
    assert.equal(deped.descriptorFor(82, 'do8_2015'), 'Satisfactory');
    assert.equal(deped.descriptorFor(76, 'do8_2015'), 'Fairly Satisfactory');
    assert.equal(deped.descriptorFor(60, 'do8_2015'), 'Did Not Meet Expectations');
  });

  test('final grade: the mean of the period grades, only when every period is in', () => {
    assert.equal(deped.finalGrade([92, 90, 88]), 90);
    assert.equal(deped.finalGrade([92, 90]), 91);
    assert.equal(deped.finalGrade([92, null, 88]), null);
    assert.equal(deped.finalGrade([]), null);
  });

  test('default profile for a year: 2026-2027 adjusted, 2027-2028 zero-based, earlier DO 8', () => {
    assert.equal(deped.defaultProfileForYear('2026-2027'), 'do015_adjusted');
    assert.equal(deped.defaultProfileForYear('2027-2028'), 'do015_zero_based');
    assert.equal(deped.defaultProfileForYear('2028-2029'), 'do015_zero_based');
    assert.equal(deped.defaultProfileForYear('2025-2026'), 'do8_2015');
  });
});

// ---------- Grade sheet ----------

describe('Grade sheet', () => {
  test('a new sheet starts with the standard columns and default weights, all blank', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    assert.deepEqual(sheet.columns.map((column) => column.name), ['WW1', 'WW2', 'WW3', 'WW4', 'PT1', 'PT2', 'PT3', 'PT4', 'Summative Test 1', 'Summative Test 2', 'Term Exam']);
    assert.deepEqual(sheet.columns.map((column) => column.highest_possible), [25, 25, 25, 25, 50, 50, 50, 50, 50, 50, 50]);
    assert.deepEqual(sheet.columns.filter((column) => column.component === 'EX').map((column) => column.sub_weight), [30, 30, 40]);
    assert.deepEqual(sheet.weights, { ww: 20, pt: 50, ex: 30, floor: 60 });
    // The sheet says which grading system is active for the year, in plain words.
    assert.equal(sheet.grading.code, 'do015_adjusted');
    assert.equal(sheet.grading.label, 'DO 015 · Adjusted · SY 2026-2027');
    assert.equal(sheet.grading.period_label, 'Term');
    assert.deepEqual(sheet.grading.periods, [1, 2, 3]);
    assert.equal(sheet.grading.third_label, 'Examinations');
    assert.equal(sheet.learners.length, 1);
    assert.equal(sheet.learners[0].computed.status, 'Incomplete');
    assert.equal(sheet.learners[0].computed.qg, null);
    assert.equal(sheet.submission, null);
    // The reminder is always an object, even when nobody has reminded yet —
    // the Grades page reads .active without a null check.
    assert.deepEqual(sheet.reminder, { active: false, reminded_at: null, adviser_name: null });
    assert.equal(sheet.stats.encoding_pct, 0);
    assert.equal(sheet.stats.complete_count, 0);
  });

  test('the sheet needs a teacher token and only the class owner can open it', async () => {
    const first = await signup();
    const second = await signup();
    const klass = await makeClass(first.token, { section_name: 'Luke' });

    const anon = await api().get(`/api/teacher/grades/${klass.id}?quarter=1`);
    assert.equal(anon.status, 401);

    const other = await api().get(`/api/teacher/grades/${klass.id}?quarter=1`).set(bearer(second.token));
    assert.equal(other.status, 404);
  });

  test('saving the worked example computes 88.01 and term grade 90 on the sheet', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', learner_id: 'STU-2026-1039', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, isabella.id);

    const sheet = await getSheet(token, klass.id, 1);
    const saved = await saveScores(token, klass.id, 1, [
      ...scoresFor(sheet, alex, WORKED),
      ...scoresFor(sheet, isabella, LOW),
    ]);
    assert.equal(saved.saved, 22);

    const after = await getSheet(token, klass.id, 1);
    const alexRow = after.learners.find((row) => row.learner_id === alex.learner_id);
    assert.equal(alexRow.computed.initial, 88.01);
    assert.equal(alexRow.computed.qg, 90);
    assert.equal(alexRow.computed.descriptor, 'Advancing');
    assert.equal(alexRow.computed.status, 'Complete · Passed');
    const isaRow = after.learners.find((row) => row.learner_id === isabella.learner_id);
    assert.equal(isaRow.computed.initial, 40);
    assert.equal(isaRow.computed.qg, 68);
    assert.equal(isaRow.computed.descriptor, 'Developing');
    assert.equal(isaRow.computed.status, 'Complete · Below 75');
    assert.equal(after.stats.mps, 64.01);
    assert.equal(after.stats.passing_rate, 50);
    assert.equal(after.stats.highest_transmuted, 90);
    assert.equal(after.stats.intervention_count, 1);
    assert.equal(after.stats.encoding_pct, 100);
  });

  test('a score over the column maximum, a negative score, and a non-enrolled learner are refused', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    const outsider = await makeLearner(token, { first_name: 'Out', last_name: 'Side', learner_id: 'STU-2026-1099', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    const ww1 = sheet.columns.find((column) => column.name === 'WW1');

    const over = await api().post(`/api/teacher/grades/${klass.id}/scores`).set(bearer(token))
      .send({ quarter: 1, scores: [{ column_id: ww1.id, learner_id: alex.id, score: 26 }] });
    assert.equal(over.status, 400, JSON.stringify(over.body));

    const negative = await api().post(`/api/teacher/grades/${klass.id}/scores`).set(bearer(token))
      .send({ quarter: 1, scores: [{ column_id: ww1.id, learner_id: alex.id, score: -1 }] });
    assert.equal(negative.status, 400, JSON.stringify(negative.body));

    const notEnrolled = await api().post(`/api/teacher/grades/${klass.id}/scores`).set(bearer(token))
      .send({ quarter: 1, scores: [{ column_id: ww1.id, learner_id: outsider.id, score: 20 }] });
    assert.equal(notEnrolled.status, 400, JSON.stringify(notEnrolled.body));

    const stillBlank = await getSheet(token, klass.id, 1);
    assert.equal(stillBlank.learners[0].computed.entered, 0);
  });

  test('a null score clears a cell, and clearing the last score of a component removes its PS', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, { ww: [20] }));
    let after = await getSheet(token, klass.id, 1);
    assert.equal(after.learners[0].computed.components.WW.ps, 80);

    const ww1 = sheet.columns.find((column) => column.name === 'WW1');
    await saveScores(token, klass.id, 1, [{ column_id: ww1.id, learner_id: alex.id, score: null }]);
    after = await getSheet(token, klass.id, 1);
    assert.equal(after.learners[0].computed.components.WW.ps, null);
    assert.equal(after.learners[0].computed.entered, 0);
  });

  test('the grade sheet downloads as a CSV with the computed grades', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));

    const csv = await api().get(`/api/teacher/grades/${klass.id}?quarter=1&format=csv`).set(bearer(token));
    assert.equal(csv.status, 200);
    assert.match(csv.text, /WW1 \(25\),WW2 \(25\)/);
    assert.match(csv.text, /Summative Test 1 \(50\),Summative Test 2 \(50\),Term Exam \(50\)/);
    assert.match(csv.text, /Rivera, Alex/);
    assert.match(csv.text, /88\.01,90,Complete · Passed/);
  });
});

// ---------- Columns and weights ----------

describe('Columns and weights', () => {
  test('adding a column appends it with the default highest possible score', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const added = await api().post(`/api/teacher/grades/${klass.id}/columns`).set(bearer(token))
      .send({ quarter: 1, component: 'WW' });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.column.name, 'WW5');
    assert.equal(added.body.column.highest_possible, 25);

    const sheet = await getSheet(token, klass.id, 1);
    assert.deepEqual(sheet.columns.filter((c) => c.component === 'WW').map((c) => c.name), ['WW1', 'WW2', 'WW3', 'WW4', 'WW5']);
  });

  test('lowering a highest possible score below a saved score is refused', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, { ww: [20] }));
    const ww1 = sheet.columns.find((column) => column.name === 'WW1');

    const refused = await api().patch(`/api/teacher/grades/${klass.id}/columns/${ww1.id}`).set(bearer(token))
      .send({ highest_possible: 10 });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));

    await saveScores(token, klass.id, 1, [{ column_id: ww1.id, learner_id: alex.id, score: 10 }]);
    const ok = await api().patch(`/api/teacher/grades/${klass.id}/columns/${ww1.id}`).set(bearer(token))
      .send({ highest_possible: 10 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.column.highest_possible, 10);
  });

  test('removing a column deletes its scores and renumbers the rest; the last column of a component stays', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, { ww: [20, 22, 25, 18] }));
    const ww2 = sheet.columns.find((column) => column.name === 'WW2');
    const removed = await api().delete(`/api/teacher/grades/${klass.id}/columns/${ww2.id}`).set(bearer(token));
    assert.equal(removed.status, 200, JSON.stringify(removed.body));

    const after = await getSheet(token, klass.id, 1);
    assert.deepEqual(after.columns.filter((c) => c.component === 'WW').map((c) => c.name), ['WW1', 'WW2', 'WW3']);
    const alexRow = after.learners[0];
    assert.equal(alexRow.computed.entered, 3);
    assert.equal(alexRow.computed.components.WW.total, 63); // 20 + 25 + 18

    // Removing an Examinations column rescales the remaining shares so they
    // still add up to 100: ST1 goes, ST2 30 -> 42.86, Term Exam 40 -> 57.14.
    const st1 = after.columns.find((column) => column.name === 'Summative Test 1');
    const removedEx = await api().delete(`/api/teacher/grades/${klass.id}/columns/${st1.id}`).set(bearer(token));
    assert.equal(removedEx.status, 200, JSON.stringify(removedEx.body));
    let afterEx = await getSheet(token, klass.id, 1);
    assert.deepEqual(
      afterEx.columns.filter((c) => c.component === 'EX').map((c) => [c.name, c.sub_weight]),
      [['Summative Test 2', 42.86], ['Term Exam', 57.14]]
    );

    const st2 = afterEx.columns.find((column) => column.name === 'Summative Test 2');
    await api().delete(`/api/teacher/grades/${klass.id}/columns/${st2.id}`).set(bearer(token));
    afterEx = await getSheet(token, klass.id, 1);
    assert.deepEqual(
      afterEx.columns.filter((c) => c.component === 'EX').map((c) => [c.name, c.sub_weight]),
      [['Term Exam', 100]]
    );

    const termExam = afterEx.columns.find((column) => column.name === 'Term Exam');
    const last = await api().delete(`/api/teacher/grades/${klass.id}/columns/${termExam.id}`).set(bearer(token));
    assert.equal(last.status, 400, JSON.stringify(last.body));
  });

  test('weights change the computation, and must add up to 100', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));

    const bad = await api().patch(`/api/teacher/grades/${klass.id}/weights`).set(bearer(token))
      .send({ ww_weight: 40, pt_weight: 40, ex_weight: 30 });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));

    const ok = await api().patch(`/api/teacher/grades/${klass.id}/weights`).set(bearer(token))
      .send({ ww_weight: 40, pt_weight: 40, ex_weight: 20 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.weights, { ww: 40, pt: 40, ex: 20, floor: 60 });

    const after = await getSheet(token, klass.id, 1);
    // 85*0.40 + 91.5*0.40 + 84.2*0.20 = 34 + 36.6 + 16.84 = 87.44 -> term grade 89.
    assert.equal(after.learners[0].computed.initial, 87.44);
    assert.equal(after.learners[0].computed.qg, 89);
  });

  test('the floor saves with the weights and lifts the lowest grades on the sheet', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    // All zeros: initial 0, which the Adjusted table transmutes to 60.
    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, { ww: [0, 0, 0, 0], pt: [0, 0, 0, 0], ex: [0, 0, 0] }));
    const before = await getSheet(token, klass.id, 1);
    assert.equal(before.learners[0].computed.qg, 60);
    assert.equal(before.weights.floor, 60);

    // A floor below the table's own changes nothing; a raised floor lifts it.
    const low = await api().patch(`/api/teacher/grades/${klass.id}/weights`).set(bearer(token))
      .send({ ww_weight: 20, pt_weight: 50, ex_weight: 30, floor_grade: 0 });
    assert.equal(low.status, 200, JSON.stringify(low.body));
    assert.equal(low.body.weights.floor, 0);
    const still60 = await getSheet(token, klass.id, 1);
    assert.equal(still60.weights.floor, 0);
    assert.equal(still60.learners[0].computed.qg, 60);

    const raised = await api().patch(`/api/teacher/grades/${klass.id}/weights`).set(bearer(token))
      .send({ ww_weight: 20, pt_weight: 50, ex_weight: 30, floor_grade: 70 });
    assert.equal(raised.status, 200, JSON.stringify(raised.body));
    assert.equal(raised.body.weights.floor, 70);
    const after = await getSheet(token, klass.id, 1);
    assert.equal(after.learners[0].computed.qg, 70);

    // An out-of-range floor is refused, and sending no floor keeps the saved one.
    const bad = await api().patch(`/api/teacher/grades/${klass.id}/weights`).set(bearer(token))
      .send({ ww_weight: 20, pt_weight: 50, ex_weight: 30, floor_grade: 101 });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    const kept = await api().patch(`/api/teacher/grades/${klass.id}/weights`).set(bearer(token))
      .send({ ww_weight: 20, pt_weight: 50, ex_weight: 30 });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.equal(kept.body.weights.floor, 70);
  });

  test('the Examinations sub-weights save together and must add up to 100', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));
    const exColumns = sheet.columns.filter((column) => column.component === 'EX');
    const byName = new Map(exColumns.map((column) => [column.name, column]));

    const bad = await api().patch(`/api/teacher/grades/${klass.id}/sub-weights`).set(bearer(token))
      .send({
        quarter: 1,
        sub_weights: [
          { column_id: byName.get('Summative Test 1').id, sub_weight: 20 },
          { column_id: byName.get('Summative Test 2').id, sub_weight: 30 },
          { column_id: byName.get('Term Exam').id, sub_weight: 40 },
        ],
      });
    assert.equal(bad.status, 400, JSON.stringify(bad.body)); // 20 + 30 + 40 = 90

    const ww1 = sheet.columns.find((column) => column.name === 'WW1');
    const notEx = await api().patch(`/api/teacher/grades/${klass.id}/sub-weights`).set(bearer(token))
      .send({
        quarter: 1,
        sub_weights: [
          { column_id: ww1.id, sub_weight: 30 },
          { column_id: byName.get('Summative Test 2').id, sub_weight: 30 },
          { column_id: byName.get('Term Exam').id, sub_weight: 40 },
        ],
      });
    assert.equal(notEx.status, 400, JSON.stringify(notEx.body));

    const ok = await api().patch(`/api/teacher/grades/${klass.id}/sub-weights`).set(bearer(token))
      .send({
        quarter: 1,
        sub_weights: [
          { column_id: byName.get('Summative Test 1').id, sub_weight: 20 },
          { column_id: byName.get('Summative Test 2').id, sub_weight: 30 },
          { column_id: byName.get('Term Exam').id, sub_weight: 50 },
        ],
      });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.columns.map((column) => column.sub_weight), [20, 30, 50]);

    // The Examinations PS follows the new shares: (84*20 + 90*30 + 80*50)/100 = 83.8.
    const after = await getSheet(token, klass.id, 1);
    assert.equal(after.learners[0].computed.components.EX.ps, 83.8);
    assert.equal(after.learners[0].computed.initial, 87.89);
    assert.equal(after.learners[0].computed.qg, 90);
  });

  test('adding an Examinations column starts it at 0, so the shares still add to 100', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });

    const added = await api().post(`/api/teacher/grades/${klass.id}/columns`).set(bearer(token))
      .send({ quarter: 1, component: 'EX' });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.column.name, 'EX4');
    assert.equal(added.body.column.highest_possible, 50);
    assert.equal(added.body.column.sub_weight, 0);

    const sheet = await getSheet(token, klass.id, 1);
    const shares = sheet.columns.filter((c) => c.component === 'EX').map((c) => c.sub_weight);
    assert.deepEqual(shares, [30, 30, 40, 0]);
    assert.equal(shares.reduce((sum, value) => sum + value, 0), 100);
  });
});

// ---------- Submission ----------

describe('Submission to the adviser', () => {
  test('the checklist, the confirm-blanks refusal, and a filing with a timestamp', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', learner_id: 'STU-2026-1039', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, isabella.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));

    const check = await api().get(`/api/teacher/grades/${klass.id}/submission-check?quarter=1`).set(bearer(token));
    assert.equal(check.status, 200);
    assert.equal(check.body.encoding_pct, 50);
    assert.equal(check.body.complete_learners, 1);
    assert.equal(check.body.total_learners, 2);
    assert.equal(check.body.incomplete_learners, 1);
    assert.deepEqual(check.body.incomplete_names, ['Flores, Isabella']);
    assert.equal(check.body.entered_cells, 11);
    assert.equal(check.body.total_cells, 22);
    assert.deepEqual(check.body.intervention, []);
    assert.equal(check.body.submitted, false);

    const refused = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 1, confirm_blanks: false });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'CONFIRM_BLANKS');
    assert.equal(refused.body.checklist.complete_learners, 1);

    const filed = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 1, confirm_blanks: true });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    assert.ok(filed.body.submission.submitted_at);

    const after = await getSheet(token, klass.id, 1);
    assert.ok(after.submission);
  });

  test('editing scores after a submission clears it, and re-submitting files it again', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));
    const first = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 1, confirm_blanks: false });
    assert.equal(first.status, 200, JSON.stringify(first.body));

    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, { ww: [21] }));
    let after = await getSheet(token, klass.id, 1);
    assert.equal(after.submission, null);

    const second = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 1, confirm_blanks: false });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    after = await getSheet(token, klass.id, 1);
    assert.ok(after.submission);
  });

  test('a complete record submits without confirming blanks', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));
    const filed = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 1, confirm_blanks: false });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
  });
});

// ---------- Consolidation ----------

describe('Academic Consolidation', () => {
  // One advisory section shared by two teachers of the same school:
  // the adviser (Sacraments) and a subject teacher (Empowerment Technologies).
  // Both teach Grade 10 in the section and share the same two learners by learner ID.
  // Each setup gets its own section name so tests cannot see each other's classes.
  async function setupSection() {
    counter += 1;
    const section = `Luke${counter}`;
    adviserToken = (await signup({ first_name: 'Melvin', last_name: 'Reston' })).token;
    subjectToken = (await signup({ first_name: 'John', last_name: 'Maniago' })).token;
    otherToken = (await signup({ first_name: 'Other', last_name: 'Teacher' })).token;
    await setAdviser(adviserToken, 10, section);

    const sacraments = await makeSubject(adviserToken, { name: 'Sacraments' });
    const sacClass = await makeClass(adviserToken, { subject: sacraments, section_name: section });
    const alexA = await makeLearner(adviserToken, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    const isaA = await makeLearner(adviserToken, { first_name: 'Isabella', last_name: 'Flores', learner_id: 'STU-2026-1039', sex: 'Female' });
    await enrol(adviserToken, sacClass.id, alexA.id);
    await enrol(adviserToken, sacClass.id, isaA.id);

    const etech = await makeSubject(subjectToken, { name: 'Empowerment Technologies' });
    const etechClass = await makeClass(subjectToken, { subject: etech, section_name: section });
    // The shared school directory: the subject teacher enrols the same
    // learners the adviser created, instead of uploading them again.
    await enrol(subjectToken, etechClass.id, alexA.id);
    await enrol(subjectToken, etechClass.id, isaA.id);

    return { sacClass, etechClass, alexA, isaA, alexB: alexA, isaB: isaA, section };
  }

  async function fillAndSubmit(token, classId, learnerScores, confirmBlanks = false, quarter = 3) {
    const sheet = await getSheet(token, classId, quarter);
    const all = [];
    for (const [learner, values] of learnerScores) all.push(...scoresFor(sheet, learner, values));
    await saveScores(token, classId, quarter, all);
    const filed = await api().post(`/api/teacher/grades/${classId}/submit`).set(bearer(token))
      .send({ quarter, confirm_blanks: confirmBlanks });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
  }

  test('a teacher who is not an adviser cannot open consolidation', async () => {
    const { token } = await signup();
    const response = await api().get('/api/teacher/consolidation?quarter=3').set(bearer(token));
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'NO_ADVISORY');
  });

  test('GWA stays blank until every subject is submitted, with the reason named', async () => {
    const { sacClass, alexA, isaA } = await setupSection();
    await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]]);

    const view = await api().get('/api/teacher/consolidation?quarter=3').set(bearer(adviserToken));
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.readiness.submitted, 1);
    assert.equal(view.body.readiness.total, 2);
    assert.equal(view.body.kpis.class_gwa, null);
    const alex = view.body.learners.find((row) => row.learner_id === alexA.learner_id);
    assert.equal(alex.grades['Sacraments'], 90);
    assert.equal(alex.grades['Empowerment Technologies'], null);
    assert.equal(alex.gwa, null);
    assert.equal(alex.gwa_reason, 'Waiting on Empowerment Technologies');
    assert.equal(alex.standing, 'Pending grades');
    const sacraments = view.body.subjects.find((subject) => subject.subject_name === 'Sacraments');
    assert.equal(sacraments.submitted, true);
    assert.equal(sacraments.average, 79); // (90 + 68) / 2
    const etech = view.body.subjects.find((subject) => subject.subject_name === 'Empowerment Technologies');
    assert.equal(etech.submitted, false);
    assert.equal(etech.average, null);
  });

  test('once every subject is in, GWA, honors and at-risk are computed', async () => {
    const { sacClass, etechClass, alexA, isaA, alexB, isaB, section } = await setupSection();
    await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]]);
    // Alex: perfect E-tech -> term grade 100. Isabella: low E-tech -> term grade 68.
    await fillAndSubmit(subjectToken, etechClass.id, [[alexB, PERFECT], [isaB, LOW]]);

    const view = await api().get('/api/teacher/consolidation?quarter=3').set(bearer(adviserToken));
    assert.equal(view.status, 200, JSON.stringify(view.body));
    // The view shape the Consolidation page reads.
    assert.equal(view.body.has_advisory, true);
    assert.equal(view.body.grade, 10);
    assert.equal(view.body.section, section);
    assert.equal(view.body.grading.code, 'do015_adjusted');
    assert.equal(view.body.grading.period_label, 'Term');
    assert.equal(view.body.readiness.submitted, 2);
    assert.equal(view.body.readiness.total, 2);
    assert.equal(view.body.readiness.pct, 100);

    const etechSubject = view.body.subjects.find((subject) => subject.subject_name === 'Empowerment Technologies');
    assert.equal(etechSubject.teacher_name, 'Maniago, John');
    assert.equal(etechSubject.class_id, etechClass.id);
    assert.equal(etechSubject.submitted, true);
    assert.equal(etechSubject.reminded, false);

    const alex = view.body.learners.find((row) => row.learner_id === alexA.learner_id);
    assert.equal(alex.grades['Empowerment Technologies'], 100);
    assert.equal(alex.gwa, 95); // (90 + 100) / 2
    assert.equal(alex.honors, 'Academic Excellence Award');
    assert.equal(alex.standing, 'Academic Excellence Award');
    assert.equal(alex.rank, 1);

    const isabella = view.body.learners.find((row) => row.learner_id === isaA.learner_id);
    assert.equal(isabella.gwa, 68); // (68 + 68) / 2
    assert.equal(isabella.honors, null);
    assert.equal(isabella.at_risk, true);
    assert.equal(isabella.standing, 'At risk');
    assert.equal(isabella.rank, 2);

    assert.equal(view.body.kpis.class_gwa, 81.5); // (95 + 68) / 2
    assert.equal(view.body.kpis.subject_average, 81.5); // (90 + 68 + 100 + 68) / 4
    assert.equal(view.body.kpis.honor_count, 1);
    assert.equal(view.body.kpis.honor_pct, 50);
    assert.equal(view.body.kpis.at_risk_count, 1);
  });

  test('an incomplete record in a filed subject keeps that learner’s GWA blank', async () => {
    const { sacClass, etechClass, alexA, isaA, alexB, isaB } = await setupSection();
    await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]]);
    // Isabella's E-tech record is filed with the Examinations cells blank.
    const etechSheet = await getSheet(subjectToken, etechClass.id, 3);
    await saveScores(subjectToken, etechClass.id, 3, [
      ...scoresFor(etechSheet, alexB, PERFECT),
      ...scoresFor(etechSheet, isaB, { ww: [10, 10, 10, 10], pt: [20, 20, 20, 20] }),
    ]);
    const filed = await api().post(`/api/teacher/grades/${etechClass.id}/submit`).set(bearer(subjectToken))
      .send({ quarter: 3, confirm_blanks: true });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));

    const view = await api().get('/api/teacher/consolidation?quarter=3').set(bearer(adviserToken));
    assert.equal(view.body.readiness.submitted, 2);
    const isabella = view.body.learners.find((row) => row.learner_id === isaA.learner_id);
    assert.equal(isabella.grades['Empowerment Technologies'], null);
    assert.equal(isabella.gwa, null);
    assert.equal(isabella.gwa_reason, 'Incomplete in Empowerment Technologies');
    assert.equal(isabella.standing, 'Pending grades');
    assert.equal(isabella.at_risk, true); // Sacraments 68 is below 75
    const alex = view.body.learners.find((row) => row.learner_id === alexA.learner_id);
    assert.equal(alex.gwa, 95);
  });

  test('an adviser reads other teachers’ submitted grades but cannot edit their scores', async () => {
    const { etechClass } = await setupSection();
    const etechSheet = await getSheet(subjectToken, etechClass.id, 3);
    const ww1 = etechSheet.columns.find((column) => column.name === 'WW1');

    const edit = await api().post(`/api/teacher/grades/${etechClass.id}/scores`).set(bearer(adviserToken))
      .send({ quarter: 3, scores: [{ column_id: ww1.id, learner_id: etechSheet.learners[0].id, score: 25 }] });
    assert.equal(edit.status, 404, JSON.stringify(edit.body));

    const seen = await api().get(`/api/teacher/grades/${etechClass.id}?quarter=3`).set(bearer(adviserToken));
    assert.equal(seen.status, 404);
  });

  test('a reminder shows on the subject teacher’s Grades page until they file again', async () => {
    const { sacClass, etechClass, alexA, isaA } = await setupSection();
    await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]]);

    const reminded = await api().post('/api/teacher/consolidation/remind').set(bearer(adviserToken))
      .send({ class_id: etechClass.id, quarter: 3 });
    assert.equal(reminded.status, 200, JSON.stringify(reminded.body));
    assert.match(reminded.body.message, /Reminder sent to Maniago, John for Empowerment Technologies/);

    let sheet = await getSheet(subjectToken, etechClass.id, 3);
    assert.equal(sheet.reminder.active, true);
    assert.ok(sheet.reminder.reminded_at);

    // The subject teacher files, and the reminder goes quiet.
    const etechSheet = await getSheet(subjectToken, etechClass.id, 3);
    await saveScores(subjectToken, etechClass.id, 3, scoresFor(etechSheet, etechSheet.learners[0], WORKED));
    const filed = await api().post(`/api/teacher/grades/${etechClass.id}/submit`).set(bearer(subjectToken))
      .send({ quarter: 3, confirm_blanks: true });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));

    sheet = await getSheet(subjectToken, etechClass.id, 3);
    assert.equal(sheet.reminder.active, false);

    // The adviser cannot remind a class outside their section.
    const otherClass = await makeClass(otherToken, { section_name: 'Mark' });
    const wrong = await api().post('/api/teacher/consolidation/remind').set(bearer(adviserToken))
      .send({ class_id: otherClass.id, quarter: 3 });
    assert.equal(wrong.status, 404, JSON.stringify(wrong.body));
  });

  test('the adviser files their own class straight into Consolidation: "Move to Consolidation"', async () => {
    const { sacClass, alexA, isaA } = await setupSection();

    // The adviser is both the subject teacher and the adviser of Sacraments.
    const sheet = await getSheet(adviserToken, sacClass.id, 3);
    assert.equal(sheet.direct_add, true);

    const all = [...scoresFor(sheet, alexA, WORKED), ...scoresFor(sheet, isaA, LOW)];
    await saveScores(adviserToken, sacClass.id, 3, all);
    const filed = await api().post(`/api/teacher/grades/${sacClass.id}/submit`).set(bearer(adviserToken))
      .send({ quarter: 3, confirm_blanks: false });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    assert.equal(filed.body.direct, true);
    assert.match(filed.body.message, /moved to Consolidation/);

    // Consolidation shows a directly-added grade exactly like a submitted one.
    const view = await api().get('/api/teacher/consolidation?quarter=3').set(bearer(adviserToken));
    assert.equal(view.status, 200, JSON.stringify(view.body));
    const sacraments = view.body.subjects.find((subject) => subject.subject_name === 'Sacraments');
    assert.equal(sacraments.submitted, true);
    assert.equal(sacraments.own_class, true);
    const alex = view.body.learners.find((row) => row.learner_id === alexA.learner_id);
    assert.equal(alex.grades['Sacraments'], 90);

    // A direct-add needs no reminder: reminding your own class is refused.
    const reminded = await api().post('/api/teacher/consolidation/remind').set(bearer(adviserToken))
      .send({ class_id: sacClass.id, quarter: 3 });
    assert.equal(reminded.status, 400, JSON.stringify(reminded.body));
    assert.match(reminded.body.message, /no one to remind/);
  });

  test('a subject teacher who is not the adviser still submits to the adviser', async () => {
    const { etechClass, alexB, isaB } = await setupSection();

    const sheet = await getSheet(subjectToken, etechClass.id, 3);
    assert.equal(sheet.direct_add, false);

    await fillAndSubmit(subjectToken, etechClass.id, [[alexB, WORKED], [isaB, LOW]]);
    const filed = await api().post(`/api/teacher/grades/${etechClass.id}/submit`).set(bearer(subjectToken))
      .send({ quarter: 3, confirm_blanks: false });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    assert.equal(filed.body.direct, false);
    assert.match(filed.body.message, /submitted to the adviser/);

    const view = await api().get('/api/teacher/consolidation?quarter=3').set(bearer(adviserToken));
    const etech = view.body.subjects.find((subject) => subject.subject_name === 'Empowerment Technologies');
    assert.equal(etech.submitted, true);
    assert.equal(etech.own_class, false);
  });

  test('the dashboard shows real consolidation readiness for the adviser', async () => {
    const { sacClass, alexA, isaA, section } = await setupSection();
    await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]]);

    const dashboard = await api().get('/api/teacher/dashboard').set(bearer(adviserToken));
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
    assert.equal(dashboard.body.consolidation.submitted, 1);
    assert.equal(dashboard.body.consolidation.total, 2);
    assert.equal(dashboard.body.consolidation.section, section);
    assert.equal(dashboard.body.consolidation.grade, 10);
    assert.equal(dashboard.body.consolidation.quarter, 3);
    assert.equal(dashboard.body.consolidation.grading.period_label, 'Term');

    const other = await api().get('/api/teacher/dashboard').set(bearer(subjectToken));
    assert.equal(other.body.consolidation, null);
  });

  test('the consolidation master sheet downloads as a CSV', async () => {
    const { sacClass, etechClass, alexA, isaA, alexB, isaB } = await setupSection();
    await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]]);
    await fillAndSubmit(subjectToken, etechClass.id, [[alexB, PERFECT], [isaB, LOW]]);

    const csv = await api().get('/api/teacher/consolidation?quarter=3&format=csv').set(bearer(adviserToken));
    assert.equal(csv.status, 200);
    // Subject columns are alphabetical: Empowerment Technologies, Sacraments.
    assert.match(csv.text, /Empowerment Technologies,Sacraments,GWA,Standing,Rank/);
    assert.match(csv.text, /Rivera, Alex.*100,90,95\.00,Academic Excellence Award,1/);
    assert.match(csv.text, /Flores, Isabella.*68,68,68\.00,At risk,2/);
  });

  test('an adviser of another section sees only their own section', async () => {
    const { sacClass, alexA, isaA } = await setupSection();
    await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]]);

    const markAdviser = (await signup({ first_name: 'Mark', last_name: 'Adviser' })).token;
    await setAdviser(markAdviser, 10, `Mark${counter}`);
    const view = await api().get('/api/teacher/consolidation?quarter=3').set(bearer(markAdviser));
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.subjects.length, 0);
    assert.equal(view.body.learners.length, 0);
    assert.equal(view.body.readiness.total, 0);
  });

  test('final grades: the mean of the three term grades, once every term is filed', async () => {
    const { sacClass, etechClass, alexA, isaA, alexB, isaB } = await setupSection();
    for (const term of [1, 2, 3]) {
      await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]], false, term);
      await fillAndSubmit(subjectToken, etechClass.id, [[alexB, PERFECT], [isaB, LOW]], false, term);
    }

    const finals = await api().get('/api/teacher/consolidation?scope=final').set(bearer(adviserToken));
    assert.equal(finals.status, 200, JSON.stringify(finals.body));
    assert.equal(finals.body.has_data, true);
    assert.deepEqual(finals.body.periods, [1, 2, 3]);
    assert.equal(finals.body.readiness.complete, 2);
    assert.equal(finals.body.readiness.total, 2);
    assert.equal(finals.body.readiness.pct, 100);

    const alex = finals.body.learners.find((row) => row.learner_id === alexA.learner_id);
    assert.equal(alex.grades['Sacraments'], 90); // (90 + 90 + 90) / 3
    assert.equal(alex.grades['Empowerment Technologies'], 100);
    assert.equal(alex.gwa, 95);
    assert.equal(alex.honors, 'Academic Excellence Award');
    assert.equal(alex.rank, 1);

    const isabella = finals.body.learners.find((row) => row.learner_id === isaA.learner_id);
    assert.equal(isabella.grades['Sacraments'], 68);
    assert.equal(isabella.grades['Empowerment Technologies'], 68);
    assert.equal(isabella.gwa, 68);
    assert.equal(isabella.honors, null);
    assert.equal(isabella.at_risk, true);
    assert.equal(isabella.rank, 2);

    assert.equal(finals.body.kpis.class_gwa, 81.5);
    assert.equal(finals.body.kpis.honor_count, 1);
    assert.equal(finals.body.kpis.at_risk_count, 1);

    const csv = await api().get('/api/teacher/consolidation?scope=final&format=csv').set(bearer(adviserToken));
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Empowerment Technologies,Sacraments,Final GWA,Standing,Rank/);
    assert.match(csv.text, /Rivera, Alex.*100,90,95\.00,Academic Excellence Award,1/);
    assert.match(csv.text, /Flores, Isabella.*68,68,68\.00,At risk,2/);
  });

  test('final grades stay blank until every term is filed for a subject', async () => {
    const { sacClass, etechClass, alexA, isaA, alexB, isaB } = await setupSection();
    for (const term of [1, 2, 3]) {
      await fillAndSubmit(adviserToken, sacClass.id, [[alexA, WORKED], [isaA, LOW]], false, term);
    }
    // E-tech files only Terms 1 and 2.
    for (const term of [1, 2]) {
      await fillAndSubmit(subjectToken, etechClass.id, [[alexB, PERFECT], [isaB, LOW]], false, term);
    }

    const finals = await api().get('/api/teacher/consolidation?scope=final').set(bearer(adviserToken));
    assert.equal(finals.status, 200, JSON.stringify(finals.body));
    assert.equal(finals.body.has_data, true);
    assert.equal(finals.body.readiness.complete, 1);
    assert.equal(finals.body.readiness.total, 2);
    const alex = finals.body.learners.find((row) => row.learner_id === alexA.learner_id);
    assert.equal(alex.grades['Sacraments'], 90);
    assert.equal(alex.grades['Empowerment Technologies'], null);
    assert.equal(alex.gwa, null);
    assert.equal(alex.gwa_reason, 'Waiting on Empowerment Technologies');
    assert.equal(alex.standing, 'Pending grades');
  });
});

// ---------- Subject groups and default weights ----------

describe('Subject groups and default weights', () => {
  test('a subject keeps the group it is given, and the group decides the default weights', async () => {
    const { token } = await signup();
    const mapeh = await makeSubject(token, { name: 'Music and Arts', grade_level: 10, group: 'mapeh' });
    assert.equal(mapeh.group, 'mapeh');
    const core = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    assert.equal(core.group, 'core');

    const mapehClass = await makeClass(token, { subject: mapeh, section_name: 'Luke' });
    const mapehSheet = await getSheet(token, mapehClass.id, 1);
    assert.deepEqual(mapehSheet.weights, { ww: 20, pt: 60, ex: 20, floor: 60 });

    const coreClass = await makeClass(token, { subject: core, section_name: 'Mark' });
    const coreSheet = await getSheet(token, coreClass.id, 1);
    assert.deepEqual(coreSheet.weights, { ww: 20, pt: 50, ex: 30, floor: 60 });

    // The group can be changed afterwards.
    const changed = await api().patch(`/api/teacher/subjects/${core.id}`).set(bearer(token))
      .send({ name: 'Sacraments', grade_level: 10, group: 'epp_tle' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.subject.group, 'epp_tle');

    const bad = await api().patch(`/api/teacher/subjects/${core.id}`).set(bearer(token))
      .send({ name: 'Sacraments', grade_level: 10, group: 'music' });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
  });

  test('a subject created without a group takes its group from its name', async () => {
    const { token } = await signup();
    const music = await makeSubject(token, { name: 'Music and Arts', grade_level: 10 });
    assert.equal(music.group, 'mapeh');
    const epp = await makeSubject(token, { name: 'EPP and TLE', grade_level: 10 });
    assert.equal(epp.group, 'epp_tle');
    const sacraments = await makeSubject(token, { name: 'Sacraments', grade_level: 10 });
    assert.equal(sacraments.group, 'core');
  });

  test('a subject created on the spot takes its group from its name', async () => {
    const { token } = await signup();
    const response = await api().post('/api/teacher/classes').set(bearer(token))
      .send({ new_subject_name: 'Music and Arts', grade_level: 10, section_name: 'Luke', room: 'Room 8', academic_year: '2026-2027' });
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const subjects = await api().get('/api/teacher/subjects').set(bearer(token));
    const music = subjects.body.items.find((subject) => subject.name === 'Music and Arts');
    assert.equal(music.group, 'mapeh');
  });
});

// ---------- Grading profiles (Settings) ----------
// These tests change the grading system, so they run last in this file and
// use the 2027-2028 year (which has no filings) for every switch — the lock
// below refuses to switch a year that already has filings, and 2026-2027
// has filings from the consolidation tests above.

describe('Grading profiles (Settings)', () => {
  test('settings shows the grading system for the year and the three choices', async () => {
    const settings = await api().get('/api/settings').set(bearer(adminToken));
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.body.grading_profile, 'do015_adjusted');
    assert.equal(settings.body.grading.label, 'DO 015 · Adjusted · SY 2026-2027');
    assert.deepEqual(settings.body.grading.periods, [1, 2, 3]);
    assert.equal(settings.body.grading.third_label, 'Examinations');
    assert.deepEqual(
      settings.body.grading_profiles.map((profile) => profile.code),
      ['do8_2015', 'do015_adjusted', 'do015_zero_based']
    );
  });

  test('a teacher cannot change the grading system, and an unknown profile is refused', async () => {
    const { token } = await signup();
    const teacher = await api().put('/api/settings/grading-system').set(bearer(token))
      .send({ academic_year: '2027-2028', profile: 'do8_2015' });
    assert.equal(teacher.status, 401, JSON.stringify(teacher.body));

    const bad = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do9_2030' });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
  });

  test('under DO 8 the sheet has four quarters, a QA column and 30/50/20 weights', async () => {
    const switched = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do8_2015' });
    assert.equal(switched.status, 200, JSON.stringify(switched.body));
    assert.equal(switched.body.grading_profile, 'do8_2015');

    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments' });
    const klass = await makeClass(token, { subject, section_name: 'Luke', academic_year: '2027-2028' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    assert.equal(sheet.grading.code, 'do8_2015');
    assert.deepEqual(sheet.grading.periods, [1, 2, 3, 4]);
    assert.equal(sheet.grading.period_label, 'Quarter');
    assert.equal(sheet.grading.third_short, 'QA');
    assert.deepEqual(sheet.columns.map((column) => column.name), ['WW1', 'WW2', 'WW3', 'WW4', 'PT1', 'PT2', 'PT3', 'PT4', 'QA1']);
    assert.deepEqual(sheet.weights, { ww: 30, pt: 50, ex: 20, floor: 60 });

    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED_DO8));
    const after = await getSheet(token, klass.id, 1);
    assert.equal(after.learners[0].computed.initial, 88.05);
    assert.equal(after.learners[0].computed.qg, 92);

    const restored = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do015_zero_based' });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
  });

  test('switching next year to zero-based does not change this year’s grades', async () => {
    const switched = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do015_zero_based' });
    assert.equal(switched.status, 200, JSON.stringify(switched.body));

    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments' });
    const nextYear = await makeClass(token, { subject, section_name: 'Luke', academic_year: '2027-2028' });
    const thisYear = await makeClass(token, { subject, section_name: 'Mark', academic_year: '2026-2027' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, nextYear.id, alex.id);
    await enrol(token, thisYear.id, alex.id);

    const nextSheet = await getSheet(token, nextYear.id, 1);
    await saveScores(token, nextYear.id, 1, scoresFor(nextSheet, alex, WORKED));
    const nextAfter = await getSheet(token, nextYear.id, 1);
    assert.equal(nextAfter.grading.code, 'do015_zero_based');
    assert.equal(nextAfter.learners[0].computed.initial, 88.01);
    assert.equal(nextAfter.learners[0].computed.qg, 88); // the initial grade itself, rounded

    const thisSheet = await getSheet(token, thisYear.id, 1);
    await saveScores(token, thisYear.id, 1, scoresFor(thisSheet, alex, WORKED));
    const thisAfter = await getSheet(token, thisYear.id, 1);
    assert.equal(thisAfter.grading.code, 'do015_adjusted');
    assert.equal(thisAfter.learners[0].computed.initial, 88.01);
    assert.equal(thisAfter.learners[0].computed.qg, 90); // the adjusted table
  });

  test('Quarter 4 data is preserved across the switch and readable again under DO 8', async () => {
    const toDo8 = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do8_2015' });
    assert.equal(toDo8.status, 200, JSON.stringify(toDo8.body));

    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments' });
    const klass = await makeClass(token, { subject, section_name: 'Luke', academic_year: '2027-2028' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const q4 = await getSheet(token, klass.id, 4);
    assert.deepEqual(q4.columns.map((column) => column.name), ['WW1', 'WW2', 'WW3', 'WW4', 'PT1', 'PT2', 'PT3', 'PT4', 'QA1']);
    await saveScores(token, klass.id, 4, scoresFor(q4, alex, WORKED_DO8));
    const filed = await getSheet(token, klass.id, 4);
    assert.equal(filed.learners[0].computed.initial, 88.05);
    assert.equal(filed.learners[0].computed.qg, 92);

    // Switch the year to DO 015: Quarter 4 is no longer offered, and the
    // sheet opens on Term 3 instead.
    const toDo015 = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do015_adjusted' });
    assert.equal(toDo015.status, 200, JSON.stringify(toDo015.body));

    const refused = await api().get(`/api/teacher/grades/${klass.id}?quarter=4`).set(bearer(token));
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(refused.body.message, /Term 4 does not exist|Quarter 4 does not exist/);

    const opened = await api().get(`/api/teacher/grades/${klass.id}`).set(bearer(token));
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.quarter, 3);
    assert.equal(opened.body.grading.code, 'do015_adjusted');

    // Switch back to DO 8: the Quarter 4 record is still there, unchanged.
    const back = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do8_2015' });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    const restored = await getSheet(token, klass.id, 4);
    assert.equal(restored.learners[0].computed.initial, 88.05);
    assert.equal(restored.learners[0].computed.qg, 92);

    const toZero = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do015_zero_based' });
    assert.equal(toZero.status, 200, JSON.stringify(toZero.body));
  });

  test('a class first opened under DO 8 follows the new profile when the year switches to DO 015', async () => {
    const toDo8 = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do8_2015' });
    assert.equal(toDo8.status, 200, JSON.stringify(toDo8.body));

    const { token } = await signup();
    const subject = await makeSubject(token, { name: 'Sacraments' });
    const klass = await makeClass(token, { subject, section_name: 'Luke', academic_year: '2027-2028' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const do8Sheet = await getSheet(token, klass.id, 1);
    assert.deepEqual(do8Sheet.columns.map((column) => column.name), ['WW1', 'WW2', 'WW3', 'WW4', 'PT1', 'PT2', 'PT3', 'PT4', 'QA1']);
    assert.deepEqual(do8Sheet.weights, { ww: 30, pt: 50, ex: 20, floor: 60 });
    await saveScores(token, klass.id, 1, scoresFor(do8Sheet, alex, WORKED_DO8));
    const filed = await getSheet(token, klass.id, 1);
    assert.equal(filed.learners[0].computed.initial, 88.05);
    assert.equal(filed.learners[0].computed.qg, 92);

    // The year switches to DO 015 with no submission filed. The encoded
    // scores are untouched; the single Quarterly Assessment column is now
    // shown as an Examinations column (it was stored as EX all along, only
    // the name follows the profile), and the weights follow the new
    // profile's defaults because the teacher never saved weights of their
    // own: 20/50/30 instead of 30/50/20. So the initial grade moves from
    // 88.05 to 87.95 (17 + 45.75 + 25.2) and the adjusted table gives 90.
    const toDo015 = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do015_adjusted' });
    assert.equal(toDo015.status, 200, JSON.stringify(toDo015.body));

    const after = await getSheet(token, klass.id, 1);
    assert.equal(after.grading.code, 'do015_adjusted');
    assert.deepEqual(after.columns.map((column) => column.name), ['WW1', 'WW2', 'WW3', 'WW4', 'PT1', 'PT2', 'PT3', 'PT4', 'EX1']);
    assert.deepEqual(
      after.columns.filter((c) => c.component === 'EX').map((c) => [c.name, c.sub_weight]),
      [['EX1', null]]
    );
    assert.deepEqual(after.weights, { ww: 20, pt: 50, ex: 30, floor: 60 });
    assert.equal(after.learners[0].computed.initial, 87.95);
    assert.equal(after.learners[0].computed.qg, 90); // the adjusted table, not DO 8

    const toZero = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2027-2028', profile: 'do015_zero_based' });
    assert.equal(toZero.status, 200, JSON.stringify(toZero.body));
  });

  test('the switch is refused once grades are filed for the year', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(sheet, alex, WORKED));
    const filed = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 1, confirm_blanks: false });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));

    const refused = await api().put('/api/settings/grading-system').set(bearer(adminToken))
      .send({ academic_year: '2026-2027', profile: 'do8_2015' });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(refused.body.message, /already been filed/);

    const settings = await api().get('/api/settings').set(bearer(adminToken));
    assert.equal(settings.body.grading_profile, 'do015_adjusted');
  });
});

// ---------- Migration 007 (quarters to terms) ----------
// Runs migration 007 against a scratch database that was built with
// migrations 001-006 and Batch 4 data, and checks the conversion: QA becomes
// EX with an equal share, the weights column is renamed, filed submissions
// keep DO 8, the year starts on DO 015 adjusted, and Quarter 4 survives.

describe('Migration 007 (quarters to terms)', () => {
  const fs = require('fs');
  const path = require('path');
  const { Pool, Client } = require('pg');
  const { config } = require('../src/config');

  const SCRATCH_DB = 'acadsync_migration_test';

  function pgOptions(database) {
    if (config.db.connectionString) {
      const url = new URL(config.db.connectionString);
      url.pathname = `/${database}`;
      return { connectionString: url.toString(), ssl: config.db.ssl };
    }
    return { ...config.db, database };
  }

  test('migration 007 converts Batch 4 data without losing anything', async () => {
    const admin = new Client(pgOptions('postgres'));
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
      await admin.query(`CREATE DATABASE "${SCRATCH_DB}"`);
    } finally {
      await admin.end();
    }

    const scratch = new Pool(pgOptions(SCRATCH_DB));
    try {
      const migrationsDir = path.join(__dirname, '..', 'migrations');
      const runFile = async (filename) => {
        const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
        await scratch.query(sql);
      };
      for (const file of ['001_init.sql', '002_billing.sql', '003_teacher_portal.sql', '004_classes.sql', '005_attendance.sql', '006_grades.sql']) {
        await runFile(file);
      }

      // Batch 4 data: a school, a teacher, Music and Arts (MAPEH by name),
      // a class with QA columns in Terms 1 and 4, weights, a score, and a
      // filed Term 1 submission. Migration 001 already sets the academic
      // year setting to 2026-2027.
      const school = await scratch.query(
        "INSERT INTO schools (name, category, school_type, city_region) VALUES ('Migration School', 'Secondary', 'Private', 'Test City') RETURNING id"
      );
      const teacher = await scratch.query(
        `INSERT INTO teachers (first_name, last_name, email, mobile, username, password_hash, school_id)
         VALUES ('Mig', 'Ration', 'migration@test.local', '09170000000', 'migration', 'hash', $1) RETURNING id`,
        [school.rows[0].id]
      );
      const subject = await scratch.query(
        `INSERT INTO subjects (teacher_id, name, grade_level) VALUES ($1, 'Music and Arts', 10) RETURNING id`,
        [teacher.rows[0].id]
      );
      const klass = await scratch.query(
        `INSERT INTO classes (teacher_id, subject_id, grade_level, section_name, academic_year)
         VALUES ($1, $2, 10, 'Luke', '2026-2027') RETURNING id`,
        [teacher.rows[0].id, subject.rows[0].id]
      );
      const classId = klass.rows[0].id;
      await scratch.query(
        `INSERT INTO grade_weights (class_id, ww_weight, pt_weight, qa_weight) VALUES ($1, 30, 50, 20)`,
        [classId]
      );
      const qa1 = await scratch.query(
        `INSERT INTO grade_columns (class_id, quarter, component, position, highest_possible)
         VALUES ($1, 1, 'QA', 1, 50) RETURNING id`,
        [classId]
      );
      await scratch.query(
        `INSERT INTO grade_columns (class_id, quarter, component, position, highest_possible)
         VALUES ($1, 4, 'QA', 1, 50)`,
        [classId]
      );
      const learner = await scratch.query(
        `INSERT INTO learners (teacher_id, first_name, last_name, learner_id, sex)
         VALUES ($1, 'Alex', 'Rivera', 'STU-2026-1048', 'Male') RETURNING id`,
        [teacher.rows[0].id]
      );
      await scratch.query(
        `INSERT INTO class_learners (class_id, learner_id) VALUES ($1, $2)`,
        [classId, learner.rows[0].id]
      );
      await scratch.query(
        `INSERT INTO grade_scores (column_id, learner_id, score) VALUES ($1, $2, 42)`,
        [qa1.rows[0].id, learner.rows[0].id]
      );
      await scratch.query(
        `INSERT INTO grade_submissions (class_id, quarter, academic_year, submitted_by)
         VALUES ($1, 1, '2026-2027', $2)`,
        [classId, teacher.rows[0].id]
      );

      await runFile('007_grading_profiles.sql');

      const profile = await scratch.query("SELECT profile FROM grading_profiles WHERE academic_year = '2026-2027'");
      assert.equal(profile.rows[0].profile, 'do015_adjusted');

      const group = await scratch.query('SELECT subject_group FROM subjects WHERE name = $1', ['Music and Arts']);
      assert.equal(group.rows[0].subject_group, 'mapeh');

      const columns = await scratch.query(
        'SELECT quarter, component, sub_weight::text AS sub_weight FROM grade_columns WHERE class_id = $1 ORDER BY quarter',
        [classId]
      );
      assert.deepEqual(columns.rows, [
        { quarter: 1, component: 'EX', sub_weight: '100.00' },
        { quarter: 4, component: 'EX', sub_weight: '100.00' },
      ]);

      const weights = await scratch.query('SELECT ww_weight, pt_weight, ex_weight FROM grade_weights WHERE class_id = $1', [classId]);
      assert.deepEqual(weights.rows[0], { ww_weight: 30, pt_weight: 50, ex_weight: 20 });

      const submissions = await scratch.query('SELECT profile FROM grade_submissions WHERE class_id = $1', [classId]);
      assert.equal(submissions.rows[0].profile, 'do8_2015');

      const score = await scratch.query(
        `SELECT gs.score::text AS score FROM grade_scores gs JOIN grade_columns gc ON gc.id = gs.column_id
          WHERE gc.class_id = $1 AND gc.quarter = 1`,
        [classId]
      );
      assert.equal(score.rows[0].score, '42.00');
    } finally {
      await scratch.end();
      const cleanup = new Client(pgOptions('postgres'));
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
      } finally {
        await cleanup.end();
      }
    }
  });
});

// ---------- Final grade column (Batch 7 fix 2) ----------

describe('Final grade column', () => {
  // Encodes one period's scores for the given learners and files the
  // period, with blanks allowed.
  async function fillAndFile(token, classId, quarter, learnerValues) {
    const sheet = await getSheet(token, classId, quarter);
    const all = [];
    for (const [learner, values] of learnerValues) all.push(...scoresFor(sheet, learner, values));
    await saveScores(token, classId, quarter, all);
    const filed = await api().post(`/api/teacher/grades/${classId}/submit`).set(bearer(token))
      .send({ quarter, confirm_blanks: true });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
  }

  test('a fresh sheet has no final grade yet', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const sheet = await getSheet(token, klass.id, 1);
    assert.equal(sheet.finals.filed_periods, 0);
    assert.equal(sheet.finals.total_periods, 3);
    assert.equal(sheet.finals.grades[alex.id], null);
  });

  test('the final appears once all three terms are saved complete, before filing, and filing keeps it', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', learner_id: 'STU-2026-1039', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, isabella.id);

    // Term 1: Alex 90, Isabella 68. No final yet.
    await fillAndFile(token, klass.id, 1, [[alex, WORKED], [isabella, LOW]]);
    let sheet = await getSheet(token, klass.id, 1);
    assert.equal(sheet.finals.filed_periods, 1);
    assert.equal(sheet.finals.grades[alex.id], null);

    // Term 2: Alex 100, Isabella 68. Still no final.
    await fillAndFile(token, klass.id, 2, [[alex, PERFECT], [isabella, LOW]]);
    sheet = await getSheet(token, klass.id, 2);
    assert.equal(sheet.finals.filed_periods, 2);
    assert.equal(sheet.finals.grades[alex.id], null);

    // Term 3 scores saved but NOT filed: the final already shows, from
    // the saved scores (Batch 8 fix 15 — the Grades-page final is no
    // longer filed-only). Only the filed count stays behind.
    const term3 = await getSheet(token, klass.id, 3);
    await saveScores(token, klass.id, 3, [
      ...scoresFor(term3, alex, LOW),
      ...scoresFor(term3, isabella, LOW),
    ]);
    sheet = await getSheet(token, klass.id, 3);
    assert.equal(sheet.finals.filed_periods, 2);
    assert.equal(sheet.finals.grades[alex.id], 86);
    assert.equal(sheet.finals.grades[isabella.id], 68);

    // Filing Term 3 keeps the final: mean of 90, 100 and 68, rounded.
    const filed = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 3, confirm_blanks: true });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    sheet = await getSheet(token, klass.id, 1);
    assert.equal(sheet.finals.filed_periods, 3);
    assert.equal(sheet.finals.total_periods, 3);
    assert.equal(sheet.finals.grades[alex.id], 86);
    assert.equal(sheet.finals.grades[isabella.id], 68);
  });

  test('editing scores after filing clears the filing, and the final follows the saved scores until re-filed', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    await fillAndFile(token, klass.id, 1, [[alex, WORKED]]);
    await fillAndFile(token, klass.id, 2, [[alex, PERFECT]]);
    await fillAndFile(token, klass.id, 3, [[alex, LOW]]);
    let sheet = await getSheet(token, klass.id, 1);
    assert.equal(sheet.finals.grades[alex.id], 86);

    // One changed score clears the Term 1 submission — but the final
    // stays, recomputed from the saved scores (Batch 8 fix 15).
    const term1 = await getSheet(token, klass.id, 1);
    await saveScores(token, klass.id, 1, scoresFor(term1, alex, { ww: [21] }));
    sheet = await getSheet(token, klass.id, 1);
    assert.equal(sheet.submission, null);
    assert.equal(sheet.finals.filed_periods, 2);
    assert.equal(sheet.finals.period_grades[alex.id][1], sheet.learners[0].computed.qg);
    assert.equal(sheet.finals.grades[alex.id], 86);

    // Re-filing brings the final back, recomputed from the new scores.
    const filed = await api().post(`/api/teacher/grades/${klass.id}/submit`).set(bearer(token))
      .send({ quarter: 1, confirm_blanks: false });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    sheet = await getSheet(token, klass.id, 1);
    const term1Grade = sheet.learners[0].computed.qg;
    assert.equal(sheet.finals.filed_periods, 3);
    assert.equal(sheet.finals.grades[alex.id], Math.round((term1Grade + 100 + 68) / 3));
  });

  test('a subject teacher with no advisory assignment sees finals for their own classes', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    // This teacher never set an advisory assignment: Consolidation
    // refuses them, but the grade sheet must still carry finals.
    const refused = await api().get('/api/teacher/consolidation?quarter=1').set(bearer(token));
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'NO_ADVISORY');

    await fillAndFile(token, klass.id, 1, [[alex, WORKED]]);
    await fillAndFile(token, klass.id, 2, [[alex, PERFECT]]);
    await fillAndFile(token, klass.id, 3, [[alex, LOW]]);
    const sheet = await getSheet(token, klass.id, 2);
    assert.equal(sheet.finals.filed_periods, 3);
    assert.equal(sheet.finals.grades[alex.id], 86);
  });

  test('a learner with an incomplete record in a filed period has no final grade', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    const isabella = await makeLearner(token, { first_name: 'Isabella', last_name: 'Flores', learner_id: 'STU-2026-1039', sex: 'Female' });
    await enrol(token, klass.id, alex.id);
    await enrol(token, klass.id, isabella.id);

    await fillAndFile(token, klass.id, 1, [[alex, WORKED], [isabella, LOW]]);
    await fillAndFile(token, klass.id, 2, [[alex, PERFECT], [isabella, LOW]]);
    // Term 3 is filed with Isabella blank (confirm_blanks).
    await fillAndFile(token, klass.id, 3, [[alex, LOW]]);

    const sheet = await getSheet(token, klass.id, 3);
    assert.equal(sheet.finals.filed_periods, 3);
    assert.equal(sheet.finals.grades[alex.id], 86);
    assert.equal(sheet.finals.grades[isabella.id], null);
  });

  test('the final averages four quarters under DO 8', async () => {
    const { token } = await signup();
    const klass = await makeClass(token, { section_name: 'Luke', academic_year: '2025-2026' });
    const alex = await makeLearner(token, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
    await enrol(token, klass.id, alex.id);

    const first = await getSheet(token, klass.id, 1);
    assert.equal(first.grading.code, 'do8_2015');
    assert.deepEqual(first.grading.periods, [1, 2, 3, 4]);
    assert.equal(first.finals.total_periods, 4);

    // Q1 92, Q2 100, Q3 70 — no final until Q4 has a complete saved record.
    // DO 8 has a single Quarterly Assessment column, so the perfect and
    // low sets carry one EX score, not three.
    const PERFECT_DO8 = { ww: [25, 25, 25, 25], pt: [50, 50, 50, 50], ex: [50] };
    const LOW_DO8 = { ww: [10, 10, 10, 10], pt: [20, 20, 20, 20], ex: [20] };
    await fillAndFile(token, klass.id, 1, [[alex, WORKED_DO8]]);
    await fillAndFile(token, klass.id, 2, [[alex, PERFECT_DO8]]);
    await fillAndFile(token, klass.id, 3, [[alex, LOW_DO8]]);
    let sheet = await getSheet(token, klass.id, 3);
    assert.equal(sheet.finals.filed_periods, 3);
    assert.equal(sheet.finals.grades[alex.id], null);

    // Q4 92, saved but not filed: mean of 92, 100, 70 and 92 is 88.5,
    // rounded to 89. The final follows the saved scores (Batch 8 fix 15).
    const q4 = await getSheet(token, klass.id, 4);
    await saveScores(token, klass.id, 4, scoresFor(q4, alex, WORKED_DO8));
    sheet = await getSheet(token, klass.id, 4);
    assert.equal(sheet.finals.filed_periods, 3);
    assert.equal(sheet.finals.grades[alex.id], 89);
  });
});
