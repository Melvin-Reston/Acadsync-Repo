// Sign in, own profile, own password, forgot / reset password.
const crypto = require('crypto');
const db = require('../db');
const { config } = require('../config');
const { signToken } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/passwords');
const { logActivity } = require('../utils/activity');
const { sendPasswordResetEmail } = require('../utils/mailer');
const { badRequest, unauthorized, forbidden, HttpError } = require('../utils/httpError');

// The admin details that are safe to send to the browser (never the password hash).
function publicAdmin(admin) {
  return {
    id: admin.id,
    role: admin.role,
    full_name: admin.full_name,
    email: admin.email,
    is_active: admin.is_active,
    must_change_password: admin.must_change_password,
    last_login_at: admin.last_login_at,
  };
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function minutesLeft(date) {
  return Math.max(1, Math.ceil((new Date(date).getTime() - Date.now()) / 60000));
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.valid.body;
  const wrong = 'Incorrect email or password.';

  const result = await db.query('SELECT * FROM admins WHERE email = $1', [email]);
  const admin = result.rows[0];
  if (!admin) throw unauthorized(wrong, { code: 'INVALID_CREDENTIALS' });

  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    const minutes = minutesLeft(admin.locked_until);
    throw new HttpError(423, `Too many wrong attempts. This account is locked. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, {
      code: 'ACCOUNT_LOCKED',
      locked_until: admin.locked_until,
    });
  }

  const passwordIsCorrect = await verifyPassword(password, admin.password_hash);

  if (!passwordIsCorrect) {
    const attempts = admin.failed_attempts + 1;

    if (attempts >= config.maxFailedAttempts) {
      const locked = await db.query(
        `UPDATE admins SET failed_attempts = 0, locked_until = NOW() + ($1 || ' minutes')::interval
          WHERE id = $2 RETURNING locked_until`,
        [String(config.lockMinutes), admin.id]
      );
      await logActivity(req, {
        actor: admin,
        action: 'auth.locked',
        entityType: 'admin',
        entityId: admin.id,
        description: `Account locked for ${config.lockMinutes} minutes after ${config.maxFailedAttempts} wrong passwords`,
      });
      throw new HttpError(423, `Too many wrong attempts. This account is locked for ${config.lockMinutes} minutes.`, {
        code: 'ACCOUNT_LOCKED',
        locked_until: locked.rows[0].locked_until,
      });
    }

    await db.query('UPDATE admins SET failed_attempts = $1 WHERE id = $2', [attempts, admin.id]);
    const left = config.maxFailedAttempts - attempts;
    throw unauthorized(`${wrong} ${left} attempt${left === 1 ? '' : 's'} left before the account is locked.`, {
      code: 'INVALID_CREDENTIALS',
      attempts_left: left,
    });
  }

  if (!admin.is_active) {
    throw forbidden('This account is disabled. Ask the Super User to enable it.', { code: 'ACCOUNT_DISABLED' });
  }

  const updated = await db.query(
    `UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW()
      WHERE id = $1 RETURNING *`,
    [admin.id]
  );
  const signedIn = updated.rows[0];

  await logActivity(req, { actor: signedIn, action: 'auth.login', entityType: 'admin', entityId: signedIn.id, description: 'Signed in' });

  res.json({ token: signToken(signedIn), admin: publicAdmin(signedIn) });
}

// POST /api/auth/logout
async function logout(req, res) {
  await logActivity(req, { action: 'auth.logout', entityType: 'admin', entityId: req.admin.id, description: 'Signed out' });
  res.json({ message: 'Signed out.' });
}

// GET /api/auth/me
async function me(req, res) {
  res.json({ admin: publicAdmin(req.admin) });
}

// PATCH /api/auth/me
async function updateProfile(req, res) {
  const { full_name, email } = req.valid.body;
  const result = await db.query(
    'UPDATE admins SET full_name = $1, email = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
    [full_name, email, req.admin.id]
  );
  const admin = result.rows[0];

  await logActivity(req, { actor: admin, action: 'profile.update', entityType: 'admin', entityId: admin.id, description: 'Updated own profile' });
  res.json({ admin: publicAdmin(admin) });
}

// POST /api/auth/change-password
async function changePassword(req, res) {
  const { current_password, new_password } = req.valid.body;

  const result = await db.query('SELECT password_hash FROM admins WHERE id = $1', [req.admin.id]);
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
    `UPDATE admins SET password_hash = $1, must_change_password = FALSE, token_version = token_version + 1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [await hashPassword(new_password), req.admin.id]
  );
  const admin = updated.rows[0];
  await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE admin_id = $1 AND used_at IS NULL', [admin.id]);

  await logActivity(req, { actor: admin, action: 'password.change', entityType: 'admin', entityId: admin.id, description: 'Changed own password' });
  res.json({ message: 'Password changed.', token: signToken(admin), admin: publicAdmin(admin) });
}

// POST /api/auth/forgot-password
// Always answers the same way, so nobody can use it to find out which emails have accounts.
async function forgotPassword(req, res) {
  const { email } = req.valid.body;
  const result = await db.query('SELECT * FROM admins WHERE email = $1 AND is_active = TRUE', [email]);
  const admin = result.rows[0];

  if (admin) {
    const token = crypto.randomBytes(32).toString('hex');

    // Only the hash is stored. Older unused links stop working.
    await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE admin_id = $1 AND used_at IS NULL', [admin.id]);
    await db.query(
      `INSERT INTO password_reset_tokens (admin_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
      [admin.id, sha256(token), String(config.resetTokenMinutes)]
    );

    await logActivity(req, {
      actor: admin,
      action: 'password.reset_requested',
      entityType: 'admin',
      entityId: admin.id,
      description: 'Requested a password reset link',
    });

    try {
      await sendPasswordResetEmail(admin, `${config.frontendUrl}/reset-password?token=${token}`);
    } catch (error) {
      console.error('Could not send the password reset email:', error.message);
    }
  }

  res.json({ message: 'If that email belongs to an admin account, a reset link has been sent.' });
}

// POST /api/auth/reset-password
async function resetPassword(req, res) {
  const { token, new_password } = req.valid.body;
  const invalid = () => badRequest('This reset link is not valid or has expired. Request a new one.', { code: 'INVALID_RESET_TOKEN' });

  const admin = await db.withTransaction(async (client) => {
    // Marking the token as used and checking it happen in one step, so it can never work twice.
    const used = await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        RETURNING admin_id`,
      [sha256(token)]
    );
    if (used.rowCount === 0) throw invalid();

    const updated = await client.query(
      `UPDATE admins
          SET password_hash = $1, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL,
              token_version = token_version + 1, updated_at = NOW()
        WHERE id = $2 AND is_active = TRUE
        RETURNING *`,
      [await hashPassword(new_password), used.rows[0].admin_id]
    );
    if (updated.rowCount === 0) throw invalid();

    await logActivity(
      req,
      { actor: updated.rows[0], action: 'password.reset_completed', entityType: 'admin', entityId: updated.rows[0].id, description: 'Set a new password with a reset link' },
      client
    );
    return updated.rows[0];
  });

  res.json({ message: 'Password updated. You can now sign in.', email: admin.email });
}

module.exports = { login, logout, me, updateProfile, changePassword, forgotPassword, resetPassword, publicAdmin };
