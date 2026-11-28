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

// ---------- The screenshot is deleted on approval, kept on rejection ----------

describe('Payment screenshot deleted on approval', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  async function screenshotPath(paymentId) {
    const row = await pool.query('SELECT screenshot_path FROM payments WHERE id = $1', [paymentId]);
    assert.equal(row.rowCount, 1);
    return row.rows[0].screenshot_path;
  }

  function storedFile(storedPath) {
    return storedPath ? path.join(config.uploadDir, storedPath) : null;
  }

  test('a confirmed payment deletes its screenshot but keeps its text record', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const submitted = await submitAsTeacher(token, invoice.id);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const paymentId = submitted.body.payment.id;

    // While pending, the admin can see the screenshot.
    const pending = await api().get(`/api/payments/${paymentId}`).set(bearer(adminToken));
    assert.equal(pending.body.payment.has_screenshot, true);
    assert.equal((await api().get(`/api/payments/${paymentId}/screenshot`).set(bearer(adminToken))).status, 200);
    const before = await screenshotPath(paymentId);
    const file = storedFile(before);
    assert.ok(file && fs.existsSync(file), 'screenshot file should exist while pending');

    const confirmed = await api().post(`/api/payments/${paymentId}/confirm`).set(bearer(adminToken));
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.payment.has_screenshot, false);

    // The image and its path are gone, but the text record stays.
    assert.equal(await screenshotPath(paymentId), null);
    assert.equal(fs.existsSync(file), false, 'screenshot file should be deleted after confirm');
    assert.equal((await api().get(`/api/payments/${paymentId}/screenshot`).set(bearer(adminToken))).status, 404);
    const again = await api().get(`/api/payments/${paymentId}`).set(bearer(adminToken));
    assert.equal(again.body.payment.status, 'confirmed');
    assert.equal(again.body.payment.reference_number, 'GCASH-1001');
    assert.equal(again.body.payment.amount, '100.00');
  });

  test('a rejected payment keeps its screenshot for re-checking', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const submitted = await submitAsTeacher(token, invoice.id);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const paymentId = submitted.body.payment.id;

    const rejected = await api()
      .post(`/api/payments/${paymentId}/reject`)
      .set(bearer(adminToken))
      .send({ reason: 'The screenshot is unreadable.' });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.payment.has_screenshot, true);

    const file = storedFile(await screenshotPath(paymentId));
    assert.ok(file && fs.existsSync(file), 'screenshot file should still exist after reject');
    assert.equal((await api().get(`/api/payments/${paymentId}/screenshot`).set(bearer(adminToken))).status, 200);
  });
});

// ---------- A second payment QR code ----------

describe('Second payment QR code', () => {
  async function paymentInfo(token) {
    const response = await api().get('/api/teacher/payment-info').set(bearer(token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }

  async function savePayment(token, build) {
    const request = api().put('/api/settings/payment').set(bearer(token));
    build(request);
    return request;
  }

  test('the second QR code starts unset, and its image address answers 404', async () => {
    const { token } = await teacherWithUnpaidInvoice();
    const info = await paymentInfo(token);
    assert.equal(info.has_qr2, false);
    assert.equal(info.qr2_label, '');
    assert.equal(info.qr2_account_name, '');
    assert.equal(info.qr2_instructions, '');

    const teacherQr2 = await api().get('/api/teacher/payment-info/qr2').set(bearer(token));
    assert.equal(teacherQr2.status, 404);
    const adminQr2 = await api().get('/api/settings/payment/qr2').set(bearer(adminToken));
    assert.equal(adminQr2.status, 404);
  });

  test('both QR codes can be uploaded in one save, and both are shown to teachers', async () => {
    const { token } = await teacherWithUnpaidInvoice();

    const saved = await savePayment(adminToken, (request) =>
      request
        .field('label', 'GCash')
        .field('account_name', 'AcadSync GCash')
        .field('instructions', 'Pay with GCash.')
        .attach('qr_image', PNG, 'gcash.png')
        .field('qr2_label', 'BPI')
        .field('qr2_account_name', 'AcadSync BPI')
        .field('qr2_instructions', 'Pay with BPI.')
        .attach('qr_image2', PNG, 'bpi.png'),
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.payment.has_qr, true);
    assert.equal(saved.body.payment.label, 'GCash');
    assert.equal(saved.body.payment.account_name, 'AcadSync GCash');
    assert.equal(saved.body.payment.has_qr2, true);
    assert.equal(saved.body.payment.qr2_label, 'BPI');
    assert.equal(saved.body.payment.qr2_account_name, 'AcadSync BPI');
    assert.equal(saved.body.payment.qr2_instructions, 'Pay with BPI.');

    const info = await paymentInfo(token);
    assert.equal(info.has_qr, true);
    assert.equal(info.label, 'GCash');
    assert.equal(info.has_qr2, true);
    assert.equal(info.qr2_label, 'BPI');

    for (const path of ['/api/teacher/payment-info/qr', '/api/teacher/payment-info/qr2']) {
      const image = await api().get(path).set(bearer(token));
      assert.equal(image.status, 200);
      assert.match(image.headers['content-type'], /image\/png/);
    }
    const adminQr2 = await api().get('/api/settings/payment/qr2').set(bearer(adminToken));
    assert.equal(adminQr2.status, 200);
    assert.match(adminQr2.headers['content-type'], /image\/png/);
  });

  test('saving with no new image keeps both QR codes', async () => {
    await teacherWithUnpaidInvoice();
    const saved = await savePayment(adminToken, (request) =>
      request
        .field('label', 'GCash')
        .field('account_name', 'AcadSync GCash')
        .field('instructions', 'Pay with GCash.')
        .field('qr2_label', 'BPI')
        .field('qr2_account_name', 'AcadSync BPI')
        .field('qr2_instructions', 'Pay with BPI.'),
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.payment.has_qr, true);
    assert.equal(saved.body.payment.has_qr2, true);
  });

  test('removing the second QR code leaves the first one in place', async () => {
    const { token } = await teacherWithUnpaidInvoice();
    const saved = await savePayment(adminToken, (request) =>
      request
        .field('label', 'GCash')
        .field('account_name', 'AcadSync GCash')
        .field('instructions', 'Pay with GCash.')
        .field('qr2_label', 'BPI')
        .field('qr2_account_name', 'AcadSync BPI')
        .field('qr2_instructions', 'Pay with BPI.')
        .field('remove_qr2', 'true'),
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.payment.has_qr, true);
    assert.equal(saved.body.payment.has_qr2, false);

    const first = await api().get('/api/teacher/payment-info/qr').set(bearer(token));
    assert.equal(first.status, 200);
    const second = await api().get('/api/teacher/payment-info/qr2').set(bearer(token));
    assert.equal(second.status, 404);
  });

  test('removing the first QR code leaves the second one in place', async () => {
    const { token } = await teacherWithUnpaidInvoice();
    const saved = await savePayment(adminToken, (request) =>
      request
        .field('label', 'GCash')
        .field('account_name', 'AcadSync GCash')
        .field('instructions', 'Pay with GCash.')
        .field('remove_qr', 'true')
        .field('qr2_label', 'BPI')
        .field('qr2_account_name', 'AcadSync BPI')
        .field('qr2_instructions', 'Pay with BPI.')
        .attach('qr_image2', PNG, 'bpi.png'),
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.payment.has_qr, false);
    assert.equal(saved.body.payment.has_qr2, true);

    const first = await api().get('/api/teacher/payment-info/qr').set(bearer(token));
    assert.equal(first.status, 404);
    const second = await api().get('/api/teacher/payment-info/qr2').set(bearer(token));
    assert.equal(second.status, 200);
  });

  test('a file that is not an image is refused for the second QR code, and nothing changes', async () => {
    const { token } = await teacherWithUnpaidInvoice();
    const before = await paymentInfo(token);
    assert.equal(before.has_qr, false);
    assert.equal(before.has_qr2, true);

    const refused = await savePayment(adminToken, (request) =>
      request
        .field('qr2_label', 'BPI')
        .field('qr2_account_name', 'AcadSync BPI')
        .field('qr2_instructions', 'Pay with BPI.')
        .attach('qr_image2', NOT_AN_IMAGE, 'proof.txt'),
    );
    assert.equal(refused.status, 400);
    assert.ok(refused.body.errors?.qr_image2);

    const after = await paymentInfo(token);
    assert.equal(after.has_qr, false);
    assert.equal(after.has_qr2, true);
    assert.equal(after.qr2_account_name, 'AcadSync BPI');
  });
});

// ---------- The teacher-initiated plan change ----------

describe('Teacher plan change', () => {
  test('changing from Pro to Free is refused: Free is once ever, only as the first plan', async () => {
    const { invoice, token } = await teacherWithUnpaidInvoice();
    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: freePlan.id });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'FREE_ALREADY_USED');

    // Nothing changed: the invoice is still unpaid and the Pro subscription is still current.
    const current = await mySubscription(token);
    assert.equal(current.status, 'past_due');
    assert.deepEqual((await myInvoices(token)).filter((item) => item.status === 'unpaid').map((item) => item.id), [invoice.id]);
  });

  test('Free to Pro the first time starts the trial to the end of the free window, with no invoice', async () => {
    const teacher = await createTeacher();
    await subscribe(teacher.id, freePlan.id, false);
    const token = await teacherToken(teacher);

    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.subscription.status, 'trial');
    assert.equal(response.body.subscription.plan_name, 'Teacher Pro');
    const trialDays = (new Date(response.body.subscription.trial_ends_at) - new Date(response.body.subscription.started_at)) / 86400000;
    assert.equal(Math.round(trialDays), 30);
    // The trial ends when the window the Free plan started ends, not 30 days after the switch.
    const window = await pool.query('SELECT trial_ends_at FROM teachers WHERE id = $1', [teacher.id]);
    assert.equal(new Date(response.body.subscription.trial_ends_at).getTime(), new Date(window.rows[0].trial_ends_at).getTime());
    assert.deepEqual(await myInvoices(token), []);
  });

  test('switching to Pro part-way through the window only gets what is left of it', async () => {
    const teacher = await createTeacher();
    const free = await subscribe(teacher.id, freePlan.id, false);
    const token = await teacherToken(teacher);

    // Eleven days into the window: the Free period started 11 days ago and
    // the window ends 19 days from now.
    await pool.query(`UPDATE subscriptions SET started_at = NOW() - INTERVAL '11 days', current_period_start = NOW() - INTERVAL '11 days' WHERE id = $1`, [free.id]);
    await pool.query(`UPDATE teachers SET trial_ends_at = NOW() + INTERVAL '19 days' WHERE id = $1`, [teacher.id]);

    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.subscription.status, 'trial');
    const window = await pool.query('SELECT trial_ends_at FROM teachers WHERE id = $1', [teacher.id]);
    assert.equal(new Date(response.body.subscription.trial_ends_at).getTime(), new Date(window.rows[0].trial_ends_at).getTime());
    const remaining = (new Date(response.body.subscription.trial_ends_at) - Date.now()) / 86400000;
    assert.ok(remaining > 18 && remaining < 20, `19 days left, got ${remaining}`);
    assert.deepEqual(await myInvoices(token), []);
  });

  test('once the window has ended, switching to Pro pays straight away', async () => {
    const teacher = await createTeacher();
    const free = await subscribe(teacher.id, freePlan.id, false);
    const token = await teacherToken(teacher);

    await pool.query(`UPDATE teachers SET trial_ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [teacher.id]);
    await pool.query(`UPDATE subscriptions SET current_period_end = NOW() + INTERVAL '1 day' WHERE id = $1`, [free.id]);

    const response = await api().post('/api/teacher/subscription/change-plan').set(bearer(token)).send({ plan_id: proPlan.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.subscription.status, 'past_due');
    assert.equal(response.body.subscription.trial_ends_at, null);

    const invoices = await myInvoices(token);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].status, 'unpaid');
    assert.equal(invoices[0].amount, '100.00');
  });

  test('Teacher Free cannot be chosen again after it ends, by the teacher or the admin', async () => {
    const teacher = await createTeacher();
    const free = await subscribe(teacher.id, freePlan.id, false);
    const token = await teacherToken(teacher);

    // The window and the Free period both end.
    await pool.query(`UPDATE teachers SET trial_ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [teacher.id]);
    await pool.query(`UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 minute' WHERE id = $1`, [free.id]);
    assert.equal((await mySubscription(token)).status, 'expired');

    const again = await api().post('/api/teacher/subscription').set(bearer(token)).send({ plan_id: freePlan.id });
    assert.equal(again.status, 400, JSON.stringify(again.body));
    assert.equal(again.body.code, 'FREE_ALREADY_USED');

    const byAdmin = await api().post('/api/subscriptions').set(bearer(adminToken)).send({ teacher_id: teacher.id, plan_id: freePlan.id, with_trial: false });
    assert.equal(byAdmin.status, 400, JSON.stringify(byAdmin.body));
    assert.equal(byAdmin.body.code, 'FREE_ALREADY_USED');
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

    // The trial ends: the next billing check makes it payable. Both the
    // subscription's trial date and the teacher's free window move into
    // the past, as they would when the window really ends.
    await pool.query(`UPDATE subscriptions SET trial_ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [subscription.id]);
    await pool.query(`UPDATE teachers SET trial_ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [teacher.id]);
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
