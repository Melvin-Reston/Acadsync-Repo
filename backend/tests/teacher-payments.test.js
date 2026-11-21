// Teacher Batch 6 tests: the teacher's own plans, invoices, receipt and QR payment,
// and the teacher-initiated plan change (trial given once, unpaid invoices voided).
// Run with: npm test
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, pool, resetDatabase, signIn, bearer, removeTestUploads, SUPER, ADMIN } = require('./helpers');
const { config } = require('../src/config');

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

const TEACHER_PASSWORD = 'TeacherPass123';

before(async () => {
  await resetDatabase();
  superToken = await signIn(SUPER);
  adminToken = await signIn(ADMIN);

  const school = await api()
    .post('/api/schools')
    .set(bearer(adminToken))
    .send({ name: 'Teacher Payments Test School', category: 'Secondary', school_type: 'Private', city_region: 'Test City', principal_contact: 'Test Principal' });
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
      first_name: 'Payments',
      last_name: `Teacher${counter}`,
      email: `payments.teacher${counter}@test.local`,
      mobile: '09171234567',
      username: `payments.teacher${counter}`,
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

async function teacherToken(teacher) {
  const response = await api().post('/api/teacher-auth/login').send({ login: teacher.username, password: TEACHER_PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token;
}

// A teacher on Teacher Pro without a trial: one unpaid invoice straight away.
async function teacherWithUnpaidInvoice() {
  const teacher = await createTeacher();
  const subscription = await subscribe(teacher.id, proPlan.id, false);
  const detail = await api().get(`/api/subscriptions/${subscription.id}`).set(bearer(adminToken));
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  return { teacher, subscription, invoice: detail.body.invoices[0], token: await teacherToken(teacher) };
}

async function mySubscription(token) {
  const response = await api().get('/api/teacher/subscription').set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.subscription;
}

async function myInvoices(token) {
  const response = await api().get('/api/teacher/invoices').set(bearer(token));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.items;
}

function submitAsTeacher(token, invoiceId, reference = 'GCASH-1001', image = PNG, filename = 'proof.png') {
  const request = api().post(`/api/teacher/invoices/${invoiceId}/payments`).set(bearer(token)).field('reference_number', reference);
  return image ? request.attach('screenshot', image, filename) : request;
}

const today = async () => (await pool.query(`SELECT (NOW() AT TIME ZONE $1)::date::text AS d`, [config.timezone])).rows[0].d;

// ---------- Plans ----------

describe('Teacher plans', () => {
  test('the active plans come from the database, with prices and the trial', async () => {
    const response = await api().get('/api/plans/active');
    assert.equal(response.status, 200);
    const names = response.body.items.map((plan) => plan.name);
    assert.deepEqual(names, ['Teacher Free', 'Teacher Pro']);
    const free = response.body.items[0];
    const pro = response.body.items[1];
    assert.equal(free.price, '0.00');
    assert.equal(free.billing_cycle, 'one_time');
    assert.equal(free.duration_months, 1);
    assert.equal(free.trial_days, 0);
    assert.equal(pro.price, '100.00');
    assert.equal(pro.billing_cycle, 'monthly');
    assert.equal(pro.trial_days, 30);
  });

  test('a teacher with no subscription gets null, not an error', async () => {
    const teacher = await createTeacher();
    const token = await teacherToken(teacher);
    assert.equal(await mySubscription(token), null);
    assert.deepEqual(await myInvoices(token), []);
  });
});

// ---------- Invoices and the receipt ----------

describe('Teacher invoices and receipt', () => {
  test('a teacher sees only their own invoices, and only their own receipt', async () => {
    const { teacher, invoice, token } = await teacherWithUnpaidInvoice();
    const other = await createTeacher();
    const otherToken = await teacherToken(other);

    const mine = await myInvoices(token);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].invoice_number, invoice.invoice_number);
    assert.equal(mine[0].amount, '100.00');
    assert.equal(mine[0].status, 'unpaid');
    assert.equal(mine[0].latest_payment_status, null);

    assert.deepEqual(await myInvoices(otherToken), []);

    const denied = await api().get(`/api/teacher/invoices/${invoice.id}`).set(bearer(otherToken));
    assert.equal(denied.status, 404);
    const signedOut = await api().get(`/api/teacher/invoices/${invoice.id}`);
    assert.equal(signedOut.status, 401);
    void teacher;
  });

  test('the receipt shows the invoice and an empty payment history', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const response = await api().get(`/api/teacher/invoices/${invoice.id}`).set(bearer(token));
    assert.equal(response.status, 200);
    const { invoice: receipt, payments } = response.body;
    assert.equal(receipt.invoice_number, invoice.invoice_number);
    assert.equal(receipt.plan_name, 'Teacher Pro');
    assert.equal(receipt.amount, '100.00');
    assert.equal(receipt.status, 'unpaid');
    assert.equal(receipt.is_overdue, false);
    assert.ok(receipt.period_start);
    assert.ok(receipt.period_end);
    assert.ok(receipt.due_date);
    assert.deepEqual(payments, []);
  });
});

// ---------- The QR payment ----------

describe('Teacher QR payment', () => {
  test('payment info and the QR code come from Settings', async () => {
    const { token } = await teacherWithUnpaidInvoice();

    const before = await api().get('/api/teacher/payment-info').set(bearer(token));
    assert.equal(before.status, 200);
    assert.equal(before.body.has_qr, false);

    const noQr = await api().get('/api/teacher/payment-info/qr').set(bearer(token));
    assert.equal(noQr.status, 404);

    const saved = await api()
      .put('/api/settings/payment')
      .set(bearer(adminToken))
      .field('account_name', 'AcadSync')
      .field('instructions', 'Scan the code and pay the exact amount.')
      .attach('qr_image', PNG, 'qr.png');
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const after = await api().get('/api/teacher/payment-info').set(bearer(token));
    assert.equal(after.body.has_qr, true);
    assert.equal(after.body.account_name, 'AcadSync');
    assert.equal(after.body.instructions, 'Scan the code and pay the exact amount.');

    const qr = await api().get('/api/teacher/payment-info/qr').set(bearer(token));
    assert.equal(qr.status, 200);
    assert.match(qr.headers['content-type'], /image\/png/);
  });

  test('a payment is always the full invoice amount, and then waits for confirmation', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const response = await submitAsTeacher(token, invoice.id);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.payment.amount, '100.00');
    assert.equal(response.body.payment.status, 'pending');
    assert.equal(response.body.payment.reference_number, 'GCASH-1001');

    const mine = await myInvoices(token);
    assert.equal(mine[0].latest_payment_status, 'pending');

    const receipt = await api().get(`/api/teacher/invoices/${invoice.id}`).set(bearer(token));
    assert.equal(receipt.body.payments.length, 1);
    assert.equal(receipt.body.payments[0].reference_number, 'GCASH-1001');
    assert.equal(receipt.body.payments[0].status, 'pending');
  });

  test('an amount sent with the payment is ignored: only the full amount is accepted', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const response = await api()
      .post(`/api/teacher/invoices/${invoice.id}/payments`)
      .set(bearer(token))
      .field('reference_number', 'GCASH-1002')
      .field('amount', '50.00')
      .attach('screenshot', PNG, 'proof.png');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.payment.amount, '100.00');
  });

  test('a screenshot is required, must be an image, and must fit in 2 MB', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();

    const noFile = await submitAsTeacher(token, invoice.id, 'GCASH-1003', null);
    assert.equal(noFile.status, 400);

    const notImage = await submitAsTeacher(token, invoice.id, 'GCASH-1004', NOT_AN_IMAGE, 'proof.txt');
    assert.equal(notImage.status, 400);

    const tooBig = await submitAsTeacher(token, invoice.id, 'GCASH-1005', TOO_BIG, 'proof.png');
    assert.equal(tooBig.status, 400);
  });

  test('a future payment date is refused', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const response = await api()
      .post(`/api/teacher/invoices/${invoice.id}/payments`)
      .set(bearer(token))
      .field('reference_number', 'GCASH-1006')
      .field('paid_on', '2999-01-01')
      .attach('screenshot', PNG, 'proof.png');
    assert.equal(response.status, 400);
  });

  test('a second payment cannot be sent while one is waiting', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const first = await submitAsTeacher(token, invoice.id);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await submitAsTeacher(token, invoice.id, 'GCASH-1007');
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'PAYMENT_PENDING');
  });

  test('a payment cannot be sent for another teacher, or for a paid or void invoice', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const other = await createTeacher();
    const otherToken = await teacherToken(other);
    const denied = await submitAsTeacher(otherToken, invoice.id);
    assert.equal(denied.status, 404);

    // Paid: submit, then the admin confirms it.
    const submitted = await submitAsTeacher(token, invoice.id);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const confirmed = await api().post(`/api/payments/${submitted.body.payment.id}/confirm`).set(bearer(adminToken));
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const afterPaid = await submitAsTeacher(token, invoice.id, 'GCASH-1008');
    assert.equal(afterPaid.status, 409);

    // Void: a fresh unpaid invoice, voided by the admin.
    const second = await teacherWithUnpaidInvoice();
    const voided = await api().post(`/api/invoices/${second.invoice.id}/void`).set(bearer(adminToken)).send({ reason: 'Issued by mistake' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    const afterVoid = await submitAsTeacher(second.token, second.invoice.id);
    assert.equal(afterVoid.status, 409);
  });

  test('confirming a payment marks the invoice paid and the subscription active', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const submitted = await submitAsTeacher(token, invoice.id);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));

    const confirmed = await api().post(`/api/payments/${submitted.body.payment.id}/confirm`).set(bearer(adminToken));
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.payment.status, 'confirmed');

    const receipt = await api().get(`/api/teacher/invoices/${invoice.id}`).set(bearer(token));
    assert.equal(receipt.body.invoice.status, 'paid');
    assert.ok(receipt.body.invoice.paid_at);
    assert.equal(receipt.body.payments[0].status, 'confirmed');

    const subscription = await mySubscription(token);
    assert.equal(subscription.status, 'active');
    assert.equal(subscription.plan_name, 'Teacher Pro');
  });

  test('a rejected payment shows its reason, and a new payment can be sent', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const submitted = await submitAsTeacher(token, invoice.id);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));

    const rejected = await api()
      .post(`/api/payments/${submitted.body.payment.id}/reject`)
      .set(bearer(adminToken))
      .send({ reason: 'The screenshot is unreadable.' });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.payment.status, 'rejected');

    const mine = await myInvoices(token);
    assert.equal(mine[0].status, 'unpaid');
    assert.equal(mine[0].latest_payment_status, 'rejected');
    assert.equal(mine[0].latest_rejection_reason, 'The screenshot is unreadable.');

    const again = await submitAsTeacher(token, invoice.id, 'GCASH-1009');
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal(again.body.payment.status, 'pending');
  });
});

// ---------- The teacher-initiated plan change ----------

describe('Teacher plan change', () => {
  test('Pro to Free: the old subscription ends and the unpaid invoice is voided', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: freePlan.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.subscription.plan_name, 'Teacher Free');
    assert.equal(response.body.subscription.status, 'active');

    const oldInvoice = await api().get(`/api/invoices/${invoice.id}`).set(bearer(adminToken));
    assert.equal(oldInvoice.body.invoice.status, 'void');
    assert.equal(oldInvoice.body.invoice.void_reason, 'Plan changed to Teacher Free');

    assert.deepEqual((await myInvoices(token)).filter((item) => item.status === 'unpaid'), []);
  });

  test('Free to Pro the first time starts the 30-day trial, with no invoice', async () => {
    const teacher = await createTeacher();
    await subscribe(teacher.id, freePlan.id, false);
    const token = await teacherToken(teacher);

    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.subscription.status, 'trial');
    assert.equal(response.body.subscription.plan_name, 'Teacher Pro');
    const trialDays = (new Date(response.body.subscription.trial_ends_at) - new Date(response.body.subscription.started_at)) / 86400000;
    assert.equal(Math.round(trialDays), 30);
    assert.deepEqual(await myInvoices(token), []);
  });

  test('a Pro trial is given once: a second Pro subscription pays straight away', async () => {
    const teacher = await createTeacher();
    await subscribe(teacher.id, proPlan.id, true);
    const token = await teacherToken(teacher);

    const toFree = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: freePlan.id });
    assert.equal(toFree.status, 201, JSON.stringify(toFree.body));

    const backToPro = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(backToPro.status, 201, JSON.stringify(backToPro.body));
    assert.equal(backToPro.body.subscription.status, 'past_due');
    assert.equal(backToPro.body.subscription.plan_name, 'Teacher Pro');

    const invoices = await myInvoices(token);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].status, 'unpaid');
    assert.equal(invoices[0].amount, '100.00');
  });

  test('changing to the same plan is refused', async () => {
    const teacher = await createTeacher();
    await subscribe(teacher.id, freePlan.id, false);
    const token = await teacherToken(teacher);
    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: freePlan.id });
    assert.equal(response.status, 400);
  });

  test('changing plan is refused while a payment is waiting for confirmation', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const submitted = await submitAsTeacher(token, invoice.id);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: freePlan.id });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'PAYMENT_PENDING');
  });

  test('changing plan with no current subscription is refused', async () => {
    const teacher = await createTeacher();
    const token = await teacherToken(teacher);
    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'NO_CURRENT_SUBSCRIPTION');
  });

  test('choosing a plan again after a trial expired gives no second trial', async () => {
    const teacher = await createTeacher();
    const subscription = await subscribe(teacher.id, proPlan.id, true);
    const token = await teacherToken(teacher);
    assert.equal(subscription.status, 'trial');

    // The trial ends: the next billing check makes it payable.
    await pool.query(`UPDATE subscriptions SET trial_ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [subscription.id]);
    const pastDue = await mySubscription(token);
    assert.equal(pastDue.status, 'past_due');
    assert.equal((await myInvoices(token)).length, 1);

    // The invoice is not paid by its due date: the subscription expires.
    await pool.query(`UPDATE invoices SET due_date = (NOW() AT TIME ZONE $1)::date - 1 WHERE subscription_id = $2`, [config.timezone, subscription.id]);
    const expired = await mySubscription(token);
    assert.equal(expired.status, 'expired');

    const again = await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal(again.body.subscription.status, 'past_due');
    // The new subscription pays straight away (no second trial) and issues its
    // own invoice. The old invoice stays on the record, still unpaid.
    const invoices = await myInvoices(token);
    assert.equal(invoices.filter((item) => item.status === 'unpaid').length, 2);
    assert.equal(invoices[0].status, 'unpaid');
    assert.equal(invoices[0].amount, '100.00');
  });

  test('past due, then expired: the subscription and its invoice tell the story', async () => {
    const teacher = await createTeacher();
    const subscription = await subscribe(teacher.id, proPlan.id, false);
    const token = await teacherToken(teacher);

    const current = await mySubscription(token);
    assert.equal(current.status, 'past_due');
    const invoices = await myInvoices(token);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].status, 'unpaid');
    assert.equal(invoices[0].amount, '100.00');
    assert.ok(invoices[0].due_date);

    await pool.query(`UPDATE invoices SET due_date = (NOW() AT TIME ZONE $1)::date - 1 WHERE subscription_id = $2`, [config.timezone, subscription.id]);
    const expired = await mySubscription(token);
    assert.equal(expired.status, 'expired');
    void current;
  });
});
