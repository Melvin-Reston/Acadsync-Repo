// Plans & Packages: the plans a teacher can subscribe to, and their prices.
const db = require('../db');
const { logActivity } = require('../utils/activity');
const { notFound, conflict } = require('../utils/httpError');

const peso = (amount) => `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PLAN_COLUMNS = `
  p.id, p.name, p.price, p.billing_cycle, p.duration_months, p.trial_days, p.features,
  p.is_popular, p.is_active, p.sort_order, p.created_at, p.updated_at,
  (SELECT COUNT(*)::int FROM subscriptions s WHERE s.plan_id = p.id) AS subscription_count,
  (SELECT COUNT(*)::int FROM subscriptions s WHERE s.plan_id = p.id AND s.status IN ('trial', 'active', 'past_due')) AS current_subscription_count`;

async function findPlan(id, client = db) {
  const result = await client.query(`SELECT ${PLAN_COLUMNS} FROM plans p WHERE p.id = $1`, [id]);
  if (result.rowCount === 0) throw notFound('Plan not found.');
  return result.rows[0];
}

// GET /api/plans  (admin: every plan, active or not)
async function listPlans(req, res) {
  const result = await db.query(`SELECT ${PLAN_COLUMNS} FROM plans p ORDER BY p.sort_order, p.id`);
  res.json({ items: result.rows });
}

// GET /api/plans/active  (public: for the Choose Plan screen)
async function listActivePlans(req, res) {
  const result = await db.query(
    `SELECT id, name, price, billing_cycle, duration_months, trial_days, features, is_popular, sort_order
       FROM plans WHERE is_active ORDER BY sort_order, id`
  );
  res.json({ items: result.rows });
}

// POST /api/plans
async function createPlan(req, res) {
  const body = req.valid.body;
  const inserted = await db.query(
    `INSERT INTO plans (name, price, billing_cycle, duration_months, trial_days, features, is_popular, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [body.name, body.price, body.billing_cycle, body.duration_months, body.trial_days, body.features, body.is_popular, body.sort_order]
  );
  const plan = await findPlan(inserted.rows[0].id);

  await logActivity(req, { action: 'plan.create', entityType: 'plan', entityId: plan.id, description: `Created plan ${plan.name} at ${peso(plan.price)}` });
  res.status(201).json({ plan });
}

// PATCH /api/plans/:id
// Existing subscriptions and invoices keep the name and price they were created with.
async function updatePlan(req, res) {
  const { id } = req.valid.params;
  const body = req.valid.body;
  const before = await findPlan(id);

  await db.query(
    `UPDATE plans
        SET name = $1, price = $2, billing_cycle = $3, duration_months = $4, trial_days = $5,
            features = $6, is_popular = $7, sort_order = $8, updated_at = NOW()
      WHERE id = $9`,
    [body.name, body.price, body.billing_cycle, body.duration_months, body.trial_days, body.features, body.is_popular, body.sort_order, id]
  );
  const plan = await findPlan(id);

  const priceNote = Number(before.price) !== Number(plan.price) ? `. Price changed from ${peso(before.price)} to ${peso(plan.price)}` : '';
  await logActivity(req, { action: 'plan.update', entityType: 'plan', entityId: id, description: `Edited plan ${plan.name}${priceNote}` });
  res.json({ plan });
}

// POST /api/plans/:id/activate  and  /deactivate
function setPlanActive(isActive) {
  return async (req, res) => {
    const { id } = req.valid.params;
    const before = await findPlan(id);
    if (before.is_active === isActive) throw conflict(isActive ? 'This plan is already active.' : 'This plan is already inactive.');

    await db.query('UPDATE plans SET is_active = $1, updated_at = NOW() WHERE id = $2', [isActive, id]);
    const plan = await findPlan(id);

    await logActivity(req, {
      action: isActive ? 'plan.activate' : 'plan.deactivate',
      entityType: 'plan',
      entityId: id,
      description: `${isActive ? 'Activated' : 'Deactivated'} plan ${plan.name}`,
    });
    res.json({ plan });
  };
}

// DELETE /api/plans/:id  (only a plan that was never used can be deleted)
async function deletePlan(req, res) {
  const { id } = req.valid.params;
  const plan = await findPlan(id);
  if (plan.subscription_count > 0) {
    throw conflict('This plan has subscriptions, so it cannot be deleted. Deactivate it instead.', { code: 'PLAN_IN_USE' });
  }

  await db.query('DELETE FROM plans WHERE id = $1', [id]);
  await logActivity(req, { action: 'plan.delete', entityType: 'plan', entityId: id, description: `Deleted plan ${plan.name}` });
  res.json({ message: 'Plan deleted.' });
}

module.exports = {
  peso,
  findPlan,
  listPlans,
  listActivePlans,
  createPlan,
  updatePlan,
  activatePlan: setPlanActive(true),
  deactivatePlan: setPlanActive(false),
  deletePlan,
};
