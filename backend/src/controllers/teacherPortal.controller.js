// Teacher-facing endpoints: announcements, the payment QR code, the teacher's own invoices
// and sending a QR payment, plus the teacher's own profile, dashboard and plan choice.
const db = require('../db');
const { config } = require('../config');
const { badRequest, notFound } = require('../utils/httpError');
const billing = require('../utils/billing');
const { saveImage, deleteImage, sendImage } = require('../utils/uploads');
const { TODAY, resolvePaidOn, lockPayableInvoice } = require('./invoices.controller');
const { readPaymentSettings } = require('./system.controller');
const { findActivePlan, assertNoCurrentSubscription, voidUnpaidInvoices } = require('./subscriptions.controller');
const { fetchTodayClasses } = require('./classes.controller');
const { fetchConsolidationReadiness } = require('./grades.controller');
const { hashPassword, verifyPassword } = require('../utils/passwords');
const { signTeacherToken } = require('../middleware/teacherAuth');
const { logSystemActivity } = require('../utils/activity');
const { publicTeacher } = require('./teacherAuth.controller');

// The teacher's own record with school and current (or latest) subscription.
async function findSelf(teacherId, client = db) {
  const result = await client.query(
    `SELECT t.id, t.first_name, t.last_name, t.email, t.mobile, t.present_address, t.username,
            t.school_id, s.name AS school_name, s.city_region AS school_city_region,
            t.region, t.division, t.deped_school_id, t.school_head_name,
            t.classes_start_date::text AS classes_start_date,
            t.classes_end_date::text AS classes_end_date,
            t.must_change_password, t.is_restricted, t.restriction_reason,
            t.is_adviser, t.advisory_grade, t.advisory_section, t.created_at,
            sub.id AS subscription_id, sub.plan_id, sub.plan_name, sub.price AS plan_price,
            sub.billing_cycle, sub.status AS subscription_status, sub.trial_ends_at,
            sub.current_period_start, sub.current_period_end
       FROM teachers t
       JOIN schools s ON s.id = t.school_id
       LEFT JOIN LATERAL (
         SELECT sub.id, sub.plan_id, sub.plan_name, sub.price, sub.billing_cycle, sub.status,
                sub.trial_ends_at, sub.current_period_start, sub.current_period_end
           FROM subscriptions sub
          WHERE sub.teacher_id = t.id
          ORDER BY (sub.status IN ('trial', 'active', 'past_due')) DESC, sub.created_at DESC, sub.id DESC
          LIMIT 1
       ) sub ON TRUE
      WHERE t.id = $1`,
    [teacherId]
  );
  if (result.rowCount === 0) throw notFound('Teacher not found.');
  return result.rows[0];
}

// The subscription part of findSelf, or null when the teacher never had one.
function subscriptionOf(self) {
  if (!self.subscription_id) return null;
  return {
    id: self.subscription_id,
    plan_id: self.plan_id,
    plan_name: self.plan_name,
    price: self.plan_price,
    billing_cycle: self.billing_cycle,
    status: self.subscription_status,
    trial_ends_at: self.trial_ends_at,
    current_period_start: self.current_period_start,
    current_period_end: self.current_period_end,
  };
}

// GET /api/teacher/me  (the signed-in teacher, their school and their subscription)
async function getMe(req, res) {
  await billing.ensureBillingUpToDate();
  const self = await findSelf(req.teacher.id);
  const year = await db.query("SELECT value FROM settings WHERE key = 'academic_year'");
  res.json({
    teacher: { ...publicTeacher(self), created_at: self.created_at },
    subscription: subscriptionOf(self),
    academic_year: year.rows[0] ? year.rows[0].value : null,
  });
}

// PATCH /api/teacher/me  (only name, email, mobile, address, the school details for DepEd forms,
// and the school calendar dates for SF2)
// The teaching assignment is read-only here: it has its own form (/me/adviser).
async function updateMe(req, res) {
  const forbiddenKeys = [
    'is_adviser',
    'advisory_grade',
    'advisory_section',
    'school_id',
    'username',
    'password',
    'password_hash',
    'is_restricted',
    'must_change_password',
    'restriction_reason',
  ];
  const refused = Object.keys(req.body || {}).filter((key) => forbiddenKeys.includes(key));
  if (refused.length > 0) {
    throw badRequest('Only your name, email, mobile, address, school details and school calendar can be changed here. Your teaching assignment is read-only.', {
      code: 'VALIDATION_ERROR',
      errors: { [refused[0]]: 'This cannot be changed here.' },
    });
  }

  const body = req.valid.body;
  // Only the fields actually sent change. (The optional text fields
  // default to '' when absent, so presence is read from the raw body.)
  const sent = Object.keys(req.body || {});
  const sets = [];
  const values = [];
  const set = (column, value, nullifyEmpty = false) => {
    values.push(value);
    sets.push(nullifyEmpty ? `${column} = NULLIF($${values.length}, '')` : `${column} = $${values.length}`);
  };
  if (sent.includes('first_name')) set('first_name', body.first_name);
  if (sent.includes('last_name')) set('last_name', body.last_name);
  if (sent.includes('email')) set('email', body.email);
  if (sent.includes('mobile')) set('mobile', body.mobile);
  if (sent.includes('present_address')) set('present_address', body.present_address);
  if (sent.includes('region')) set('region', body.region, true);
  if (sent.includes('division')) set('division', body.division, true);
  if (sent.includes('deped_school_id')) set('deped_school_id', body.deped_school_id, true);
  if (sent.includes('school_head_name')) set('school_head_name', body.school_head_name, true);
  // The calendar dates arrive as YYYY-MM-DD, or undefined when the field
  // was sent empty (optionalDate turns '' into undefined) — an empty
  // value clears the date back to unset (NULL). The last day must not
  // come before the first day, counting the date already stored when
  // only one side of the pair is sent.
  const setDate = (column, value) => {
    values.push(value || null);
    sets.push(`${column} = $${values.length}`);
  };
  if (sent.includes('classes_start_date') || sent.includes('classes_end_date')) {
    const current = await db.query(
      'SELECT classes_start_date::text AS classes_start_date, classes_end_date::text AS classes_end_date FROM teachers WHERE id = $1',
      [req.teacher.id]
    );
    const effectiveStart = sent.includes('classes_start_date')
      ? body.classes_start_date || null
      : current.rows[0].classes_start_date;
    const effectiveEnd = sent.includes('classes_end_date')
      ? body.classes_end_date || null
      : current.rows[0].classes_end_date;
    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      throw badRequest('Please check the highlighted fields.', {
        code: 'VALIDATION_ERROR',
        errors: { classes_end_date: 'The last day of classes must be on or after the first day of classes.' },
      });
    }
  }
  if (sent.includes('classes_start_date')) setDate('classes_start_date', body.classes_start_date);
  if (sent.includes('classes_end_date')) setDate('classes_end_date', body.classes_end_date);
  if (sets.length > 0) {
    values.push(req.teacher.id);
    await db.query(
      `UPDATE teachers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
      values,
    );
  }
  const self = await findSelf(req.teacher.id);
  res.json({ teacher: publicTeacher(self) });
}

// PATCH /api/teacher/me/adviser  (adviser status, grade and section)
async function updateAdviser(req, res) {
  const { is_adviser, advisory_grade, advisory_section } = req.valid.body;
  await db.query(
    `UPDATE teachers
        SET is_adviser = $1, advisory_grade = $2, advisory_section = $3, updated_at = NOW()
      WHERE id = $4`,
    [is_adviser, advisory_grade, advisory_section, req.teacher.id]
  );
  const self = await findSelf(req.teacher.id);
  res.json({ teacher: publicTeacher(self) });
}

// POST /api/teacher/change-password
async function changePassword(req, res) {
  const { current_password, new_password } = req.valid.body;

  const result = await db.query('SELECT password_hash, token_version FROM teachers WHERE id = $1', [req.teacher.id]);
  const matches = await verifyPassword(current_password, result.rows[0].password_hash);
  if (!matches) {
    throw badRequest('Current password is incorrect.', { errors: { current_password: 'Current password is incorrect.' } });
  }
  if (current_password === new_password) {
    throw badRequest('Choose a new password that is different from the current one.', {
      errors: { new_password: 'Choose a password that is different from the current one.' },
    });
  }

  // token_version + 1 signs out every other session; a fresh token keeps this one signed in.
  const updated = await db.query(
    `UPDATE teachers SET password_hash = $1, must_change_password = FALSE, token_version = token_version + 1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [await hashPassword(new_password), req.teacher.id]
  );
  const teacher = updated.rows[0];
  await db.query('UPDATE teacher_password_reset_tokens SET used_at = NOW() WHERE teacher_id = $1 AND used_at IS NULL', [teacher.id]);

  res.json({ message: 'Password changed.', token: signTeacherToken(teacher), teacher: publicTeacher(teacher) });
}

// The teacher's holidays, oldest first. Dates come back as YYYY-MM-DD text,
// never as timestamps, so the dashboard and SF2 compare them directly.
async function fetchHolidays(teacherId, client = db) {
  const result = await client.query(
    'SELECT id, date::text AS date, name FROM teacher_holidays WHERE teacher_id = $1 ORDER BY date, id',
    [teacherId]
  );
  return result.rows;
}

// GET /api/teacher/holidays  (the teacher's own holiday list)
async function listHolidays(req, res) {
  res.json({ items: await fetchHolidays(req.teacher.id) });
}

// POST /api/teacher/holidays  { date, name }  (add one holiday; a date can be a holiday only once)
async function addHoliday(req, res) {
  const { date, name } = req.valid.body;
  const existing = await db.query(
    'SELECT id FROM teacher_holidays WHERE teacher_id = $1 AND date = $2',
    [req.teacher.id, date]
  );
  if (existing.rowCount > 0) {
    throw badRequest('Please check the highlighted fields.', {
      code: 'VALIDATION_ERROR',
      errors: { date: 'That date is already a holiday.' },
    });
  }
  const result = await db.query(
    'INSERT INTO teacher_holidays (teacher_id, date, name) VALUES ($1, $2, $3) RETURNING id, date::text AS date, name',
    [req.teacher.id, date, name]
  );
  res.status(201).json({ holiday: result.rows[0] });
}

// DELETE /api/teacher/holidays/:id  (remove one holiday; another teacher's holiday is not found)
async function deleteHoliday(req, res) {
  const result = await db.query(
    'DELETE FROM teacher_holidays WHERE id = $1 AND teacher_id = $2 RETURNING id',
    [req.valid.params.id, req.teacher.id]
  );
  if (result.rowCount === 0) throw notFound('Holiday not found.');
  res.json({ deleted: true });
}

// GET /api/teacher/dashboard  (everything the dashboard shows: teacher, plan, next invoice, announcements,
// the teacher's classes today and how many classes and learners they have)
async function getDashboard(req, res) {
  await billing.ensureBillingUpToDate();
  const self = await findSelf(req.teacher.id);
  const year = await db.query("SELECT value FROM settings WHERE key = 'academic_year'");

  // The earliest invoice the teacher still has to pay, if any.
  const invoice = await db.query(
    `SELECT id, invoice_number, plan_name, amount, due_date::text AS due_date, issued_at,
            (status = 'unpaid' AND due_date < ${TODAY}) AS is_overdue,
            (SELECT p.status FROM payments p WHERE p.invoice_id = i.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_payment_status
       FROM invoices i
      WHERE i.teacher_id = $1 AND i.status = 'unpaid'
      ORDER BY i.due_date, i.id LIMIT 1`,
    [req.teacher.id]
  );

  const counts = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM classes WHERE teacher_id = $1) AS class_count,
            (SELECT COUNT(*)::int FROM learners WHERE teacher_id = $1) AS learner_count`,
    [req.teacher.id]
  );

  res.json({
    teacher: { ...publicTeacher(self), created_at: self.created_at },
    subscription: subscriptionOf(self),
    next_invoice: invoice.rows[0] || null,
    announcements: await fetchAnnouncements(req.teacher.id),
    academic_year: year.rows[0] ? year.rows[0].value : null,
    class_count: counts.rows[0].class_count,
    learner_count: counts.rows[0].learner_count,
    today_classes: await fetchTodayClasses(req.teacher.id),
    consolidation: await fetchConsolidationReadiness(req.teacher.id),
    holidays: await fetchHolidays(req.teacher.id),
  });
}

// GET /api/teacher/today-classes  (the signed-in teacher's classes today, for the sign-in panel)
// Filled in by Batch 2 from the teacher's real meetings (Asia/Manila time).
async function getTodayClasses(req, res) {
  res.json({ items: await fetchTodayClasses(req.teacher.id) });
}

// POST /api/teacher/subscription/change-plan  { plan_id }  (Change plan: ends the current
// subscription and starts a new one on the chosen plan, following the same billing rules the
// admin's change-plan uses — unpaid invoices are voided, and a payment waiting for confirmation
// blocks the change. A Pro trial is given once, so a teacher who already had one pays straight away.)
async function changeMyPlan(req, res) {
  const { plan_id } = req.valid.body;

  const subscription = await db.withTransaction(async (client) => {
    const current = await client.query(
      `SELECT * FROM subscriptions WHERE teacher_id = $1 AND status IN ('trial', 'active', 'past_due')
        ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [req.teacher.id]
    );
    if (current.rowCount === 0) {
      throw badRequest('You have no current subscription. Choose a plan instead.', { code: 'NO_CURRENT_SUBSCRIPTION' });
    }
    const old = current.rows[0];
    if (old.plan_id === plan_id) {
      throw badRequest('You are already on this plan.', { code: 'VALIDATION_ERROR', errors: { plan_id: 'You are already on this plan.' } });
    }
    const plan = await findActivePlan(plan_id, client);

    await voidUnpaidInvoices(old.id, `Plan changed to ${plan.name}`, client);
    await billing.endSubscription(client, old, 'cancelled', new Date(), `Changed plan to ${plan.name}`);
    const created = await billing.createSubscription(client, {
      teacherId: req.teacher.id,
      plan,
      withTrial: !(await billing.hasHadTrial(client, req.teacher.id)),
    });
    await logSystemActivity(
      {
        action: 'subscription.change_plan',
        entityType: 'subscription',
        entityId: created.id,
        description: `Teacher ${req.teacher.first_name} ${req.teacher.last_name} changed their plan from ${old.plan_name} to ${plan.name}${created.status === 'trial' ? ', starting with a trial' : ''}`,
      },
      client
    );
    return created;
  });

  res.status(201).json({ subscription });
}

// GET /api/teacher/subscription  (the signed-in teacher's current or latest subscription)
async function getMySubscription(req, res) {
  await billing.ensureBillingUpToDate();
  const self = await findSelf(req.teacher.id);
  res.json({ subscription: subscriptionOf(self) });
}

// POST /api/teacher/subscription  { plan_id }  (Choose Plan: starts the teacher's subscription)
async function createMySubscription(req, res) {
  const { plan_id } = req.valid.body;
  const plan = await findActivePlan(plan_id);

  const subscription = await db.withTransaction(async (client) => {
    await assertNoCurrentSubscription(req.teacher.id, client);
    // A trial is given once: a teacher who already had one pays straight away.
    const created = await billing.createSubscription(client, {
      teacherId: req.teacher.id,
      plan,
      withTrial: !(await billing.hasHadTrial(client, req.teacher.id)),
    });
    await logSystemActivity(
      {
        action: 'subscription.create',
        entityType: 'subscription',
        entityId: created.id,
        description: `Teacher ${req.teacher.first_name} ${req.teacher.last_name} chose ${plan.name}${created.status === 'trial' ? ', starting with a trial' : ''}`,
      },
      client
    );
    return created;
  });

  res.status(201).json({ subscription });
}

// A teacher counts as "pro" while they have a current subscription on a paid plan. Everyone else is "free".
async function teacherTier(teacherId) {
  const result = await db.query(
    `SELECT 1 FROM subscriptions WHERE teacher_id = $1 AND status IN ('trial', 'active', 'past_due') AND price > 0`,
    [teacherId]
  );
  return result.rowCount > 0 ? 'pro' : 'free';
}

// The announcements that are live today and meant for this teacher.
async function fetchAnnouncements(teacherId) {
  const tier = await teacherTier(teacherId);
  const result = await db.query(
    `SELECT id, title, body, audience, starts_on::text AS starts_on, ends_on::text AS ends_on, created_at
       FROM announcements
      WHERE ends_on >= ${TODAY}
        AND (starts_on IS NULL OR starts_on <= ${TODAY})
        AND audience IN ('all', $1)
      ORDER BY COALESCE(starts_on, created_at::date) DESC, id DESC`,
    [tier]
  );
  return result.rows;
}

// GET /api/teacher/announcements  (only announcements that are live today and meant for this teacher)
async function listMyAnnouncements(req, res) {
  await billing.ensureBillingUpToDate();
  res.json({ items: await fetchAnnouncements(req.teacher.id) });
}

// GET /api/teacher/payment-info  (account name, instructions and whether a QR code is set)
async function getPaymentInfo(req, res) {
  const settings = await readPaymentSettings();
  res.json({ account_name: settings.account_name, instructions: settings.instructions, has_qr: settings.has_qr });
}

// GET /api/teacher/payment-info/qr  (the QR code image)
async function getPaymentQr(req, res) {
  const settings = await readPaymentSettings();
  if (!settings.qr_path) throw notFound('No payment QR code has been set yet.');
  await sendImage(res, settings.qr_path);
}

// GET /api/teacher/invoices  (the signed-in teacher's own invoices)
async function listMyInvoices(req, res) {
  await billing.ensureBillingUpToDate();
  const result = await db.query(
    `SELECT i.id, i.invoice_number, i.plan_name, i.amount, i.period_start, i.period_end, i.status, i.issued_at, i.due_date::text AS due_date, i.paid_at,
            i.voided_at, i.void_reason,
            (i.status = 'unpaid' AND i.due_date < ${TODAY}) AS is_overdue,
            (SELECT p.status FROM payments p WHERE p.invoice_id = i.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_payment_status,
            (SELECT p.rejection_reason FROM payments p WHERE p.invoice_id = i.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_rejection_reason
       FROM invoices i
      WHERE i.teacher_id = $1
      ORDER BY i.issued_at DESC, i.id DESC`,
    [req.teacher.id]
  );
  res.json({ items: result.rows });
}

// GET /api/teacher/invoices/:id  (one of the teacher's own invoices, as a receipt, with its payment history)
async function getMyInvoice(req, res) {
  await billing.ensureBillingUpToDate();
  const { id } = req.valid.params;
  const invoice = await db.query(
    `SELECT i.id, i.invoice_number, i.plan_name, i.amount, i.period_start, i.period_end, i.status, i.issued_at, i.due_date::text AS due_date, i.paid_at,
            i.voided_at, i.void_reason,
            (i.status = 'unpaid' AND i.due_date < ${TODAY}) AS is_overdue,
            (SELECT p.status FROM payments p WHERE p.invoice_id = i.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_payment_status,
            (SELECT p.rejection_reason FROM payments p WHERE p.invoice_id = i.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_rejection_reason
       FROM invoices i
      WHERE i.id = $1 AND i.teacher_id = $2`,
    [id, req.teacher.id]
  );
  if (invoice.rowCount === 0) throw notFound('Invoice not found.');
  const payments = await db.query(
    `SELECT p.id, p.amount, p.reference_number, p.status, p.paid_on::text AS paid_on, p.note,
            p.rejection_reason, p.reviewed_at, p.created_at, (p.screenshot_path IS NOT NULL) AS has_screenshot
       FROM payments p WHERE p.invoice_id = $1 ORDER BY p.created_at DESC, p.id DESC`,
    [id]
  );
  res.json({ invoice: invoice.rows[0], payments: payments.rows });
}

// POST /api/teacher/invoices/:id/payments   (form: reference_number, screenshot, paid_on?, note?)
// The teacher paid by QR code and sends the proof. It waits for an admin to confirm or reject it.
async function submitPayment(req, res) {
  const { id } = req.valid.params;
  const { reference_number, paid_on, note } = req.valid.body;

  if (!req.file) {
    const message = 'Attach a screenshot of your payment.';
    throw badRequest(message, { code: 'VALIDATION_ERROR', errors: { screenshot: message } });
  }
  const paidOn = await resolvePaidOn(paid_on);
  const screenshotPath = await saveImage(req.file, 'payments', 'screenshot');

  let payment;
  try {
    payment = await db.withTransaction(async (client) => {
      // A teacher can only pay their own invoice.
      const owned = await client.query('SELECT id FROM invoices WHERE id = $1 AND teacher_id = $2', [id, req.teacher.id]);
      if (owned.rowCount === 0) throw notFound('Invoice not found.');
      const invoice = await lockPayableInvoice(id, client);

      const inserted = await client.query(
        `INSERT INTO payments (invoice_id, teacher_id, amount, reference_number, screenshot_path, source, status, paid_on, note)
         VALUES ($1, $2, $3, $4, $5, 'teacher', 'pending', $6, $7)
         RETURNING id, invoice_id, amount, reference_number, status, paid_on::text AS paid_on, note, created_at`,
        [invoice.id, req.teacher.id, invoice.amount, reference_number, screenshotPath, paidOn, note]
      );
      return inserted.rows[0];
    });
  } catch (error) {
    await deleteImage(screenshotPath);
    throw error;
  }

  res.status(201).json({ payment, message: 'Payment sent. It will be checked by the administrator.' });
}

module.exports = {
  teacherTier,
  listMyAnnouncements,
  getPaymentInfo,
  getPaymentQr,
  listMyInvoices,
  getMyInvoice,
  submitPayment,
  getMe,
  updateMe,
  updateAdviser,
  changePassword,
  listHolidays,
  addHoliday,
  deleteHoliday,
  fetchHolidays,
  getDashboard,
  getTodayClasses,
  getMySubscription,
  createMySubscription,
  changeMyPlan,
};
