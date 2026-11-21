// Subscriptions: one teacher, one plan. There is no whole-school package.
const db = require('../db');
const { logActivity } = require('../utils/activity');
const { notFound, badRequest, conflict } = require('../utils/httpError');
const billing = require('../utils/billing');
const { config } = require('../config');
const { peso } = require('./plans.controller');

const SUBSCRIPTION_COLUMNS = `
  sub.id, sub.teacher_id, sub.plan_id, sub.plan_name, sub.price, sub.billing_cycle, sub.duration_months,
  sub.status, sub.started_at, sub.trial_ends_at, sub.current_period_start, sub.current_period_end,
  sub.ended_at, sub.end_reason, sub.created_at, sub.updated_at,
  t.first_name, t.last_name, t.username, t.email AS teacher_email, t.is_restricted,
  sc.name AS school_name, cb.full_name AS created_by_name,
  (SELECT COUNT(*)::int FROM invoices i WHERE i.subscription_id = sub.id AND i.status = 'unpaid') AS unpaid_invoice_count`;

const SUBSCRIPTION_JOINS = `
  FROM subscriptions sub
  JOIN teachers t ON t.id = sub.teacher_id
  JOIN schools sc ON sc.id = t.school_id
  LEFT JOIN admins cb ON cb.id = sub.created_by`;

const teacherName = (row) => `${row.first_name} ${row.last_name}`;

async function findSubscription(id, client = db) {
  const result = await client.query(`SELECT ${SUBSCRIPTION_COLUMNS} ${SUBSCRIPTION_JOINS} WHERE sub.id = $1`, [id]);
  if (result.rowCount === 0) throw notFound('Subscription not found.');
  return result.rows[0];
}

// Locks the row so two admins cannot change the same subscription at the same moment.
async function lockSubscription(id, client) {
  const result = await client.query('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [id]);
  if (result.rowCount === 0) throw notFound('Subscription not found.');
  return result.rows[0];
}

async function findActivePlan(planId, client = db) {
  const result = await client.query('SELECT * FROM plans WHERE id = $1', [planId]);
  const plan = result.rows[0];
  if (!plan || !plan.is_active) {
    const message = plan ? 'This plan is inactive. Activate it first or choose another plan.' : 'Choose a plan from the list.';
    throw badRequest(message, { code: 'VALIDATION_ERROR', errors: { plan_id: message } });
  }
  return plan;
}

async function assertNoCurrentSubscription(teacherId, client) {
  const result = await client.query(
    `SELECT id, plan_name FROM subscriptions WHERE teacher_id = $1 AND status IN ('trial', 'active', 'past_due')`,
    [teacherId]
  );
  if (result.rowCount > 0) {
    throw conflict(`This teacher already has a current subscription (${result.rows[0].plan_name}). Change its plan or cancel it first.`, {
      code: 'HAS_CURRENT_SUBSCRIPTION',
      subscription_id: result.rows[0].id,
    });
  }
}

// Unpaid invoices of a subscription are no longer owed when it is cancelled, replaced or extended by hand.
async function voidUnpaidInvoices(subscriptionId, reason, client) {
  const pending = await client.query(
    `SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE i.subscription_id = $1 AND i.status = 'unpaid' AND p.status = 'pending'`,
    [subscriptionId]
  );
  if (pending.rowCount > 0) {
    throw conflict('A payment for this subscription is waiting for confirmation. Confirm or reject it first.', { code: 'PAYMENT_PENDING' });
  }
  const voided = await client.query(
    `UPDATE invoices SET status = 'void', voided_at = NOW(), void_reason = $2
      WHERE subscription_id = $1 AND status = 'unpaid' RETURNING invoice_number`,
    [subscriptionId, reason]
  );
  return voided.rows.map((row) => row.invoice_number);
}

// GET /api/subscriptions?search=&plan_id=&teacher_id=&status=&page=&page_size=
async function listSubscriptions(req, res) {
  await billing.ensureBillingUpToDate();
  const { search, plan_id, teacher_id, status, page, page_size } = req.valid.query;

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(t.first_name || ' ' || t.last_name ILIKE $${params.length}
                 OR t.username ILIKE $${params.length}
                 OR t.email ILIKE $${params.length}
                 OR sc.name ILIKE $${params.length})`);
  }
  if (plan_id) {
    params.push(plan_id);
    where.push(`sub.plan_id = $${params.length}`);
  }
  if (teacher_id) {
    params.push(teacher_id);
    where.push(`sub.teacher_id = $${params.length}`);
  }
  if (status === 'current') {
    where.push(`sub.status IN ('trial', 'active', 'past_due')`);
  } else if (status) {
    params.push(status);
    where.push(`sub.status = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = await db.query(`SELECT COUNT(*)::int AS count ${SUBSCRIPTION_JOINS} ${whereSql}`, params);
  const rows = await db.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} ${SUBSCRIPTION_JOINS} ${whereSql}
      ORDER BY sub.created_at DESC, sub.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );
  const counts = await db.query(`
    SELECT COUNT(*) FILTER (WHERE status = 'trial')::int     AS trial,
           COUNT(*) FILTER (WHERE status = 'active')::int    AS active,
           COUNT(*) FILTER (WHERE status = 'past_due')::int  AS past_due,
           COUNT(*) FILTER (WHERE status = 'expired')::int   AS expired,
           COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
      FROM subscriptions`);

  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size, counts: counts.rows[0] });
}

// GET /api/subscriptions/:id  (with its invoices)
async function getSubscription(req, res) {
  await billing.ensureBillingUpToDate();
  const subscription = await findSubscription(req.valid.params.id);
  const invoices = await db.query(
    `SELECT i.id, i.invoice_number, i.plan_name, i.amount, i.period_start, i.period_end, i.status, i.issued_at, i.due_date::text AS due_date, i.paid_at,
            (i.status = 'unpaid' AND i.due_date < (NOW() AT TIME ZONE $2)::date) AS is_overdue
       FROM invoices i WHERE i.subscription_id = $1 ORDER BY i.issued_at DESC, i.id DESC`,
    [subscription.id, config.timezone]
  );
  res.json({ subscription, invoices: invoices.rows });
}

// POST /api/subscriptions   { teacher_id, plan_id, with_trial }
async function createSubscription(req, res) {
  const { teacher_id, plan_id, with_trial } = req.valid.body;

  const id = await db.withTransaction(async (client) => {
    const teacher = await client.query('SELECT id, first_name, last_name FROM teachers WHERE id = $1 FOR UPDATE', [teacher_id]);
    if (teacher.rowCount === 0) {
      throw badRequest('Choose a teacher from the list.', { code: 'VALIDATION_ERROR', errors: { teacher_id: 'Choose a teacher from the list.' } });
    }
    const plan = await findActivePlan(plan_id, client);
    await assertNoCurrentSubscription(teacher_id, client);

    const subscription = await billing.createSubscription(client, { teacherId: teacher_id, plan, withTrial: with_trial, adminId: req.admin.id });
    await logActivity(
      req,
      {
        action: 'subscription.create',
        entityType: 'subscription',
        entityId: subscription.id,
        description: `Added a ${plan.name} subscription (${peso(plan.price)}) for ${teacherName(teacher.rows[0])} by hand${subscription.status === 'trial' ? ', starting with a trial' : ''}`,
      },
      client
    );
    return subscription.id;
  });

  res.status(201).json({ subscription: await findSubscription(id) });
}

// POST /api/subscriptions/:id/extend   { months }
// Gives the teacher more time without an invoice.
async function extendSubscription(req, res) {
  const { id } = req.valid.params;
  const { months } = req.valid.body;

  await db.withTransaction(async (client) => {
    const subscription = await lockSubscription(id, client);
    const view = await findSubscription(id, client);

    if (subscription.status === 'cancelled') {
      throw conflict('A cancelled subscription cannot be extended. Add a new subscription instead.');
    }

    if (subscription.status === 'trial') {
      await client.query(
        `UPDATE subscriptions
            SET trial_ends_at = trial_ends_at + make_interval(months => $2),
                current_period_end = current_period_end + make_interval(months => $2), updated_at = NOW()
          WHERE id = $1`,
        [id, months]
      );
    } else if (subscription.status === 'active') {
      await client.query(
        `UPDATE subscriptions SET current_period_end = current_period_end + make_interval(months => $2), updated_at = NOW() WHERE id = $1`,
        [id, months]
      );
    } else {
      // Past due or expired: the time is given by hand, so an unpaid invoice is no longer owed.
      if (subscription.status === 'expired') await assertNoCurrentSubscription(subscription.teacher_id, client);
      await voidUnpaidInvoices(id, 'Subscription extended by hand', client);
      await client.query(
        `UPDATE subscriptions
            SET status = 'active', ended_at = NULL, end_reason = NULL,
                current_period_start = NOW(), current_period_end = NOW() + make_interval(months => $2), updated_at = NOW()
          WHERE id = $1`,
        [id, months]
      );
    }

    await logActivity(
      req,
      {
        action: 'subscription.extend',
        entityType: 'subscription',
        entityId: id,
        description: `Extended the ${subscription.plan_name} subscription of ${teacherName(view)} by ${months} month(s)`,
      },
      client
    );
  });

  res.json({ subscription: await findSubscription(id) });
}

// POST /api/subscriptions/:id/cancel   { reason }
async function cancelSubscription(req, res) {
  const { id } = req.valid.params;
  const { reason } = req.valid.body;

  await db.withTransaction(async (client) => {
    const subscription = await lockSubscription(id, client);
    const view = await findSubscription(id, client);
    if (!billing.CURRENT_STATUSES.includes(subscription.status)) {
      throw conflict(`This subscription is already ${subscription.status}.`);
    }

    await voidUnpaidInvoices(id, 'Subscription cancelled', client);
    await billing.endSubscription(client, subscription, 'cancelled', new Date(), reason || 'Cancelled by an administrator');

    await logActivity(
      req,
      {
        action: 'subscription.cancel',
        entityType: 'subscription',
        entityId: id,
        description: `Cancelled the ${subscription.plan_name} subscription of ${teacherName(view)}${reason ? `. Reason: ${reason}` : ''}`,
      },
      client
    );
  });

  res.json({ subscription: await findSubscription(id) });
}

// POST /api/subscriptions/:id/change-plan   { plan_id, with_trial }
// Ends the current subscription and starts a new one on the chosen plan, so the history stays clear.
async function changePlan(req, res) {
  const { id } = req.valid.params;
  const { plan_id, with_trial } = req.valid.body;

  const newId = await db.withTransaction(async (client) => {
    const subscription = await lockSubscription(id, client);
    const view = await findSubscription(id, client);
    if (!billing.CURRENT_STATUSES.includes(subscription.status)) {
      throw conflict(`This subscription is ${subscription.status}. Add a new subscription instead.`);
    }
    if (subscription.plan_id === plan_id) {
      throw badRequest('The teacher is already on this plan.', { code: 'VALIDATION_ERROR', errors: { plan_id: 'The teacher is already on this plan.' } });
    }
    const plan = await findActivePlan(plan_id, client);

    await voidUnpaidInvoices(id, `Plan changed to ${plan.name}`, client);
    await billing.endSubscription(client, subscription, 'cancelled', new Date(), `Changed plan to ${plan.name}`);
    const created = await billing.createSubscription(client, { teacherId: subscription.teacher_id, plan, withTrial: with_trial, adminId: req.admin.id });

    await logActivity(
      req,
      {
        action: 'subscription.change_plan',
        entityType: 'subscription',
        entityId: created.id,
        description: `Changed the plan of ${teacherName(view)} from ${subscription.plan_name} to ${plan.name} (${peso(plan.price)})`,
      },
      client
    );
    return created.id;
  });

  res.status(201).json({ subscription: await findSubscription(newId) });
}

module.exports = {
  findSubscription,
  findActivePlan,
  assertNoCurrentSubscription,
  voidUnpaidInvoices,
  listSubscriptions,
  getSubscription,
  createSubscription,
  extendSubscription,
  cancelSubscription,
  changePlan,
};
