// DepEd logo tests: the two logos live in the database, seeded from the
// bundled originals, and an admin can replace one when DepEd changes it.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOT_AN_IMAGE = Buffer.from('This is plain text, not an image at all.');
const BUNDLED_SEAL = fs.readFileSync(path.join(__dirname, '..', 'assets', 'deped-seal.png'));
const BUNDLED_LOGO = fs.readFileSync(path.join(__dirname, '..', 'assets', 'deped-logo.webp'));

let adminToken;
let teacherToken;
let counter = 0;

before(async () => {
  await resetDatabase();
  await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'DepEd Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));

  counter += 1;
  const teacher = await api()
    .post('/api/teacher-auth/register')
    .send({
      first_name: 'DepEd',
      last_name: 'Teacher',
      email: `deped${counter}@test.local`,
      mobile: '09171234567',
      school_id: school.body.school.id,
      password: 'TeacherPass123',
      terms_accepted: true,
    });
  assert.equal(teacher.status, 201, JSON.stringify(teacher.body));
  teacherToken = teacher.body.token;
});

after(async () => {
  await pool.end();
});

describe('DepEd logos in the database', () => {
  test('the admin settings report both logos set, seeded from the bundled originals', async () => {
    const assets = await api().get('/api/settings/deped').set(bearer(adminToken));
    assert.equal(assets.status, 200, JSON.stringify(assets.body));
    assert.equal(assets.body.has_deped_seal, true);
    assert.equal(assets.body.has_deped_logo, true);

    const rows = await pool.query('SELECT key, mime_type, length(image_data) AS size FROM branding_images WHERE key LIKE \'deped_%\' ORDER BY key');
    assert.equal(rows.rowCount, 2);
    assert.equal(rows.rows.find((row) => row.key === 'deped_seal').mime_type, 'image/png');
    assert.equal(rows.rows.find((row) => row.key === 'deped_logo').mime_type, 'image/webp');
    assert.ok(Number(rows.rows.find((row) => row.key === 'deped_seal').size) > 100000);
  });

  test('teachers read the exact bundled bytes through their own endpoints', async () => {
    const seal = await api().get('/api/teacher/deped/seal').set(bearer(teacherToken));
    assert.equal(seal.status, 200);
    assert.equal(seal.headers['content-type'], 'image/png');
    assert.ok(Buffer.from(seal.body).equals(BUNDLED_SEAL));

    const logo = await api().get('/api/teacher/deped/logo').set(bearer(teacherToken));
    assert.equal(logo.status, 200);
    assert.equal(logo.headers['content-type'], 'image/webp');
    assert.ok(Buffer.from(logo.body).equals(BUNDLED_LOGO));
  });

  test('an admin can replace a logo, and re-seeding never overwrites the replacement', async () => {
    const replaced = await api()
      .put('/api/settings/deped/seal')
      .set(bearer(adminToken))
      .attach('image', PNG, 'new-seal.png');
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.equal(replaced.body.has_deped_seal, true);

    const seal = await api().get('/api/teacher/deped/seal').set(bearer(teacherToken));
    assert.ok(Buffer.from(seal.body).equals(PNG));

    // Asking for the assets again runs the seeder: the replacement must survive it.
    const assets = await api().get('/api/settings/deped').set(bearer(adminToken));
    assert.equal(assets.body.has_deped_seal, true);
    const again = await api().get('/api/teacher/deped/seal').set(bearer(teacherToken));
    assert.ok(Buffer.from(again.body).equals(PNG));

    const activity = await pool.query(`SELECT description FROM activity_log WHERE action = 'settings.deped_logo' ORDER BY id DESC LIMIT 1`);
    assert.match(activity.rows[0].description, /DepEd seal/);
  });

  test('replacing the logo works the same way, and a non-image is refused', async () => {
    const replaced = await api()
      .put('/api/settings/deped/logo')
      .set(bearer(adminToken))
      .attach('image', PNG, 'new-logo.png');
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));

    const logo = await api().get('/api/teacher/deped/logo').set(bearer(teacherToken));
    assert.ok(Buffer.from(logo.body).equals(PNG));

    const refused = await api()
      .put('/api/settings/deped/logo')
      .set(bearer(adminToken))
      .attach('image', NOT_AN_IMAGE, 'logo.png');
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    const still = await api().get('/api/teacher/deped/logo').set(bearer(teacherToken));
    assert.ok(Buffer.from(still.body).equals(PNG));
  });

  test('teachers and signed-out visitors cannot use the admin DepEd endpoints, and an unknown logo is not found', async () => {
    assert.equal((await api().get('/api/settings/deped')).status, 401);
    assert.equal((await api().get('/api/settings/deped').set(bearer(teacherToken))).status, 401);
    assert.equal((await api().put('/api/settings/deped/badge').set(bearer(adminToken)).attach('image', PNG, 'x.png')).status, 404);
  });
});
