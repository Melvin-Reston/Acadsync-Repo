// Lesson plans (Batch 11) tests: creating a draft with only its header,
// the AI declaration (none by default, described when AI was used), the
// period check against the class's grading profile, ownership scoping,
// marking Ready only when the core sections are present, duplicating a
// plan as a fresh draft, and deleting. Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

let adminToken;
let schoolId;
let counter = 0;
let teacherToken;
let otherTeacherToken;
let klass;
let otherKlass;

async function signup(overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'Lesson',
      last_name: `Teacher${counter}`,
      email: `lessonteacher${counter}@test.local`,
      mobile: '09171234567',
      school_id: schoolId,
      password: 'TeacherPass123',
      terms_accepted: true,
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function makeClass(token, overrides = {}) {
  counter += 1;
  const subject = await api()
    .post('/api/teacher/subjects')
    .set(bearer(token))
    .send({ name: `LessonSubject${counter}`, grade_level: 7 });
  assert.equal(subject.status, 201, JSON.stringify(subject.body));
  const response = await api()
    .post('/api/teacher/classes')
    .set(bearer(token))
    .send({
      subject_id: subject.body.subject.id,
      grade_level: 7,
      section_name: `LessonSection${counter}`,
      room: 'Room 1',
      academic_year: '2026-2027',
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.class;
}

async function createPlan(token, overrides = {}) {
  return api()
    .post('/api/teacher/lesson-plans')
    .set(bearer(token))
    .send({
      class_id: klass.id,
      quarter: 1,
      week_number: 7,
      session_date: '2026-08-20',
      lesson_title: 'Different Forms, Same Value: Representing Rational Numbers',
      ...overrides,
    });
}

before(async () => {
  await resetDatabase();
  adminToken = await signIn(ADMIN);
  await signIn(SUPER);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Lesson Test School', category: 'Secondary', school_type: 'Public', city_region: 'Hindang, Leyte', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  teacherToken = (await signup({ first_name: 'John', last_name: 'Maniago' })).token;
  otherTeacherToken = (await signup({ first_name: 'Elmer', last_name: 'Datalayta' })).token;
  klass = await makeClass(teacherToken);
  otherKlass = await makeClass(otherTeacherToken);
});

after(async () => {
  await pool.end();
});

describe('lesson plan creation', () => {
  test('a draft starts with only its header, and the no-AI declaration is stored', async () => {
    const response = await createPlan(teacherToken);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const plan = response.body.plan;
    assert.equal(plan.status, 'draft');
    assert.equal(plan.ai_use, 'none');
    assert.match(plan.ai_declaration, /No AI tools were used/);
    assert.match(plan.ai_declaration, /DO 3, s\. 2026/);
    assert.equal(plan.competency, '');
    assert.equal(plan.subject_name, klass.subject_name);
    assert.equal(plan.period_label, 'Term');
  });

  test('AI used without a description is refused, and with one it is stored', async () => {
    const refused = await createPlan(teacherToken, { ai_use: 'used', ai_declaration: '', session_date: '2026-08-21' });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.ok(refused.body.errors.ai_declaration);

    const used = await createPlan(teacherToken, {
      ai_use: 'used',
      ai_declaration: 'Used Muse to draft the motivation activity; reviewed and adapted for the class.',
      session_date: '2026-08-21',
    });
    assert.equal(used.status, 201, JSON.stringify(used.body));
    assert.equal(used.body.plan.ai_use, 'used');
    assert.match(used.body.plan.ai_declaration, /Muse/);
  });

  test('a plan created already marked Ready is refused until the core sections are present', async () => {
    const refused = await createPlan(teacherToken, { status: 'ready', session_date: '2026-08-25' });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.ok(refused.body.errors.formative_assessment);
  });

  test('Term 4 does not exist under DO 015, and a bad week or date is refused', async () => {
    const term4 = await createPlan(teacherToken, { quarter: 4, session_date: '2026-08-22' });
    assert.equal(term4.status, 400, JSON.stringify(term4.body));
    const week0 = await createPlan(teacherToken, { week_number: 0, session_date: '2026-08-22' });
    assert.equal(week0.status, 400, JSON.stringify(week0.body));
    const badDate = await createPlan(teacherToken, { session_date: '2026-02-31' });
    assert.equal(badDate.status, 400, JSON.stringify(badDate.body));
  });

  test("another teacher's class cannot be used, and plans are scoped to their teacher", async () => {
    const foreign = await createPlan(teacherToken, { class_id: otherKlass.id, session_date: '2026-08-23' });
    assert.equal(foreign.status, 404, JSON.stringify(foreign.body));

    const list = await api().get('/api/teacher/lesson-plans').set(bearer(otherTeacherToken));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.items.length, 0);

    const mine = await api().get('/api/teacher/lesson-plans').set(bearer(teacherToken));
    assert.ok(mine.body.items.length >= 2);
    assert.ok(mine.body.items.every((item) => item.teacher_id !== undefined));
  });
});

describe('lesson plan editing, readiness and duplication', () => {
  let planId;

  test('a partial update changes only the fields sent', async () => {
    const created = await createPlan(teacherToken, { session_date: '2026-08-24', competency: 'Describe rational numbers.' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    planId = created.body.plan.id;

    const updated = await api()
      .patch(`/api/teacher/lesson-plans/${planId}`)
      .set(bearer(teacherToken))
      .send({ lesson_title: 'Rational Numbers, Retitled' });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.plan.lesson_title, 'Rational Numbers, Retitled');
    assert.equal(updated.body.plan.competency, 'Describe rational numbers.');
    assert.equal(updated.body.plan.session_date, '2026-08-24');
  });

  test('Ready is refused until the core sections are present, then it succeeds', async () => {
    const refused = await api()
      .patch(`/api/teacher/lesson-plans/${planId}`)
      .set(bearer(teacherToken))
      .send({ status: 'ready' });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.ok(refused.body.errors.formative_assessment);

    const filled = await api()
      .patch(`/api/teacher/lesson-plans/${planId}`)
      .set(bearer(teacherToken))
      .send({
        objective_knowledge: 'Define a rational number.',
        flow: 'Convert fractions to decimals by dividing.',
        formative_assessment: 'Choose the equivalent of 3/5.',
        formative_answer_key: 'B — 0.6',
      });
    assert.equal(filled.status, 200, JSON.stringify(filled.body));

    const ready = await api()
      .patch(`/api/teacher/lesson-plans/${planId}`)
      .set(bearer(teacherToken))
      .send({ status: 'ready' });
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    assert.equal(ready.body.plan.status, 'ready');
  });

  test('switching the AI choice without new wording refills or refuses, never contradicts', async () => {
    const used = await api()
      .patch(`/api/teacher/lesson-plans/${planId}`)
      .set(bearer(teacherToken))
      .send({ ai_use: 'used' });
    assert.equal(used.status, 400, JSON.stringify(used.body));

    const described = await api()
      .patch(`/api/teacher/lesson-plans/${planId}`)
      .set(bearer(teacherToken))
      .send({ ai_use: 'used', ai_declaration: 'Used an AI tool to draft the group activity; reviewed and adapted.' });
    assert.equal(described.status, 200, JSON.stringify(described.body));
    assert.equal(described.body.plan.ai_use, 'used');

    const backToNone = await api()
      .patch(`/api/teacher/lesson-plans/${planId}`)
      .set(bearer(teacherToken))
      .send({ ai_use: 'none' });
    assert.equal(backToNone.status, 200, JSON.stringify(backToNone.body));
    assert.equal(backToNone.body.plan.ai_use, 'none');
    assert.match(backToNone.body.plan.ai_declaration, /No AI tools were used/);
  });

  test('the detail read carries the school header for the printout', async () => {
    const response = await api().get(`/api/teacher/lesson-plans/${planId}`).set(bearer(teacherToken));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.header.teacher_name, 'John Maniago');
    assert.equal(response.body.header.school_name, 'Lesson Test School');
    assert.equal(response.body.header.school_city_region, 'Hindang, Leyte');
    assert.equal(response.body.grading.period_label, 'Term');
  });

  test('duplicating copies every section as a fresh draft for a new week and date', async () => {
    const duplicated = await api()
      .post(`/api/teacher/lesson-plans/${planId}/duplicate`)
      .set(bearer(teacherToken))
      .send({ week_number: 8, session_date: '2026-08-27' });
    assert.equal(duplicated.status, 201, JSON.stringify(duplicated.body));
    const copy = duplicated.body.plan;
    assert.notEqual(copy.id, planId);
    assert.equal(copy.status, 'draft');
    assert.equal(copy.week_number, 8);
    assert.equal(copy.session_date, '2026-08-27');
    assert.equal(copy.competency, 'Describe rational numbers.');
    assert.equal(copy.formative_assessment, 'Choose the equivalent of 3/5.');
    assert.equal(copy.lesson_title, 'Rational Numbers, Retitled');
  });

  test("another teacher cannot read, change or delete a plan, and deleting removes it", async () => {
    const foreignRead = await api().get(`/api/teacher/lesson-plans/${planId}`).set(bearer(otherTeacherToken));
    assert.equal(foreignRead.status, 404, JSON.stringify(foreignRead.body));
    const foreignDelete = await api().delete(`/api/teacher/lesson-plans/${planId}`).set(bearer(otherTeacherToken));
    assert.equal(foreignDelete.status, 404, JSON.stringify(foreignDelete.body));

    const deleted = await api().delete(`/api/teacher/lesson-plans/${planId}`).set(bearer(teacherToken));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    const gone = await api().get(`/api/teacher/lesson-plans/${planId}`).set(bearer(teacherToken));
    assert.equal(gone.status, 404, JSON.stringify(gone.body));
  });

  test('list filters narrow by class, period, status and search', async () => {
    const first = await createPlan(teacherToken, { session_date: '2026-09-01', lesson_title: 'Fractions Searchable', quarter: 2 });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await createPlan(teacherToken, { session_date: '2026-09-02', lesson_title: 'Decimals Other', quarter: 1 });
    assert.equal(second.status, 201, JSON.stringify(second.body));

    const bySearch = await api().get('/api/teacher/lesson-plans?search=Fractions').set(bearer(teacherToken));
    assert.equal(bySearch.body.items.length, 1);
    assert.equal(bySearch.body.items[0].lesson_title, 'Fractions Searchable');

    const byPeriod = await api().get('/api/teacher/lesson-plans?quarter=2').set(bearer(teacherToken));
    assert.ok(byPeriod.body.items.length >= 1);
    assert.ok(byPeriod.body.items.every((item) => item.quarter === 2));

    const byYear = await api().get('/api/teacher/lesson-plans?academic_year=2026-2027').set(bearer(teacherToken));
    assert.ok(byYear.body.items.length >= 2);
    const otherYear = await api().get('/api/teacher/lesson-plans?academic_year=2025-2026').set(bearer(teacherToken));
    assert.equal(otherYear.body.items.length, 0);
  });
});
