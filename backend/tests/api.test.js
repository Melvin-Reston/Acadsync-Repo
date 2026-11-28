// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');
const { testOutbox } = require('../src/utils/mailer');

let superToken;
let adminToken;

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);
});

after(async () => {
  await pool.end();
});

const school = (overrides = {}) => ({
  name: 'Test School A',
  category: 'Secondary',
  school_type: 'Private',
  city_region: 'Test City',
  principal_contact: 'Test Principal',
  ...overrides,
});

const teacher = (schoolId, overrides = {}) => ({
  first_name: 'Test',
  last_name: 'Teacher',
  email: 'teacher.one@test.local',
  mobile: '09171234567',
  username: 'teacher.one',
  school_id: schoolId,
  present_address: '',
  temporary_password: 'TempPass123',
  ...overrides,
});

async function createSchool(overrides) {
  const response = await api().post('/api/schools').set(bearer(adminToken)).send(school(overrides));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.school;
}

async function createTeacher(schoolId, overrides) {
  const response = await api().post('/api/teachers').set(bearer(adminToken)).send(teacher(schoolId, overrides));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.teacher;
}

describe('Health and access', () => {
  test('health check works without signing in', async () => {
    const response = await api().get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
  });

  test('protected routes need a token', async () => {
    for (const path of ['/api/overview', '/api/teachers', '/api/schools', '/api/activity', '/api/settings', '/api/auth/me']) {
      const response = await api().get(path);
      assert.equal(response.status, 401, path);
    }
  });

  test('a made-up token is rejected', async () => {
    const response = await api().get('/api/overview').set(bearer('not-a-real-token'));
    assert.equal(response.status, 401);
  });

  test('there is no admin sign-up route', async () => {
    for (const path of ['/api/auth/register', '/api/auth/signup', '/api/admins']) {
      const response = await api().post(path).send({ email: 'new@test.local', password: 'Whatever123' });
      assert.ok([401, 404].includes(response.status), `${path} -> ${response.status}`);
    }
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM admins');
    assert.equal(count.rows[0].count, 2);
  });

  test('unknown routes answer 404 after sign-in', async () => {
    const response = await api().get('/api/nothing-here').set(bearer(adminToken));
    assert.equal(response.status, 404);
  });
});

describe('Admin sign-in', () => {
  test('correct details return a token and never the password hash', async () => {
    const response = await api().post('/api/auth/login').send({ email: SUPER.email, password: SUPER.password });
    assert.equal(response.status, 200);
    assert.ok(response.body.token);
    assert.equal(response.body.admin.role, 'super_user');
    assert.equal(response.body.admin.password_hash, undefined);
  });

  test('email is not case sensitive', async () => {
    const response = await api().post('/api/auth/login').send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password });
    assert.equal(response.status, 200);
    assert.equal(response.body.admin.role, 'admin');
  });

  test('unknown email is rejected', async () => {
    const response = await api().post('/api/auth/login').send({ email: 'nobody@test.local', password: 'Whatever123' });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'INVALID_CREDENTIALS');
  });

  test('missing fields give a validation error', async () => {
    const response = await api().post('/api/auth/login').send({ email: 'not-an-email' });
    assert.equal(response.status, 400);
    assert.ok(response.body.errors.email);
    assert.ok(response.body.errors.password);
  });

  test('a teacher cannot sign in to the admin side', async () => {
    const s = await createSchool({ name: 'Login Check School' });
    await createTeacher(s.id, { email: 'not.admin@test.local', username: 'not.admin' });
    const response = await api().post('/api/auth/login').send({ email: 'not.admin@test.local', password: 'TempPass123' });
    assert.equal(response.status, 401);
  });

  test('GET /auth/me returns the signed-in admin', async () => {
    const response = await api().get('/api/auth/me').set(bearer(adminToken));
    assert.equal(response.status, 200);
    assert.equal(response.body.admin.email, ADMIN.email);
  });
});

describe('Lockout after 5 wrong attempts', () => {
  test('locks for 15 minutes, refuses even the right password, then works again after the lock ends', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await api().post('/api/auth/login').send({ email: ADMIN.email, password: 'WrongPass999' });
      assert.equal(response.status, 401);
      assert.equal(response.body.attempts_left, 5 - attempt);
    }

    const fifth = await api().post('/api/auth/login').send({ email: ADMIN.email, password: 'WrongPass999' });
    assert.equal(fifth.status, 423);
    assert.equal(fifth.body.code, 'ACCOUNT_LOCKED');

    const lockedMinutes = (new Date(fifth.body.locked_until).getTime() - Date.now()) / 60000;
    assert.ok(lockedMinutes > 14 && lockedMinutes <= 15.1, `locked for ${lockedMinutes} minutes`);

    const whileLocked = await api().post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    assert.equal(whileLocked.status, 423);

    // Pretend the 15 minutes have passed.
    await pool.query("UPDATE admins SET locked_until = NOW() - INTERVAL '1 second' WHERE email = $1", [ADMIN.email]);
    const afterLock = await api().post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    assert.equal(afterLock.status, 200);
    adminToken = afterLock.body.token;
  });

  test('a correct sign-in clears earlier wrong attempts', async () => {
    await api().post('/api/auth/login').send({ email: ADMIN.email, password: 'WrongPass999' });
    await api().post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    const row = await pool.query('SELECT failed_attempts FROM admins WHERE email = $1', [ADMIN.email]);
    assert.equal(row.rows[0].failed_attempts, 0);
  });

  test('the Super User can unlock the Admin account', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await api().post('/api/auth/login').send({ email: ADMIN.email, password: 'WrongPass999' });
    }
    const locked = await api().get('/api/admin-account').set(bearer(superToken));
    assert.equal(locked.body.admin.is_locked, true);

    const unlocked = await api().post('/api/admin-account/unlock').set(bearer(superToken));
    assert.equal(unlocked.status, 200);
    assert.equal(unlocked.body.admin.is_locked, false);

    const response = await api().post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    assert.equal(response.status, 200);
    adminToken = response.body.token;
  });
});

describe('Roles: Super User and Admin', () => {
  test('the Admin cannot open or change the Admin account management routes', async () => {
    const calls = [
      api().get('/api/admin-account').set(bearer(adminToken)),
      api().patch('/api/admin-account').set(bearer(adminToken)).send({ full_name: 'X', email: 'x@test.local', is_active: true }),
      api().post('/api/admin-account/reset-password').set(bearer(adminToken)),
      api().post('/api/admin-account/unlock').set(bearer(adminToken)),
    ];
    for (const call of calls) {
      const response = await call;
      assert.equal(response.status, 403);
    }
  });

  test('the Super User can edit the Admin account, and the Super User row is not affected', async () => {
    const response = await api()
      .patch('/api/admin-account')
      .set(bearer(superToken))
      .send({ full_name: 'Renamed Admin', email: ADMIN.email, is_active: true });
    assert.equal(response.status, 200);
    assert.equal(response.body.admin.full_name, 'Renamed Admin');
    assert.equal(response.body.admin.role, 'admin');

    const superRow = await pool.query("SELECT full_name, email FROM admins WHERE role = 'super_user'");
    assert.equal(superRow.rows[0].full_name, SUPER.name);
    assert.equal(superRow.rows[0].email, SUPER.email);
  });

  test('the Admin account cannot take the Super User email', async () => {
    const response = await api()
      .patch('/api/admin-account')
      .set(bearer(superToken))
      .send({ full_name: 'Renamed Admin', email: SUPER.email, is_active: true });
    assert.equal(response.status, 409);
  });

  test('disabling the Admin signs it out and blocks sign-in; enabling restores it', async () => {
    const disabled = await api()
      .patch('/api/admin-account')
      .set(bearer(superToken))
      .send({ full_name: 'Renamed Admin', email: ADMIN.email, is_active: false });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.admin.is_active, false);

    const oldSession = await api().get('/api/overview').set(bearer(adminToken));
    assert.equal(oldSession.status, 401);

    const signInAttempt = await api().post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    assert.equal(signInAttempt.status, 403);
    assert.equal(signInAttempt.body.code, 'ACCOUNT_DISABLED');

    await api().patch('/api/admin-account').set(bearer(superToken)).send({ full_name: 'Renamed Admin', email: ADMIN.email, is_active: true });
    adminToken = await signIn(ADMIN);
  });

  test('the Super User resets the Admin password: temporary password works once shown, old one stops', async () => {
    const reset = await api().post('/api/admin-account/reset-password').set(bearer(superToken));
    assert.equal(reset.status, 200);
    const temporary = reset.body.temporary_password;
    assert.equal(temporary.length, 12);

    const oldSession = await api().get('/api/overview').set(bearer(adminToken));
    assert.equal(oldSession.status, 401);

    const oldPassword = await api().post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    assert.equal(oldPassword.status, 401);

    const withTemporary = await api().post('/api/auth/login').send({ email: ADMIN.email, password: temporary });
    assert.equal(withTemporary.status, 200);
    assert.equal(withTemporary.body.admin.must_change_password, true);

    // The Admin sets the usual test password again.
    const change = await api()
      .post('/api/auth/change-password')
      .set(bearer(withTemporary.body.token))
      .send({ current_password: temporary, new_password: ADMIN.password });
    assert.equal(change.status, 200);
    assert.equal(change.body.admin.must_change_password, false);
    adminToken = change.body.token;

    const stored = await pool.query("SELECT password_hash FROM admins WHERE role = 'admin'");
    assert.ok(stored.rows[0].password_hash.startsWith('$2'));
    assert.ok(!stored.rows[0].password_hash.includes(temporary));
  });
});

describe('Own profile and password', () => {
  test('profile can be updated', async () => {
    const response = await api().patch('/api/auth/me').set(bearer(superToken)).send({ full_name: SUPER.name, email: SUPER.email });
    assert.equal(response.status, 200);
    assert.equal(response.body.admin.full_name, SUPER.name);
  });

  test('changing the password needs the correct current password', async () => {
    const response = await api()
      .post('/api/auth/change-password')
      .set(bearer(superToken))
      .send({ current_password: 'NotMyPassword1', new_password: 'BrandNew123' });
    assert.equal(response.status, 400);
    assert.ok(response.body.errors.current_password);
  });

  test('weak new passwords are refused', async () => {
    for (const weak of ['short1', 'onlyletters', '1234567890']) {
      const response = await api()
        .post('/api/auth/change-password')
        .set(bearer(superToken))
        .send({ current_password: SUPER.password, new_password: weak });
      assert.equal(response.status, 400, weak);
      assert.ok(response.body.errors.new_password);
    }
  });

  test('a successful change signs out old sessions and returns a fresh token', async () => {
    const changed = await api()
      .post('/api/auth/change-password')
      .set(bearer(superToken))
      .send({ current_password: SUPER.password, new_password: 'BrandNew123' });
    assert.equal(changed.status, 200);

    const oldSession = await api().get('/api/auth/me').set(bearer(superToken));
    assert.equal(oldSession.status, 401);

    const back = await api()
      .post('/api/auth/change-password')
      .set(bearer(changed.body.token))
      .send({ current_password: 'BrandNew123', new_password: SUPER.password });
    assert.equal(back.status, 200);
    superToken = back.body.token;
  });
});

describe('Forgot and reset password', () => {
  const tokenFromOutbox = () => testOutbox[testOutbox.length - 1].text.match(/token=([a-f0-9]+)/)[1];

  test('unknown emails get the same answer and no email', async () => {
    const before = testOutbox.length;
    const response = await api().post('/api/auth/forgot-password').send({ email: 'nobody@test.local' });
    assert.equal(response.status, 200);
    assert.equal(testOutbox.length, before);
  });

  test('a reset link is sent, the token is stored only as a hash, and it works exactly once', async () => {
    const response = await api().post('/api/auth/forgot-password').send({ email: SUPER.email });
    assert.equal(response.status, 200);

    const mail = testOutbox[testOutbox.length - 1];
    assert.equal(mail.to, SUPER.email);
    assert.match(mail.text, /\/reset-password\?token=[a-f0-9]{64}/);

    const token = tokenFromOutbox();
    const stored = await pool.query('SELECT token_hash FROM password_reset_tokens ORDER BY id DESC LIMIT 1');
    assert.notEqual(stored.rows[0].token_hash, token);

    const reset = await api().post('/api/auth/reset-password').send({ token, new_password: 'AfterReset123' });
    assert.equal(reset.status, 200);

    const oldSession = await api().get('/api/auth/me').set(bearer(superToken));
    assert.equal(oldSession.status, 401);

    const again = await api().post('/api/auth/reset-password').send({ token, new_password: 'SecondTry123' });
    assert.equal(again.status, 400);
    assert.equal(again.body.code, 'INVALID_RESET_TOKEN');

    const oldPassword = await api().post('/api/auth/login').send({ email: SUPER.email, password: SUPER.password });
    assert.equal(oldPassword.status, 401);

    superToken = await signIn({ email: SUPER.email, password: 'AfterReset123' });
  });

  test('an expired link is refused', async () => {
    await api().post('/api/auth/forgot-password').send({ email: SUPER.email });
    const token = tokenFromOutbox();
    await pool.query("UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE used_at IS NULL");

    const response = await api().post('/api/auth/reset-password').send({ token, new_password: 'Expired12345' });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_RESET_TOKEN');
  });

  test('asking again cancels the earlier link', async () => {
    await api().post('/api/auth/forgot-password').send({ email: SUPER.email });
    const first = tokenFromOutbox();
    await api().post('/api/auth/forgot-password').send({ email: SUPER.email });
    const second = tokenFromOutbox();

    const withFirst = await api().post('/api/auth/reset-password').send({ token: first, new_password: 'FirstLink123' });
    assert.equal(withFirst.status, 400);

    const withSecond = await api().post('/api/auth/reset-password').send({ token: second, new_password: SUPER.password });
    assert.equal(withSecond.status, 200);
    superToken = await signIn(SUPER);
  });

  test('a reset also clears a lockout', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await api().post('/api/auth/login').send({ email: SUPER.email, password: 'WrongPass999' });
    }
    await api().post('/api/auth/forgot-password').send({ email: SUPER.email });
    const reset = await api().post('/api/auth/reset-password').send({ token: tokenFromOutbox(), new_password: SUPER.password });
    assert.equal(reset.status, 200);
    superToken = await signIn(SUPER);
  });

  test('a made-up token is refused', async () => {
    const response = await api().post('/api/auth/reset-password').send({ token: 'a'.repeat(64), new_password: 'Whatever123' });
    assert.equal(response.status, 400);
  });
});

describe('Schools', () => {
  let first;
  let second;

  test('add a school', async () => {
    first = await createSchool({ name: 'Merge Keep School', city_region: 'North City' });
    assert.equal(first.teacher_count, 0);
    assert.equal(first.category, 'Secondary');
  });

  test('required fields and allowed choices are checked', async () => {
    const response = await api()
      .post('/api/schools')
      .set(bearer(adminToken))
      .send({ name: '', category: 'College', school_type: 'Charter', city_region: '' });
    assert.equal(response.status, 400);
    for (const field of ['name', 'category', 'school_type', 'city_region']) assert.ok(response.body.errors[field], field);
  });

  test('the same name in the same place is refused, in another place it is allowed', async () => {
    const duplicate = await api()
      .post('/api/schools')
      .set(bearer(adminToken))
      .send(school({ name: 'merge keep school', city_region: 'north city' }));
    assert.equal(duplicate.status, 409);

    second = await createSchool({ name: 'Merge Keep School', city_region: 'South City', category: 'Primary', school_type: 'Public' });
    assert.notEqual(second.id, first.id);
  });

  test('edit a school', async () => {
    const response = await api()
      .patch(`/api/schools/${second.id}`)
      .set(bearer(adminToken))
      .send(school({ name: 'Merge Remove School', city_region: 'South City', principal_contact: 'New Contact' }));
    assert.equal(response.status, 200);
    assert.equal(response.body.school.name, 'Merge Remove School');
    assert.equal(response.body.school.principal_contact, 'New Contact');
  });

  test('list with search, filters, pagination and teacher counts', async () => {
    await createTeacher(first.id, { email: 'count.one@test.local', username: 'count.one' });

    const searched = await api().get('/api/schools').query({ search: 'merge keep' }).set(bearer(adminToken));
    assert.equal(searched.status, 200);
    assert.equal(searched.body.total, 1);
    assert.equal(searched.body.items[0].teacher_count, 1);

    const filtered = await api().get('/api/schools').query({ school_type: 'Private', category: 'Secondary' }).set(bearer(adminToken));
    assert.ok(filtered.body.items.every((item) => item.school_type === 'Private' && item.category === 'Secondary'));

    const paged = await api().get('/api/schools').query({ page_size: 1, page: 2 }).set(bearer(adminToken));
    assert.equal(paged.body.items.length, 1);
    assert.ok(paged.body.total >= 3);

    const options = await api().get('/api/schools/options').set(bearer(adminToken));
    assert.equal(options.body.items.length, paged.body.total);
  });

  test('merge moves the teachers to the kept school and removes the other one', async () => {
    const moving = await createTeacher(second.id, { email: 'moving@test.local', username: 'moving.teacher' });

    const response = await api().post('/api/schools/merge').set(bearer(adminToken)).send({ keep_id: first.id, remove_id: second.id });
    assert.equal(response.status, 200);
    assert.equal(response.body.moved_teachers, 1);
    assert.equal(response.body.school.teacher_count, 2);

    const gone = await api().get(`/api/schools/${second.id}`).set(bearer(adminToken));
    assert.equal(gone.status, 404);

    const moved = await api().get(`/api/teachers/${moving.id}`).set(bearer(adminToken));
    assert.equal(moved.body.teacher.school_id, first.id);
  });

  test('merge refuses the same school twice and unknown schools', async () => {
    const same = await api().post('/api/schools/merge').set(bearer(adminToken)).send({ keep_id: first.id, remove_id: first.id });
    assert.equal(same.status, 400);

    const unknown = await api().post('/api/schools/merge').set(bearer(adminToken)).send({ keep_id: first.id, remove_id: 999999 });
    assert.equal(unknown.status, 404);
  });
});

describe('Teachers', () => {
  let schoolRow;
  let created;

  before(async () => {
    schoolRow = await createSchool({ name: 'Teacher Test School' });
  });

  test('create a teacher; the password is stored only as a hash', async () => {
    created = await createTeacher(schoolRow.id, { email: 'Teacher.One@Test.Local', username: 'Teacher.One', mobile: '0917 123 4567' });
    assert.equal(created.email, 'teacher.one@test.local');
    assert.equal(created.username, 'teacher.one');
    assert.equal(created.mobile, '09171234567');
    assert.equal(created.school_name, 'Teacher Test School');
    assert.equal(created.must_change_password, true);
    assert.equal(created.password_hash, undefined);
    assert.equal(created.temporary_password, undefined);

    const stored = await pool.query('SELECT password_hash FROM teachers WHERE id = $1', [created.id]);
    assert.ok(stored.rows[0].password_hash.startsWith('$2'));
  });

  test('the teachers table has no middle name, birth date, civil status or gender columns', async () => {
    const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'teachers'");
    const names = columns.rows.map((row) => row.column_name);
    for (const banned of ['middle_name', 'date_of_birth', 'birth_date', 'civil_status', 'gender']) {
      assert.ok(!names.includes(banned), banned);
    }
  });

  test('every required field is checked', async () => {
    const response = await api().post('/api/teachers').set(bearer(adminToken)).send({
      first_name: '',
      last_name: '',
      email: 'nope',
      mobile: '12345',
      username: 'a b',
      school_id: 'x',
      temporary_password: 'short',
    });
    assert.equal(response.status, 400);
    for (const field of ['first_name', 'last_name', 'email', 'mobile', 'username', 'school_id', 'temporary_password']) {
      assert.ok(response.body.errors[field], field);
    }
  });

  test('duplicate email or username, and an unknown school, are refused with a clear field message', async () => {
    const email = await api().post('/api/teachers').set(bearer(adminToken)).send(teacher(schoolRow.id, { username: 'someone.else' }));
    assert.equal(email.status, 409);
    assert.ok(email.body.errors.email);

    const username = await api().post('/api/teachers').set(bearer(adminToken)).send(teacher(schoolRow.id, { email: 'someone.else@test.local' }));
    assert.equal(username.status, 409);
    assert.ok(username.body.errors.username);

    const noSchool = await api().post('/api/teachers').set(bearer(adminToken)).send(teacher(999999, { email: 'x@test.local', username: 'x.teacher' }));
    assert.equal(noSchool.status, 400);
    assert.ok(noSchool.body.errors.school_id);
  });

  test('view a teacher profile', async () => {
    const response = await api().get(`/api/teachers/${created.id}`).set(bearer(superToken));
    assert.equal(response.status, 200);
    assert.equal(response.body.teacher.id, created.id);
    assert.ok(response.body.teacher.created_by_name);

    const missing = await api().get('/api/teachers/999999').set(bearer(superToken));
    assert.equal(missing.status, 404);

    const badId = await api().get('/api/teachers/abc').set(bearer(superToken));
    assert.equal(badId.status, 400);
  });

  test('edit a teacher', async () => {
    const response = await api()
      .patch(`/api/teachers/${created.id}`)
      .set(bearer(adminToken))
      .send({
        first_name: 'Edited',
        last_name: 'Teacher',
        email: 'teacher.one@test.local',
        mobile: '+639171234567',
        username: 'teacher.one',
        school_id: schoolRow.id,
        present_address: 'Test Address 1',
      });
    assert.equal(response.status, 200);
    assert.equal(response.body.teacher.first_name, 'Edited');
    assert.equal(response.body.teacher.present_address, 'Test Address 1');
  });

  test('editing cannot change the password or the restriction', async () => {
    const before = await pool.query('SELECT password_hash FROM teachers WHERE id = $1', [created.id]);
    await api()
      .patch(`/api/teachers/${created.id}`)
      .set(bearer(adminToken))
      .send({
        first_name: 'Edited',
        last_name: 'Teacher',
        email: 'teacher.one@test.local',
        mobile: '09171234567',
        username: 'teacher.one',
        school_id: schoolRow.id,
        password_hash: 'hacked',
        is_restricted: true,
      });
    const after = await pool.query('SELECT password_hash, is_restricted FROM teachers WHERE id = $1', [created.id]);
    assert.equal(after.rows[0].password_hash, before.rows[0].password_hash);
    assert.equal(after.rows[0].is_restricted, false);
  });

  test('list with search, school filter, status filter and pagination', async () => {
    await createTeacher(schoolRow.id, { first_name: 'Second', last_name: 'Person', email: 'second@test.local', username: 'second.person' });

    const all = await api().get('/api/teachers').query({ school_id: schoolRow.id }).set(bearer(adminToken));
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 2);

    const searched = await api().get('/api/teachers').query({ search: 'second per' }).set(bearer(adminToken));
    assert.equal(searched.body.total, 1);
    assert.equal(searched.body.items[0].username, 'second.person');

    const paged = await api().get('/api/teachers').query({ school_id: schoolRow.id, page_size: 1, page: 2 }).set(bearer(adminToken));
    assert.equal(paged.body.items.length, 1);
    assert.equal(paged.body.total, 2);

    const none = await api().get('/api/teachers').query({ school_id: schoolRow.id, status: 'restricted' }).set(bearer(adminToken));
    assert.equal(none.body.total, 0);

    assert.ok(all.body.items.every((item) => item.password_hash === undefined));
  });

  test('teacher sign-in check works before any restriction', async () => {
    const byUsername = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one', password: 'TempPass123' });
    assert.equal(byUsername.status, 200);
    assert.equal(byUsername.body.teacher.username, 'teacher.one');

    const byEmail = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one@test.local', password: 'TempPass123' });
    assert.equal(byEmail.status, 200);

    const wrong = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one', password: 'WrongPass999' });
    assert.equal(wrong.status, 401);
  });

  test('restricting needs a reason', async () => {
    const response = await api().post(`/api/teachers/${created.id}/restrict`).set(bearer(adminToken)).send({ reason: '' });
    assert.equal(response.status, 400);
    assert.ok(response.body.errors.reason);
  });

  test('a restricted teacher is told the account is restricted, with the reason', async () => {
    const restricted = await api()
      .post(`/api/teachers/${created.id}/restrict`)
      .set(bearer(adminToken))
      .send({ reason: 'Test reason for restriction' });
    assert.equal(restricted.status, 200);
    assert.equal(restricted.body.teacher.is_restricted, true);
    assert.equal(restricted.body.teacher.restriction_reason, 'Test reason for restriction');
    assert.ok(restricted.body.teacher.restricted_by_name);

    const signInAttempt = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one', password: 'TempPass123' });
    assert.equal(signInAttempt.status, 403);
    assert.equal(signInAttempt.body.code, 'ACCOUNT_RESTRICTED');
    assert.equal(signInAttempt.body.reason, 'Test reason for restriction');

    const wrongPassword = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one', password: 'WrongPass999' });
    assert.equal(wrongPassword.status, 401, 'the reason is only shown to someone who knows the password');

    const twice = await api().post(`/api/teachers/${created.id}/restrict`).set(bearer(adminToken)).send({ reason: 'Again please' });
    assert.equal(twice.status, 409);

    const listed = await api().get('/api/teachers').query({ status: 'restricted' }).set(bearer(adminToken));
    assert.ok(listed.body.items.some((item) => item.id === created.id));
  });

  test('unrestricting lets the teacher sign in again', async () => {
    const response = await api().post(`/api/teachers/${created.id}/unrestrict`).set(bearer(superToken));
    assert.equal(response.status, 200);
    assert.equal(response.body.teacher.is_restricted, false);
    assert.equal(response.body.teacher.restriction_reason, null);

    const signInAttempt = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one', password: 'TempPass123' });
    assert.equal(signInAttempt.status, 200);

    const twice = await api().post(`/api/teachers/${created.id}/unrestrict`).set(bearer(superToken));
    assert.equal(twice.status, 409);
  });

  test('reset password returns a temporary password once; the old one stops working', async () => {
    const response = await api().post(`/api/teachers/${created.id}/reset-password`).set(bearer(adminToken));
    assert.equal(response.status, 200);
    const temporary = response.body.temporary_password;
    assert.equal(temporary.length, 12);

    const oldPassword = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one', password: 'TempPass123' });
    assert.equal(oldPassword.status, 401);

    const newPassword = await api().post('/api/teacher-auth/login').send({ login: 'teacher.one', password: temporary });
    assert.equal(newPassword.status, 200);
    assert.equal(newPassword.body.teacher.must_change_password, true);

    const profile = await api().get(`/api/teachers/${created.id}`).set(bearer(adminToken));
    assert.ok(!JSON.stringify(profile.body).includes(temporary));
  });

  test('deleting a teacher removes the teacher and logs the delete', async () => {
    const deletable = await createTeacher(schoolRow.id, { first_name: 'Delete', last_name: 'Me', email: 'delete.me@test.local', username: 'delete.me' });

    const noToken = await api().delete(`/api/teachers/${deletable.id}`);
    assert.equal(noToken.status, 401);

    const missing = await api().delete('/api/teachers/999999').set(bearer(adminToken));
    assert.equal(missing.status, 404);

    const response = await api().delete(`/api/teachers/${deletable.id}`).set(bearer(adminToken));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.message, 'Teacher deleted.');

    const gone = await api().get(`/api/teachers/${deletable.id}`).set(bearer(adminToken));
    assert.equal(gone.status, 404);

    const listed = await api().get('/api/teachers').query({ search: 'delete.me' }).set(bearer(adminToken));
    assert.equal(listed.body.total, 0);

    const signInAttempt = await api().post('/api/teacher-auth/login').send({ login: 'delete.me', password: 'TempPass123' });
    assert.equal(signInAttempt.status, 401);

    const logged = await pool.query("SELECT description FROM activity_log WHERE action = 'teacher.delete' AND entity_id = $1", [deletable.id]);
    assert.equal(logged.rowCount, 1);
    assert.match(logged.rows[0].description, /Delete Me/);

    const again = await api().delete(`/api/teachers/${deletable.id}`).set(bearer(adminToken));
    assert.equal(again.status, 404);
  });

  test('deleting a teacher keeps a learner another teacher of the same school uses', async () => {
    // Set up with direct rows (not the public sign-up) so this test writes
    // no system-role activity rows: the Activity log test in this file
    // expects every row to carry a Super User or Admin role.
    const first = await createTeacher(schoolRow.id, { first_name: 'Shared', last_name: 'First', email: 'shared.first@test.local', username: 'shared.first' });
    const second = await createTeacher(schoolRow.id, { first_name: 'Shared', last_name: 'Second', email: 'shared.second@test.local', username: 'shared.second' });

    const makeClass = async (teacherId, name) => {
      const subject = await pool.query('INSERT INTO subjects (teacher_id, name, grade_level) VALUES ($1, $2, 10) RETURNING id', [teacherId, name]);
      const klass = await pool.query(
        'INSERT INTO classes (teacher_id, subject_id, grade_level, section_name, academic_year) VALUES ($1, $2, 10, $3, $4) RETURNING id',
        [teacherId, subject.rows[0].id, 'Luke', '2026-2027']
      );
      return klass.rows[0].id;
    };
    const firstClassId = await makeClass(first.id, 'Shared Subject A');
    const secondClassId = await makeClass(second.id, 'Shared Subject B');

    const learner = await pool.query(
      "INSERT INTO learners (teacher_id, school_id, first_name, last_name, learner_id, sex) VALUES ($1, $2, 'Shared', 'Learner', 'STU-SHARED-1', 'Female') RETURNING id",
      [first.id, schoolRow.id]
    );
    const learnerId = learner.rows[0].id;
    await pool.query('INSERT INTO class_learners (class_id, learner_id) VALUES ($1, $2), ($3, $2)', [firstClassId, learnerId, secondClassId]);

    const deleted = await api().delete(`/api/teachers/${first.id}`).set(bearer(adminToken));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    const kept = await pool.query('SELECT teacher_id FROM learners WHERE id = $1', [learnerId]);
    assert.equal(kept.rowCount, 1, 'the shared learner survives the delete');
    assert.equal(kept.rows[0].teacher_id, second.id);

    const enrolment = await pool.query('SELECT 1 FROM class_learners WHERE class_id = $1 AND learner_id = $2', [secondClassId, learnerId]);
    assert.equal(enrolment.rowCount, 1, 'the other teacher keeps the enrolment');

    const firstClassGone = await pool.query('SELECT 1 FROM classes WHERE id = $1', [firstClassId]);
    assert.equal(firstClassGone.rowCount, 0);
  });
});

describe('Overview', () => {
  test('counts match the database', async () => {
    const response = await api().get('/api/overview').set(bearer(adminToken));
    assert.equal(response.status, 200);

    const real = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM teachers) AS teachers,
             (SELECT COUNT(*)::int FROM teachers WHERE is_restricted) AS restricted,
             (SELECT COUNT(*)::int FROM schools) AS schools`);
    assert.equal(response.body.counts.total_teachers, real.rows[0].teachers);
    assert.equal(response.body.counts.restricted_teachers, real.rows[0].restricted);
    assert.equal(response.body.counts.total_schools, real.rows[0].schools);
    assert.equal(response.body.counts.new_signups_this_month, real.rows[0].teachers);
    assert.equal(response.body.academic_year, '2026-2027');

    // Nothing is subscribed or paid yet in this file, so the billing cards are zero.
    assert.equal(response.body.counts.active_subscriptions, 0);
    assert.equal(response.body.counts.pending_payments, 0);
    assert.equal(response.body.counts.income_this_month, '0.00');
  });
});

describe('Settings', () => {
  test('academic year starts at 2026-2027 and can be changed', async () => {
    const start = await api().get('/api/settings').set(bearer(adminToken));
    assert.equal(start.body.academic_year, '2026-2027');

    const changed = await api().put('/api/settings/academic-year').set(bearer(adminToken)).send({ academic_year: '2027-2028' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.academic_year, '2027-2028');

    await api().put('/api/settings/academic-year').set(bearer(adminToken)).send({ academic_year: '2026-2027' });
  });

  test('wrong academic year formats are refused', async () => {
    for (const bad of ['2026', '2026-2028', '26-27', 'abcd-efgh']) {
      const response = await api().put('/api/settings/academic-year').set(bearer(adminToken)).send({ academic_year: bad });
      assert.equal(response.status, 400, bad);
    }
  });
});

describe('Activity log', () => {
  test('every kind of admin action was recorded with who, what and when', async () => {
    const result = await pool.query('SELECT DISTINCT action FROM activity_log');
    const actions = result.rows.map((row) => row.action);
    const expected = [
      'auth.login',
      'auth.locked',
      'profile.update',
      'password.change',
      'password.reset_requested',
      'password.reset_completed',
      'admin.update',
      'admin.disable',
      'admin.enable',
      'admin.reset_password',
      'admin.unlock',
      'teacher.create',
      'teacher.update',
      'teacher.restrict',
      'teacher.unrestrict',
      'teacher.reset_password',
      'school.create',
      'school.update',
      'school.merge',
      'settings.academic_year',
    ];
    for (const action of expected) assert.ok(actions.includes(action), `missing ${action}`);

    const incomplete = await pool.query(
      "SELECT COUNT(*)::int AS count FROM activity_log WHERE admin_name = '' OR description = '' OR created_at IS NULL OR admin_role NOT IN ('super_user', 'admin')"
    );
    assert.equal(incomplete.rows[0].count, 0);
  });

  test('no password or reset token is ever written to the log', async () => {
    const result = await pool.query('SELECT description FROM activity_log');
    const text = result.rows.map((row) => row.description).join('\n');
    for (const secret of ['TempPass123', SUPER.password, ADMIN.password, 'AfterReset123']) assert.ok(!text.includes(secret));
  });

  test('list is newest first, with filters and pagination', async () => {
    const all = await api().get('/api/activity').query({ page_size: 100 }).set(bearer(adminToken));
    assert.equal(all.status, 200);
    assert.ok(all.body.total > 20);
    assert.equal(all.body.admins.length, 2);
    const times = all.body.items.map((item) => new Date(item.created_at).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));

    const group = await api().get('/api/activity').query({ action: 'school', page_size: 100 }).set(bearer(adminToken));
    assert.ok(group.body.total > 0);
    assert.ok(group.body.items.every((item) => item.action.startsWith('school.')));

    const exact = await api().get('/api/activity').query({ action: 'school.merge' }).set(bearer(adminToken));
    assert.equal(exact.body.total, 1);
    assert.match(exact.body.items[0].description, /1 teacher\(s\) moved/);

    const superId = all.body.admins.find((admin) => admin.role === 'super_user').id;
    const bySuper = await api().get('/api/activity').query({ admin_id: superId, page_size: 100 }).set(bearer(adminToken));
    assert.ok(bySuper.body.total > 0);
    assert.ok(bySuper.body.items.every((item) => item.admin_id === superId));

    const searched = await api().get('/api/activity').query({ search: 'restricted teacher' }).set(bearer(adminToken));
    assert.ok(searched.body.total >= 1);

    const today = new Date().toISOString().slice(0, 10);
    const future = await api().get('/api/activity').query({ from: '2999-01-01' }).set(bearer(adminToken));
    assert.equal(future.body.total, 0);
    const past = await api().get('/api/activity').query({ to: '2000-01-01' }).set(bearer(adminToken));
    assert.equal(past.body.total, 0);
    const badDate = await api().get('/api/activity').query({ from: today.replace(/-/g, '/') }).set(bearer(adminToken));
    assert.equal(badDate.status, 400);

    const paged = await api().get('/api/activity').query({ page_size: 5, page: 2 }).set(bearer(adminToken));
    assert.equal(paged.body.items.length, 5);
    assert.equal(paged.body.page, 2);
  });

  test('sign-out is recorded', async () => {
    const token = await signIn(ADMIN);
    const response = await api().post('/api/auth/logout').set(bearer(token));
    assert.equal(response.status, 200);
    const logged = await pool.query("SELECT COUNT(*)::int AS count FROM activity_log WHERE action = 'auth.logout'");
    assert.equal(logged.rows[0].count, 1);
  });
});
