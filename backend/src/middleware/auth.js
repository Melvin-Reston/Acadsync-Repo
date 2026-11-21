// Checks the sign-in token on protected routes.
const jwt = require('jsonwebtoken');
const db = require('../db');
const { config } = require('../config');
const { unauthorized, forbidden } = require('../utils/httpError');

function signToken(admin) {
  return jwt.sign({ sub: String(admin.id), role: admin.role, tv: admin.token_version }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// Requires "Authorization: Bearer <token>" and loads the signed-in admin into req.admin.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw unauthorized('Please sign in.', { code: 'NOT_SIGNED_IN' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.', { code: 'SESSION_EXPIRED' });
  }

  // A teacher token is never accepted on admin routes.
  if (payload.kind === 'teacher') throw unauthorized('Please sign in as an administrator.', { code: 'NOT_SIGNED_IN' });

  const result = await db.query(
    `SELECT id, role, full_name, email, is_active, must_change_password, token_version, last_login_at
       FROM admins WHERE id = $1`,
    [Number(payload.sub)]
  );
  const admin = result.rows[0];

  // token_version changes whenever the password changes, which signs out old sessions.
  if (!admin || !admin.is_active || admin.token_version !== payload.tv) {
    throw unauthorized('Your session has ended. Please sign in again.', { code: 'SESSION_EXPIRED' });
  }

  req.admin = admin;
  next();
}

// Use after requireAuth: requireRole('super_user')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.admin.role)) {
      throw forbidden('Only the Super User can do this.', { code: 'FORBIDDEN' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
