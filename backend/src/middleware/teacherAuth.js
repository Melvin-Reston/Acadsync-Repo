// Sign-in token for teachers. Used only by the teacher-facing routes (/api/teacher/...).
// The teacher portal itself is added in a later part.
const jwt = require('jsonwebtoken');
const db = require('../db');
const { config } = require('../config');
const { unauthorized, forbidden } = require('../utils/httpError');

function signTeacherToken(teacher, expiresIn = config.jwtExpiresIn) {
  return jwt.sign({ sub: String(teacher.id), kind: 'teacher', tv: teacher.token_version || 0 }, config.jwtSecret, { expiresIn });
}

// Requires "Authorization: Bearer <teacher token>" and loads the teacher into req.teacher.
async function requireTeacher(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw unauthorized('Please sign in.', { code: 'NOT_SIGNED_IN' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.', { code: 'SESSION_EXPIRED' });
  }
  // An admin token is not accepted here.
  if (payload.kind !== 'teacher') throw unauthorized('Please sign in as a teacher.', { code: 'NOT_SIGNED_IN' });

  const result = await db.query(
    'SELECT id, first_name, last_name, email, username, is_restricted, restriction_reason, token_version FROM teachers WHERE id = $1',
    [Number(payload.sub)]
  );
  const teacher = result.rows[0];
  if (!teacher) throw unauthorized('Your session has ended. Please sign in again.', { code: 'SESSION_EXPIRED' });
  // token_version changes when the teacher changes their password, which signs out old sessions.
  // Tokens from before token_version existed carry no tv and are still accepted.
  if (payload.tv !== undefined && payload.tv !== teacher.token_version) {
    throw unauthorized('Your session has ended. Please sign in again.', { code: 'SESSION_EXPIRED' });
  }
  if (teacher.is_restricted) {
    throw forbidden('Your account is restricted. Please contact the administrator.', { code: 'ACCOUNT_RESTRICTED', reason: teacher.restriction_reason });
  }

  req.teacher = teacher;
  next();
}

module.exports = { signTeacherToken, requireTeacher };
