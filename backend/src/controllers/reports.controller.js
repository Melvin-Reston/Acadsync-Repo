// Reports: income, subscriptions and teachers per school. Every figure comes from the database.
// Each report takes ?from=YYYY-MM-DD&to=YYYY-MM-DD and can be downloaded with ?format=csv.
const db = require('../db');
const { config } = require('../config');
const { sendCsv } = require('../utils/csv');
const billing = require('../utils/billing');

const TZ = config.timezone;
const MAX_ROWS = 10000;

const BILLING_CYCLE_LABELS = { monthly: 'Monthly', yearly: 'Yearly', one_time: 'One time' };
const STATUS_LABELS = { trial: 'Trial', active: 'Active', past_due: 'Past due', expired: 'Expired', cancelled: 'Cancelled' };

// Without dates, a report covers this month so far.
async function resolveRange(query) {
  const result = await db.query(
    `SELECT date_trunc('month', NOW() AT TIME ZONE $1)::date::text AS month_start, (NOW() AT TIME ZONE $1)::date::text AS today`,
    [TZ]
  );
  return { from: query.from || result.rows[0].month_start, to: query.to || result.rows[0].today };
}

const dateOnly = (value) => (value instanceof Date ? value.toLocaleDateString('en-CA', { timeZone: TZ }) : String(value || '').slice(0, 10));

// GET /api/reports/income
async function incomeReport(req, res) {
  const range = await resolveRange(req.valid.query);

  const rows = await db.query(
    `SELECT p.id, p.paid_on::text AS paid_on, i.invoice_number, i.plan_name, p.reference_number, p.source, p.amount,
            t.first_name || ' ' || t.last_name AS teacher_name, t.username, sc.name AS school_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN teachers t ON t.id = p.teacher_id
       JOIN schools sc ON sc.id = t.school_id
      WHERE p.status = 'confirmed' AND p.paid_on BETWEEN $1::date AND $2::date
      ORDER BY p.paid_on DESC, p.id DESC
      LIMIT ${MAX_ROWS}`,
    [range.from, range.to]
  );

  if (req.valid.query.format === 'csv') {
    return sendCsv(res, `income_${range.from}_to_${range.to}.csv`, [
      { header: 'Date paid', value: (row) => row.paid_on },
      { header: 'Invoice', value: (row) => row.invoice_number },
      { header: 'Teacher', value: (row) => row.teacher_name },
      { header: 'Username', value: (row) => row.username },
      { header: 'School', value: (row) => row.school_name },
      { header: 'Plan', value: (row) => row.plan_name },
      { header: 'Reference number', value: (row) => row.reference_number },
      { header: 'Recorded by', value: (row) => (row.source === 'teacher' ? 'Teacher (QR payment)' : 'Admin (by hand)') },
      { header: 'Amount (PHP)', value: (row) => row.amount },
    ], rows.rows);
  }

  const summary = await db.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total, COUNT(*)::int AS payment_count
       FROM payments WHERE status = 'confirmed' AND paid_on BETWEEN $1::date AND $2::date`,
    [range.from, range.to]
  );
  const byPlan = await db.query(
    `SELECT i.plan_name, COUNT(*)::int AS payment_count, SUM(p.amount)::numeric(12,2) AS total
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.status = 'confirmed' AND p.paid_on BETWEEN $1::date AND $2::date
      GROUP BY i.plan_name ORDER BY total DESC, i.plan_name`,
    [range.from, range.to]
  );

  res.json({ ...range, summary: summary.rows[0], by_plan: byPlan.rows, items: rows.rows });
}

// GET /api/reports/subscriptions  (subscriptions that started in the date range)
async function subscriptionsReport(req, res) {
  await billing.ensureBillingUpToDate();
  const range = await resolveRange(req.valid.query);
  const inRange = `(sub.started_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date`;

  const rows = await db.query(
    `SELECT sub.id, sub.plan_name, sub.price, sub.billing_cycle, sub.status, sub.started_at, sub.current_period_end, sub.ended_at,
            t.first_name || ' ' || t.last_name AS teacher_name, t.username, sc.name AS school_name
       FROM subscriptions sub
       JOIN teachers t ON t.id = sub.teacher_id
       JOIN schools sc ON sc.id = t.school_id
      WHERE ${inRange}
      ORDER BY sub.started_at DESC, sub.id DESC
      LIMIT ${MAX_ROWS}`,
    [range.from, range.to]
  );

  if (req.valid.query.format === 'csv') {
    return sendCsv(res, `subscriptions_${range.from}_to_${range.to}.csv`, [
      { header: 'Started', value: (row) => dateOnly(row.started_at) },
      { header: 'Teacher', value: (row) => row.teacher_name },
      { header: 'Username', value: (row) => row.username },
      { header: 'School', value: (row) => row.school_name },
      { header: 'Plan', value: (row) => row.plan_name },
      { header: 'Price (PHP)', value: (row) => row.price },
      { header: 'Billing cycle', value: (row) => BILLING_CYCLE_LABELS[row.billing_cycle] },
      { header: 'Status', value: (row) => STATUS_LABELS[row.status] },
      { header: 'Current period ends', value: (row) => dateOnly(row.current_period_end) },
      { header: 'Ended', value: (row) => (row.ended_at ? dateOnly(row.ended_at) : '') },
    ], rows.rows);
  }

  const summary = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE sub.status = 'trial')::int     AS trial,
            COUNT(*) FILTER (WHERE sub.status = 'active')::int    AS active,
            COUNT(*) FILTER (WHERE sub.status = 'past_due')::int  AS past_due,
            COUNT(*) FILTER (WHERE sub.status = 'expired')::int   AS expired,
            COUNT(*) FILTER (WHERE sub.status = 'cancelled')::int AS cancelled
       FROM subscriptions sub WHERE ${inRange}`,
    [range.from, range.to]
  );
  const byPlan = await db.query(
    `SELECT sub.plan_name, COUNT(*)::int AS subscription_count
       FROM subscriptions sub WHERE ${inRange}
      GROUP BY sub.plan_name ORDER BY subscription_count DESC, sub.plan_name`,
    [range.from, range.to]
  );

  res.json({ ...range, summary: summary.rows[0], by_plan: byPlan.rows, items: rows.rows });
}

// GET /api/reports/teachers-per-school  (every school; "added" counts teachers added in the date range)
async function teachersPerSchoolReport(req, res) {
  await billing.ensureBillingUpToDate();
  const range = await resolveRange(req.valid.query);

  const rows = await db.query(
    `SELECT sc.id, sc.name, sc.city_region, sc.category, sc.school_type,
            COUNT(t.id)::int AS teacher_count,
            COUNT(t.id) FILTER (WHERE (t.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date)::int AS added_in_range,
            COUNT(t.id) FILTER (WHERE t.is_restricted)::int AS restricted_count,
            COUNT(t.id) FILTER (WHERE EXISTS (
              SELECT 1 FROM subscriptions sub
               WHERE sub.teacher_id = t.id AND sub.status IN ('trial', 'active', 'past_due') AND sub.price > 0
            ))::int AS paid_plan_count
       FROM schools sc
       LEFT JOIN teachers t ON t.school_id = sc.id
      GROUP BY sc.id
      ORDER BY teacher_count DESC, sc.name
      LIMIT ${MAX_ROWS}`,
    [range.from, range.to]
  );

  if (req.valid.query.format === 'csv') {
    return sendCsv(res, `teachers_per_school_${range.from}_to_${range.to}.csv`, [
      { header: 'School', value: (row) => row.name },
      { header: 'City or region', value: (row) => row.city_region },
      { header: 'Category', value: (row) => row.category },
      { header: 'Type', value: (row) => row.school_type },
      { header: 'Teachers', value: (row) => row.teacher_count },
      { header: `Added ${range.from} to ${range.to}`, value: (row) => row.added_in_range },
      { header: 'Restricted', value: (row) => row.restricted_count },
      { header: 'On a paid plan', value: (row) => row.paid_plan_count },
    ], rows.rows);
  }

  const sum = (key) => rows.rows.reduce((total, row) => total + row[key], 0);
  res.json({
    ...range,
    summary: { school_count: rows.rows.length, teacher_count: sum('teacher_count'), added_in_range: sum('added_in_range'), paid_plan_count: sum('paid_plan_count') },
    items: rows.rows,
  });
}

module.exports = { incomeReport, subscriptionsReport, teachersPerSchoolReport };
