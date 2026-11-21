// Overview counts, activity log, academic year setting, and the payment QR code settings.
// Teacher sign-in lives in teacherAuth.controller.js.
const db = require('../db');
const { logActivity } = require('../utils/activity');
const { notFound } = require('../utils/httpError');
const { config } = require('../config');
const billing = require('../utils/billing');
const { saveImage, deleteImage, sendImage } = require('../utils/uploads');
const deped = require('../utils/deped');
const grading = require('../utils/grading');

// GET /api/overview  (every number comes straight from the database)
async function getOverview(req, res) {
  await billing.ensureBillingUpToDate();
  const counts = await db.query(
    `SELECT
      (SELECT COUNT(*)::int FROM teachers)                                                     AS total_teachers,
      (SELECT COUNT(*)::int FROM teachers WHERE is_restricted)                                 AS restricted_teachers,
      (SELECT COUNT(*)::int FROM schools)                                                      AS total_schools,
      (SELECT COUNT(*)::int FROM teachers WHERE created_at >= date_trunc('month', NOW()))      AS new_signups_this_month,
      (SELECT COUNT(*)::int FROM subscriptions WHERE status IN ('trial', 'active'))            AS active_subscriptions,
      (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'trial')                         AS trial_subscriptions,
      (SELECT COUNT(*)::int FROM payments WHERE status = 'pending')                            AS pending_payments,
      (SELECT COALESCE(SUM(amount), 0)::numeric(12,2) FROM payments
        WHERE status = 'confirmed'
          AND paid_on >= date_trunc('month', NOW() AT TIME ZONE $1)::date
          AND paid_on <  (date_trunc('month', NOW() AT TIME ZONE $1) + INTERVAL '1 month')::date) AS income_this_month`,
    [config.timezone]
  );

  const recentTeachers = await db.query(`
    SELECT t.id, t.first_name, t.last_name, t.username, t.is_restricted, t.created_at, s.name AS school_name
      FROM teachers t JOIN schools s ON s.id = t.school_id
     ORDER BY t.created_at DESC, t.id DESC LIMIT 5
  `);

  const recentActivity = await db.query(`
    SELECT id, admin_name, admin_role, action, description, created_at
      FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 6
  `);

  const year = await db.query("SELECT value FROM settings WHERE key = 'academic_year'");

  res.json({
    counts: counts.rows[0],
    recent_teachers: recentTeachers.rows,
    recent_activity: recentActivity.rows,
    academic_year: year.rows[0] ? year.rows[0].value : null,
  });
}

// GET /api/activity?search=&action=&admin_id=&from=&to=&page=&page_size=
async function listActivity(req, res) {
  const { search, action, admin_id, from, to, page, page_size } = req.valid.query;

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(description ILIKE $${params.length} OR admin_name ILIKE $${params.length})`);
  }
  if (action) {
    // "teacher" matches teacher.create, teacher.update, ... ; "teacher.create" matches only that one.
    params.push(action.includes('.') ? action : `${action}.%`);
    where.push(`action LIKE $${params.length}`);
  }
  if (admin_id) {
    params.push(admin_id);
    where.push(`admin_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`created_at < ($${params.length}::date + 1)`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = await db.query(`SELECT COUNT(*)::int AS count FROM activity_log ${whereSql}`, params);
  const rows = await db.query(
    `SELECT id, admin_id, admin_name, admin_role, action, entity_type, entity_id, description, ip_address, created_at
       FROM activity_log ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );
  const admins = await db.query('SELECT id, full_name, role FROM admins ORDER BY id');

  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size, admins: admins.rows });
}

// The payment QR code settings, read from the settings table.
async function readPaymentSettings(client = db) {
  const result = await client.query(
    `SELECT key, value, updated_at FROM settings WHERE key IN ('payment_qr_path', 'payment_account_name', 'payment_instructions')`
  );
  const byKey = Object.fromEntries(result.rows.map((row) => [row.key, row]));
  const value = (key) => (byKey[key] ? byKey[key].value : '');
  const updatedAt = result.rows.reduce((latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest), null);

  return {
    qr_path: value('payment_qr_path'),
    has_qr: Boolean(value('payment_qr_path')),
    account_name: value('payment_account_name'),
    instructions: value('payment_instructions'),
    updated_at: updatedAt,
  };
}

// What the browser may see: everything except the file path.
const publicPaymentSettings = ({ qr_path, ...rest }) => rest; // eslint-disable-line no-unused-vars

// GET /api/settings
async function getSettings(req, res) {
  const result = await db.query("SELECT value, updated_at FROM settings WHERE key = 'academic_year'");
  const academicYear = result.rows[0].value;
  const profile = await grading.getGradingProfile(db, academicYear);
  res.json({
    academic_year: academicYear,
    academic_year_updated_at: result.rows[0].updated_at,
    grading_profile: profile.code,
    grading: grading.gradingInfo(profile, academicYear),
    grading_profiles: deped.PROFILE_CODES.map((code) => {
      const info = deped.profileFor(code);
      return {
        code,
        label: info.label,
        periods: info.periods,
        period_label: info.periodLabel,
        grade_label: info.gradeLabel,
        third_label: info.thirdLabel,
      };
    }),
    payment: publicPaymentSettings(await readPaymentSettings()),
  });
}

async function saveSetting(client, key, value) {
  await client.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

// PUT /api/settings/payment   (form: account_name, instructions, qr_image?, remove_qr?)
// Saves the payment QR code that teachers see when they pay.
async function updatePaymentSettings(req, res) {
  const { account_name, instructions, remove_qr } = req.valid.body;
  const before = await readPaymentSettings();
  const newQrPath = req.file ? await saveImage(req.file, 'qr', 'qr_image') : null;

  let qrPath = before.qr_path;
  if (newQrPath) qrPath = newQrPath;
  else if (remove_qr) qrPath = '';

  try {
    await db.withTransaction(async (client) => {
      await saveSetting(client, 'payment_qr_path', qrPath);
      await saveSetting(client, 'payment_account_name', account_name);
      await saveSetting(client, 'payment_instructions', instructions);

      let change = 'Updated the payment details';
      if (newQrPath) change = before.has_qr ? 'Replaced the payment QR code' : 'Uploaded the payment QR code';
      else if (remove_qr && before.has_qr) change = 'Removed the payment QR code';
      await logActivity(req, { action: 'settings.payment_qr', entityType: 'settings', description: `${change}${account_name ? ` (account name: ${account_name})` : ''}` }, client);
    });
  } catch (error) {
    await deleteImage(newQrPath);
    throw error;
  }

  // The old image is no longer needed once a new one is saved or it was removed.
  if (before.qr_path && before.qr_path !== qrPath) await deleteImage(before.qr_path);

  res.json({ payment: publicPaymentSettings(await readPaymentSettings()) });
}

// GET /api/settings/payment/qr  (the QR code image, for signed-in admins)
async function getPaymentQrImage(req, res) {
  const settings = await readPaymentSettings();
  if (!settings.qr_path) throw notFound('No payment QR code has been set yet.');
  await sendImage(res, settings.qr_path);
}

// PUT /api/settings/academic-year
async function updateAcademicYear(req, res) {
  const { academic_year } = req.valid.body;
  const result = await db.query(
    `INSERT INTO settings (key, value) VALUES ('academic_year', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING value, updated_at`,
    [academic_year]
  );

  await logActivity(req, { action: 'settings.academic_year', entityType: 'settings', description: `Set the academic year to ${academic_year}` });
  res.json({ academic_year: result.rows[0].value, academic_year_updated_at: result.rows[0].updated_at });
}

// PUT /api/settings/grading-system  { academic_year, profile }
// The grading system for one academic year. Any admin may change it — the
// same permission as changing the academic year. It is refused while grades
// have already been filed for that year (see grading.assertSwitchAllowed):
// filed grades keep the system they were filed under, so the switch can
// never recompute a filed grade.
async function updateGradingSystem(req, res) {
  const { academic_year, profile } = req.valid.body;

  await db.withTransaction(async (client) => {
    await grading.assertSwitchAllowed(client, academic_year);
    await client.query(
      `INSERT INTO grading_profiles (academic_year, profile) VALUES ($1, $2)
       ON CONFLICT (academic_year) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()`,
      [academic_year, profile]
    );
  });

  await logActivity(req, {
    action: 'settings.grading_system',
    entityType: 'settings',
    description: `Set the grading system for ${academic_year} to ${deped.profileLabel(profile, academic_year)}`,
  });
  const updated = await grading.getGradingProfile(db, academic_year);
  res.json({
    academic_year,
    grading_profile: updated.code,
    grading: grading.gradingInfo(updated, academic_year),
  });
}

module.exports = {
  getOverview,
  listActivity,
  getSettings,
  updateAcademicYear,
  updateGradingSystem,
  readPaymentSettings,
  updatePaymentSettings,
  getPaymentQrImage,
};
