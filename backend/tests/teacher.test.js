// Teacher Batch 1 tests: public sign-up, plan choice, teacher sign-in and lockout,
// forgot/reset password, own profile and adviser assignment, token separation,
// announcements audience, and the admin view of self-registered teachers.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, SUPER, ADMIN } = require('./helpers');
const { testOutbox } = require('../src/utils/mailer');
const { config } = require('../src/config');
const billing = require('../src/utils/billing');

let superToken;
let adminToken;
let schoolId;
let freePlan;
let proPlan;
let counter = 0;

const TEACHER_PASSWORD = 'TeacherPass123';
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Teacher Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const plans = await api().get('/api/plans').set(bearer(adminToken));
  freePlan = plans.body.items.find((plan) => plan.name === 'Teacher Free');
  proPlan = plans.body.items.find((plan) => plan.name === 'Teacher Pro');
});

after(async () => {
  await pool.end();
});

// ---------- Small helpers ----------

function signupBody(overrides = {}) {
  counter += 1;
  return {
    first_name: 'Sign',
    last_name: `Up${counter}`,
    email: `signup${counter}@test.local`,
    mobile: '09171234567',
    school_id: schoolId,
    password: TEACHER_PASSWORD,
    terms_accepted: true,
    ...overrides,
  };
}

async function signup(overrides = {}) {
  const response = await api().post('/api/teacher-auth/register').send(signupBody(overrides));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function teacherLogin(login, password) {
  return api().post('/api/teacher-auth/login').send({ login, password });
}

async function createAdminTeacher(overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teachers')
    .set(bearer(adminToken))
    .send({
      first_name: 'Admin',
      last_name: `Created${counter}`,
      email: `admin.created${counter}@test.local`,
      mobile: '09171234567',
      username: `admin.created${counter}`,
      school_id: schoolId,
      temporary_password: 'TempPass123',
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.teacher;
}

async function createAnnouncement(token, overrides = {}) {
  counter += 1;
  const response = await api()
    .post('/api/announcements')
    .set(bearer(token))
    .send({
      title: `Announcement ${counter}`,
      body: 'Please read this.',
      audience: 'all',
      ends_on: '2999-01-01',
      ...overrides,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.announcement;
}

// ---------- Public sign-up ----------

describe('Teacher sign-up', () => {
  test('sign-up creates the teacher, derives the username from the email, and signs them in', async () => {
    const { teacher, token } = await signup({ email: 'mreston103@test.local' });
    assert.equal(teacher.username, 'mreston103');
    assert.equal(teacher.email, 'mreston103@test.local');
    assert.equal(teacher.must_change_password, false);
    assert.equal(teacher.is_restricted, false);
    assert.ok(token, 'a token is returned so the next step (Choose Plan) is already signed in');

    const me = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.teacher.username, 'mreston103');
    assert.equal(me.body.teacher.school_name, 'Teacher Test School');
  });

  test('sign-up refuses a missing agreement, a weak password, a bad mobile number and an unknown school', async () => {
    const noTerms = await api().post('/api/teacher-auth/register').send(signupBody({ terms_accepted: false }));
    assert.equal(noTerms.status, 400);
    assert.ok(noTerms.body.errors.terms_accepted);

    const weak = await api().post('/api/teacher-auth/register').send(signupBody({ password: 'password' }));
    assert.equal(weak.status, 400);
    assert.ok(weak.body.errors.password);

    const badMobile = await api().post('/api/teacher-auth/register').send(signupBody({ mobile: '12345' }));
    assert.equal(badMobile.status, 400);
    assert.ok(badMobile.body.errors.mobile);

    const badSchool = await api().post('/api/teacher-auth/register').send(signupBody({ school_id: 99999 }));
    assert.equal(badSchool.status, 400);
    assert.ok(badSchool.body.errors.school_id);
  });

  test('sign-up refuses a duplicate email', async () => {
    const first = await signup({ email: 'duplicate@test.local' });
    assert.equal(first.teacher.email, 'duplicate@test.local');

    const again = await api().post('/api/teacher-auth/register').send(signupBody({ email: 'duplicate@test.local' }));
    assert.equal(again.status, 409);
    assert.ok(again.body.errors.email);
  });

  test('two teachers with the same email name get different usernames', async () => {
    const first = await signup({ email: 'same.name@test.local' });
    const second = await signup({ email: 'same.name@other.local' });
    assert.equal(first.teacher.username, 'same.name');
    assert.notEqual(second.teacher.username, 'same.name');
    assert.match(second.teacher.username, /^same\.name\d+$/);
  });

  test('a school added during sign-up can be picked straight away', async () => {
    const created = await api()
      .post('/api/teacher-auth/register/school')
      .send({ name: 'New Signup School', category: 'Primary', school_type: 'Public', city_region: 'Signup City', principal_contact: '' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.school.name, 'New Signup School');

    const options = await api().get('/api/teacher-auth/schools');
    assert.equal(options.status, 200);
    assert.ok(options.body.items.some((school) => school.name === 'New Signup School'));

    const { teacher } = await signup({ school_id: created.body.school.id });
    assert.equal(teacher.school_name, 'New Signup School');

    const duplicate = await api()
      .post('/api/teacher-auth/register/school')
      .send({ name: 'New Signup School', category: 'Primary', school_type: 'Public', city_region: 'Signup City', principal_contact: '' });
    assert.equal(duplicate.status, 409);
  });
});

// ---------- Choose Plan ----------

describe('Choose Plan', () => {
  test('Teacher Free starts active, costs nothing and expires by itself after 1 month', async () => {
    const { token } = await signup();
    const response = await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: freePlan.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.subscription.plan_name, 'Teacher Free');
    assert.equal(response.body.subscription.status, 'active');
    assert.equal(response.body.subscription.price, '0.00');

    // A second plan is refused while one is current.
    const again = await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(again.status, 409);

    await billing.runBillingCycle(daysFromNow(32));
    const me = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(me.body.subscription.status, 'expired');

    // A free plan never creates an invoice.
    const invoices = await api().get('/api/teacher/invoices').set(bearer(token));
    assert.deepEqual(invoices.body.items, []);
  });

  test('Teacher Pro starts on trial and becomes payable with an invoice when the trial ends', async () => {
    const { token } = await signup();
    const response = await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.subscription.plan_name, 'Teacher Pro');
    assert.equal(response.body.subscription.status, 'trial');
    assert.equal(response.body.subscription.price, '100.00');
    assert.ok(response.body.subscription.trial_ends_at);

    await billing.runBillingCycle(daysFromNow(29));
    const stillTrial = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(stillTrial.body.subscription.status, 'trial');

    await billing.runBillingCycle(daysFromNow(31));
    const pastDue = await api().get('/api/teacher/me').set(bearer(token));
    assert.equal(pastDue.body.subscription.status, 'past_due');

    const invoices = await api().get('/api/teacher/invoices').set(bearer(token));
    assert.equal(invoices.body.items.length, 1);
    assert.equal(invoices.body.items[0].amount, '100.00');
    assert.equal(invoices.body.items[0].status, 'unpaid');
  });

  test('an inactive plan cannot be chosen', async () => {
    const deactivated = await api().post(`/api/plans/${proPlan.id}/deactivate`).set(bearer(adminToken));
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
    try {
      const { token } = await signup();
      const response = await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: proPlan.id });
      assert.equal(response.status, 400);
      assert.ok(response.body.errors.plan_id);
    } finally {
      const reactivated = await api().post(`/api/plans/${proPlan.id}/activate`).set(bearer(adminToken));
      assert.equal(reactivated.status, 200, JSON.stringify(reactivated.body));
    }
  });
});

// ---------- Teacher sign-in ----------

describe('Teacher sign-in', () => {
  test('sign-in works with username and with email, and returns the teacher', async () => {
    const { teacher } = await signup({ email: 'signin@test.local' });
    const byUsername = await teacherLogin(teacher.username, TEACHER_PASSWORD);
    assert.equal(byUsername.status, 200, JSON.stringify(byUsername.body));
    assert.equal(byUsername.body.teacher.username, teacher.username);

    const byEmail = await teacherLogin('signin@test.local', TEACHER_PASSWORD);
    assert.equal(byEmail.status, 200);
  });

  test('wrong passwords lock the account after 5 attempts for 15 minutes', async () => {
    const { teacher } = await signup();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await teacherLogin(teacher.username, 'WrongPass123');
      assert.equal(response.status, 401);
      assert.equal(response.body.attempts_left, 5 - attempt);
    }

    const locked = await teacherLogin(teacher.username, 'WrongPass123');
    assert.equal(locked.status, 423);
    assert.equal(locked.body.code, 'ACCOUNT_LOCKED');

    // The right password does not help while the account is locked.
    const correct = await teacherLogin(teacher.username, TEACHER_PASSWORD);
    assert.equal(correct.status, 423);
  });

  test('a restricted teacher is refused with the reason', async () => {
    const { teacher } = await signup();
    const restricted = await api()
      .post(`/api/teachers/${teacher.id}/restrict`)
      .set(bearer(adminToken))
      .send({ reason: 'Unpaid fees for review' });
    assert.equal(restricted.status, 200, JSON.stringify(restricted.body));

    const response = await teacherLogin(teacher.username, TEACHER_PASSWORD);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'ACCOUNT_RESTRICTED');
    assert.equal(response.body.reason, 'Unpaid fees for review');
  });

  test('a teacher created by the admin signs in with the temporary password, then sets their own', async () => {
    const teacher = await createAdminTeacher();
    const first = await teacherLogin(teacher.username, 'TempPass123');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.teacher.must_change_password, true);
    const oldToken = first.body.token;

    const wrongCurrent = await api()
      .post('/api/teacher/change-password')
      .set(bearer(oldToken))
      .send({ current_password: 'NotThePassword1', new_password: 'NewTeacherPass1' });
    assert.equal(wrongCurrent.status, 400);

    const changed = await api()
      .post('/api/teacher/change-password')
      .set(bearer(oldToken))
      .send({ current_password: 'TempPass123', new_password: 'NewTeacherPass1' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.teacher.must_change_password, false);

    // The old token stopped working when the password changed.
    const stale = await api().get('/api/teacher/me').set(bearer(oldToken));
    assert.equal(stale.status, 401);

    const again = await teacherLogin(teacher.username, 'NewTeacherPass1');
    assert.equal(again.status, 200);
    assert.equal(again.body.teacher.must_change_password, false);
  });

  test('a teacher token opens no admin page, and an admin token opens no teacher page', async () => {
    const { token } = await signup();
    const adminPage = await api().get('/api/overview').set(bearer(token));
    assert.equal(adminPage.status, 401);

    const teacherPage = await api().get('/api/teacher/me').set(bearer(adminToken));
    assert.equal(teacherPage.status, 401);
  });

  test('"Remember this device" gives a 30-day token; without it the token lasts 8 hours', async () => {
    const jwt = require('jsonwebtoken');
    const { teacher } = await signup();

    const remembered = await api()
      .post('/api/teacher-auth/login')
      .send({ login: teacher.username, password: TEACHER_PASSWORD, remember_me: true });
    assert.equal(remembered.status, 200, JSON.stringify(remembered.body));
    const rememberedPayload = jwt.decode(remembered.body.token);
    assert.ok(
      Math.abs(rememberedPayload.exp - rememberedPayload.iat - 30 * 24 * 60 * 60) <= 10,
      `remembered token lasts ${rememberedPayload.exp - rememberedPayload.iat}s, expected 30 days`
    );

    const plain = await teacherLogin(teacher.username, TEACHER_PASSWORD);
    assert.equal(plain.status, 200);
    const plainPayload = jwt.decode(plain.body.token);
    assert.ok(
      Math.abs(plainPayload.exp - plainPayload.iat - 8 * 60 * 60) <= 10,
      `plain token lasts ${plainPayload.exp - plainPayload.iat}s, expected 8 hours`
    );
  });

  test('remember_me must be true or false, not a word', async () => {
    const { teacher } = await signup();
    const response = await api()
      .post('/api/teacher-auth/login')
      .send({ login: teacher.username, password: TEACHER_PASSWORD, remember_me: 'yes' });
    assert.equal(response.status, 400);
  });
});

// ---------- Today's classes (sign-in panel) ----------

describe("Today's classes", () => {
  test('needs a teacher token and answers with an empty list until Batch 2 adds classes', async () => {
    const nobody = await api().get('/api/teacher/today-classes');
    assert.equal(nobody.status, 401);

    const { token } = await signup();
    const response = await api().get('/api/teacher/today-classes').set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.items, []);
  });
});

// ---------- Forgot and reset password ----------

describe('Teacher forgot and reset password', () => {
  test('a reset link is sent, works once, and the new password signs in', async () => {
    const { teacher } = await signup({ email: 'reset.me@test.local' });
    testOutbox.length = 0;

    const forgot = await api().post('/api/teacher-auth/forgot-password').send({ email: 'reset.me@test.local' });
    assert.equal(forgot.status, 200);
    assert.equal(testOutbox.length, 1);
    assert.equal(testOutbox[0].to, 'reset.me@test.local');
    const token = testOutbox[0].text.match(/token=([0-9a-f]+)/)[1];
    assert.ok(token);

    const reset = await api().post('/api/teacher-auth/reset-password').send({ token, new_password: 'ResetPass123' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    const reused = await api().post('/api/teacher-auth/reset-password').send({ token, new_password: 'ResetPass123' });
    assert.equal(reused.status, 400);

    const signedIn = await teacherLogin(teacher.username, 'ResetPass123');
    assert.equal(signedIn.status, 200);
  });

  test('an unknown email gets the same answer, so accounts cannot be listed', async () => {
    testOutbox.length = 0;
    const response = await api().post('/api/teacher-auth/forgot-password').send({ email: 'nobody@test.local' });
    assert.equal(response.status, 200);
    assert.equal(testOutbox.length, 0);
  });
});

// ---------- Own profile and adviser assignment ----------

describe('Teacher profile and adviser assignment', () => {
  test('the teacher can change name, email, mobile and address', async () => {
    const { token } = await signup();
    const updated = await api()
      .patch('/api/teacher/me')
      .set(bearer(token))
      .send({ first_name: 'New', last_name: 'Name', email: 'new.name@test.local', mobile: '09981234567', present_address: 'New Address' });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.teacher.first_name, 'New');
    assert.equal(updated.body.teacher.email, 'new.name@test.local');
  });

  test('the teaching assignment is refused on the profile form', async () => {
    const { token } = await signup();
    for (const field of ['is_adviser', 'advisory_grade', 'advisory_section', 'school_id', 'username']) {
      const value = field === 'is_adviser' ? true : field === 'advisory_grade' ? 10 : field === 'school_id' ? schoolId : 'x';
      const response = await api()
        .patch('/api/teacher/me')
        .set(bearer(token))
        .send({ first_name: 'Sign', last_name: 'Up', email: 'keep@test.local', mobile: '09171234567', present_address: '', [field]: value });
      assert.equal(response.status, 400, `${field} should be refused: ${JSON.stringify(response.body)}`);
    }
  });

  test('the adviser form files the assignment and clears it when the teacher is not an adviser', async () => {
    const { token } = await signup();
    const missing = await api()
      .patch('/api/teacher/me/adviser')
      .set(bearer(token))
      .send({ is_adviser: true, advisory_grade: null, advisory_section: '' });
    assert.equal(missing.status, 400);

    const filed = await api()
      .patch('/api/teacher/me/adviser')
      .set(bearer(token))
      .send({ is_adviser: true, advisory_grade: 10, advisory_section: 'Luke' });
    assert.equal(filed.status, 200, JSON.stringify(filed.body));
    assert.equal(filed.body.teacher.is_adviser, true);
    assert.equal(filed.body.teacher.advisory_grade, 10);
    assert.equal(filed.body.teacher.advisory_section, 'Luke');

    const cleared = await api()
      .patch('/api/teacher/me/adviser')
      .set(bearer(token))
      .send({ is_adviser: false, advisory_grade: null, advisory_section: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.teacher.is_adviser, false);
    assert.equal(cleared.body.teacher.advisory_grade, null);
    assert.equal(cleared.body.teacher.advisory_section, null);
  });

  test('the dashboard shows the subscription, the next invoice and announcements, and no made-up classes', async () => {
    const { token } = await signup();
    await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: proPlan.id });
    await createAnnouncement(adminToken, { title: 'For everyone', audience: 'all' });

    const dashboard = await api().get('/api/teacher/dashboard').set(bearer(token));
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
    assert.equal(dashboard.body.subscription.plan_name, 'Teacher Pro');
    assert.equal(dashboard.body.subscription.status, 'trial');
    assert.equal(dashboard.body.academic_year, '2026-2027');
    assert.equal(dashboard.body.announcements.length, 1);
    assert.equal(dashboard.body.announcements[0].title, 'For everyone');
    assert.equal(dashboard.body.next_invoice, null);
    assert.ok(!('classes' in dashboard.body));
    assert.ok(!('grades' in dashboard.body));
  });
});

// ---------- Announcements audience ----------

describe('Announcements audience', () => {
  test('a Free teacher sees All and Free, a Pro teacher sees All and Pro', async () => {
    const freeSignup = await signup();
    await api().post('/api/teacher/subscription').set(bearer(freeSignup.token)).send({ plan_id: freePlan.id });

    const proSignup = await signup();
    await api().post('/api/teacher/subscription').set(bearer(proSignup.token)).send({ plan_id: proPlan.id });

    await createAnnouncement(adminToken, { title: 'For all', audience: 'all' });
    await createAnnouncement(adminToken, { title: 'For free', audience: 'free' });
    await createAnnouncement(adminToken, { title: 'For pro', audience: 'pro' });

    const freeList = await api().get('/api/teacher/announcements').set(bearer(freeSignup.token));
    const freeTitles = freeList.body.items.map((item) => item.title);
    assert.ok(freeTitles.includes('For all'));
    assert.ok(freeTitles.includes('For free'));
    assert.ok(!freeTitles.includes('For pro'));

    const proList = await api().get('/api/teacher/announcements').set(bearer(proSignup.token));
    const proTitles = proList.body.items.map((item) => item.title);
    assert.ok(proTitles.includes('For all'));
    assert.ok(proTitles.includes('For pro'));
    assert.ok(!proTitles.includes('For free'));

    const dashboard = await api().get('/api/teacher/dashboard').set(bearer(freeSignup.token));
    const dashboardTitles = dashboard.body.announcements.map((item) => item.title);
    assert.ok(dashboardTitles.includes('For all'));
    assert.ok(dashboardTitles.includes('For free'));
    assert.ok(!dashboardTitles.includes('For pro'));
  });
});

// ---------- Admin view of self-registered teachers ----------

describe('Admin view of self-registered teachers', () => {
  test('a teacher who signed up appears in the admin list with school and plan, and can be restricted and reset', async () => {
    const { teacher } = await signup({ email: 'visible.to.admin@test.local' });
    const { token } = await signup({ email: 'second.visible@test.local' });
    await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: proPlan.id });

    const list = await api().get('/api/teachers?search=visible.to.admin').set(bearer(adminToken));
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].school_name, 'Teacher Test School');
    assert.equal(list.body.items[0].created_by_name, null);

    const detail = await api().get(`/api/teachers/${teacher.id}`).set(bearer(adminToken));
    assert.equal(detail.body.teacher.email, 'visible.to.admin@test.local');

    const restricted = await api()
      .post(`/api/teachers/${teacher.id}/restrict`)
      .set(bearer(adminToken))
      .send({ reason: 'Check this account' });
    assert.equal(restricted.status, 200);

    const reset = await api().post(`/api/teachers/${teacher.id}/reset-password`).set(bearer(adminToken));
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.ok(reset.body.temporary_password);
  });
});
