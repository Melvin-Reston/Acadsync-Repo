// Announcements shown to teachers: all of them, only those without a paid plan, or only those on a paid plan.
const db = require('../db');
const { config } = require('../config');
const { logActivity } = require('../utils/activity');
const { notFound } = require('../utils/httpError');

const TODAY = `(NOW() AT TIME ZONE '${config.timezone}')::date`;
const AUDIENCE_LABELS = { all: 'all teachers', free: 'Free teachers only', pro: 'Pro teachers only' };

// live = showing now, scheduled = start date not reached, ended = past its end date.
const ANNOUNCEMENT_COLUMNS = `
  a.id, a.title, a.body, a.audience, a.starts_on::text AS starts_on, a.ends_on::text AS ends_on,
  a.created_at, a.updated_at, cb.full_name AS created_by_name,
  CASE WHEN a.ends_on < ${TODAY} THEN 'ended'
       WHEN a.starts_on IS NOT NULL AND a.starts_on > ${TODAY} THEN 'scheduled'
       ELSE 'live' END AS status`;

const ANNOUNCEMENT_JOINS = `FROM announcements a LEFT JOIN admins cb ON cb.id = a.created_by`;

async function findAnnouncement(id) {
  const result = await db.query(`SELECT ${ANNOUNCEMENT_COLUMNS} ${ANNOUNCEMENT_JOINS} WHERE a.id = $1`, [id]);
  if (result.rowCount === 0) throw notFound('Announcement not found.');
  return result.rows[0];
}

// GET /api/announcements?search=&status=&audience=&page=&page_size=
async function listAnnouncements(req, res) {
  const { search, status, audience, page, page_size } = req.valid.query;

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`);
  }
  if (audience) {
    params.push(audience);
    where.push(`a.audience = $${params.length}`);
  }
  if (status === 'ended') where.push(`a.ends_on < ${TODAY}`);
  if (status === 'scheduled') where.push(`a.ends_on >= ${TODAY} AND a.starts_on > ${TODAY}`);
  if (status === 'live') where.push(`a.ends_on >= ${TODAY} AND (a.starts_on IS NULL OR a.starts_on <= ${TODAY})`);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = await db.query(`SELECT COUNT(*)::int AS count ${ANNOUNCEMENT_JOINS} ${whereSql}`, params);
  const rows = await db.query(
    `SELECT ${ANNOUNCEMENT_COLUMNS} ${ANNOUNCEMENT_JOINS} ${whereSql}
      ORDER BY a.ends_on DESC, a.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );

  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size });
}

// POST /api/announcements
async function createAnnouncement(req, res) {
  const { title, body, audience, starts_on, ends_on } = req.valid.body;
  const inserted = await db.query(
    `INSERT INTO announcements (title, body, audience, starts_on, ends_on, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [title, body, audience, starts_on || null, ends_on, req.admin.id]
  );
  const announcement = await findAnnouncement(inserted.rows[0].id);

  await logActivity(req, {
    action: 'announcement.create',
    entityType: 'announcement',
    entityId: announcement.id,
    description: `Created announcement "${title}" for ${AUDIENCE_LABELS[audience]}, until ${ends_on}`,
  });
  res.status(201).json({ announcement });
}

// PATCH /api/announcements/:id
async function updateAnnouncement(req, res) {
  const { id } = req.valid.params;
  const { title, body, audience, starts_on, ends_on } = req.valid.body;
  await findAnnouncement(id);

  await db.query(
    `UPDATE announcements SET title = $1, body = $2, audience = $3, starts_on = $4, ends_on = $5, updated_at = NOW() WHERE id = $6`,
    [title, body, audience, starts_on || null, ends_on, id]
  );
  const announcement = await findAnnouncement(id);

  await logActivity(req, {
    action: 'announcement.update',
    entityType: 'announcement',
    entityId: id,
    description: `Edited announcement "${title}" for ${AUDIENCE_LABELS[audience]}, until ${ends_on}`,
  });
  res.json({ announcement });
}

// DELETE /api/announcements/:id
async function deleteAnnouncement(req, res) {
  const { id } = req.valid.params;
  const announcement = await findAnnouncement(id);

  await db.query('DELETE FROM announcements WHERE id = $1', [id]);
  await logActivity(req, { action: 'announcement.delete', entityType: 'announcement', entityId: id, description: `Deleted announcement "${announcement.title}"` });
  res.json({ message: 'Announcement deleted.' });
}

module.exports = { listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement };
