// Payments & Invoices: what each teacher owes, what was paid, and QR payments waiting for confirmation.
const db = require('../db');
const { config } = require('../config');
const { logActivity } = require('../utils/activity');
const { notFound, badRequest, conflict } = require('../utils/httpError');
const billing = require('../utils/billing');
const { saveImage, deleteImage, sendImage } = require('../utils/uploads');
const { peso } = require('./plans.controller');

// "today" in the school's timezone, as SQL.
const TODAY = `(NOW() AT TIME ZONE '${config.timezone}')::date`;

const INVOICE_COLUMNS = `
  i.id, i.invoice_number, i.subscription_id, i.teacher_id, i.plan_name, i.amount, i.period_start, i.period_end,
  i.status, i.issued_at, i.due_date::text AS due_date, i.paid_at, i.voided_at, i.void_reason,
  (i.status = 'unpaid' AND i.due_date < ${TODAY}) AS is_overdue,
  t.first_name, t.last_name, t.username, sc.name AS school_name,
  EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'pending') AS has_pending_payment`;

const INVOICE_JOINS = `
  FROM invoices i
  JOIN teachers t ON t.id = i.teacher_id
  JOIN schools sc ON sc.id = t.school_id`;

const PAYMENT_COLUMNS = `
  p.id, p.invoice_id, p.teacher_id, p.amount, p.reference_number, p.source, p.status, p.paid_on::text AS paid_on, p.note,
  p.rejection_reason, p.reviewed_at, p.created_at, (p.screenshot_path IS NOT NULL) AS has_screenshot,
  rb.full_name AS reviewed_by_name,
  i.invoice_number, i.plan_name, i.subscription_id, i.status AS invoice_status,
  t.first_name, t.last_name, t.username, sc.name AS school_name`;

const PAYMENT_JOINS = `
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  JOIN teachers t ON t.id = p.teacher_id
  JOIN schools sc ON sc.id = t.school_id
  LEFT JOIN admins rb ON rb.id = p.reviewed_by`;

const teacherName = (row) => `${row.first_name} ${row.last_name}`;

async function findInvoice(id, client = db) {
  const result = await client.query(`SELECT ${INVOICE_COLUMNS} ${INVOICE_JOINS} WHERE i.id = $1`, [id]);
  if (result.rowCount === 0) throw notFound('Invoice not found.');
  return result.rows[0];
}

async function findPayment(id, client = db) {
  const result = await client.query(`SELECT ${PAYMENT_COLUMNS} ${PAYMENT_JOINS} WHERE p.id = $1`, [id]);
  if (result.rowCount === 0) throw notFound('Payment not found.');
  return result.rows[0];
}

// ---------- Shared steps ----------

// The date a payment was made. Defaults to today and cannot be in the future.
async function resolvePaidOn(paidOn) {
  const result = await db.query(`SELECT ${TODAY}::text AS today`);
  const today = result.rows[0].today;
  if (paidOn && paidOn > today) {
    throw badRequest('The payment date cannot be in the future.', { code: 'VALIDATION_ERROR', errors: { paid_on: 'The payment date cannot be in the future.' } });
  }
  return paidOn || today;
}

// Locks an invoice and checks that it can still take a payment.
async function lockPayableInvoice(invoiceId, client) {
  const result = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
  const invoice = result.rows[0];
  if (!invoice) throw notFound('Invoice not found.');
  if (invoice.status !== 'unpaid') throw conflict(`This invoice is already ${invoice.status}.`, { code: 'INVOICE_NOT_PAYABLE' });

  const pending = await client.query(`SELECT 1 FROM payments WHERE invoice_id = $1 AND status = 'pending'`, [invoiceId]);
  if (pending.rowCount > 0) {
    throw conflict('A payment for this invoice is already waiting for confirmation.', { code: 'PAYMENT_PENDING' });
  }
  return invoice;
}

// A confirmed payment marks the invoice paid and makes the subscription active for the paid period.
async function applyConfirmedPayment(invoice, client) {
  const subscription = (await client.query('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [invoice.subscription_id])).rows[0];

  if (subscription.status === 'expired') {
    // Paid after the subscription expired: it starts again today for one full period.
    const other = await client.query(
      `SELECT 1 FROM subscriptions WHERE teacher_id = $1 AND status IN ('trial', 'active', 'past_due')`,
      [subscription.teacher_id]
    );
    if (other.rowCount > 0) {
      throw conflict('This teacher already has another current subscription. Void this invoice instead.', { code: 'HAS_CURRENT_SUBSCRIPTION' });
    }
    await client.query(
      `UPDATE invoices SET period_start = NOW(), period_end = NOW() + make_interval(months => $2) WHERE id = $1`,
      [invoice.id, subscription.duration_months]
    );
    await client.query(
      `UPDATE subscriptions
          SET status = 'active', ended_at = NULL, end_reason = NULL,
              current_period_start = NOW(), current_period_end = NOW() + make_interval(months => duration_months), updated_at = NOW()
        WHERE id = $1`,
      [subscription.id]
    );
  } else if (subscription.status === 'past_due') {
    await client.query(
      `UPDATE subscriptions SET status = 'active', current_period_start = $2, current_period_end = $3, updated_at = NOW() WHERE id = $1`,
      [subscription.id, invoice.period_start, invoice.period_end]
    );
  }

  await client.query(`UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = $1`, [invoice.id]);
}

// ---------- Invoices ----------

// GET /api/invoices?search=&status=&teacher_id=&subscription_id=&from=&to=&page=&page_size=
async function listInvoices(req, res) {
  await billing.ensureBillingUpToDate();
  const { search, status, teacher_id, subscription_id, from, to, page, page_size } = req.valid.query;

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(i.invoice_number ILIKE $${params.length}
                 OR t.first_name || ' ' || t.last_name ILIKE $${params.length}
                 OR t.username ILIKE $${params.length})`);
  }
  if (status === 'overdue') where.push(`i.status = 'unpaid' AND i.due_date < ${TODAY}`);
  else if (status) {
    params.push(status);
    where.push(`i.status = $${params.length}`);
  }
  if (teacher_id) {
    params.push(teacher_id);
    where.push(`i.teacher_id = $${params.length}`);
  }
  if (subscription_id) {
    params.push(subscription_id);
    where.push(`i.subscription_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`(i.issued_at AT TIME ZONE '${config.timezone}')::date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`(i.issued_at AT TIME ZONE '${config.timezone}')::date <= $${params.length}::date`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = await db.query(`SELECT COUNT(*)::int AS count ${INVOICE_JOINS} ${whereSql}`, params);
  const rows = await db.query(
    `SELECT ${INVOICE_COLUMNS} ${INVOICE_JOINS} ${whereSql}
      ORDER BY i.issued_at DESC, i.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );

  // Totals for all invoices, whatever the filters are.
  const totals = await db.query(`
    SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)::numeric(12,2)                          AS outstanding,
           COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid' AND due_date < ${TODAY}), 0)::numeric(12,2) AS overdue,
           COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric(12,2)                            AS paid,
           COUNT(*) FILTER (WHERE status = 'unpaid')::int                                                    AS outstanding_count,
           COUNT(*) FILTER (WHERE status = 'unpaid' AND due_date < ${TODAY})::int                           AS overdue_count,
           COUNT(*) FILTER (WHERE status = 'paid')::int                                                      AS paid_count
      FROM invoices`);

  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size, totals: totals.rows[0] });
}

// GET /api/invoices/:id  (with its payments)
async function getInvoice(req, res) {
  const invoice = await findInvoice(req.valid.params.id);
  const payments = await db.query(`SELECT ${PAYMENT_COLUMNS} ${PAYMENT_JOINS} WHERE p.invoice_id = $1 ORDER BY p.created_at DESC, p.id DESC`, [invoice.id]);
  res.json({ invoice, payments: payments.rows });
}

// POST /api/invoices/:id/void   { reason }
async function voidInvoice(req, res) {
  const { id } = req.valid.params;
  const { reason } = req.valid.body;

  await db.withTransaction(async (client) => {
    const invoice = await lockPayableInvoice(id, client);
    const view = await findInvoice(id, client);

    await client.query(`UPDATE invoices SET status = 'void', voided_at = NOW(), void_reason = $2 WHERE id = $1`, [id, reason]);

    // Nothing is left to pay, so a subscription that was waiting for this payment ends.
    const subscription = (await client.query('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [invoice.subscription_id])).rows[0];
    if (subscription.status === 'past_due') {
      await billing.endSubscription(client, subscription, 'expired', new Date(), 'Invoice voided');
    }

    await logActivity(
      req,
      { action: 'invoice.void', entityType: 'invoice', entityId: id, description: `Voided invoice ${invoice.invoice_number} (${peso(invoice.amount)}) of ${teacherName(view)}. Reason: ${reason}` },
      client
    );
  });

  res.json({ invoice: await findInvoice(id) });
}

// POST /api/invoices/:id/payments   (form: reference_number, paid_on?, note?, screenshot?)
// The admin records a payment by hand. It counts as confirmed straight away.
async function recordPayment(req, res) {
  const { id } = req.valid.params;
  const { reference_number, paid_on, note } = req.valid.body;
  const paidOn = await resolvePaidOn(paid_on);
  const screenshotPath = req.file ? await saveImage(req.file, 'payments', 'screenshot') : null;

  let paymentId;
  try {
    paymentId = await db.withTransaction(async (client) => {
      const invoice = await lockPayableInvoice(id, client);
      const view = await findInvoice(id, client);

      const inserted = await client.query(
        `INSERT INTO payments (invoice_id, teacher_id, amount, reference_number, screenshot_path, source, status, paid_on, note, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, 'admin', 'confirmed', $6, $7, $8, NOW()) RETURNING id`,
        [invoice.id, invoice.teacher_id, invoice.amount, reference_number, screenshotPath, paidOn, note, req.admin.id]
      );
      await applyConfirmedPayment(invoice, client);

      await logActivity(
        req,
        {
          action: 'payment.record',
          entityType: 'payment',
          entityId: inserted.rows[0].id,
          description: `Recorded a payment of ${peso(invoice.amount)} by hand for invoice ${invoice.invoice_number} of ${teacherName(view)} (ref. ${reference_number})`,
        },
        client
      );
      return inserted.rows[0].id;
    });
  } catch (error) {
    await deleteImage(screenshotPath); // do not leave a file behind when nothing was saved
    throw error;
  }

  res.status(201).json({ payment: await findPayment(paymentId), invoice: await findInvoice(id) });
}

// ---------- Payments ----------

// GET /api/payments?search=&status=&source=&from=&to=&page=&page_size=
async function listPayments(req, res) {
  const { search, status, source, from, to, page, page_size } = req.valid.query;

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(p.reference_number ILIKE $${params.length}
                 OR i.invoice_number ILIKE $${params.length}
                 OR t.first_name || ' ' || t.last_name ILIKE $${params.length}
                 OR t.username ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }
  if (source) {
    params.push(source);
    where.push(`p.source = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`p.paid_on >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`p.paid_on <= $${params.length}::date`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = await db.query(`SELECT COUNT(*)::int AS count ${PAYMENT_JOINS} ${whereSql}`, params);
  const rows = await db.query(
    `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_JOINS} ${whereSql}
      ORDER BY (p.status = 'pending') DESC, p.created_at DESC, p.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );
  const pending = await db.query(`SELECT COUNT(*)::int AS count FROM payments WHERE status = 'pending'`);

  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size, pending_count: pending.rows[0].count });
}

// GET /api/payments/:id
async function getPayment(req, res) {
  res.json({ payment: await findPayment(req.valid.params.id) });
}

// GET /api/payments/:id/screenshot  (signed-in admins only)
async function getPaymentScreenshot(req, res) {
  const result = await db.query('SELECT screenshot_path FROM payments WHERE id = $1', [req.valid.params.id]);
  if (result.rowCount === 0) throw notFound('Payment not found.');
  await sendImage(res, result.rows[0].screenshot_path);
}

async function lockPendingPayment(id, client) {
  const result = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [id]);
  const payment = result.rows[0];
  if (!payment) throw notFound('Payment not found.');
  if (payment.status !== 'pending') throw conflict(`This payment is already ${payment.status}.`, { code: 'PAYMENT_REVIEWED' });
  return payment;
}

// POST /api/payments/:id/confirm
// Confirming keeps the screenshot: the image stays with the payment record so
// the proof can be re-checked later. The payment record itself (reference
// number, amount, who confirmed it and when) is kept as well.
async function confirmPayment(req, res) {
  const { id } = req.valid.params;

  await db.withTransaction(async (client) => {
    const payment = await lockPendingPayment(id, client);
    const view = await findPayment(id, client);
    const invoice = (await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [payment.invoice_id])).rows[0];
    if (invoice.status !== 'unpaid') throw conflict(`The invoice of this payment is already ${invoice.status}.`, { code: 'INVOICE_NOT_PAYABLE' });

    await client.query(`UPDATE payments SET status = 'confirmed', reviewed_by = $2, reviewed_at = NOW() WHERE id = $1`, [id, req.admin.id]);
    await applyConfirmedPayment(invoice, client);

    await logActivity(
      req,
      {
        action: 'payment.confirm',
        entityType: 'payment',
        entityId: id,
        description: `Confirmed the payment of ${peso(payment.amount)} from ${teacherName(view)} for invoice ${invoice.invoice_number} (ref. ${payment.reference_number})`,
      },
      client
    );
  });

  res.json({ payment: await findPayment(id) });
}

// POST /api/payments/:id/reject   { reason }
async function rejectPayment(req, res) {
  const { id } = req.valid.params;
  const { reason } = req.valid.body;

  await db.withTransaction(async (client) => {
    const payment = await lockPendingPayment(id, client);
    const view = await findPayment(id, client);

    await client.query(
      `UPDATE payments SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW() WHERE id = $1`,
      [id, reason, req.admin.id]
    );
    await logActivity(
      req,
      {
        action: 'payment.reject',
        entityType: 'payment',
        entityId: id,
        description: `Rejected the payment from ${teacherName(view)} for invoice ${view.invoice_number} (ref. ${payment.reference_number}). Reason: ${reason}`,
      },
      client
    );
  });

  res.json({ payment: await findPayment(id) });
}

module.exports = {
  TODAY,
  findInvoice,
  findPayment,
  resolvePaidOn,
  lockPayableInvoice,
  listInvoices,
  getInvoice,
  voidInvoice,
  recordPayment,
  listPayments,
  getPayment,
  getPaymentScreenshot,
  confirmPayment,
  rejectPayment,
};
