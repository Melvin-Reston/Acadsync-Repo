// The subscription rules, in one place.
//
//   One free window per teacher: 30 days from the teacher's first
//   subscription (teachers.trial_ends_at). Teacher Free and the Teacher Pro
//   trial are the same window, not two separate ones. Switching plans
//   never pauses, extends or restarts the window: a teacher who changes
//   plan part-way through only gets what is left of it, and once it has
//   ended a paid plan is payable straight away. Teacher Free can only
//   ever be the teacher's first subscription, so it can never be picked
//   again after it ends or after switching away from it.
//
//   Free plan (price 0, first subscription only) -> active until the window ends, then expired. No invoice.
//   Paid plan inside the window, with a trial -> trial until the window ends, then payable.
//   Paid plan outside the window, or without a trial -> payable straight away.
//   Payable                        -> an invoice is issued and the subscription is "past due" until it is paid.
//   Invoice paid                   -> active for the paid period, then payable again (renewal).
//   Invoice not paid by its due date -> expired (unless a payment is waiting for confirmation).
//
// Every function takes "now" so tests can use fixed dates.
const db = require('../db');
const { config } = require('../config');
const { logSystemActivity } = require('./activity');
const { badRequest } = require('./httpError');

const CURRENT_STATUSES = ['trial', 'active', 'past_due'];

// The free window is 30 days, the same length as the Pro trial.
const TRIAL_WINDOW_DAYS = 30;

const isFree = (row) => Number(row.price) === 0;

// The end of the teacher's free window, creating it when this is the
// teacher's first subscription. Returns null when the window has never
// started (no subscription yet) or when it cannot be created here
// (a teacher with earlier subscriptions but no stored window, which the
// 018 migration backfilled — treat it as already used up).
async function trialWindowEnd(client, teacherId, now) {
  const teacher = await client.query('SELECT trial_ends_at FROM teachers WHERE id = $1 FOR UPDATE', [teacherId]);
  if (teacher.rowCount === 0) return null;
  if (teacher.rows[0].trial_ends_at) return new Date(teacher.rows[0].trial_ends_at);
  const prior = await client.query('SELECT 1 FROM subscriptions WHERE teacher_id = $1 LIMIT 1', [teacherId]);
  if (prior.rowCount > 0) return null;
  const windowEnd = new Date(now.getTime() + TRIAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  await client.query('UPDATE teachers SET trial_ends_at = $2 WHERE id = $1', [teacherId, windowEnd]);
  return windowEnd;
}

// Issues an invoice for one period of a subscription. The amount is the price saved on the subscription.
async function issueInvoice(client, subscription, periodStart) {
  const result = await client.query(
    `INSERT INTO invoices (invoice_number, subscription_id, teacher_id, plan_name, amount, period_start, period_end, issued_at, due_date)
     VALUES (
       'INV-' || to_char($4::timestamptz AT TIME ZONE $6, 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
       $1, $2, $3, $5,
       $4::timestamptz,
       $4::timestamptz + make_interval(months => $7),
       $4::timestamptz,
       ($4::timestamptz AT TIME ZONE $6)::date + $8::int
     )
     RETURNING *`,
    [
      subscription.id,
      subscription.teacher_id,
      subscription.plan_name,
      periodStart,
      subscription.price,
      config.timezone,
      subscription.duration_months,
      config.invoiceDueDays,
    ]
  );
  return result.rows[0];
}

// The subscription now has something to pay: issue the invoice and mark it past due until it is paid.
async function makePayable(client, subscription, periodStart) {
  const invoice = await issueInvoice(client, subscription, periodStart);
  await client.query(
    `UPDATE subscriptions
        SET status = 'past_due', current_period_start = $2, current_period_end = $3, updated_at = NOW()
      WHERE id = $1`,
    [subscription.id, invoice.period_start, invoice.period_end]
  );
  return invoice;
}

// Starts a new subscription for a teacher. The plan's name, price and billing cycle are copied in.
// Teacher Free is refused when the teacher already has any subscription:
// it is once ever, and only as the first subscription. A trial is only
// what is left of the teacher's free window: switching plans mid-window
// keeps the same end date instead of starting a fresh trial.
async function createSubscription(client, { teacherId, plan, withTrial, adminId = null, now = new Date() }) {
  now = new Date(now);
  const prior = await client.query('SELECT 1 FROM subscriptions WHERE teacher_id = $1 LIMIT 1', [teacherId]);
  if (isFree(plan) && prior.rowCount > 0) {
    throw badRequest('Teacher Free can only be chosen once, as the first plan.', {
      code: 'FREE_ALREADY_USED',
      errors: { plan_id: 'Teacher Free can only be chosen once, as the first plan.' },
    });
  }

  const windowEnd = await trialWindowEnd(client, teacherId, now);
  const inWindow = windowEnd !== null && windowEnd > now;
  const useTrial = !isFree(plan) && withTrial && plan.trial_days > 0 && inWindow;
  // A free or trial subscription runs to the end of the window, never past it.
  // A paid subscription without a trial runs its normal period from the start.
  const windowPeriodEnd = isFree(plan) || useTrial ? windowEnd : null;

  const inserted = await client.query(
    `INSERT INTO subscriptions
       (teacher_id, plan_id, plan_name, price, billing_cycle, duration_months, status,
        started_at, trial_ends_at, current_period_start, current_period_end, created_by)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8::timestamptz,
       $9::timestamptz,
       $8::timestamptz,
       CASE WHEN $10::timestamptz IS NOT NULL THEN $10::timestamptz
            ELSE $8::timestamptz + make_interval(months => $6) END,
       $11
     )
     RETURNING *`,
    [
      teacherId,
      plan.id,
      plan.name,
      plan.price,
      plan.billing_cycle,
      plan.duration_months,
      useTrial ? 'trial' : 'active',
      now,
      useTrial ? windowEnd : null,
      windowPeriodEnd,
      adminId,
    ]
  );
  const subscription = inserted.rows[0];

  // A paid plan without a trial must be paid first.
  if (!isFree(plan) && !useTrial) {
    await makePayable(client, subscription, subscription.started_at);
  }

  const fresh = await client.query('SELECT * FROM subscriptions WHERE id = $1', [subscription.id]);
  return fresh.rows[0];
}

async function endSubscription(client, subscription, status, endedAt, reason) {
  await client.query(
    `UPDATE subscriptions SET status = $2, ended_at = $3, end_reason = $4, updated_at = NOW() WHERE id = $1`,
    [subscription.id, status, endedAt, reason]
  );
}

// Brings every subscription up to date for the given moment. Safe to run as often as you like.
async function runBillingCycle(now = new Date()) {
  const summary = { trialsEnded: 0, renewalsDue: 0, expired: 0 };

  await db.withTransaction(async (client) => {
    // 1. Trials that are over become payable.
    const trials = await client.query(
      `SELECT * FROM subscriptions WHERE status = 'trial' AND trial_ends_at <= $1 ORDER BY id FOR UPDATE SKIP LOCKED`,
      [now]
    );
    for (const subscription of trials.rows) {
      const invoice = await makePayable(client, subscription, subscription.trial_ends_at);
      await logSystemActivity(
        { action: 'invoice.issue', entityType: 'invoice', entityId: invoice.id, description: `Trial ended for subscription #${subscription.id} (${subscription.plan_name}). Issued invoice ${invoice.invoice_number}` },
        client
      );
      summary.trialsEnded += 1;
    }

    // 2. Active subscriptions whose period is over.
    const ended = await client.query(
      `SELECT * FROM subscriptions WHERE status = 'active' AND current_period_end <= $1 ORDER BY id FOR UPDATE SKIP LOCKED`,
      [now]
    );
    for (const subscription of ended.rows) {
      if (subscription.billing_cycle === 'one_time') {
        await endSubscription(client, subscription, 'expired', subscription.current_period_end, 'Period ended');
        await logSystemActivity(
          { action: 'subscription.expire', entityType: 'subscription', entityId: subscription.id, description: `Subscription #${subscription.id} (${subscription.plan_name}) expired: period ended` },
          client
        );
        summary.expired += 1;
      } else if (isFree(subscription)) {
        // A free plan that renews simply moves on to its next period.
        await client.query(
          `UPDATE subscriptions
              SET current_period_start = current_period_end,
                  current_period_end = current_period_end + make_interval(months => duration_months),
                  updated_at = NOW()
            WHERE id = $1`,
          [subscription.id]
        );
      } else {
        const invoice = await makePayable(client, subscription, subscription.current_period_end);
        await logSystemActivity(
          { action: 'invoice.issue', entityType: 'invoice', entityId: invoice.id, description: `Renewal due for subscription #${subscription.id} (${subscription.plan_name}). Issued invoice ${invoice.invoice_number}` },
          client
        );
        summary.renewalsDue += 1;
      }
    }

    // 3. Past due subscriptions whose invoice was not paid by its due date expire,
    //    unless a payment is still waiting for confirmation.
    const unpaid = await client.query(
      `SELECT s.*
         FROM subscriptions s
        WHERE s.status = 'past_due'
          AND NOT EXISTS (
            SELECT 1 FROM invoices i
             WHERE i.subscription_id = s.id AND i.status = 'unpaid'
               AND (i.due_date >= ($1::timestamptz AT TIME ZONE $2)::date
                    OR EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'pending'))
          )
        ORDER BY s.id
        FOR UPDATE OF s SKIP LOCKED`,
      [now, config.timezone]
    );
    for (const subscription of unpaid.rows) {
      await endSubscription(client, subscription, 'expired', now, 'Payment not received');
      await logSystemActivity(
        { action: 'subscription.expire', entityType: 'subscription', entityId: subscription.id, description: `Subscription #${subscription.id} (${subscription.plan_name}) expired: payment not received` },
        client
      );
      summary.expired += 1;
    }
  });

  return summary;
}

// Called before billing data is read, so lists are correct even if the timer has not run yet.
let lastRunAt = 0;
async function ensureBillingUpToDate() {
  const minimumGapMs = config.isTest ? 0 : 60 * 1000;
  if (Date.now() - lastRunAt < minimumGapMs) return;
  lastRunAt = Date.now();
  await runBillingCycle();
}

// Runs the billing cycle when the API starts and then every 10 minutes.
function startBillingTimer() {
  const run = () => runBillingCycle().catch((error) => console.error(`Billing check failed: ${error.message}`));
  run();
  const timer = setInterval(run, 10 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = {
  CURRENT_STATUSES,
  TRIAL_WINDOW_DAYS,
  isFree,
  trialWindowEnd,
  issueInvoice,
  makePayable,
  createSubscription,
  endSubscription,
  runBillingCycle,
  ensureBillingUpToDate,
  startBillingTimer,
};
