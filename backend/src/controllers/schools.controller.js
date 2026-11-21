// Schools directory: list, add, edit, merge. A school is not a billing unit.
const db = require('../db');
const { logActivity } = require('../utils/activity');
const { notFound } = require('../utils/httpError');

const SCHOOL_SELECT = `
  SELECT s.id, s.name, s.category, s.school_type, s.city_region, s.principal_contact, s.created_at, s.updated_at,
         (SELECT COUNT(*)::int FROM teachers t WHERE t.school_id = s.id) AS teacher_count
    FROM schools s`;

async function findSchool(id, client = db) {
  const result = await client.query(`${SCHOOL_SELECT} WHERE s.id = $1`, [id]);
  if (result.rowCount === 0) throw notFound('School not found.');
  return result.rows[0];
}

// GET /api/schools?search=&category=&school_type=&page=&page_size=
async function listSchools(req, res) {
  const { search, category, school_type, page, page_size } = req.valid.query;

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(s.name ILIKE $${params.length} OR s.city_region ILIKE $${params.length} OR s.principal_contact ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`s.category = $${params.length}`);
  }
  if (school_type) {
    params.push(school_type);
    where.push(`s.school_type = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = await db.query(`SELECT COUNT(*)::int AS count FROM schools s ${whereSql}`, params);
  const rows = await db.query(
    `${SCHOOL_SELECT} ${whereSql} ORDER BY s.name, s.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );

  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size });
}

// GET /api/schools/options  (every school, for dropdowns)
async function listSchoolOptions(req, res) {
  const result = await db.query(`${SCHOOL_SELECT} ORDER BY s.name, s.id`);
  res.json({ items: result.rows });
}

// GET /api/schools/:id
async function getSchool(req, res) {
  res.json({ school: await findSchool(req.valid.params.id) });
}

// POST /api/schools
async function createSchool(req, res) {
  const { name, category, school_type, city_region, principal_contact } = req.valid.body;
  const inserted = await db.query(
    `INSERT INTO schools (name, category, school_type, city_region, principal_contact)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, category, school_type, city_region, principal_contact]
  );
  const school = await findSchool(inserted.rows[0].id);

  await logActivity(req, { action: 'school.create', entityType: 'school', entityId: school.id, description: `Added school ${school.name} (${school.city_region})` });
  res.status(201).json({ school });
}

// PATCH /api/schools/:id
async function updateSchool(req, res) {
  const { id } = req.valid.params;
  const { name, category, school_type, city_region, principal_contact } = req.valid.body;
  await findSchool(id);

  await db.query(
    `UPDATE schools
        SET name = $1, category = $2, school_type = $3, city_region = $4, principal_contact = $5, updated_at = NOW()
      WHERE id = $6`,
    [name, category, school_type, city_region, principal_contact, id]
  );
  const school = await findSchool(id);

  await logActivity(req, { action: 'school.update', entityType: 'school', entityId: id, description: `Edited school ${school.name} (${school.city_region})` });
  res.json({ school });
}

// POST /api/schools/merge   { keep_id, remove_id }
// Moves every teacher from the removed school to the kept school, then deletes the removed school.
async function mergeSchools(req, res) {
  const { keep_id, remove_id } = req.valid.body;

  const result = await db.withTransaction(async (client) => {
    const keep = await findSchool(keep_id, client);
    const remove = await findSchool(remove_id, client);

    const moved = await client.query('UPDATE teachers SET school_id = $1, updated_at = NOW() WHERE school_id = $2', [keep_id, remove_id]);
    await client.query('DELETE FROM schools WHERE id = $1', [remove_id]);
    await client.query('UPDATE schools SET updated_at = NOW() WHERE id = $1', [keep_id]);

    await logActivity(
      req,
      {
        action: 'school.merge',
        entityType: 'school',
        entityId: keep_id,
        description: `Merged school ${remove.name} (${remove.city_region}) into ${keep.name} (${keep.city_region}). ${moved.rowCount} teacher(s) moved`,
      },
      client
    );

    return { school: await findSchool(keep_id, client), moved_teachers: moved.rowCount };
  });

  res.json(result);
}

module.exports = { listSchools, listSchoolOptions, getSchool, createSchool, updateSchool, mergeSchools };
