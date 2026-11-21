// The Super User manages the Admin account here. The Admin can never reach these routes,
// and nothing here can change the Super User account.
const db = require('../db');
const { hashPassword, generateTemporaryPassword } = require('../utils/passwords');
const { logActivity } = require('../utils/activity');
const { notFound } = require('../utils/httpError');
const { publicAdmin } = require('./auth.controller');

async function findAdminAccount() {
  const result = await db.query("SELECT * FROM admins WHERE role = 'admin'");
  if (result.rowCount === 0) throw notFound('The Admin account does not exist yet. Run "npm run seed" in the backend.');
  return result.rows[0];
}

function adminAccountView(admin) {
  return {
    ...publicAdmin(admin),
    is_locked: Boolean(admin.locked_until && new Date(admin.locked_until) > new Date()),
    locked_until: admin.locked_until,
    created_at: admin.created_at,
  };
}

// GET /api/admin-account
async function getAdminAccount(req, res) {
  res.json({ admin: adminAccountView(await findAdminAccount()) });
}

// PATCH /api/admin-account
async function updateAdminAccount(req, res) {
  const { full_name, email, is_active } = req.valid.body;
  const before = await findAdminAccount();

  // Disabling the account also signs it out everywhere.
  const result = await db.query(
    `UPDATE admins
        SET full_name = $1, email = $2, is_active = $3,
            token_version = token_version + CASE WHEN is_active AND NOT $3 THEN 1 ELSE 0 END,
            updated_at = NOW()
      WHERE id = $4 RETURNING *`,
    [full_name, email, is_active, before.id]
  );
  const admin = result.rows[0];

  if (before.full_name !== admin.full_name || before.email !== admin.email) {
    await logActivity(req, { action: 'admin.update', entityType: 'admin', entityId: admin.id, description: `Edited the Admin account (${admin.email})` });
  }
  if (before.is_active !== admin.is_active) {
    await logActivity(req, {
      action: admin.is_active ? 'admin.enable' : 'admin.disable',
      entityType: 'admin',
      entityId: admin.id,
      description: `${admin.is_active ? 'Enabled' : 'Disabled'} the Admin account (${admin.email})`,
    });
  }

  res.json({ admin: adminAccountView(admin) });
}

// POST /api/admin-account/reset-password
async function resetAdminPassword(req, res) {
  const before = await findAdminAccount();
  const temporaryPassword = generateTemporaryPassword();

  const result = await db.query(
    `UPDATE admins
        SET password_hash = $1, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL,
            token_version = token_version + 1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [await hashPassword(temporaryPassword), before.id]
  );
  await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE admin_id = $1 AND used_at IS NULL', [before.id]);

  await logActivity(req, { action: 'admin.reset_password', entityType: 'admin', entityId: before.id, description: `Reset the Admin account password (${before.email})` });

  // The temporary password is returned once and is not stored in readable form anywhere.
  res.json({ admin: adminAccountView(result.rows[0]), temporary_password: temporaryPassword });
}

// POST /api/admin-account/unlock
async function unlockAdminAccount(req, res) {
  const before = await findAdminAccount();
  const result = await db.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING *', [before.id]);

  await logActivity(req, { action: 'admin.unlock', entityType: 'admin', entityId: before.id, description: `Unlocked the Admin account (${before.email})` });
  res.json({ admin: adminAccountView(result.rows[0]) });
}

module.exports = { getAdminAccount, updateAdminAccount, resetAdminPassword, unlockAdminAccount };
