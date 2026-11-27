// School seal tests: upload on the Dashboard, shared by the school,
// printed on the Report Card. Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOT_AN_IMAGE = Buffer.from('This is plain text, not an image at all.');
const TOO_BIG = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);

let adminToken;
let schoolId;
let adviserToken;
let otherToken;
let counter = 0;

async function signup(first, last) {
  counter += 1;
  const response = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: first,
      last_name: last,
      email: `seal${counter}@test.local`,
      mobile: '09171234567',
      school_id: schoolId,
      password: 'TeacherPass123',
      terms_accepted: true,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

before(async () => {
  await resetDatabase();
  await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Seal Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const adviser = await signup('Adviser', 'Teacher');
  adviserToken = adviser.token;
  const other = await signup('Other', 'Teacher');
  otherToken = other.token;

  // The adviser needs a section and a class so the Report Card loads.
  const adviserSet = await api()
    .patch('/api/teacher/me/adviser')
    .set(bearer(adviserToken))
    .send({ is_adviser: true, advisory_grade: 7, advisory_section: 'Tatus' });
  assert.equal(adviserSet.status, 200, JSON.stringify(adviserSet.body));

  const subject = await api()
    .post('/api/teacher/subjects')
    .set(bearer(adviserToken))
    .send({ name: 'Mathematics', grade_level: 7 });
  assert.equal(subject.status, 201, JSON.stringify(subject.body));
  const klass = await api()
    .post('/api/teacher/classes')
    .set(bearer(adviserToken))
    .send({ subject_id: subject.body.subject.id, grade_level: 7, section_name: 'Tatus', room: 'Room 1', academic_year: '2026-2027' });
  assert.equal(klass.status, 201, JSON.stringify(klass.body));
  const learner = await api()
    .post('/api/teacher/learners')
    .set(bearer(adviserToken))
    .send({ first_name: 'Alex', last_name: 'Rivera', learner_id: 'STU-2026-1048', sex: 'Male', birthdate: '2013-05-20' });
  assert.equal(learner.status, 201, JSON.stringify(learner.body));
  const enrolled = await api()
    .post(`/api/teacher/classes/${klass.body.class.id}/learners`)
    .set(bearer(adviserToken))
    .send({ learner_id: learner.body.learner.id });
  assert.equal(enrolled.status, 201, JSON.stringify(enrolled.body));
});

after(async () => {
  await pool.end();
});

async function getCards(token) {
  const response = await api().get('/api/teacher/report-card').set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

describe('School seal upload', () => {
  test('no seal at first: the card says so and the image is not found', async () => {
    const cards = await getCards(adviserToken);
    assert.equal(cards.has_school_seal, false);
    const image = await api().get('/api/teacher/school/seal').set(bearer(adviserToken));
    assert.equal(image.status, 404, JSON.stringify(image.body));
  });

  test('uploading a seal sets the flag, serves the image, and flags the card', async () => {
    const uploaded = await api()
      .put('/api/teacher/school/seal')
      .set(bearer(adviserToken))
      .attach('seal_image', PNG, 'seal.png');
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.teacher.has_school_seal, true);
    assert.equal(uploaded.body.message, 'School seal uploaded.');

    const image = await api().get('/api/teacher/school/seal').set(bearer(adviserToken));
    assert.equal(image.status, 200);
    assert.match(image.headers['content-type'], /image\/png/);

    const cards = await getCards(adviserToken);
    assert.equal(cards.has_school_seal, true);
  });

  test('the seal belongs to the school: another teacher of the school sees it too', async () => {
    const image = await api().get('/api/teacher/school/seal').set(bearer(otherToken));
    assert.equal(image.status, 200);
    const me = await api().get('/api/teacher/me').set(bearer(otherToken));
    assert.equal(me.body.teacher.has_school_seal, true);
  });

  test('an image that is not a PNG, JPG or WEBP is refused', async () => {
    const response = await api()
      .put('/api/teacher/school/seal')
      .set(bearer(adviserToken))
      .attach('seal_image', NOT_AN_IMAGE, 'seal.png');
    assert.equal(response.status, 400, JSON.stringify(response.body));
    const cards = await getCards(adviserToken);
    assert.equal(cards.has_school_seal, true);
  });

  test('an image over 2 MB is refused', async () => {
    const response = await api()
      .put('/api/teacher/school/seal')
      .set(bearer(adviserToken))
      .attach('seal_image', TOO_BIG, 'seal.png');
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(JSON.stringify(response.body), /too large/i);
    const cards = await getCards(adviserToken);
    assert.equal(cards.has_school_seal, true);
  });

  test('removing the seal clears the flag and the image', async () => {
    const removed = await api()
      .put('/api/teacher/school/seal')
      .set(bearer(adviserToken))
      .field('remove_seal', 'true');
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.teacher.has_school_seal, false);
    const image = await api().get('/api/teacher/school/seal').set(bearer(adviserToken));
    assert.equal(image.status, 404);
    const cards = await getCards(adviserToken);
    assert.equal(cards.has_school_seal, false);
  });

  test('uploading with no file and no remove flag is refused', async () => {
    const response = await api()
      .put('/api/teacher/school/seal')
      .set(bearer(adviserToken))
      .field('remove_seal', 'false');
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });
});
