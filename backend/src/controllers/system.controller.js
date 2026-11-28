// Overview counts, activity log, academic year setting, and the payment QR code settings.
// Teacher sign-in lives in teacherAuth.controller.js.
const db = require('../db');
const { logActivity } = require('../utils/activity');
const { notFound, badRequest } = require('../utils/httpError');
const { config } = require('../config');
const billing = require('../utils/billing');
const { readImageFile, sendBytes } = require('../utils/uploads');
const branding = require('../utils/branding');
const { DEP_SEAL_KEY, DEP_LOGO_KEY } = branding;
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

// The payment QR code settings. The QR images themselves live in the
// database (branding_images, migration 020), not as files on disk, so
// a redeploy cannot wipe them; only their labels and instructions live
// in the settings table. There are two optional QR codes (for example,
// one e-wallet and one bank).
const PAYMENT_SETTING_KEYS = [
  'payment_label',
  'payment_account_name',
  'payment_instructions',
  'payment_qr2_label',
  'payment_qr2_account_name',
  'payment_qr2_instructions',
];

async function readPaymentSettings(client = db) {
  const result = await client.query(
    `SELECT key, value, updated_at FROM settings WHERE key IN (${PAYMENT_SETTING_KEYS.map((_, i) => `$${i + 1}`).join(', ')})`,
    PAYMENT_SETTING_KEYS,
  );
  const byKey = Object.fromEntries(result.rows.map((row) => [row.key, row]));
  const value = (key) => (byKey[key] ? byKey[key].value : '');
  const updatedAt = result.rows.reduce((latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest), null);
  const flags = await branding.brandingFlags(client);

  return {
    has_qr: flags.has_qr,
    label: value('payment_label'),
    account_name: value('payment_account_name'),
    instructions: value('payment_instructions'),
    has_qr2: flags.has_qr2,
    qr2_label: value('payment_qr2_label'),
    qr2_account_name: value('payment_qr2_account_name'),
    qr2_instructions: value('payment_qr2_instructions'),
    updated_at: updatedAt,
  };
}

// What the browser may see: the payment settings as read above.
const publicPaymentSettings = (settings) => settings;

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

// PUT /api/settings/payment   (form: label, account_name, instructions, qr_image?, remove_qr?,
//   qr2_label, qr2_account_name, qr2_instructions, qr_image2?, remove_qr2?)
// Saves both payment QR codes that teachers see when they pay. One save
// carries both codes, so saving one never wipes the other. Either code may
// be removed on its own. The images are stored in the database, so they
// survive a redeploy; the old file paths in settings are cleared and
// never read again.
async function updatePaymentSettings(req, res) {
  const {
    label,
    account_name,
    instructions,
    remove_qr,
    qr2_label,
    qr2_account_name,
    qr2_instructions,
    remove_qr2,
  } = req.valid.body;
  const before = await readPaymentSettings();
  // The upload middleware puts the files under req.files; accept the old
  // single-file shape too, so nothing else has to change. Both images
  // are checked before anything is saved, so a bad second image cannot
  // leave the first one half-saved.
  const firstFile = req.files?.qr_image?.[0] ?? req.file ?? null;
  const secondFile = req.files?.qr_image2?.[0] ?? null;
  const newQr = firstFile ? readImageFile(firstFile, 'qr_image') : null;
  const newQr2 = secondFile ? readImageFile(secondFile, 'qr_image2') : null;

  await db.withTransaction(async (client) => {
    await saveSetting(client, 'payment_label', label);
    await saveSetting(client, 'payment_account_name', account_name);
    await saveSetting(client, 'payment_instructions', instructions);
    await saveSetting(client, 'payment_qr2_label', qr2_label);
    await saveSetting(client, 'payment_qr2_account_name', qr2_account_name);
    await saveSetting(client, 'payment_qr2_instructions', qr2_instructions);
    // Clear the pre-fix-15 file paths, in case an install upgraded with
    // a QR code already set: the database rows below are the only source now.
    await saveSetting(client, 'payment_qr_path', '');
    await saveSetting(client, 'payment_qr2_path', '');

    if (newQr) await branding.saveBrandingImage(branding.PAYMENT_QR_KEY, newQr, client);
    else if (remove_qr) await branding.deleteBrandingImage(branding.PAYMENT_QR_KEY, client);
    if (newQr2) await branding.saveBrandingImage(branding.PAYMENT_QR2_KEY, newQr2, client);
    else if (remove_qr2) await branding.deleteBrandingImage(branding.PAYMENT_QR2_KEY, client);

    const changes = [];
    if (newQr) changes.push(before.has_qr ? 'Replaced the payment QR code' : 'Uploaded the payment QR code');
    else if (remove_qr && before.has_qr) changes.push('Removed the payment QR code');
    if (newQr2) changes.push(before.has_qr2 ? 'Replaced the second payment QR code' : 'Uploaded the second payment QR code');
    else if (remove_qr2 && before.has_qr2) changes.push('Removed the second payment QR code');
    const change = changes.length > 0 ? changes.join('; ') : 'Updated the payment details';
    await logActivity(req, { action: 'settings.payment_qr', entityType: 'settings', description: `${change}${account_name ? ` (account name: ${account_name})` : ''}` }, client);
  });

  res.json({ payment: publicPaymentSettings(await readPaymentSettings()) });
}

// GET /api/settings/payment/qr  (the first QR code image, for signed-in admins)
async function getPaymentQrImage(req, res) {
  const image = await branding.readBrandingImage(branding.PAYMENT_QR_KEY);
  if (!image) throw notFound('No payment QR code has been set yet.');
  sendBytes(res, image.data, image.mime);
}

// GET /api/settings/payment/qr2  (the second QR code image, for signed-in admins)
async function getSecondPaymentQrImage(req, res) {
  const image = await branding.readBrandingImage(branding.PAYMENT_QR2_KEY);
  if (!image) throw notFound('No second payment QR code has been set yet.');
  sendBytes(res, image.data, image.mime);
}

// ---------- DepEd logos ----------
// The two DepEd logos (the circular seal and the logo) live in the
// database too, seeded from the bundled originals the first time they
// are needed. They almost never change; when DepEd does change one, an
// admin replaces it here, and the replacement is never overwritten by
// a later deploy. Teachers read the same images through their own
// endpoints, so the print forms always use the logos in force.

// GET /api/settings/deped  (whether each DepEd logo is set)
async function getDepedAssets(req, res) {
  await branding.ensureDepedAssets(db);
  const flags = await branding.brandingFlags(db);
  res.json({ has_deped_seal: flags.has_deped_seal, has_deped_logo: flags.has_deped_logo });
}

// GET /api/settings/deped/seal and /api/settings/deped/logo (signed-in admins)
async function getDepedSealImage(req, res) {
  const image = await branding.readDepedImage(DEP_SEAL_KEY);
  if (!image) throw notFound('No DepEd seal has been set yet.');
  sendBytes(res, image.data, image.mime);
}

async function getDepedLogoImage(req, res) {
  const image = await branding.readDepedImage(DEP_LOGO_KEY);
  if (!image) throw notFound('No DepEd logo has been set yet.');
  sendBytes(res, image.data, image.mime);
}

// PUT /api/settings/deped/:kind  (form: image?) — kind is "seal" or "logo".
// Replaces one DepEd logo with the uploaded image.
async function updateDepedAsset(req, res) {
  const kind = req.params.kind;
  const key = kind === 'seal' ? DEP_SEAL_KEY : kind === 'logo' ? DEP_LOGO_KEY : null;
  if (!key) throw notFound('DepEd logo not found.');
  if (!req.file) {
    throw badRequest('Choose an image to upload.', {
      code: 'VALIDATION_ERROR',
      errors: { image: 'Choose an image to upload.' },
    });
  }
  const image = readImageFile(req.file, 'image');
  await branding.saveBrandingImage(key, image);
  const label = kind === 'seal' ? 'DepEd seal' : 'DepEd logo';
  await logActivity(req, { action: 'settings.deped_logo', entityType: 'settings', description: `Replaced the ${label}` });
  const flags = await branding.brandingFlags(db);
  res.json({ has_deped_seal: flags.has_deped_seal, has_deped_logo: flags.has_deped_logo });
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
  getSecondPaymentQrImage,
  getDepedAssets,
  getDepedSealImage,
  getDepedLogoImage,
  updateDepedAsset,
};
