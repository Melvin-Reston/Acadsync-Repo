// Teachers: list, create, view, edit, restrict / unrestrict, reset password.
const db = require('../db');
const { hashPassword, generateTemporaryPassword } = require('../utils/passwords');
const { logActivity } = require('../utils/activity');
const { notFound, badRequest, conflict } = require('../utils/httpError');
const billing = require('../utils/billing');
const { findActivePlan } = require('./subscriptions.controller');

// Columns that are safe to send to the browser. The password hash is never included.
const TEACHER_COLUMNS = `
  t.id, t.first_name, t.last_name, t.email, t.mobile, t.present_address, t.username,
  t.school_id, s.name AS school_name, s.city_region AS school_city_region,
  t.must_change_password, t.is_restricted, t.restriction_reason, t.restricted_at,
  rb.full_name AS restricted_by_name, cb.full_name AS created_by_name,
  t.created_at, t.updated_at,
  latest.id AS subscription_id, latest.plan_name, latest.price AS plan_price, latest.status AS subscription_status,
  latest.current_period_end AS subscription_period_end`;

const TEACHER_JOINS = `
  FROM teachers t
  JOIN schools s ON s.id = t.school_id
  LEFT JOIN admins rb ON rb.id = t.restricted_by
  LEFT JOIN admins cb ON cb.id = t.created_by
  -- The teacher's current subscription, or the latest one when none is current.
  LEFT JOIN LATERAL (
    SELECT sub.id, sub.plan_name, sub.price, sub.status, sub.current_period_end
      FROM subscriptions sub
     WHERE sub.teacher_id = t.id
     ORDER BY (sub.status IN ('trial', 'active', 'past_due')) DESC, sub.created_at DESC, sub.id DESC
     LIMIT 1
  ) latest ON TRUE`;

const fullName = (teacher) => `${teacher.first_name} ${teacher.last_name}`;

async function findTeacher(id, client = db) {
  const result = await client.query(`SELECT ${TEACHER_COLUMNS} ${TEACHER_JOINS} WHERE t.id = $1`, [id]);
  if (result.rowCount === 0) throw notFound('Teacher not found.');
  return result.rows[0];
}

async function assertSchoolExists(schoolId) {
  const result = await db.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
  if (result.rowCount === 0) {
    throw badRequest('Choose a school from the list.', { code: 'VALIDATION_ERROR', errors: { school_id: 'Choose a school from the list.' } });
  }
}

// GET /api/teachers?search=&school_id=&status=&page=&page_size=
async function listTeachers(req, res) {
  await billing.ensureBillingUpToDate();
  const { search, school_id, status, page, page_size } = req.valid.query;

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(t.first_name || ' ' || t.last_name ILIKE $${params.length}
                 OR t.email ILIKE $${params.length}
                 OR t.username ILIKE $${params.length}
                 OR t.mobile ILIKE $${params.length})`);
  }
  if (school_id) {
    params.push(school_id);
    where.push(`t.school_id = $${params.length}`);
  }
  if (status === 'active') where.push('t.is_restricted = FALSE');
  if (status === 'restricted') where.push('t.is_restricted = TRUE');
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = await db.query(`SELECT COUNT(*)::int AS count ${TEACHER_JOINS} ${whereSql}`, params);
  const rows = await db.query(
    `SELECT ${TEACHER_COLUMNS} ${TEACHER_JOINS} ${whereSql}
      ORDER BY t.last_name, t.first_name, t.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );

  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size });
}

// GET /api/teachers/:id
async function getTeacher(req, res) {
  await billing.ensureBillingUpToDate();
  res.json({ teacher: await findTeacher(req.valid.params.id) });
}

// POST /api/teachers
async function createTeacher(req, res) {
  const body = req.valid.body;
  await assertSchoolExists(body.school_id);

  // An optional plan starts the teacher's first subscription in the same step.
  const plan = body.plan_id ? await findActivePlan(body.plan_id) : null;
  const passwordHash = await hashPassword(body.temporary_password);

  const teacher = await db.withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO teachers (first_name, last_name, email, mobile, present_address, username, school_id, password_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [body.first_name, body.last_name, body.email, body.mobile, body.present_address, body.username, body.school_id, passwordHash, req.admin.id]
    );
    const teacherId = inserted.rows[0].id;
    await logActivity(
      req,
      { action: 'teacher.create', entityType: 'teacher', entityId: teacherId, description: `Created teacher ${body.first_name} ${body.last_name} (${body.username})` },
      client
    );

    if (plan) {
      const subscription = await billing.createSubscription(client, { teacherId, plan, withTrial: body.with_trial, adminId: req.admin.id });
      await logActivity(
        req,
        {
          action: 'subscription.create',
          entityType: 'subscription',
          entityId: subscription.id,
          description: `Added a ${plan.name} subscription for ${body.first_name} ${body.last_name} by hand${subscription.status === 'trial' ? ', starting with a trial' : ''}`,
        },
        client
      );
    }
    return findTeacher(teacherId, client);
  });

  res.status(201).json({ teacher });
}

// PATCH /api/teachers/:id
async function updateTeacher(req, res) {
  const { id } = req.valid.params;
  const body = req.valid.body;
  await findTeacher(id);
  await assertSchoolExists(body.school_id);

  await db.query(
    `UPDATE teachers
        SET first_name = $1, last_name = $2, email = $3, mobile = $4, present_address = $5,
            username = $6, school_id = $7, updated_at = NOW()
      WHERE id = $8`,
    [body.first_name, body.last_name, body.email, body.mobile, body.present_address, body.username, body.school_id, id]
  );
  const teacher = await findTeacher(id);

  await logActivity(req, { action: 'teacher.update', entityType: 'teacher', entityId: id, description: `Edited teacher ${fullName(teacher)} (${teacher.username})` });
  res.json({ teacher });
}

// POST /api/teachers/:id/restrict   { reason }
async function restrictTeacher(req, res) {
  const { id } = req.valid.params;
  const { reason } = req.valid.body;
  const before = await findTeacher(id);
  if (before.is_restricted) throw conflict('This teacher is already restricted.');

  await db.query(
    `UPDATE teachers
        SET is_restricted = TRUE, restriction_reason = $1, restricted_at = NOW(), restricted_by = $2, updated_at = NOW()
      WHERE id = $3`,
    [reason, req.admin.id, id]
  );
  const teacher = await findTeacher(id);

  await logActivity(req, { action: 'teacher.restrict', entityType: 'teacher', entityId: id, description: `Restricted teacher ${fullName(teacher)}. Reason: ${reason}` });
  res.json({ teacher });
}

// POST /api/teachers/:id/unrestrict
async function unrestrictTeacher(req, res) {
  const { id } = req.valid.params;
  const before = await findTeacher(id);
  if (!before.is_restricted) throw conflict('This teacher is not restricted.');

  await db.query(
    `UPDATE teachers
        SET is_restricted = FALSE, restriction_reason = NULL, restricted_at = NULL, restricted_by = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id]
  );
  const teacher = await findTeacher(id);

  await logActivity(req, { action: 'teacher.unrestrict', entityType: 'teacher', entityId: id, description: `Removed the restriction on teacher ${fullName(teacher)}` });
  res.json({ teacher });
}

// POST /api/teachers/:id/reset-password
async function resetTeacherPassword(req, res) {
  const { id } = req.valid.params;
  const teacher = await findTeacher(id);
  const temporaryPassword = generateTemporaryPassword();

  await db.query('UPDATE teachers SET password_hash = $1, must_change_password = TRUE, updated_at = NOW() WHERE id = $2', [
    await hashPassword(temporaryPassword),
    id,
  ]);

  await logActivity(req, { action: 'teacher.reset_password', entityType: 'teacher', entityId: id, description: `Reset the password of teacher ${fullName(teacher)}` });

  // Shown once to the admin. Only the hash is stored.
  res.json({ temporary_password: temporaryPassword });
}

module.exports = { listTeachers, getTeacher, createTeacher, updateTeacher, restrictTeacher, unrestrictTeacher, resetTeacherPassword };
