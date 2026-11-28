// Part 2 tests: plans, subscriptions, invoices, payments, reports, announcements and uploads.
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { api, pool, resetDatabase, signIn, bearer, removeTestUploads, SUPER, ADMIN } = require('./helpers');
const { config } = require('../src/config');
const billing = require('../src/utils/billing');

let superToken;
let adminToken;
let schoolId;
let freePlan;
let proPlan;
let counter = 0;

// A real 1x1 PNG image, and a file that only pretends to be one.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOT_AN_IMAGE = Buffer.from('This is plain text, not an image at all.');
const TOO_BIG = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);

const TEACHER_PASSWORD = 'TeachPass123';

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Billing Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
  assert.equal(school.status, 201, JSON.stringify(school.body));
  schoolId = school.body.school.id;

  const plans = await api().get('/api/plans').set(bearer(adminToken));
  freePlan = plans.body.items.find((plan) => plan.name === 'Teacher Free');
  proPlan = plans.body.items.find((plan) => plan.name === 'Teacher Pro');
});

after(async () => {
  await pool.end();
  removeTestUploads();
});

// ---------- Small helpers ----------

async function createTeacher(extra = {}) {
  counter += 1;
  const response = await api()
    .post('/api/teachers')
    .set(bearer(adminToken))
    .send({
      first_name: 'Billing',
      last_name: `Teacher${counter}`,
      email: `billing.teacher${counter}@test.local`,
      mobile: '09171234567',
      username: `billing.teacher${counter}`,
      school_id: schoolId,
      present_address: '',
      temporary_password: TEACHER_PASSWORD,
      ...extra,
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.teacher;
}

async function subscribe(teacherId, planId, withTrial = true) {
  const response = await api().post('/api/subscriptions').set(bearer(adminToken)).send({ teacher_id: teacherId, plan_id: planId, with_trial: withTrial });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.subscription;
}

async function getSubscription(id) {
  const response = await api().get(`/api/subscriptions/${id}`).set(bearer(adminToken));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

// A teacher on Teacher Pro without a trial: one unpaid invoice straight away.
async function teacherWithUnpaidInvoice() {
  const teacher = await createTeacher();
  const subscription = await subscribe(teacher.id, proPlan.id, false);
  const detail = await getSubscription(subscription.id);
  return { teacher, subscription, invoice: detail.invoices[0] };
}

async function teacherToken(teacher) {
  const response = await api().post('/api/teacher-auth/login').send({ login: teacher.username, password: TEACHER_PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token;
}

function submitAsTeacher(token, invoiceId, reference = 'GCASH-1001', image = PNG, filename = 'proof.png') {
  const request = api().post(`/api/teacher/invoices/${invoiceId}/payments`).set(bearer(token)).field('reference_number', reference);
  return image ? request.attach('screenshot', image, filename) : request;
}

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
const today = async () => (await pool.query(`SELECT (NOW() AT TIME ZONE $1)::date::text AS d`, [config.timezone])).rows[0].d;
const dateOffset = async (days) => (await pool.query(`SELECT ((NOW() AT TIME ZONE $1)::date + $2::int)::text AS d`, [config.timezone, days])).rows[0].d;
const lastActivity = async (action) => (await pool.query('SELECT * FROM activity_log WHERE action = $1 ORDER BY id DESC LIMIT 1', [action])).rows[0];

// ---------- Plans & Packages ----------

describe('Plans & Packages', () => {
  test('the migration adds exactly Teacher Free and Teacher Pro', async () => {
    const response = await api().get('/api/plans').set(bearer(adminToken));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.items.map((plan) => plan.name), ['Teacher Free', 'Teacher Pro']);

    assert.equal(freePlan.price, '0.00');
    assert.equal(freePlan.billing_cycle, 'one_time');
    assert.equal(freePlan.duration_months, 1);
    assert.equal(freePlan.trial_days, 0);

    assert.equal(proPlan.price, '100.00');
    assert.equal(proPlan.billing_cycle, 'monthly');
    assert.equal(proPlan.trial_days, 30);
    assert.deepEqual(proPlan.features, ['Consolidation', 'Report cards (SF9)', 'Rankings & honors', 'QR Scanning attendance']);
  });

  test('nothing else is shipped: no teachers besides the tests, no subscriptions, invoices, payments or announcements', async () => {
    const counts = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM subscriptions) AS subscriptions, (SELECT COUNT(*)::int FROM invoices) AS invoices,
             (SELECT COUNT(*)::int FROM payments) AS payments, (SELECT COUNT(*)::int FROM announcements) AS announcements`);
    assert.deepEqual(counts.rows[0], { subscriptions: 0, invoices: 0, payments: 0, announcements: 0 });
  });

  test('active plans are public, the full list is not', async () => {
    const open = await api().get('/api/plans/active');
    assert.equal(open.status, 200);
    assert.equal(open.body.items.length, 2);
    assert.equal(open.body.items[1].price, '100.00');

    const closed = await api().get('/api/plans');
    assert.equal(closed.status, 401);
  });

  test('create, edit, deactivate, activate and delete a plan, all logged', async () => {
    const created = await api()
      .post('/api/plans')
      .set(bearer(adminToken))
      .send({ name: 'Test Yearly', price: '1000.5', billing_cycle: 'yearly', trial_days: 7, features: ['One', 'Two'], is_popular: true, sort_order: 5 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const plan = created.body.plan;
    assert.equal(plan.price, '1000.50');
    assert.equal(plan.duration_months, 12);
    assert.equal(plan.trial_days, 7);
    assert.deepEqual(plan.features, ['One', 'Two']);
    assert.equal((await lastActivity('plan.create')).entity_id, plan.id);

    const edited = await api()
      .patch(`/api/plans/${plan.id}`)
      .set(bearer(superToken))
      .send({ name: 'Test Yearly', price: 1200, billing_cycle: 'yearly', features: ['One'] });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.plan.price, '1200.00');
    assert.match((await lastActivity('plan.update')).description, /1,000\.50.*1,200\.00/);

    const off = await api().post(`/api/plans/${plan.id}/deactivate`).set(bearer(adminToken));
    assert.equal(off.body.plan.is_active, false);
    const publicList = await api().get('/api/plans/active');
    assert.ok(!publicList.body.items.some((item) => item.id === plan.id));

    const on = await api().post(`/api/plans/${plan.id}/activate`).set(bearer(adminToken));
    assert.equal(on.body.plan.is_active, true);

    const removed = await api().delete(`/api/plans/${plan.id}`).set(bearer(adminToken));
    assert.equal(removed.status, 200);
    assert.equal((await lastActivity('plan.delete')).admin_name, ADMIN.name);
    assert.equal((await api().get('/api/plans').set(bearer(adminToken))).body.items.length, 2);
  });

  test('bad plan values are refused', async () => {
    const send = (body) => api().post('/api/plans').set(bearer(adminToken)).send({ name: 'Bad Plan', price: '10', billing_cycle: 'monthly', ...body });

    assert.equal((await send({ price: '-5' })).status, 400);
    assert.equal((await send({ price: '10.999' })).status, 400);
    assert.equal((await send({ price: 'abc' })).status, 400);
    assert.equal((await send({ billing_cycle: 'weekly' })).status, 400);
    assert.equal((await send({ name: '' })).status, 400);

    const duplicate = await send({ name: 'teacher pro' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.errors.name, 'A plan with this name already exists.');
  });

  test('a free plan never has a trial', async () => {
    const created = await api().post('/api/plans').set(bearer(adminToken)).send({ name: 'Free With Trial', price: 0, billing_cycle: 'one_time', duration_months: 2, trial_days: 14 });
    assert.equal(created.body.plan.trial_days, 0);
    assert.equal(created.body.plan.duration_months, 2);
    await api().delete(`/api/plans/${created.body.plan.id}`).set(bearer(adminToken));
  });

  test('a plan with subscriptions cannot be deleted, only deactivated', async () => {
    const created = await api().post('/api/plans').set(bearer(adminToken)).send({ name: 'In Use Plan', price: 50, billing_cycle: 'monthly' });
    const plan = created.body.plan;
    const teacher = await createTeacher();
    await subscribe(teacher.id, plan.id);

    const removed = await api().delete(`/api/plans/${plan.id}`).set(bearer(adminToken));
    assert.equal(removed.status, 409);
    assert.equal(removed.body.code, 'PLAN_IN_USE');

    const off = await api().post(`/api/plans/${plan.id}/deactivate`).set(bearer(adminToken));
    assert.equal(off.status, 200);

    // A plan that is switched off cannot be given to anyone new.
    const other = await createTeacher();
    const refused = await api().post('/api/subscriptions').set(bearer(adminToken)).send({ teacher_id: other.id, plan_id: plan.id });
    assert.equal(refused.status, 400);
    assert.ok(refused.body.errors.plan_id);
  });
});

// ---------- Subscriptions ----------

describe('Subscriptions', () => {
  test('Teacher Free: active for one month, no invoice, then expires by itself', async () => {
    const teacher = await createTeacher();
    const subscription = await subscribe(teacher.id, freePlan.id);
    assert.equal(subscription.status, 'active');
    assert.equal(subscription.plan_name, 'Teacher Free');
    assert.equal(subscription.price, '0.00');

    const periodDays = (new Date(subscription.current_period_end) - new Date(subscription.current_period_start)) / 86400000;
    assert.ok(periodDays >= 28 && periodDays <= 31, `period was ${periodDays} days`);

    // 20 days later it is still active. 32 days later it has expired.
    await billing.runBillingCycle(daysFromNow(20));
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'active');

    await billing.runBillingCycle(daysFromNow(32));
    const after = await getSubscription(subscription.id);
    assert.equal(after.subscription.status, 'expired');
    assert.equal(after.subscription.end_reason, 'Period ended');
    assert.equal(after.invoices.length, 0);

    const log = await lastActivity('subscription.expire');
    assert.equal(log.entity_id, subscription.id);
    assert.equal(log.admin_name, 'System');
    assert.equal(log.admin_id, null);
  });

  test('Teacher Pro: 30-day trial, then an invoice of ₱100.00, then active once paid', async () => {
    const teacher = await createTeacher();
    const subscription = await subscribe(teacher.id, proPlan.id);
    assert.equal(subscription.status, 'trial');
    const trialDays = (new Date(subscription.trial_ends_at) - new Date(subscription.started_at)) / 86400000;
    assert.equal(Math.round(trialDays), 30);
    assert.equal((await getSubscription(subscription.id)).invoices.length, 0);

    // Day 29: still on trial.
    await billing.runBillingCycle(daysFromNow(29));
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'trial');

    // The trial is over (moved into the past so "today" is after it).
    await pool.query(`UPDATE subscriptions SET started_at = NOW() - INTERVAL '30 days', trial_ends_at = NOW() - INTERVAL '1 minute',
                        current_period_start = NOW() - INTERVAL '30 days', current_period_end = NOW() - INTERVAL '1 minute' WHERE id = $1`, [subscription.id]);
    const list = await api().get('/api/subscriptions').query({ teacher_id: teacher.id }).set(bearer(adminToken));
    assert.equal(list.body.items[0].status, 'past_due'); // correct on read, without waiting for the timer

    const detail = await getSubscription(subscription.id);
    assert.equal(detail.invoices.length, 1);
    const invoice = detail.invoices[0];
    assert.equal(invoice.amount, '100.00');
    assert.equal(invoice.status, 'unpaid');
    assert.match(invoice.invoice_number, /^INV-\d{4}-\d{6}$/);
    assert.equal((await lastActivity('invoice.issue')).entity_id, invoice.id);

    // Running the cycle again does not issue a second invoice.
    await billing.runBillingCycle();
    assert.equal((await getSubscription(subscription.id)).invoices.length, 1);

    const paid = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'BANK-0001');
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    assert.equal(paid.body.invoice.status, 'paid');

    const active = await getSubscription(subscription.id);
    assert.equal(active.subscription.status, 'active');
    assert.equal(active.subscription.current_period_end, invoice.period_end);
  });

  test('renewal: when the paid month ends a new invoice is issued, and no payment by the due date means expired', async () => {
    const { subscription, invoice } = await teacherWithUnpaidInvoice();
    await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'BANK-0002');

    // One month later: renewal invoice.
    await billing.runBillingCycle(daysFromNow(32));
    let detail = await getSubscription(subscription.id);
    assert.equal(detail.subscription.status, 'past_due');
    assert.equal(detail.invoices.length, 2);
    const renewal = detail.invoices.find((item) => item.status === 'unpaid');
    assert.equal(renewal.amount, '100.00');
    assert.equal(renewal.period_start, invoice.period_end);

    // Still inside the 7 days to pay.
    await billing.runBillingCycle(daysFromNow(35));
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'past_due');

    // Past the due date without a payment.
    await billing.runBillingCycle(daysFromNow(45));
    detail = await getSubscription(subscription.id);
    assert.equal(detail.subscription.status, 'expired');
    assert.equal(detail.subscription.end_reason, 'Payment not received');
  });

  test('a subscription with a payment waiting for confirmation does not expire', async () => {
    const { teacher, subscription, invoice } = await teacherWithUnpaidInvoice();
    const sent = await submitAsTeacher(await teacherToken(teacher), invoice.id, 'GCASH-WAIT');
    assert.equal(sent.status, 201, JSON.stringify(sent.body));

    await billing.runBillingCycle(daysFromNow(20));
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'past_due');

    await api().post(`/api/payments/${sent.body.payment.id}/reject`).set(bearer(adminToken)).send({ reason: 'Reference number not found' });
    await billing.runBillingCycle(daysFromNow(20));
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'expired');
  });

  test('one current subscription per teacher', async () => {
    const teacher = await createTeacher();
    await subscribe(teacher.id, freePlan.id);
    const second = await api().post('/api/subscriptions').set(bearer(adminToken)).send({ teacher_id: teacher.id, plan_id: proPlan.id });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'HAS_CURRENT_SUBSCRIPTION');

    // The database itself also refuses it.
    await assert.rejects(
      pool.query(
        `INSERT INTO subscriptions (teacher_id, plan_id, plan_name, price, billing_cycle, duration_months, status, started_at, current_period_start, current_period_end)
         VALUES ($1, $2, 'X', 0, 'one_time', 1, 'active', NOW(), NOW(), NOW() + INTERVAL '1 month')`,
        [teacher.id, freePlan.id]
      ),
      /subscriptions_one_current_key/
    );
  });

  test('unknown teacher or plan is refused', async () => {
    const teacher = await createTeacher();
    const noTeacher = await api().post('/api/subscriptions').set(bearer(adminToken)).send({ teacher_id: 999999, plan_id: freePlan.id });
    assert.equal(noTeacher.status, 400);
    const noPlan = await api().post('/api/subscriptions').set(bearer(adminToken)).send({ teacher_id: teacher.id, plan_id: 999999 });
    assert.equal(noPlan.status, 400);
  });

  test('extend adds months to an active subscription', async () => {
    const teacher = await createTeacher();
    const subscription = await subscribe(teacher.id, freePlan.id);
    const extended = await api().post(`/api/subscriptions/${subscription.id}/extend`).set(bearer(adminToken)).send({ months: 2 });
    assert.equal(extended.status, 200, JSON.stringify(extended.body));

    const days = (new Date(extended.body.subscription.current_period_end) - new Date(subscription.current_period_end)) / 86400000;
    assert.ok(days >= 59 && days <= 62, `extended by ${days} days`);
    assert.equal((await lastActivity('subscription.extend')).entity_id, subscription.id);

    assert.equal((await api().post(`/api/subscriptions/${subscription.id}/extend`).set(bearer(adminToken)).send({ months: 0 })).status, 400);
    assert.equal((await api().post(`/api/subscriptions/${subscription.id}/extend`).set(bearer(adminToken)).send({ months: 25 })).status, 400);
  });

  test('extending a past due subscription makes it active and voids the unpaid invoice', async () => {
    const { subscription, invoice } = await teacherWithUnpaidInvoice();
    const extended = await api().post(`/api/subscriptions/${subscription.id}/extend`).set(bearer(adminToken)).send({ months: 1 });
    assert.equal(extended.status, 200, JSON.stringify(extended.body));
    assert.equal(extended.body.subscription.status, 'active');

    const after = await api().get(`/api/invoices/${invoice.id}`).set(bearer(adminToken));
    assert.equal(after.body.invoice.status, 'void');
  });

  test('extending an expired subscription starts it again', async () => {
    const teacher = await createTeacher();
    const subscription = await subscribe(teacher.id, freePlan.id);
    await pool.query(`UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 day' WHERE id = $1`, [subscription.id]);
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'expired');

    const extended = await api().post(`/api/subscriptions/${subscription.id}/extend`).set(bearer(adminToken)).send({ months: 1 });
    assert.equal(extended.status, 200, JSON.stringify(extended.body));
    assert.equal(extended.body.subscription.status, 'active');
    assert.equal(extended.body.subscription.ended_at, null);
    assert.ok(new Date(extended.body.subscription.current_period_end) > new Date());
  });

  test('cancel ends the subscription, voids its unpaid invoice, and it cannot be extended afterwards', async () => {
    const { subscription, invoice } = await teacherWithUnpaidInvoice();
    const cancelled = await api().post(`/api/subscriptions/${subscription.id}/cancel`).set(bearer(adminToken)).send({ reason: 'Teacher asked to stop' });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.subscription.status, 'cancelled');
    assert.equal(cancelled.body.subscription.end_reason, 'Teacher asked to stop');
    assert.equal((await api().get(`/api/invoices/${invoice.id}`).set(bearer(adminToken))).body.invoice.status, 'void');
    assert.match((await lastActivity('subscription.cancel')).description, /Teacher asked to stop/);

    assert.equal((await api().post(`/api/subscriptions/${subscription.id}/cancel`).set(bearer(adminToken)).send({})).status, 409);
    assert.equal((await api().post(`/api/subscriptions/${subscription.id}/extend`).set(bearer(adminToken)).send({ months: 1 })).status, 409);
  });

  test('cancel is blocked while a payment waits for confirmation', async () => {
    const { teacher, subscription, invoice } = await teacherWithUnpaidInvoice();
    await submitAsTeacher(await teacherToken(teacher), invoice.id, 'GCASH-BLOCK');
    const cancelled = await api().post(`/api/subscriptions/${subscription.id}/cancel`).set(bearer(adminToken)).send({});
    assert.equal(cancelled.status, 409);
    assert.equal(cancelled.body.code, 'PAYMENT_PENDING');
  });

  test('change plan closes the old subscription and starts a new one', async () => {
    const teacher = await createTeacher();
    const free = await subscribe(teacher.id, freePlan.id);

    const same = await api().post(`/api/subscriptions/${free.id}/change-plan`).set(bearer(adminToken)).send({ plan_id: freePlan.id });
    assert.equal(same.status, 400);

    const changed = await api().post(`/api/subscriptions/${free.id}/change-plan`).set(bearer(adminToken)).send({ plan_id: proPlan.id });
    assert.equal(changed.status, 201, JSON.stringify(changed.body));
    assert.equal(changed.body.subscription.plan_name, 'Teacher Pro');
    assert.equal(changed.body.subscription.status, 'past_due'); // no trial by default, so it is payable now
    assert.notEqual(changed.body.subscription.id, free.id);

    assert.equal((await getSubscription(free.id)).subscription.status, 'cancelled');
    assert.equal((await getSubscription(changed.body.subscription.id)).invoices.length, 1);
    assert.match((await lastActivity('subscription.change_plan')).description, /Teacher Free.*Teacher Pro/);

    const current = await api().get('/api/subscriptions').query({ teacher_id: teacher.id, status: 'current' }).set(bearer(adminToken));
    assert.equal(current.body.total, 1);
  });

  test('list: search, plan filter, status filter and counts', async () => {
    const teacher = await createTeacher({ first_name: 'Zephyrine' });
    await subscribe(teacher.id, proPlan.id);

    const found = await api().get('/api/subscriptions').query({ search: 'zephyrine' }).set(bearer(adminToken));
    assert.equal(found.body.total, 1);
    assert.equal(found.body.items[0].teacher_id, teacher.id);
    assert.equal(found.body.items[0].school_name, 'Billing Test School');

    const byPlan = await api().get('/api/subscriptions').query({ plan_id: freePlan.id, page_size: 100 }).set(bearer(adminToken));
    assert.ok(byPlan.body.items.length > 0);
    assert.ok(byPlan.body.items.every((item) => item.plan_id === freePlan.id));

    const trials = await api().get('/api/subscriptions').query({ status: 'trial', page_size: 100 }).set(bearer(adminToken));
    assert.ok(trials.body.items.every((item) => item.status === 'trial'));
    assert.equal(trials.body.total, trials.body.counts.trial);

    assert.equal((await api().get('/api/subscriptions').query({ status: 'nope' }).set(bearer(adminToken))).status, 400);
  });

  test('snapshots: a later price change never alters existing subscriptions or invoices', async () => {
    const created = await api().post('/api/plans').set(bearer(adminToken)).send({ name: 'Snapshot Plan', price: 250, billing_cycle: 'monthly' });
    const plan = created.body.plan;
    const teacher = await createTeacher();
    const subscription = await subscribe(teacher.id, plan.id);
    const firstInvoice = (await getSubscription(subscription.id)).invoices[0];
    assert.equal(firstInvoice.amount, '250.00');

    // The plan is renamed and its price is raised.
    const edited = await api().patch(`/api/plans/${plan.id}`).set(bearer(adminToken)).send({ name: 'Snapshot Plan Plus', price: 400, billing_cycle: 'yearly' });
    assert.equal(edited.status, 200);

    const detail = await getSubscription(subscription.id);
    assert.equal(detail.subscription.plan_name, 'Snapshot Plan');
    assert.equal(detail.subscription.price, '250.00');
    assert.equal(detail.subscription.billing_cycle, 'monthly');
    assert.equal(detail.invoices[0].amount, '250.00');
    assert.equal(detail.invoices[0].plan_name, 'Snapshot Plan');

    // Pay it; the renewal invoice still uses the price from when the teacher subscribed.
    await api().post(`/api/invoices/${firstInvoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'SNAP-1');
    await billing.runBillingCycle(daysFromNow(32));
    const renewed = await getSubscription(subscription.id);
    const renewal = renewed.invoices.find((item) => item.status === 'unpaid');
    assert.equal(renewal.amount, '250.00');

    // A new subscriber gets the new price.
    const other = await createTeacher();
    const fresh = await subscribe(other.id, plan.id);
    assert.equal(fresh.price, '400.00');
    assert.equal(fresh.plan_name, 'Snapshot Plan Plus');
  });
});

// ---------- Teachers ----------

describe('Teachers and plans', () => {
  test('a plan can be chosen when the admin creates a teacher', async () => {
    const teacher = await createTeacher({ plan_id: proPlan.id });
    assert.equal(teacher.plan_name, 'Teacher Pro');
    assert.equal(teacher.subscription_status, 'trial');
    assert.ok(teacher.subscription_id);

    const noTrial = await createTeacher({ plan_id: proPlan.id, with_trial: false });
    assert.equal(noTrial.subscription_status, 'past_due');

    const profile = await api().get(`/api/teachers/${teacher.id}`).set(bearer(adminToken));
    assert.equal(profile.body.teacher.plan_name, 'Teacher Pro');
    assert.equal(profile.body.teacher.plan_price, '100.00');

    const list = await api().get('/api/teachers').query({ search: teacher.username }).set(bearer(adminToken));
    assert.equal(list.body.items[0].plan_name, 'Teacher Pro');
  });

  test('a teacher created without a plan has no subscription', async () => {
    const teacher = await createTeacher();
    assert.equal(teacher.plan_name, null);
    assert.equal(teacher.subscription_id, null);
  });

  test('an unknown plan stops the whole creation', async () => {
    counter += 1;
    const response = await api().post('/api/teachers').set(bearer(adminToken)).send({
      first_name: 'No', last_name: 'Plan', email: `noplan${counter}@test.local`, mobile: '09171234567', username: `noplan${counter}`,
      school_id: schoolId, present_address: '', temporary_password: TEACHER_PASSWORD, plan_id: 999999,
    });
    assert.equal(response.status, 400);
    const found = await pool.query('SELECT 1 FROM teachers WHERE username = $1', [`noplan${counter}`]);
    assert.equal(found.rowCount, 0);
  });
});

// ---------- Invoices and payments ----------

describe('Invoices and payments', () => {
  test('a paid plan without a trial is payable immediately, due in 7 days', async () => {
    const { subscription, invoice } = await teacherWithUnpaidInvoice();
    assert.equal(subscription.status, 'past_due');
    assert.equal(invoice.amount, '100.00');
    assert.equal(invoice.status, 'unpaid');

    const row = await pool.query('SELECT due_date::text AS due_date FROM invoices WHERE id = $1', [invoice.id]);
    assert.equal(row.rows[0].due_date, await dateOffset(7));
  });

  test('admin records a payment by hand: invoice paid, subscription active, logged', async () => {
    const { teacher, subscription, invoice } = await teacherWithUnpaidInvoice();
    const yesterday = await dateOffset(-1);

    const recorded = await api()
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(bearer(adminToken))
      .field('reference_number', 'CASH-777')
      .field('paid_on', yesterday)
      .field('note', 'Paid at the office')
      .attach('screenshot', PNG, 'receipt.png');
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    assert.equal(recorded.body.payment.status, 'confirmed');
    assert.equal(recorded.body.payment.source, 'admin');
    assert.equal(recorded.body.payment.amount, '100.00');
    assert.equal(recorded.body.payment.has_screenshot, true);
    assert.equal(recorded.body.payment.reviewed_by_name, ADMIN.name);
    assert.equal(recorded.body.invoice.status, 'paid');
    assert.ok(!('screenshot_path' in recorded.body.payment));

    assert.equal((await getSubscription(subscription.id)).subscription.status, 'active');

    const log = await lastActivity('payment.record');
    assert.equal(log.entity_id, recorded.body.payment.id);
    assert.match(log.description, /₱100\.00.*CASH-777/);
    assert.ok(log.description.includes(teacher.last_name));

    // It cannot be paid twice.
    const again = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'CASH-778');
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'INVOICE_NOT_PAYABLE');
  });

  test('a payment needs a reference number and a date that is not in the future', async () => {
    const { invoice } = await teacherWithUnpaidInvoice();
    const noReference = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('note', 'x');
    assert.equal(noReference.status, 400);
    assert.ok(noReference.body.errors.reference_number);

    const future = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'R1').field('paid_on', await dateOffset(2));
    assert.equal(future.status, 400);
    assert.ok(future.body.errors.paid_on);

    const badDate = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'R1').field('paid_on', '2026-02-31');
    assert.equal(badDate.status, 400);

    assert.equal((await api().post('/api/invoices/999999/payments').set(bearer(adminToken)).field('reference_number', 'R1')).status, 404);
  });

  test('teacher sends a QR payment, admin confirms it', async () => {
    const { teacher, subscription, invoice } = await teacherWithUnpaidInvoice();
    const token = await teacherToken(teacher);

    const mine = await api().get('/api/teacher/invoices').set(bearer(token));
    assert.equal(mine.status, 200);
    assert.equal(mine.body.items.length, 1);
    assert.equal(mine.body.items[0].id, invoice.id);

    const sent = await submitAsTeacher(token, invoice.id, 'GCASH-2001');
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.payment.status, 'pending');

    // Still unpaid until an admin confirms it. A second submission is refused.
    assert.equal((await api().get(`/api/invoices/${invoice.id}`).set(bearer(adminToken))).body.invoice.status, 'unpaid');
    const twice = await submitAsTeacher(token, invoice.id, 'GCASH-2002');
    assert.equal(twice.status, 409);
    assert.equal(twice.body.code, 'PAYMENT_PENDING');

    const pending = await api().get('/api/payments').query({ status: 'pending' }).set(bearer(adminToken));
    assert.ok(pending.body.items.some((item) => item.id === sent.body.payment.id));
    assert.ok(pending.body.pending_count >= 1);
    assert.equal((await api().get('/api/overview').set(bearer(adminToken))).body.counts.pending_payments, pending.body.pending_count);

    const confirmed = await api().post(`/api/payments/${sent.body.payment.id}/confirm`).set(bearer(adminToken));
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.payment.status, 'confirmed');
    assert.equal(confirmed.body.payment.source, 'teacher');
    assert.equal(confirmed.body.payment.invoice_status, 'paid');
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'active');
    assert.match((await lastActivity('payment.confirm')).description, /GCASH-2001/);

    assert.equal((await api().post(`/api/payments/${sent.body.payment.id}/confirm`).set(bearer(adminToken))).status, 409);
    assert.equal((await api().post(`/api/payments/${sent.body.payment.id}/reject`).set(bearer(adminToken)).send({ reason: 'Too late now' })).status, 409);
  });

  test('admin rejects a QR payment with a reason, and the teacher can send another', async () => {
    const { teacher, subscription, invoice } = await teacherWithUnpaidInvoice();
    const token = await teacherToken(teacher);
    const sent = await submitAsTeacher(token, invoice.id, 'GCASH-3001');

    const noReason = await api().post(`/api/payments/${sent.body.payment.id}/reject`).set(bearer(adminToken)).send({});
    assert.equal(noReason.status, 400);

    const rejected = await api().post(`/api/payments/${sent.body.payment.id}/reject`).set(bearer(adminToken)).send({ reason: 'Amount does not match' });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.payment.status, 'rejected');
    assert.equal(rejected.body.payment.rejection_reason, 'Amount does not match');
    assert.equal(rejected.body.payment.invoice_status, 'unpaid');
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'past_due');
    assert.match((await lastActivity('payment.reject')).description, /Amount does not match/);

    const mine = await api().get('/api/teacher/invoices').set(bearer(token));
    assert.equal(mine.body.items[0].latest_payment_status, 'rejected');
    assert.equal(mine.body.items[0].latest_rejection_reason, 'Amount does not match');

    const second = await submitAsTeacher(token, invoice.id, 'GCASH-3002');
    assert.equal(second.status, 201);
    const detail = await api().get(`/api/invoices/${invoice.id}`).set(bearer(adminToken));
    assert.equal(detail.body.payments.length, 2);
  });

  test('a teacher can only pay their own invoice and must attach a screenshot', async () => {
    const first = await teacherWithUnpaidInvoice();
    const second = await teacherWithUnpaidInvoice();
    const token = await teacherToken(second.teacher);

    const notMine = await submitAsTeacher(token, first.invoice.id, 'GCASH-4001');
    assert.equal(notMine.status, 404);

    const noScreenshot = await submitAsTeacher(token, second.invoice.id, 'GCASH-4002', null);
    assert.equal(noScreenshot.status, 400);
    assert.ok(noScreenshot.body.errors.screenshot);

    assert.equal((await pool.query('SELECT 1 FROM payments WHERE invoice_id = ANY($1)', [[first.invoice.id, second.invoice.id]])).rowCount, 0);
  });

  test('paying after the subscription expired starts it again from the payment date', async () => {
    const { subscription, invoice } = await teacherWithUnpaidInvoice();
    await pool.query(`UPDATE invoices SET due_date = due_date - 30 WHERE id = $1`, [invoice.id]);
    await billing.runBillingCycle();
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'expired');

    const overdue = await api().get('/api/invoices').query({ status: 'overdue', page_size: 100 }).set(bearer(adminToken));
    assert.ok(overdue.body.items.some((item) => item.id === invoice.id && item.is_overdue));

    const paid = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'LATE-1');
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    const detail = await getSubscription(subscription.id);
    assert.equal(detail.subscription.status, 'active');
    assert.equal(detail.subscription.ended_at, null);
    const days = (new Date(detail.subscription.current_period_end) - Date.now()) / 86400000;
    assert.ok(days > 27 && days < 32, `period ends in ${days} days`);
  });

  test('void an invoice with a reason: the waiting subscription ends', async () => {
    const { subscription, invoice } = await teacherWithUnpaidInvoice();
    assert.equal((await api().post(`/api/invoices/${invoice.id}/void`).set(bearer(adminToken)).send({ reason: '' })).status, 400);

    const voided = await api().post(`/api/invoices/${invoice.id}/void`).set(bearer(adminToken)).send({ reason: 'Issued by mistake' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.equal(voided.body.invoice.status, 'void');
    assert.equal(voided.body.invoice.void_reason, 'Issued by mistake');
    assert.equal((await getSubscription(subscription.id)).subscription.status, 'expired');
    assert.match((await lastActivity('invoice.void')).description, /Issued by mistake/);

    assert.equal((await api().post(`/api/invoices/${invoice.id}/void`).set(bearer(adminToken)).send({ reason: 'Issued by mistake' })).status, 409);
    assert.equal((await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'X1')).status, 409);
  });

  test('invoice list: filters and totals come from the database', async () => {
    const list = await api().get('/api/invoices').query({ page_size: 100 }).set(bearer(adminToken));
    assert.equal(list.status, 200);

    const real = await pool.query(`
      SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)::numeric(12,2)::text AS outstanding,
             COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric(12,2)::text AS paid,
             COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid' AND due_date < (NOW() AT TIME ZONE $1)::date), 0)::numeric(12,2)::text AS overdue,
             COUNT(*)::int AS total FROM invoices`, [config.timezone]);
    assert.equal(list.body.totals.outstanding, real.rows[0].outstanding);
    assert.equal(list.body.totals.paid, real.rows[0].paid);
    assert.equal(list.body.totals.overdue, real.rows[0].overdue);
    assert.equal(list.body.total, real.rows[0].total);
    assert.ok(Number(list.body.totals.paid) > 0);

    for (const status of ['unpaid', 'paid', 'void']) {
      const filtered = await api().get('/api/invoices').query({ status, page_size: 100 }).set(bearer(adminToken));
      assert.ok(filtered.body.items.length > 0, `no ${status} invoices`);
      assert.ok(filtered.body.items.every((item) => item.status === status));
    }

    const one = list.body.items[0];
    const bySearch = await api().get('/api/invoices').query({ search: one.invoice_number }).set(bearer(adminToken));
    assert.equal(bySearch.body.total, 1);
    const byTeacher = await api().get('/api/invoices').query({ teacher_id: one.teacher_id }).set(bearer(adminToken));
    assert.ok(byTeacher.body.items.every((item) => item.teacher_id === one.teacher_id));

    const none = await api().get('/api/invoices').query({ from: '2001-01-01', to: '2001-01-31' }).set(bearer(adminToken));
    assert.equal(none.body.total, 0);
    assert.equal((await api().get('/api/invoices').query({ from: 'yesterday' }).set(bearer(adminToken))).status, 400);
  });

  test('payment list: status and source filters', async () => {
    const byAdmin = await api().get('/api/payments').query({ source: 'admin', page_size: 100 }).set(bearer(adminToken));
    assert.ok(byAdmin.body.items.length > 0);
    assert.ok(byAdmin.body.items.every((item) => item.source === 'admin' && item.status === 'confirmed'));

    const rejected = await api().get('/api/payments').query({ status: 'rejected', page_size: 100 }).set(bearer(adminToken));
    assert.ok(rejected.body.items.length > 0);
    assert.ok(rejected.body.items.every((item) => item.status === 'rejected'));

    const one = await api().get(`/api/payments/${byAdmin.body.items[0].id}`).set(bearer(adminToken));
    assert.equal(one.status, 200);
    assert.equal((await api().get('/api/payments/999999').set(bearer(adminToken))).status, 404);
  });
});

// ---------- Uploads ----------

describe('Uploads', () => {
  test('only real images are accepted, whatever the file name says', async () => {
    const { teacher, invoice } = await teacherWithUnpaidInvoice();
    const token = await teacherToken(teacher);

    const fake = await submitAsTeacher(token, invoice.id, 'GCASH-5001', NOT_AN_IMAGE, 'proof.png');
    assert.equal(fake.status, 400);
    assert.equal(fake.body.code, 'UPLOAD_ERROR');
    assert.equal(fake.body.errors.screenshot, 'Upload a PNG, JPG or WEBP image.');

    const byHand = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'R5').attach('screenshot', NOT_AN_IMAGE, 'x.jpg');
    assert.equal(byHand.status, 400);
    assert.equal((await pool.query('SELECT 1 FROM payments WHERE invoice_id = $1', [invoice.id])).rowCount, 0);
  });

  test('images over 2 MB are refused', async () => {
    const { teacher, invoice } = await teacherWithUnpaidInvoice();
    const big = await submitAsTeacher(await teacherToken(teacher), invoice.id, 'GCASH-5002', TOO_BIG, 'big.png');
    assert.equal(big.status, 400);
    assert.equal(big.body.errors.screenshot, 'The image is too large. The limit is 2 MB.');

    const qr = await api().put('/api/settings/payment').set(bearer(adminToken)).field('account_name', 'X').attach('qr_image', TOO_BIG, 'qr.png');
    assert.equal(qr.status, 400);
  });

  test('the screenshot is saved on disk, only its path is in the database, and only admins can open it', async () => {
    const { teacher, invoice } = await teacherWithUnpaidInvoice();
    const token = await teacherToken(teacher);
    const sent = await submitAsTeacher(token, invoice.id, 'GCASH-5003');
    const paymentId = sent.body.payment.id;

    const row = await pool.query('SELECT screenshot_path FROM payments WHERE id = $1', [paymentId]);
    assert.match(row.rows[0].screenshot_path, /^payments\/[0-9a-f]{32}\.png$/);
    const file = path.join(config.uploadDir, row.rows[0].screenshot_path);
    assert.ok(fs.existsSync(file));
    assert.ok(fs.readFileSync(file).equals(PNG));

    const image = await api().get(`/api/payments/${paymentId}/screenshot`).set(bearer(adminToken));
    assert.equal(image.status, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.ok(Buffer.from(image.body).equals(PNG));

    assert.equal((await api().get(`/api/payments/${paymentId}/screenshot`)).status, 401);
    assert.equal((await api().get(`/api/payments/${paymentId}/screenshot`).set(bearer(token))).status, 401);
    // Uploaded files are not served as plain static files either.
    assert.equal((await api().get(`/uploads/${row.rows[0].screenshot_path}`)).status, 404);
    assert.equal((await api().get(`/api/uploads/${row.rows[0].screenshot_path}`)).status, 401);
  });

  test('a file is not left behind when the payment is refused', async () => {
    const { invoice } = await teacherWithUnpaidInvoice();
    await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'PAID-1');

    const folder = path.join(config.uploadDir, 'payments');
    const before = fs.readdirSync(folder).length;
    const again = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer(adminToken)).field('reference_number', 'PAID-2').attach('screenshot', PNG, 'a.png');
    assert.equal(again.status, 409);
    assert.equal(fs.readdirSync(folder).length, before);
  });
});

// ---------- Payment QR code (Settings) ----------

describe('Payment QR code', () => {
  test('starts empty', async () => {
    const settings = await api().get('/api/settings').set(bearer(adminToken));
    assert.equal(settings.body.payment.has_qr, false);
    assert.equal(settings.body.payment.account_name, '');
    assert.equal(settings.body.payment.has_qr2, false);
    assert.ok(!('qr_path' in settings.body.payment));
    assert.ok(!('qr2_path' in settings.body.payment));
    assert.equal((await api().get('/api/settings/payment/qr').set(bearer(adminToken))).status, 404);
  });

  test('upload, replace and remove the QR code with account name and instructions', async () => {
    const saved = await api()
      .put('/api/settings/payment')
      .set(bearer(adminToken))
      .field('account_name', 'Test Account Name')
      .field('instructions', 'Scan the code, pay the exact amount, then send the reference number.')
      .attach('qr_image', PNG, 'qr.png');
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.payment.has_qr, true);
    assert.equal(saved.body.payment.account_name, 'Test Account Name');
    assert.match((await lastActivity('settings.payment_qr')).description, /Uploaded the payment QR code/);

    const firstRow = (await pool.query(`SELECT image_data, mime_type FROM branding_images WHERE key = 'payment_qr'`)).rows[0];
    assert.ok(firstRow);
    assert.ok(Buffer.from(firstRow.image_data).equals(PNG));
    assert.equal(firstRow.mime_type, 'image/png');
    // The old file path in settings is cleared: the database row is the only source now.
    assert.equal((await pool.query(`SELECT value FROM settings WHERE key = 'payment_qr_path'`)).rows[0].value, '');
    assert.ok(!fs.existsSync(path.join(config.uploadDir, 'qr')), 'no QR code file should be written to disk');

    const image = await api().get('/api/settings/payment/qr').set(bearer(adminToken));
    assert.equal(image.status, 200);
    assert.ok(Buffer.from(image.body).equals(PNG));
    assert.equal((await api().get('/api/settings/payment/qr')).status, 401);

    // Text only: the image stays.
    const textOnly = await api().put('/api/settings/payment').set(bearer(superToken)).field('account_name', 'Second Name').field('instructions', '');
    assert.equal(textOnly.body.payment.has_qr, true);
    assert.equal(textOnly.body.payment.account_name, 'Second Name');
    assert.equal(textOnly.body.payment.instructions, '');

    // Replace: the database row is updated in place, and no file is written.
    const replaced = await api().put('/api/settings/payment').set(bearer(adminToken)).field('account_name', 'Second Name').attach('qr_image', PNG, 'new.png');
    assert.equal(replaced.status, 200);
    assert.match((await lastActivity('settings.payment_qr')).description, /Replaced the payment QR code/);
    const replacedRow = (await pool.query(`SELECT image_data FROM branding_images WHERE key = 'payment_qr'`)).rows[0];
    assert.ok(Buffer.from(replacedRow.image_data).equals(PNG));
    assert.ok(!fs.existsSync(path.join(config.uploadDir, 'qr')));

    const wrongType = await api().put('/api/settings/payment').set(bearer(adminToken)).field('account_name', 'Second Name').attach('qr_image', NOT_AN_IMAGE, 'qr.png');
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.body.errors.qr_image, 'Upload a PNG, JPG or WEBP image.');
    assert.equal((await api().get('/api/settings').set(bearer(adminToken))).body.payment.has_qr, true);
  });

  test('teachers read the payment details through their own endpoint', async () => {
    const teacher = await createTeacher();
    const token = await teacherToken(teacher);

    const info = await api().get('/api/teacher/payment-info').set(bearer(token));
    assert.equal(info.status, 200);
    assert.deepEqual(info.body, {
      label: '',
      account_name: 'Second Name',
      instructions: '',
      has_qr: true,
      qr2_label: '',
      qr2_account_name: '',
      qr2_instructions: '',
      has_qr2: false,
    });
    const image = await api().get('/api/teacher/payment-info/qr').set(bearer(token));
    assert.equal(image.status, 200);
    assert.equal(image.headers['content-type'], 'image/png');

    assert.equal((await api().get('/api/teacher/payment-info')).status, 401);
    assert.equal((await api().get('/api/teacher/payment-info').set(bearer(adminToken))).status, 401);

    const removed = await api().put('/api/settings/payment').set(bearer(adminToken)).field('account_name', 'Second Name').field('remove_qr', 'true');
    assert.equal(removed.body.payment.has_qr, false);
    assert.equal((await api().get('/api/teacher/payment-info/qr').set(bearer(token))).status, 404);
  });
});

// ---------- Announcements ----------

describe('Announcements', () => {
  let freeTeacherToken;
  let proTeacherToken;
  let noPlanTeacherToken;

  const announcement = (extra = {}) => ({ title: 'Test notice', body: 'Test message body.', audience: 'all', ...extra });
  const create = async (extra) => {
    const response = await api().post('/api/announcements').set(bearer(adminToken)).send(announcement({ ends_on: await dateOffset(7), ...extra }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.announcement;
  };
  const titlesFor = async (token) => (await api().get('/api/teacher/announcements').set(bearer(token))).body.items.map((item) => item.title);

  before(async () => {
    const free = await createTeacher({ plan_id: freePlan.id });
    const pro = await createTeacher({ plan_id: proPlan.id });
    const none = await createTeacher();
    freeTeacherToken = await teacherToken(free);
    proTeacherToken = await teacherToken(pro);
    noPlanTeacherToken = await teacherToken(none);
  });

  test('create, edit and delete, all logged', async () => {
    const created = await create({ title: 'To edit' });
    assert.equal(created.status, 'live');
    assert.equal(created.created_by_name, ADMIN.name);
    assert.equal((await lastActivity('announcement.create')).entity_id, created.id);

    const edited = await api().patch(`/api/announcements/${created.id}`).set(bearer(superToken)).send(announcement({ title: 'Edited title', audience: 'pro', ends_on: await dateOffset(3) }));
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.announcement.title, 'Edited title');
    assert.equal(edited.body.announcement.audience, 'pro');
    assert.equal((await lastActivity('announcement.update')).admin_name, SUPER.name);

    const removed = await api().delete(`/api/announcements/${created.id}`).set(bearer(adminToken));
    assert.equal(removed.status, 200);
    assert.match((await lastActivity('announcement.delete')).description, /Edited title/);
    assert.equal((await api().delete(`/api/announcements/${created.id}`).set(bearer(adminToken))).status, 404);
  });

  test('an end date is required and must not be before the start date', async () => {
    const noEnd = await api().post('/api/announcements').set(bearer(adminToken)).send(announcement());
    assert.equal(noEnd.status, 400);
    assert.ok(noEnd.body.errors.ends_on);

    const backwards = await api().post('/api/announcements').set(bearer(adminToken)).send(announcement({ starts_on: await dateOffset(5), ends_on: await dateOffset(2) }));
    assert.equal(backwards.status, 400);

    const badAudience = await api().post('/api/announcements').set(bearer(adminToken)).send(announcement({ audience: 'school', ends_on: await dateOffset(2) }));
    assert.equal(badAudience.status, 400);
  });

  test('audience: All, Free only and Pro only follow the teacher\'s current plan', async () => {
    await create({ title: 'For everyone', audience: 'all' });
    await create({ title: 'For free', audience: 'free' });
    await create({ title: 'For pro', audience: 'pro' });

    assert.deepEqual((await titlesFor(freeTeacherToken)).sort(), ['For everyone', 'For free']);
    assert.deepEqual((await titlesFor(noPlanTeacherToken)).sort(), ['For everyone', 'For free']);
    assert.deepEqual((await titlesFor(proTeacherToken)).sort(), ['For everyone', 'For pro']);
  });

  test('an announcement disappears after its end date and waits for its start date', async () => {
    const ending = await create({ title: 'Ends today', ends_on: await today() });
    const later = await create({ title: 'Starts later', starts_on: await dateOffset(2), ends_on: await dateOffset(5) });
    assert.equal(later.status, 'scheduled');

    let titles = await titlesFor(freeTeacherToken);
    assert.ok(titles.includes('Ends today'));
    assert.ok(!titles.includes('Starts later'));

    // The next day "Ends today" is over.
    await pool.query(`UPDATE announcements SET ends_on = ends_on - 1 WHERE id = $1`, [ending.id]);
    titles = await titlesFor(freeTeacherToken);
    assert.ok(!titles.includes('Ends today'));

    const ended = await api().get('/api/announcements').query({ status: 'ended' }).set(bearer(adminToken));
    assert.deepEqual(ended.body.items.map((item) => item.title), ['Ends today']);
    const scheduled = await api().get('/api/announcements').query({ status: 'scheduled' }).set(bearer(adminToken));
    assert.deepEqual(scheduled.body.items.map((item) => item.title), ['Starts later']);
    const live = await api().get('/api/announcements').query({ status: 'live', audience: 'pro' }).set(bearer(adminToken));
    assert.deepEqual(live.body.items.map((item) => item.title), ['For pro']);
    const found = await api().get('/api/announcements').query({ search: 'everyone' }).set(bearer(adminToken));
    assert.equal(found.body.total, 1);
  });
});

// ---------- Reports ----------

describe('Reports', () => {
  test('income: total equals the confirmed payments in the database for the date range', async () => {
    const from = await dateOffset(-40);
    const to = await today();
    const report = await api().get('/api/reports/income').query({ from, to }).set(bearer(adminToken));
    assert.equal(report.status, 200, JSON.stringify(report.body));

    const real = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric(12,2)::text AS total, COUNT(*)::int AS count FROM payments WHERE status = 'confirmed' AND paid_on BETWEEN $1 AND $2`,
      [from, to]
    );
    assert.equal(report.body.summary.total, real.rows[0].total);
    assert.equal(report.body.summary.payment_count, real.rows[0].count);
    assert.equal(report.body.items.length, real.rows[0].count);
    assert.ok(real.rows[0].count > 0);

    const planTotal = report.body.by_plan.reduce((sum, row) => sum + Math.round(Number(row.total) * 100), 0);
    assert.equal(planTotal, Math.round(Number(real.rows[0].total) * 100));

    // Rejected and pending payments are never income.
    assert.ok(report.body.items.every((item) => item.reference_number !== 'GCASH-3001'));

    // A range with nothing in it.
    const empty = await api().get('/api/reports/income').query({ from: '2001-01-01', to: '2001-01-31' }).set(bearer(adminToken));
    assert.equal(empty.body.summary.total, '0.00');
    assert.equal(empty.body.items.length, 0);

    // The payment recorded for yesterday only counts for yesterday.
    const yesterday = await dateOffset(-1);
    const oneDay = await api().get('/api/reports/income').query({ from: yesterday, to: yesterday }).set(bearer(adminToken));
    assert.deepEqual(oneDay.body.items.map((item) => item.reference_number), ['CASH-777']);
    assert.equal(oneDay.body.summary.total, '100.00');
  });

  test('income this month on the overview matches the report with no dates', async () => {
    const report = await api().get('/api/reports/income').set(bearer(adminToken));
    const overview = await api().get('/api/overview').set(bearer(adminToken));
    assert.equal(report.body.to, await today());
    assert.match(report.body.from, /-01$/);
    assert.equal(overview.body.counts.income_this_month, report.body.summary.total);

    const real = await pool.query(`SELECT COUNT(*)::int AS active FROM subscriptions WHERE status IN ('trial', 'active')`);
    assert.equal(overview.body.counts.active_subscriptions, real.rows[0].active);
  });

  test('income CSV export', async () => {
    const from = await dateOffset(-40);
    const to = await today();
    const csv = await api().get('/api/reports/income').query({ from, to, format: 'csv' }).set(bearer(adminToken));
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.headers['content-disposition'], new RegExp(`attachment; filename="income_${from}_to_${to}.csv"`));

    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.equal(lines[0], 'Date paid,Invoice,Teacher,Username,School,Plan,Reference number,Recorded by,Amount (PHP)');
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM payments WHERE status = 'confirmed' AND paid_on BETWEEN $1 AND $2`, [from, to]);
    assert.equal(lines.length - 1, count.rows[0].count);
    assert.ok(lines.some((line) => line.includes('CASH-777') && line.endsWith(',100.00')));
  });

  test('subscriptions report and CSV', async () => {
    const range = { from: await dateOffset(-40), to: await today() };
    const report = await api().get('/api/reports/subscriptions').query(range).set(bearer(adminToken));
    assert.equal(report.status, 200, JSON.stringify(report.body));
    const real = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled FROM subscriptions`);
    assert.equal(report.body.summary.total, real.rows[0].total);
    assert.equal(report.body.summary.cancelled, real.rows[0].cancelled);
    const s = report.body.summary;
    assert.equal(s.trial + s.active + s.past_due + s.expired + s.cancelled, s.total);
    assert.equal(report.body.by_plan.reduce((sum, row) => sum + row.subscription_count, 0), s.total);

    const csv = await api().get('/api/reports/subscriptions').query({ ...range, format: 'csv' }).set(bearer(adminToken));
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.equal(lines[0], 'Started,Teacher,Username,School,Plan,Price (PHP),Billing cycle,Status,Current period ends,Ended');
    assert.equal(lines.length - 1, real.rows[0].total);

    const empty = await api().get('/api/reports/subscriptions').query({ from: '2001-01-01', to: '2001-01-02' }).set(bearer(adminToken));
    assert.equal(empty.body.summary.total, 0);
  });

  test('teachers per school report and CSV', async () => {
    await api().post('/api/schools').set(bearer(adminToken)).send({ name: 'Empty Test School', category: 'Primary', school_type: 'Public', city_region: 'Test City', principal_contact: 'Nobody' });

    const report = await api().get('/api/reports/teachers-per-school').set(bearer(adminToken));
    assert.equal(report.status, 200, JSON.stringify(report.body));
    const real = await pool.query(`SELECT COUNT(*)::int AS teachers FROM teachers`);
    assert.equal(report.body.summary.school_count, 2);
    assert.equal(report.body.summary.teacher_count, real.rows[0].teachers);
    assert.equal(report.body.items[0].name, 'Billing Test School');
    assert.equal(report.body.items[0].teacher_count, real.rows[0].teachers);
    assert.equal(report.body.items[0].added_in_range, real.rows[0].teachers);
    assert.equal(report.body.items[1].teacher_count, 0);

    const paid = await pool.query(`SELECT COUNT(DISTINCT teacher_id)::int AS count FROM subscriptions WHERE status IN ('trial','active','past_due') AND price > 0`);
    assert.equal(report.body.items[0].paid_plan_count, paid.rows[0].count);

    const old = await api().get('/api/reports/teachers-per-school').query({ from: '2001-01-01', to: '2001-01-31' }).set(bearer(adminToken));
    assert.equal(old.body.items[0].added_in_range, 0);
    assert.equal(old.body.items[0].teacher_count, real.rows[0].teachers);

    const csv = await api().get('/api/reports/teachers-per-school').query({ format: 'csv' }).set(bearer(adminToken));
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^School,City or region,Category,Type,Teachers,Added /);
    assert.match(lines[1], /^Billing Test School,Test City,Secondary,Private,/);
  });

  test('a date range that runs backwards is refused', async () => {
    const response = await api().get('/api/reports/income').query({ from: '2026-11-10', to: '2026-11-01' }).set(bearer(adminToken));
    assert.equal(response.status, 400);
    assert.equal((await api().get('/api/reports/income').query({ format: 'pdf' }).set(bearer(adminToken))).status, 400);
  });
});

// ---------- Permissions ----------

describe('Permissions', () => {
  const adminRoutes = [
    ['get', '/api/plans'],
    ['post', '/api/plans'],
    ['get', '/api/subscriptions'],
    ['post', '/api/subscriptions'],
    ['get', '/api/invoices'],
    ['get', '/api/payments'],
    ['post', '/api/payments/1/confirm'],
    ['post', '/api/payments/1/reject'],
    ['get', '/api/reports/income'],
    ['get', '/api/reports/subscriptions'],
    ['get', '/api/reports/teachers-per-school'],
    ['get', '/api/announcements'],
    ['post', '/api/announcements'],
    ['put', '/api/settings/payment'],
    ['get', '/api/settings/payment/qr'],
  ];

  test('every Part 2 admin route needs an admin sign-in', async () => {
    const teacher = await createTeacher();
    const token = await teacherToken(teacher);
    for (const [method, url] of adminRoutes) {
      const anonymous = await api()[method](url);
      assert.equal(anonymous.status, 401, `${method} ${url} without a token`);
      const asTeacher = await api()[method](url).set(bearer(token));
      assert.equal(asTeacher.status, 401, `${method} ${url} with a teacher token`);
    }
  });

  test('teacher routes need a teacher sign-in, and a restricted teacher is refused', async () => {
    for (const url of ['/api/teacher/announcements', '/api/teacher/invoices', '/api/teacher/payment-info']) {
      assert.equal((await api().get(url)).status, 401, url);
      assert.equal((await api().get(url).set(bearer(adminToken))).status, 401, `${url} with an admin token`);
    }

    const teacher = await createTeacher();
    const token = await teacherToken(teacher);
    assert.equal((await api().get('/api/teacher/invoices').set(bearer(token))).status, 200);

    await api().post(`/api/teachers/${teacher.id}/restrict`).set(bearer(adminToken)).send({ reason: 'Testing the restriction' });
    const refused = await api().get('/api/teacher/invoices').set(bearer(token));
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'ACCOUNT_RESTRICTED');
  });

  test('both the Admin and the Super User can use the billing screens', async () => {
    for (const token of [adminToken, superToken]) {
      for (const url of ['/api/plans', '/api/subscriptions', '/api/invoices', '/api/payments', '/api/reports/income', '/api/announcements']) {
        assert.equal((await api().get(url).set(bearer(token))).status, 200, url);
      }
    }
    const teacher = await createTeacher();
    const bySuper = await api().post('/api/subscriptions').set(bearer(superToken)).send({ teacher_id: teacher.id, plan_id: freePlan.id });
    assert.equal(bySuper.status, 201);
    assert.equal((await lastActivity('subscription.create')).admin_role, 'super_user');
  });
});

// ---------- Activity log ----------

describe('Activity log for billing', () => {
  test('every kind of Part 2 action was recorded with who, what and when', async () => {
    const expected = [
      'plan.create', 'plan.update', 'plan.activate', 'plan.deactivate', 'plan.delete',
      'subscription.create', 'subscription.extend', 'subscription.cancel', 'subscription.change_plan', 'subscription.expire',
      'invoice.issue', 'invoice.void',
      'payment.record', 'payment.confirm', 'payment.reject',
      'announcement.create', 'announcement.update', 'announcement.delete',
      'settings.payment_qr',
    ];
    const found = await pool.query('SELECT DISTINCT action FROM activity_log');
    const actions = found.rows.map((row) => row.action);
    for (const action of expected) assert.ok(actions.includes(action), `missing ${action}`);

    const incomplete = await pool.query(`SELECT COUNT(*)::int AS count FROM activity_log WHERE admin_name IS NULL OR description = '' OR created_at IS NULL`);
    assert.equal(incomplete.rows[0].count, 0);

    const list = await api().get('/api/activity').query({ action: 'payment.confirm' }).set(bearer(adminToken));
    assert.equal(list.status, 200);
    assert.ok(list.body.items.length > 0);
    assert.equal(list.body.items[0].admin_name, ADMIN.name);
  });
});

// ---------- Safety ----------

describe('Test safety', () => {
  const { spawnSync } = require('child_process');
  const run = (env) =>
    spawnSync(process.execPath, ['-e', "require('./tests/helpers'); console.log('STARTED')"], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });

  test('the tests refuse to run when the test database is the real database', async () => {
    const sameName = run({ TEST_DATABASE_URL: '', DB_NAME: 'acadsync', TEST_DB_NAME: 'acadsync' });
    assert.equal(sameName.status, 1);
    assert.match(sameName.stderr, /The tests did not run, to keep your real data safe/);
    assert.match(sameName.stderr, /TEST_DB_NAME and DB_NAME are both "acadsync"/);
    assert.ok(!sameName.stdout.includes('STARTED'));

    const address = 'postgresql://someone:secret@db.example.test/school';
    const sameUrl = run({ DATABASE_URL: address, TEST_DATABASE_URL: address });
    assert.equal(sameUrl.status, 1);
    assert.match(sameUrl.stderr, /TEST_DATABASE_URL points to the same database as DATABASE_URL/);
    assert.ok(!sameUrl.stderr.includes('secret'));

    // Same server and database with different options is still the same database.
    const sameTarget = run({ DATABASE_URL: address, TEST_DATABASE_URL: `${address}?sslmode=require` });
    assert.equal(sameTarget.status, 1);
  });
});
