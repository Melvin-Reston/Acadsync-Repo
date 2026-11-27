// Teacher sign-in and public sign-up. Admin accounts never use these routes.
// The teacher's own pages and profile live in teacherPortal.controller.js.
const crypto = require('crypto');
const db = require('../db');
const { config } = require('../config');
const { signTeacherToken } = require('../middleware/teacherAuth');
const { hashPassword, verifyPassword } = require('../utils/passwords');
const { logSystemActivity } = require('../utils/activity');
const { sendPasswordResetEmail } = require('../utils/mailer');
const { badRequest, unauthorized, forbidden, HttpError } = require('../utils/httpError');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function minutesLeft(date) {
  return Math.max(1, Math.ceil((new Date(date).getTime() - Date.now()) / 60000));
}

// The username is derived from the email address, so a teacher never has to invent one.
// "mreston103@gmail.com" -> "mreston103". When it is taken, a number is added: "mreston1031".
async function deriveUsername(email, client = db) {
  let base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  if (base.length < 3) base = `teacher${base}`;
  if (base.length > 30) base = base.slice(0, 30);
  if (base.length === 0) base = 'teacher';

  let candidate = base;
  let suffix = 1;
  for (;;) {
    const taken = await client.query('SELECT 1 FROM teachers WHERE username = $1', [candidate]);
    if (taken.rowCount === 0) return candidate;
    suffix += 1;
    candidate = `${base.slice(0, 30 - String(suffix).length)}${suffix}`;
  }
}

async function assertSchoolExists(schoolId) {
  const result = await db.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
  if (result.rowCount === 0) {
    throw badRequest('Choose a school from the list.', { code: 'VALIDATION_ERROR', errors: { school_id: 'Choose a school from the list.' } });
  }
}

// A calendar date as YYYY-MM-DD text, from a text column value or a Date object.
function calendarDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// The teacher details that are safe to send to the browser (never the password hash).
function publicTeacher(teacher) {
  return {
    id: teacher.id,
    first_name: teacher.first_name,
    last_name: teacher.last_name,
    email: teacher.email,
    username: teacher.username,
    mobile: teacher.mobile,
    present_address: teacher.present_address,
    school_id: teacher.school_id,
    school_name: teacher.school_name || null,
    // Whether the school has an uploaded seal (Dashboard). Only findSelf
    // supplies the seal path, so sign-in responses read false until the
    // Dashboard refreshes the teacher — which it does on every load.
    has_school_seal: Boolean(teacher.seal_path),
    // The teacher's own entries for the DepEd print forms; null until filled in.
    region: teacher.region || null,
    division: teacher.division || null,
    deped_school_id: teacher.deped_school_id || null,
    school_head_name: teacher.school_head_name || null,
    // The school calendar dates for SF2; null until filled in. They arrive
    // as YYYY-MM-DD text from findSelf, or as Date objects from SELECT *
    // rows — both become YYYY-MM-DD text here.
    classes_start_date: calendarDate(teacher.classes_start_date),
    classes_end_date: calendarDate(teacher.classes_end_date),
    must_change_password: teacher.must_change_password,
    is_restricted: teacher.is_restricted,
    is_adviser: teacher.is_adviser,
    advisory_grade: teacher.advisory_grade,
    advisory_section: teacher.advisory_section,
  };
}

// GET /api/teacher-auth/schools  (public: the school list for the sign-up form)
async function listPublicSchools(req, res) {
  const result = await db.query('SELECT id, name, city_region FROM schools ORDER BY name, id');
  res.json({ items: result.rows });
}

// POST /api/teacher-auth/register/school  (public: "School not in the list? Add a school")
// The school is added straight away, so it can be picked on the sign-up form.
// An admin can review it and merge it with another school later.
async function registerSchool(req, res) {
  const { name, category, school_type, city_region, principal_contact } = req.valid.body;
  const inserted = await db.query(
    `INSERT INTO schools (name, category, school_type, city_region, principal_contact)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, category, school_type, city_region, principal_contact`,
    [name, category, school_type, city_region, principal_contact]
  );
  const school = inserted.rows[0];

  await logSystemActivity({
    action: 'school.create',
    entityType: 'school',
    entityId: school.id,
    description: `School ${school.name} (${school.city_region}) was added during teacher sign-up`,
  });

  res.status(201).json({ school: { ...school, teacher_count: 0 } });
}

// POST /api/teacher-auth/register  (public sign-up)
// Creates the teacher account and signs them in straight away, so the next step
// (Choose Plan) already knows who they are. The plan itself is chosen afterwards.
async function register(req, res) {
  const body = req.valid.body;
  await assertSchoolExists(body.school_id);

  const username = await deriveUsername(body.email);
  const passwordHash = await hashPassword(body.password);

  const teacher = await db.withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO teachers (first_name, last_name, email, mobile, present_address, username, school_id, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE) RETURNING id`,
      [body.first_name, body.last_name, body.email, body.mobile, body.present_address, username, body.school_id, passwordHash]
    );
    const teacherId = inserted.rows[0].id;

    await logSystemActivity(
      {
        action: 'teacher.register',
        entityType: 'teacher',
        entityId: teacherId,
        description: `Teacher ${body.first_name} ${body.last_name} (${username}) signed up`,
      },
      client
    );

    const found = await client.query(
      `SELECT t.*, s.name AS school_name, s.seal_path FROM teachers t JOIN schools s ON s.id = t.school_id WHERE t.id = $1`,
      [teacherId]
    );
    return found.rows[0];
  });

  res.status(201).json({ teacher: publicTeacher(teacher), token: signTeacherToken(teacher) });
}

// POST /api/teacher-auth/login   { login, password, remember_me? }
// Checks the sign-in details and returns a token for the teacher-facing routes (/api/teacher/...).
// With remember_me the token lasts 30 days instead of the usual 8 hours.
async function login(req, res) {
  const { login: loginValue, password, remember_me } = req.valid.body;
  const wrong = 'Incorrect username or password.';

  const result = await db.query(
    `SELECT id, first_name, last_name, email, username, password_hash, must_change_password,
            is_restricted, restriction_reason, failed_attempts, locked_until, token_version,
            classes_start_date::text AS classes_start_date, classes_end_date::text AS classes_end_date
       FROM teachers WHERE username = $1 OR email = $1`,
    [loginValue]
  );
  const teacher = result.rows[0];
  if (!teacher) throw unauthorized(wrong, { code: 'INVALID_CREDENTIALS' });

  if (teacher.locked_until && new Date(teacher.locked_until) > new Date()) {
    const minutes = minutesLeft(teacher.locked_until);
    throw new HttpError(423, `Too many wrong attempts. This account is locked. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, {
      code: 'ACCOUNT_LOCKED',
      locked_until: teacher.locked_until,
    });
  }

  const passwordIsCorrect = await verifyPassword(password, teacher.password_hash);

  if (!passwordIsCorrect) {
    const attempts = teacher.failed_attempts + 1;

    if (attempts >= config.maxFailedAttempts) {
      const locked = await db.query(
        `UPDATE teachers SET failed_attempts = 0, locked_until = NOW() + ($1 || ' minutes')::interval
          WHERE id = $2 RETURNING locked_until`,
        [String(config.lockMinutes), teacher.id]
      );
      throw new HttpError(423, `Too many wrong attempts. This account is locked for ${config.lockMinutes} minutes.`, {
        code: 'ACCOUNT_LOCKED',
        locked_until: locked.rows[0].locked_until,
      });
    }

    await db.query('UPDATE teachers SET failed_attempts = $1 WHERE id = $2', [attempts, teacher.id]);
    const left = config.maxFailedAttempts - attempts;
    throw unauthorized(`${wrong} ${left} attempt${left === 1 ? '' : 's'} left before the account is locked.`, {
      code: 'INVALID_CREDENTIALS',
      attempts_left: left,
    });
  }

  if (teacher.is_restricted) {
    throw forbidden('Your account is restricted. Please contact the administrator.', {
      code: 'ACCOUNT_RESTRICTED',
      reason: teacher.restriction_reason,
    });
  }

  const updated = await db.query(
    `UPDATE teachers SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW()
      WHERE id = $1 RETURNING *`,
    [teacher.id]
  );
  const signedIn = updated.rows[0];

  res.json({
    message: 'Sign-in details are correct.',
    token: signTeacherToken(signedIn, remember_me ? '30d' : undefined),
    teacher: {
      id: signedIn.id,
      first_name: signedIn.first_name,
      last_name: signedIn.last_name,
      email: signedIn.email,
      username: signedIn.username,
      must_change_password: signedIn.must_change_password,
    },
  });
}

// POST /api/teacher-auth/forgot-password
// Always answers the same way, so nobody can use it to find out which emails have accounts.
async function forgotPassword(req, res) {
  const { email } = req.valid.body;
  const result = await db.query('SELECT * FROM teachers WHERE email = $1 AND is_restricted = FALSE', [email]);
  const teacher = result.rows[0];

  if (teacher) {
    const token = crypto.randomBytes(32).toString('hex');

    // Only the hash is stored. Older unused links stop working.
    await db.query('UPDATE teacher_password_reset_tokens SET used_at = NOW() WHERE teacher_id = $1 AND used_at IS NULL', [teacher.id]);
    await db.query(
      `INSERT INTO teacher_password_reset_tokens (teacher_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
      [teacher.id, sha256(token), String(config.resetTokenMinutes)]
    );

    try {
      await sendPasswordResetEmail(
        { full_name: `${teacher.first_name} ${teacher.last_name}`, email: teacher.email },
        `${config.frontendUrl}/teacher/reset-password?token=${token}`
      );
    } catch (error) {
      console.error('Could not send the password reset email:', error.message);
    }
  }

  res.json({ message: 'If that email belongs to a teacher account, a reset link has been sent.' });
}

// POST /api/teacher-auth/reset-password
async function resetPassword(req, res) {
  const { token, new_password } = req.valid.body;
  const invalid = () => badRequest('This reset link is not valid or has expired. Request a new one.', { code: 'INVALID_RESET_TOKEN' });

  const teacher = await db.withTransaction(async (client) => {
    // Marking the token as used and checking it happen in one step, so it can never work twice.
    const used = await client.query(
      `UPDATE teacher_password_reset_tokens SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        RETURNING teacher_id`,
      [sha256(token)]
    );
    if (used.rowCount === 0) throw invalid();

    const updated = await client.query(
      `UPDATE teachers
          SET password_hash = $1, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL,
              token_version = token_version + 1, updated_at = NOW()
        WHERE id = $2 AND is_restricted = FALSE
        RETURNING *`,
      [await hashPassword(new_password), used.rows[0].teacher_id]
    );
    if (updated.rowCount === 0) throw invalid();

    return updated.rows[0];
  });

  res.json({ message: 'Password updated. You can now sign in.', email: teacher.email });
}

module.exports = {
  publicTeacher,
  deriveUsername,
  listPublicSchools,
  registerSchool,
  register,
  login,
  forgotPassword,
  resetPassword,
};
