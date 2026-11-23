// Teacher Batch 8 fix 10 tests: adviser-created manual subjects in
// Consolidation, with grades filed from a CSV upload. A manual subject
// exists when the subject teacher has no AcadSync account: the adviser
// creates the subject, uploads one CSV carrying every period's term
// grades, and Consolidation treats those grades like filed grades.
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
    .send({ name: 'Manual Subjects Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
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
      first_name: 'Manual',
      last_name: `Teacher${counter}`,
      email: `manualteacher${counter}@test.local`,
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

// The worked example under the default profile for 2026-2027
// (DO 015 adjusted, core weights 20/50/30) files a term grade of 90;
// LOW files 68; PERFECT files 100.
const WORKED = { ww: [20, 22, 25, 18], pt: [45, 48, 50, 40], ex: [42, 45, 40] };
const LOW = { ww: [10, 10, 10, 10], pt: [20, 20, 20, 20], ex: [20, 20, 20] };
const PERFECT = { ww: [25, 25, 25, 25], pt: [50, 50, 50, 50], ex: [50, 50, 50] };

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

async function fillAndSubmit(token, classId, learnerScores, quarter = 3) {
  const sheet = await getSheet(token, classId, quarter);
  const all = [];
  for (const [learner, values] of learnerScores) all.push(...scoresFor(sheet, learner, values));
  await saveScores(token, classId, quarter, all);
  const filed = await api().post(`/api/teacher/grades/${classId}/submit`).set(bearer(token))
    .send({ quarter, confirm_blanks: false });
  assert.equal(filed.status, 200, JSON.stringify(filed.body));
}

// One advisory section shared by an adviser and a subject teacher of the
// same school, with the same two learners by learner ID. Each setup gets
// its own section name so tests cannot see each other's classes.
async function setupSection() {
  counter += 1;
  const section = `Luke${counter}`;
  const adviserToken = (await signup({ first_name: 'Melvin', last_name: 'Reston' })).token;
  const subjectToken = (await signup({ first_name: 'John', last_name: 'Maniago' })).token;
  const otherToken = (await signup({ first_name: 'Other', last_name: 'Teacher' })).token;
  await setAdviser(adviserToken, 10, section);

  const sacraments = await makeSubject(adviserToken, { name: 'Sacraments' });
  const sacClass = await makeClass(adviserToken, { subject: sacraments, section_name: section });
  const alex = await makeLearner(adviserToken, { first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male' });
  const isa = await makeLearner(adviserToken, { first_name: 'Isabella', last_name: 'Flores', learner_id: 'STU-2026-1039', sex: 'Female' });
  await enrol(adviserToken, sacClass.id, alex.id);
  await enrol(adviserToken, sacClass.id, isa.id);

  const etech = await makeSubject(subjectToken, { name: 'Empowerment Technologies' });
  const etechClass = await makeClass(subjectToken, { subject: etech, section_name: section });
  await enrol(subjectToken, etechClass.id, alex.id);
  await enrol(subjectToken, etechClass.id, isa.id);

  return { adviserToken, subjectToken, otherToken, sacClass, etechClass, alex, isa, section };
}

async function createManual(token, overrides = {}) {
  return api()
    .post('/api/teacher/consolidation/manual-subjects')
    .set(bearer(token))
    .send({ subject_name: 'Values Education', teacher_name: 'Ms. No Account', ...overrides });
}

async function fileGrades(token, id, grades) {
  return api()
    .post(`/api/teacher/consolidation/manual-subjects/${id}/grades`)
    .set(bearer(token))
    .send({ grades });
}

function gradesFor(alex, isa, terms) {
  // terms: { alex: [t1, t2, t3], isa: [t1, t2, t3] } — null means not filed.
  const grades = [];
  for (const [learner, values] of [[alex, terms.alex], [isa, terms.isa]]) {
    values.forEach((grade, index) => {
      if (grade !== null && grade !== undefined) {
        grades.push({ learner_id: learner.learner_id, quarter: index + 1, grade });
      }
    });
  }
  return grades;
}

async function getView(token, quarter) {
  const view = await api().get(`/api/teacher/consolidation?quarter=${quarter}`).set(bearer(token));
  assert.equal(view.status, 200, JSON.stringify(view.body));
  return view.body;
}

async function getFinals(token) {
  const finals = await api().get('/api/teacher/consolidation?scope=final').set(bearer(token));
  assert.equal(finals.status, 200, JSON.stringify(finals.body));
  return finals.body;
}

// ---------- Manual subjects ----------

describe('Manual subjects', () => {
  test('the adviser creates a manual subject, frozen under the year’s profile', async () => {
    const { adviserToken } = await setupSection();
    const created = await createManual(adviserToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const manual = created.body.manual_subject;
    assert.equal(manual.subject_name, 'Values Education');
    assert.equal(manual.teacher_name, 'Ms. No Account');
    assert.equal(manual.grade_level, 10);
    assert.equal(manual.academic_year, '2026-2027');
    assert.equal(manual.profile_code, 'do015_adjusted');
    assert.equal(manual.grade_count, 0);
    assert.deepEqual(manual.periods_with_grades, []);

    const listed = await api().get('/api/teacher/consolidation/manual-subjects').set(bearer(adviserToken));
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.manual_subjects.length, 1);
    assert.equal(listed.body.manual_subjects[0].id, manual.id);
  });

  test('a teacher who is not an adviser cannot create a manual subject', async () => {
    const { subjectToken } = await setupSection();
    const created = await createManual(subjectToken);
    assert.equal(created.status, 400, JSON.stringify(created.body));
    assert.equal(created.body.code, 'NO_ADVISORY');
  });

  test('a manual subject cannot duplicate a real class subject for the section', async () => {
    const { adviserToken } = await setupSection();
    const created = await createManual(adviserToken, { subject_name: 'sacraments', teacher_name: 'Someone Else' });
    assert.equal(created.status, 409, JSON.stringify(created.body));
  });

  test('a manual subject cannot duplicate another manual subject for the section', async () => {
    const { adviserToken } = await setupSection();
    const first = await createManual(adviserToken);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await createManual(adviserToken, { subject_name: '  VALUES education  ', teacher_name: 'Another Name' });
    assert.equal(second.status, 409, JSON.stringify(second.body));
  });

  test('uploading grades shows the manual subject card with its average, and counts toward readiness', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const filed = await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, 82] }));
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    assert.equal(filed.body.filed, 6);
    assert.equal(filed.body.manual_subject.grade_count, 6);
    assert.deepEqual(filed.body.manual_subject.periods_with_grades, [1, 2, 3]);

    const view = await getView(adviserToken, 2);
    const card = view.subjects.find((subject) => subject.subject_name === 'Values Education');
    assert.ok(card, JSON.stringify(view.subjects));
    assert.equal(card.manual, true);
    assert.equal(card.manual_subject_id, manual.id);
    assert.equal(card.teacher_name, 'Ms. No Account');
    assert.equal(card.submitted, true);
    assert.equal(card.class_id, null);
    assert.equal(card.average, 85); // (90 + 80) / 2
    assert.equal(view.readiness.submitted, 1);
    assert.equal(view.readiness.total, 3);

    const alexRow = view.learners.find((row) => row.learner_id === alex.learner_id);
    assert.equal(alexRow.grades['Values Education'], 90);
    // Sacraments and E-tech are still waiting, so the GWA stays blank.
    assert.equal(alexRow.gwa, null);
    assert.match(alexRow.gwa_reason, /Waiting on/);
  });

  test('blank periods are allowed, and a learner with no grades stays blank', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    // Isabella has no Term 3 grade; Alex has all three terms.
    const filed = await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, null] }));
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    assert.equal(filed.body.filed, 5);

    const view = await getView(adviserToken, 3);
    const isaRow = view.learners.find((row) => row.learner_id === isa.learner_id);
    assert.equal(isaRow.grades['Values Education'], null);
    const card = view.subjects.find((subject) => subject.subject_name === 'Values Education');
    assert.equal(card.submitted, true); // Alex's Term 3 grade files the period
    assert.equal(card.average, 92);

    const finals = await getFinals(adviserToken);
    const alexFinal = finals.learners.find((row) => row.learner_id === alex.learner_id);
    assert.equal(alexFinal.grades['Values Education'], 89); // (85 + 90 + 92) / 3
    const isaFinal = finals.learners.find((row) => row.learner_id === isa.learner_id);
    assert.equal(isaFinal.grades['Values Education'], null);
  });

  test('an unknown Learner ID blocks the whole filing: nothing is saved', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const bad = await fileGrades(adviserToken, manual.id, [
      ...gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, 82] }),
      { learner_id: 'STU-9999', quarter: 1, grade: 88 },
    ]);
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.equal(bad.body.code, 'MANUAL_GRADES_INVALID');
    assert.equal(bad.body.invalid_rows.length, 1);
    assert.equal(bad.body.invalid_rows[0].learner_id, 'STU-9999');

    const listed = await api().get('/api/teacher/consolidation/manual-subjects').set(bearer(adviserToken));
    assert.equal(listed.body.manual_subjects[0].grade_count, 0);
    const view = await getView(adviserToken, 1);
    assert.equal(view.subjects.find((subject) => subject.subject_name === 'Values Education').submitted, false);
  });

  test('a duplicate row in the same filing is rejected', async () => {
    const { adviserToken, alex } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const bad = await fileGrades(adviserToken, manual.id, [
      { learner_id: alex.learner_id, quarter: 1, grade: 85 },
      { learner_id: ` ${alex.learner_id.toLowerCase()} `, quarter: 1, grade: 90 },
    ]);
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.equal(bad.body.code, 'MANUAL_GRADES_INVALID');
  });

  test('a non-numeric grade and a grade over 100 are rejected', async () => {
    const { adviserToken, alex } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const text = await fileGrades(adviserToken, manual.id, [
      { learner_id: alex.learner_id, quarter: 1, grade: 'eighty' },
    ]);
    assert.equal(text.status, 400, JSON.stringify(text.body));
    const over = await fileGrades(adviserToken, manual.id, [
      { learner_id: alex.learner_id, quarter: 1, grade: 101 },
    ]);
    assert.equal(over.status, 400, JSON.stringify(over.body));
  });

  test('Learner IDs match trimmed and case-insensitively', async () => {
    const { adviserToken, alex } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const filed = await fileGrades(adviserToken, manual.id, [
      { learner_id: `  ${alex.learner_id.toLowerCase()}  `, quarter: 1, grade: 85 },
    ]);
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    const view = await getView(adviserToken, 1);
    const row = view.learners.find((learner) => learner.learner_id === alex.learner_id);
    assert.equal(row.grades['Values Education'], 85);
  });

  test('re-uploading replaces the whole manual subject’s grades', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const first = await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, 82] }));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [70, null, null], isa: [null, null, null] }));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.manual_subject.grade_count, 1);
    assert.deepEqual(second.body.manual_subject.periods_with_grades, [1]);

    const view = await getView(adviserToken, 2);
    const alexRow = view.learners.find((row) => row.learner_id === alex.learner_id);
    assert.equal(alexRow.grades['Values Education'], null); // the Term 2 grade is gone
    const firstView = await getView(adviserToken, 1);
    assert.equal(firstView.learners.find((row) => row.learner_id === alex.learner_id).grades['Values Education'], 70);
  });

  test('renaming is allowed, but not to a real class subject name', async () => {
    const { adviserToken } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const renamed = await api()
      .patch(`/api/teacher/consolidation/manual-subjects/${manual.id}`)
      .set(bearer(adviserToken))
      .send({ subject_name: 'Civics', teacher_name: 'Mr. Renamed' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.manual_subject.subject_name, 'Civics');
    assert.equal(renamed.body.manual_subject.teacher_name, 'Mr. Renamed');

    const clash = await api()
      .patch(`/api/teacher/consolidation/manual-subjects/${manual.id}`)
      .set(bearer(adviserToken))
      .send({ subject_name: 'Empowerment Technologies' });
    assert.equal(clash.status, 409, JSON.stringify(clash.body));
  });

  test('deleting a manual subject removes it and its grades', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const filed = await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, 82] }));
    assert.equal(filed.status, 200, JSON.stringify(filed.body));

    const deleted = await api()
      .delete(`/api/teacher/consolidation/manual-subjects/${manual.id}`)
      .set(bearer(adviserToken));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    const listed = await api().get('/api/teacher/consolidation/manual-subjects').set(bearer(adviserToken));
    assert.deepEqual(listed.body.manual_subjects, []);
    const view = await getView(adviserToken, 1);
    assert.equal(view.subjects.some((subject) => subject.subject_name === 'Values Education'), false);
    const template = await api()
      .get(`/api/teacher/consolidation/manual-subjects/${manual.id}/template`)
      .set(bearer(adviserToken));
    assert.equal(template.status, 404, JSON.stringify(template.body));
  });

  test('another adviser’s manual subjects are invisible and unmodifiable', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, 82] }));

    const markToken = (await signup({ first_name: 'Mark', last_name: 'Adviser' })).token;
    await setAdviser(markToken, 10, `Mark${counter}`);
    const listed = await api().get('/api/teacher/consolidation/manual-subjects').set(bearer(markToken));
    assert.deepEqual(listed.body.manual_subjects, []);

    const template = await api()
      .get(`/api/teacher/consolidation/manual-subjects/${manual.id}/template`)
      .set(bearer(markToken));
    assert.equal(template.status, 404, JSON.stringify(template.body));
    const filed = await fileGrades(markToken, manual.id, [{ learner_id: alex.learner_id, quarter: 1, grade: 50 }]);
    assert.equal(filed.status, 404, JSON.stringify(filed.body));
    const deleted = await api()
      .delete(`/api/teacher/consolidation/manual-subjects/${manual.id}`)
      .set(bearer(markToken));
    assert.equal(deleted.status, 404, JSON.stringify(deleted.body));

    // The owner's grades are untouched.
    const view = await getView(adviserToken, 1);
    assert.equal(view.learners.find((row) => row.learner_id === alex.learner_id).grades['Values Education'], 85);
  });

  test('the CSV template is prefilled with one row per roster learner', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const template = await api()
      .get(`/api/teacher/consolidation/manual-subjects/${manual.id}/template`)
      .set(bearer(adviserToken));
    assert.equal(template.status, 200, JSON.stringify(template.body));
    const text = template.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const lines = text.trim().split('\n');
    assert.equal(lines[0], 'Learner ID,Student Name,Term 1,Term 2,Term 3');
    assert.equal(lines.length, 3);
    // Roster order is last name first, so the row order follows the roster.
    assert.deepEqual(
      lines.slice(1).sort(),
      [
        `${alex.learner_id},"Rivera, Alex",,,`,
        `${isa.learner_id},"Flores, Isabella",,,`,
      ].sort()
    );
  });

  test('an empty section roster yields a header-only template and blocks filing', async () => {
    const adviserToken = (await signup({ first_name: 'Empty', last_name: 'Roster' })).token;
    await setAdviser(adviserToken, 10, `Empty${counter}`);
    const manual = (await createManual(adviserToken)).body.manual_subject;
    const template = await api()
      .get(`/api/teacher/consolidation/manual-subjects/${manual.id}/template`)
      .set(bearer(adviserToken));
    assert.equal(template.status, 200, JSON.stringify(template.body));
    assert.equal(template.text.replace(/^\uFEFF/, '').trim(), 'Learner ID,Student Name,Term 1,Term 2,Term 3');

    const filed = await fileGrades(adviserToken, manual.id, [{ learner_id: 'STU-1', quarter: 1, grade: 85 }]);
    assert.equal(filed.status, 400, JSON.stringify(filed.body));
    assert.equal(filed.body.code, 'EMPTY_ROSTER');
  });

  test('a real filed submission takes precedence per period; manual grades fill the rest', async () => {
    const { adviserToken, subjectToken, alex, isa, section } = await setupSection();
    // The manual subject is created first, before any real Civics class exists.
    const manual = (await createManual(adviserToken, { subject_name: 'Civics', teacher_name: 'Ms. Civics' })).body.manual_subject;
    const filed = await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [80, 85, 90], isa: [82, 85, 88] }));
    assert.equal(filed.status, 200, JSON.stringify(filed.body));

    // The subject teacher later creates a real Civics class for the section
    // and files Term 2 only: perfect for Alex, low for Isabella.
    const civics = await makeSubject(subjectToken, { name: 'Civics' });
    const civicsClass = await makeClass(subjectToken, { subject: civics, section_name: section });
    await enrol(subjectToken, civicsClass.id, alex.id);
    await enrol(subjectToken, civicsClass.id, isa.id);
    await fillAndSubmit(subjectToken, civicsClass.id, [[alex, PERFECT], [isa, LOW]], 2);

    // One merged entry: Term 1 and Term 3 come from the manual grades,
    // Term 2 comes from the real filing — including Isabella's 68, which
    // the real filing's blank-free record replaces outright.
    const term1 = await getView(adviserToken, 1);
    assert.equal(term1.subjects.filter((subject) => subject.subject_name === 'Civics').length, 1);
    assert.equal(term1.learners.find((row) => row.learner_id === alex.learner_id).grades['Civics'], 80);
    const term2 = await getView(adviserToken, 2);
    assert.equal(term2.learners.find((row) => row.learner_id === alex.learner_id).grades['Civics'], 100);
    assert.equal(term2.learners.find((row) => row.learner_id === isa.learner_id).grades['Civics'], 68);
    const term3 = await getView(adviserToken, 3);
    assert.equal(term3.learners.find((row) => row.learner_id === isa.learner_id).grades['Civics'], 88);

    const finals = await getFinals(adviserToken);
    const civicsFinal = finals.subjects.find((subject) => subject.subject_name === 'Civics');
    assert.equal(civicsFinal.manual, true);
    assert.equal(civicsFinal.filed_periods, 3);
    const alexFinal = finals.learners.find((row) => row.learner_id === alex.learner_id);
    assert.equal(alexFinal.grades['Civics'], 90); // (80 + 100 + 90) / 3
    const isaFinal = finals.learners.find((row) => row.learner_id === isa.learner_id);
    assert.equal(isaFinal.grades['Civics'], 79); // (82 + 68 + 88) / 3, rounded
  });

  test('manual grades count in the final grades CSV export', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, 82] }));
    const finals = await getFinals(adviserToken);
    const subject = finals.subjects.find((row) => row.subject_name === 'Values Education');
    assert.equal(subject.filed_periods, 3);
    assert.equal(subject.total_periods, 3);
    assert.equal(subject.average, 84.5); // (89 + 80) / 2

    const csv = await api().get('/api/teacher/consolidation?scope=final&format=csv').set(bearer(adviserToken));
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Values Education,Final GWA/);
    // The final GWA stays blank while the unfiled real subjects are
    // waiting, but the manual final grade is in its column.
    assert.match(csv.text, new RegExp(`"Rivera, Alex",${alex.learner_id},Male,,,89,,Pending grades`));
  });

  test('manual grades appear on the Report Card with a final grade and general average', async () => {
    const { adviserToken, alex, isa } = await setupSection();
    const manual = (await createManual(adviserToken)).body.manual_subject;
    await fileGrades(adviserToken, manual.id, gradesFor(alex, isa, { alex: [85, 90, 92], isa: [78, 80, 82] }));

    const cards = await api().get('/api/teacher/report-card').set(bearer(adviserToken));
    assert.equal(cards.status, 200, JSON.stringify(cards.body));
    // Only the manual subject has filed grades, so it is the only subject
    // on the card — the unfiled real subjects stay off it.
    assert.deepEqual(
      cards.body.subjects.map((subject) => subject.subject_name),
      ['Values Education']
    );
    assert.equal(cards.body.subjects[0].teacher_name, 'Ms. No Account');
    const alexCard = cards.body.learners.find((row) => row.learner_id === alex.learner_id);
    const row = alexCard.subjects.find((subject) => subject.subject_name === 'Values Education');
    assert.deepEqual(row.period_grades, [85, 90, 92]);
    assert.equal(row.final_grade, 89);
    assert.equal(row.remarks, 'Passed');
    assert.equal(alexCard.general_average, 89);
    assert.equal(alexCard.general_average_remarks, 'Passed');
    const isaCard = cards.body.learners.find((row) => row.learner_id === isa.learner_id);
    assert.equal(isaCard.general_average, 80);
  });
});
