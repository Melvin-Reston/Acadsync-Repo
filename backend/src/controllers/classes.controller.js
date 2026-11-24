// Classes & Sections and Schedules: the teacher's own subjects, classes, learners,
// enrolments and weekly meetings. Every query is scoped to the signed-in teacher
// (req.teacher.id); an id from the request can never reach another teacher's rows.
const db = require('../db');
const { config } = require('../config');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { logSystemActivity } = require('../utils/activity');
const { sendCsv } = require('../utils/csv');

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// ---------- Dates in the school's timezone (Asia/Manila by default) ----------
// The server may run in any timezone, so "today" and "now" are always worked out
// in the configured timezone, using only plain date strings and UTC arithmetic.
function manilaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

// The Monday of the week that contains dateStr (YYYY-MM-DD).
function mondayOf(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const weekday = date.getUTCDay(); // 0 is Sunday, 1 is Monday
  const back = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatTime(time) {
  // "07:30:00" from the database becomes "7:30 AM" on screen.
  const [hour, minute] = String(time).split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}

// A database unique-key error becomes a plain message instead of a crash.
function uniqueError(error, message) {
  if (error && error.code === '23505') throw conflict(message);
  throw error;
}

// ---------- Lookups (all scoped to the signed-in teacher) ----------

// The school a teacher belongs to. Learners belong to the school (Batch 7),
// so every learner lookup is scoped to this id, never to the teacher.
async function teacherSchoolId(teacherId, client = db) {
  const result = await client.query('SELECT school_id FROM teachers WHERE id = $1', [teacherId]);
  if (result.rowCount === 0) throw notFound('Teacher not found.');
  return result.rows[0].school_id;
}

// One learner, with the school they belong to. Any teacher of the same school
// can see the row; a teacher of another school gets "not found", never the row.
const LEARNER_SELECT = `
  SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex,
         l.birthdate::text AS birthdate, l.school_id, s.name AS school_name,
         l.created_at, l.updated_at,
         (SELECT COUNT(*)::int FROM class_learners cl WHERE cl.learner_id = l.id) AS class_count
    FROM learners l JOIN schools s ON s.id = l.school_id`;

async function findSubject(id, teacherId, client = db) {
  const result = await client.query(
    `SELECT s.id, s.name, s.grade_level, s.subject_group AS "group",
            (SELECT COUNT(*)::int FROM classes c WHERE c.subject_id = s.id) AS class_count
       FROM subjects s WHERE s.id = $1 AND s.teacher_id = $2`,
    [id, teacherId]
  );
  if (result.rowCount === 0) throw notFound('Subject not found.');
  return result.rows[0];
}

// The group a new subject belongs to, guessed from its name — the same
// guesses migration 007 made for subjects that already existed. A teacher
// can correct any subject in Manage Subjects.
function detectSubjectGroup(name) {
  const lower = String(name || '').toLowerCase();
  if (
    lower.includes('music') || lower.includes('arts') ||
    lower.includes('physical education') || lower.includes('health') ||
    lower === 'pe' || lower.startsWith('pe ') || lower.endsWith(' pe')
  ) {
    return 'mapeh';
  }
  if (
    lower.startsWith('epp') || lower.includes(' epp') ||
    lower.startsWith('tle') || lower.includes(' tle') || lower.endsWith('tle')
  ) {
    return 'epp_tle';
  }
  return 'core';
}

const CLASS_SELECT = `
  SELECT c.id, c.subject_id, s.name AS subject_name, c.grade_level, c.section_name,
         c.room, c.academic_year, c.created_at, c.updated_at,
         (SELECT COUNT(*)::int FROM class_learners cl WHERE cl.class_id = c.id) AS learner_count,
         (SELECT COUNT(*)::int FROM class_meetings m WHERE m.class_id = c.id) AS meeting_count
    FROM classes c JOIN subjects s ON s.id = c.subject_id`;

async function findClass(id, teacherId, client = db) {
  const result = await client.query(`${CLASS_SELECT} WHERE c.id = $1 AND c.teacher_id = $2`, [id, teacherId]);
  if (result.rowCount === 0) throw notFound('Class not found.');
  return result.rows[0];
}

async function findLearner(id, teacherId, client = db) {
  const schoolId = await teacherSchoolId(teacherId, client);
  const result = await client.query(
    `${LEARNER_SELECT} WHERE l.id = $1 AND l.school_id = $2`,
    [id, schoolId]
  );
  if (result.rowCount === 0) throw notFound('Learner not found.');
  return result.rows[0];
}

const MEETING_SELECT = `
  SELECT m.id, m.class_id, c.subject_id, s.name AS subject_name, c.grade_level,
         c.section_name, m.day_of_week,
         CASE m.day_of_week
           WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
           WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
         END AS day_name,
         m.start_time::text AS start_time, m.end_time::text AS end_time,
         m.room, m.created_at, m.updated_at
    FROM class_meetings m
    JOIN classes c ON c.id = m.class_id
    JOIN subjects s ON s.id = c.subject_id`;

async function findMeeting(id, teacherId, client = db) {
  const result = await client.query(`${MEETING_SELECT} WHERE m.id = $1 AND c.teacher_id = $2`, [id, teacherId]);
  if (result.rowCount === 0) throw notFound('Meeting not found.');
  return result.rows[0];
}

// ---------- Meeting conflicts ----------
// A new or changed meeting is refused when it overlaps another meeting of the same
// teacher, or when its room is already booked at that time by another teacher of the
// same school. Back-to-back meetings (one ends as the other starts) are fine.
// The room check names no other teacher, so it leaks nothing about them.
async function assertNoConflict(client, teacherId, { dayOfWeek, startTime, endTime, room, excludeId = null }) {
  const mine = await client.query(
    `SELECT m.start_time::text AS start_time, m.end_time::text AS end_time,
            s.name AS subject_name, c.section_name
       FROM class_meetings m
       JOIN classes c ON c.id = m.class_id
       JOIN subjects s ON s.id = c.subject_id
      WHERE c.teacher_id = $1 AND m.day_of_week = $2
        AND m.start_time < $4 AND m.end_time > $3
        AND ($5::int IS NULL OR m.id <> $5)
      ORDER BY m.start_time LIMIT 1`,
    [teacherId, dayOfWeek, startTime, endTime, excludeId]
  );
  if (mine.rowCount > 0) {
    const other = mine.rows[0];
    throw conflict(
      `That overlaps ${other.subject_name} · ${other.section_name} (${formatTime(other.start_time)}–${formatTime(other.end_time)}) on ${DAY_NAMES[dayOfWeek - 1]}.`,
      { errors: { start_time: 'This overlaps another meeting of yours.' } }
    );
  }

  if (room) {
    const booked = await client.query(
      `SELECT m.start_time::text AS start_time, m.end_time::text AS end_time
         FROM class_meetings m
         JOIN classes c ON c.id = m.class_id
         JOIN teachers t ON t.id = c.teacher_id
        WHERE t.school_id = (SELECT school_id FROM teachers WHERE id = $1)
          AND c.teacher_id <> $1 AND m.day_of_week = $2 AND m.room = $3
          AND m.start_time < $5 AND m.end_time > $4
          AND ($6::int IS NULL OR m.id <> $6)
        ORDER BY m.start_time LIMIT 1`,
      [teacherId, dayOfWeek, room, startTime, endTime, excludeId]
    );
    if (booked.rowCount > 0) {
      const other = booked.rows[0];
      throw conflict(
        `${room} is already booked on ${DAY_NAMES[dayOfWeek - 1]} (${formatTime(other.start_time)}–${formatTime(other.end_time)}).`,
        { errors: { room: 'This room is already booked at that time.' } }
      );
    }
  }
}

// ---------- Subjects ----------

// GET /api/teacher/subjects  (the teacher's own subject library)
async function listSubjects(req, res) {
  const result = await db.query(
    `SELECT s.id, s.name, s.grade_level, s.subject_group AS "group", s.created_at, s.updated_at,
            (SELECT COUNT(*)::int FROM classes c WHERE c.subject_id = s.id) AS class_count
       FROM subjects s WHERE s.teacher_id = $1 ORDER BY s.grade_level, s.name, s.id`,
    [req.teacher.id]
  );
  res.json({ items: result.rows });
}

// GET /api/teacher/subjects/:id
async function getSubject(req, res) {
  res.json({ subject: await findSubject(req.valid.params.id, req.teacher.id) });
}

// POST /api/teacher/subjects
// The group is guessed from the name when it is left out (Music and Arts
// is MAPEH); the teacher can correct it in Manage Subjects afterwards.
async function createSubject(req, res) {
  const { name, grade_level } = req.valid.body;
  const group = req.valid.body.group ?? detectSubjectGroup(name);
  let subject;
  try {
    const inserted = await db.query(
      `INSERT INTO subjects (teacher_id, name, grade_level, subject_group) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.teacher.id, name, grade_level, group]
    );
    subject = await findSubject(inserted.rows[0].id, req.teacher.id);
  } catch (error) {
    uniqueError(error, `You already have a subject called ${name} in Grade ${grade_level}.`);
  }
  res.status(201).json({ subject });
}

// PATCH /api/teacher/subjects/:id
// A group left out of the update keeps the subject's current group.
async function updateSubject(req, res) {
  const { id } = req.valid.params;
  const { name, grade_level } = req.valid.body;
  const subject = await findSubject(id, req.teacher.id);
  const group = req.valid.body.group ?? subject.group;

  if (grade_level !== subject.grade_level && subject.class_count > 0) {
    throw badRequest('This subject has classes, so its grade level cannot be changed. Add a new subject for the other grade instead.', {
      errors: { grade_level: 'This subject has classes.' },
    });
  }

  try {
    await db.query('UPDATE subjects SET name = $1, grade_level = $2, subject_group = $3, updated_at = NOW() WHERE id = $4', [name, grade_level, group, id]);
  } catch (error) {
    uniqueError(error, `You already have a subject called ${name} in Grade ${grade_level}.`);
  }
  res.json({ subject: await findSubject(id, req.teacher.id) });
}

// DELETE /api/teacher/subjects/:id  (refused while a class uses the subject)
async function deleteSubject(req, res) {
  const { id } = req.valid.params;
  const subject = await findSubject(id, req.teacher.id);
  if (subject.class_count > 0) {
    throw conflict(`"${subject.name}" is used by ${subject.class_count} class${subject.class_count === 1 ? '' : 'es'}. Delete the class first.`);
  }
  await db.query('DELETE FROM subjects WHERE id = $1', [id]);
  res.json({ message: 'Subject deleted.' });
}

// ---------- Classes ----------

// GET /api/teacher/classes?search=&grade=&academic_year=&subject_id=&page=&page_size=
async function listClasses(req, res) {
  const { search, grade, academic_year, subject_id, page, page_size } = req.valid.query;
  const where = ['c.teacher_id = $1'];
  const params = [req.teacher.id];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(s.name ILIKE $${params.length} OR c.section_name ILIKE $${params.length} OR c.room ILIKE $${params.length})`);
  }
  if (grade) {
    params.push(grade);
    where.push(`c.grade_level = $${params.length}`);
  }
  if (academic_year) {
    params.push(academic_year);
    where.push(`c.academic_year = $${params.length}`);
  }
  if (subject_id) {
    params.push(subject_id);
    where.push(`c.subject_id = $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = await db.query(`SELECT COUNT(*)::int AS count FROM classes c JOIN subjects s ON s.id = c.subject_id ${whereSql}`, params);
  const rows = await db.query(
    `${CLASS_SELECT} ${whereSql} ORDER BY s.grade_level, s.name, c.section_name, c.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );
  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size });
}

// POST /api/teacher/classes  (subject_id, or new_subject_name to create the subject too)
async function createClass(req, res) {
  const { subject_id, new_subject_name, grade_level, section_name, room, academic_year } = req.valid.body;

  const created = await db.withTransaction(async (client) => {
    let subject;
    if (new_subject_name) {
      try {
        // A subject created on the spot takes its group from its name
        // (Music and Arts is MAPEH); the teacher can correct it in
        // Manage Subjects.
        const inserted = await client.query(
          `INSERT INTO subjects (teacher_id, name, grade_level, subject_group) VALUES ($1, $2, $3, $4) RETURNING id`,
          [req.teacher.id, new_subject_name, grade_level, detectSubjectGroup(new_subject_name)]
        );
        subject = await findSubject(inserted.rows[0].id, req.teacher.id, client);
      } catch (error) {
        uniqueError(error, `You already have a subject called ${new_subject_name} in Grade ${grade_level}.`);
      }
    } else {
      subject = await findSubject(subject_id, req.teacher.id, client);
      if (subject.grade_level !== grade_level) {
        throw badRequest(`"${subject.name}" is a Grade ${subject.grade_level} subject. Choose its grade, or add it as a new subject for Grade ${grade_level}.`, {
          errors: { grade_level: 'The grade does not match the subject.' },
        });
      }
    }

    let classId;
    try {
      const inserted = await client.query(
        `INSERT INTO classes (teacher_id, subject_id, grade_level, section_name, room, academic_year)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.teacher.id, subject.id, grade_level, section_name, room, academic_year]
      );
      classId = inserted.rows[0].id;
    } catch (error) {
      uniqueError(error, `"${subject.name}" already has a section called ${section_name} in Grade ${grade_level} for ${academic_year}.`);
    }

    await logSystemActivity(
      {
        action: 'class.create',
        entityType: 'class',
        entityId: classId,
        description: `Teacher ${req.teacher.first_name} ${req.teacher.last_name} added class ${subject.name}, Grade ${grade_level}, ${section_name} (${academic_year})`,
      },
      client
    );
    return classId;
  });

  res.status(201).json({ class: await findClass(created, req.teacher.id) });
}

// GET /api/teacher/classes/:id  (the class, its learners and its meetings)
async function getClass(req, res) {
  const { id } = req.valid.params;
  const klass = await findClass(id, req.teacher.id);
  const learners = await db.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex,
            l.birthdate::text AS birthdate, l.school_id, s.name AS school_name, cl.enrolled_at
       FROM class_learners cl JOIN learners l ON l.id = cl.learner_id
       JOIN schools s ON s.id = l.school_id
      WHERE cl.class_id = $1 ORDER BY l.last_name, l.first_name, l.id`,
    [id]
  );
  const meetings = await db.query(
    `${MEETING_SELECT} WHERE m.class_id = $1 ORDER BY m.day_of_week, m.start_time, m.id`,
    [id]
  );
  res.json({ class: { ...klass, learners: learners.rows, meetings: meetings.rows } });
}

// PATCH /api/teacher/classes/:id  (the grade always follows the chosen subject)
async function updateClass(req, res) {
  const { id } = req.valid.params;
  const { subject_id, section_name, room, academic_year } = req.valid.body;
  await findClass(id, req.teacher.id);
  const subject = await findSubject(subject_id, req.teacher.id);

  try {
    await db.query(
      `UPDATE classes
          SET subject_id = $1, grade_level = $2, section_name = $3, room = $4, academic_year = $5, updated_at = NOW()
        WHERE id = $6`,
      [subject.id, subject.grade_level, section_name, room, academic_year, id]
    );
  } catch (error) {
    uniqueError(error, `"${subject.name}" already has a section called ${section_name} in Grade ${subject.grade_level} for ${academic_year}.`);
  }
  res.json({ class: await findClass(id, req.teacher.id) });
}

// DELETE /api/teacher/classes/:id  (meetings and enrolments go with it)
async function deleteClass(req, res) {
  const { id } = req.valid.params;
  const klass = await findClass(id, req.teacher.id);
  await db.query('DELETE FROM classes WHERE id = $1', [id]);
  await logSystemActivity({
    action: 'class.delete',
    entityType: 'class',
    entityId: id,
    description: `Teacher ${req.teacher.first_name} ${req.teacher.last_name} deleted class ${klass.subject_name}, Grade ${klass.grade_level}, ${klass.section_name}`,
  });
  res.json({ message: 'Class deleted.' });
}

// ---------- Learners ----------

// GET /api/teacher/learners?search=&page=&page_size=
// The whole school's learner directory: every teacher of the school sees
// the same learners, so a class uploaded once never needs uploading again.
async function listLearners(req, res) {
  const { search, page, page_size } = req.valid.query;
  const schoolId = await teacherSchoolId(req.teacher.id);
  const where = ['l.school_id = $1'];
  const params = [schoolId];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(l.first_name ILIKE $${params.length} OR l.last_name ILIKE $${params.length} OR l.learner_id ILIKE $${params.length})`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = await db.query(`SELECT COUNT(*)::int AS count FROM learners l ${whereSql}`, params);
  const rows = await db.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex,
            l.birthdate::text AS birthdate, l.school_id, s.name AS school_name,
            l.created_at, l.updated_at,
            (SELECT COUNT(*)::int FROM class_learners cl WHERE cl.learner_id = l.id) AS class_count,
            (SELECT STRING_AGG(c.section_name, ', ' ORDER BY c.section_name)
               FROM class_learners cl JOIN classes c ON c.id = cl.class_id WHERE cl.learner_id = l.id) AS classes
       FROM learners l JOIN schools s ON s.id = l.school_id ${whereSql} ORDER BY l.last_name, l.first_name, l.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );
  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size });
}

// POST /api/teacher/learners
async function createLearner(req, res) {
  const { first_name, last_name, learner_id, sex, birthdate } = req.valid.body;
  const schoolId = await teacherSchoolId(req.teacher.id);
  let learner;
  try {
    const inserted = await db.query(
      `INSERT INTO learners (teacher_id, school_id, first_name, last_name, learner_id, sex, birthdate)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.teacher.id, schoolId, first_name, last_name, learner_id, sex, birthdate || null]
    );
    learner = await findLearner(inserted.rows[0].id, req.teacher.id);
  } catch (error) {
    uniqueError(error, `A learner with the ID ${learner_id} already exists in your school.`);
  }
  res.status(201).json({ learner });
}

// PATCH /api/teacher/learners/:id
async function updateLearner(req, res) {
  const { id } = req.valid.params;
  const { first_name, last_name, learner_id, sex, birthdate } = req.valid.body;
  await findLearner(id, req.teacher.id);
  try {
    await db.query(
      `UPDATE learners SET first_name = $1, last_name = $2, learner_id = $3, sex = $4, birthdate = $5, updated_at = NOW() WHERE id = $6`,
      [first_name, last_name, learner_id, sex, birthdate || null, id]
    );
  } catch (error) {
    uniqueError(error, `A learner with the ID ${learner_id} already exists in your school.`);
  }
  res.json({ learner: await findLearner(id, req.teacher.id) });
}

// DELETE /api/teacher/learners/:id
// A learner with records cannot be deleted: remove them from their classes
// first (their attendance and grade scores stay on file either way, so a
// learner with those can never be deleted). A learner with no records at all
// is deleted outright.
async function deleteLearner(req, res) {
  const { id } = req.valid.params;
  const learner = await findLearner(id, req.teacher.id);
  const usage = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM class_learners WHERE learner_id = $1) AS enrolments,
            (SELECT COUNT(*)::int FROM attendance WHERE learner_id = $1) AS attendance,
            (SELECT COUNT(*)::int FROM grade_scores WHERE learner_id = $1) AS scores,
            (SELECT COUNT(*)::int FROM quiz_attempts WHERE learner_id = $1) AS quiz_attempts,
            (SELECT COUNT(*)::int FROM report_card_comments WHERE learner_id = $1) AS comments`,
    [id]
  );
  const used = usage.rows[0];
  const name = `${learner.first_name} ${learner.last_name}`;
  if (used.enrolments > 0) {
    throw conflict(`${name} is enrolled in ${used.enrolments} ${used.enrolments === 1 ? 'class' : 'classes'}. Remove them from their classes first.`);
  }
  if (used.attendance > 0) {
    throw conflict(`${name} has attendance records, so they cannot be deleted.`);
  }
  if (used.scores > 0) {
    throw conflict(`${name} has grade scores, so they cannot be deleted.`);
  }
  if (used.quiz_attempts > 0) {
    throw conflict(`${name} has quiz attempts, so they cannot be deleted.`);
  }
  if (used.comments > 0) {
    throw conflict(`${name} has report card comments, so they cannot be deleted.`);
  }
  await db.query('DELETE FROM learners WHERE id = $1', [id]);
  res.json({ message: 'Learner deleted.' });
}

// ---------- Bulk upload ----------

// GET /api/teacher/learners/upload-template  (the blank CSV to fill in)
async function downloadLearnerTemplate(req, res) {
  sendCsv(
    res,
    'learners-template.csv',
    [
      { header: 'first_name', value: () => '' },
      { header: 'last_name', value: () => '' },
      { header: 'learner_id', value: () => '' },
      { header: 'sex', value: () => '' },
      { header: 'birthdate', value: () => '' },
    ],
    []
  );
}

// A small CSV reader: quoted fields ("a, b"), doubled quotes (""), CRLF and
// LF endings. Returns rows as arrays of strings; a blank line is dropped.
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (char === ',') {
      pushField();
      i += 1;
    } else if (char === '\r') {
      i += 1; // the CR of a CRLF pair; the LF ends the row
    } else if (char === '\n') {
      pushRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// True for a real calendar date written as YYYY-MM-DD (so 2026-02-31 is refused).
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const BULK_COLUMNS = ['first_name', 'last_name', 'learner_id', 'sex', 'birthdate'];
const BULK_MAX_ROWS = 500;

// POST /api/teacher/learners/upload  (multipart form, field "file")
// Adds every valid row to the school's learner directory. A row whose
// learner ID already exists in the school is skipped as a duplicate; a row
// with a mistake is reported with its reason. Nothing is ever overwritten
// and a bad row never stops the good rows.
async function uploadLearners(req, res) {
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    throw badRequest('Choose a CSV file to upload.', { errors: { file: 'Choose a CSV file.' } });
  }
  const name = String(req.file.originalname || '').toLowerCase();
  if (!name.endsWith('.csv')) {
    throw badRequest('Upload a CSV file.', { errors: { file: 'Upload a CSV file.' } });
  }

  const rows = parseCsvRows(req.file.buffer.toString('utf8'));
  if (rows.length === 0) {
    throw badRequest('The file has no rows.', { errors: { file: 'The file is empty.' } });
  }
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const missing = BULK_COLUMNS.filter((column) => !header.includes(column));
  const extra = header.filter((column) => column !== '' && !BULK_COLUMNS.includes(column));
  if (missing.length > 0 || extra.length > 0) {
    const problems = [
      ...(missing.length > 0 ? [`missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`] : []),
      ...(extra.length > 0 ? [`unexpected column${extra.length === 1 ? '' : 's'}: ${extra.join(', ')}`] : []),
    ];
    throw badRequest(`The file must have the columns ${BULK_COLUMNS.join(', ')}. ${problems.join('; ')}.`, {
      errors: { file: 'Check the columns against the template.' },
    });
  }
  const indexOf = (column) => header.indexOf(column);
  const dataRows = rows.slice(1);
  if (dataRows.length > BULK_MAX_ROWS) {
    throw badRequest(`The file has ${dataRows.length} rows. Upload at most ${BULK_MAX_ROWS} learners at a time.`, {
      errors: { file: `At most ${BULK_MAX_ROWS} rows.` },
    });
  }

  const schoolId = await teacherSchoolId(req.teacher.id);
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db.query('SELECT LOWER(TRIM(learner_id)) AS norm FROM learners WHERE school_id = $1', [schoolId]);
  const seen = new Set(existing.rows.map((row) => row.norm));

  const results = [];
  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < dataRows.length; i += 1) {
    const rowNumber = i + 2; // the header is row 1
    const cell = (column) => String(dataRows[i][indexOf(column)] ?? '').trim();
    const firstName = cell('first_name');
    const lastName = cell('last_name');
    const learnerId = cell('learner_id');
    const sexRaw = cell('sex');
    const birthdate = cell('birthdate');
    const fail = (message) => {
      failed += 1;
      results.push({ row: rowNumber, status: 'error', learner_id: learnerId, message });
    };

    if (!firstName || !lastName || !learnerId) {
      fail('First name, last name and learner ID are all required.');
      continue;
    }
    if (firstName.length > 60 || lastName.length > 60) {
      fail('First name and last name must be 60 characters or fewer.');
      continue;
    }
    if (learnerId.length > 30) {
      fail('Learner ID must be 30 characters or fewer.');
      continue;
    }
    const sex = sexRaw.toLowerCase() === 'male' ? 'Male' : sexRaw.toLowerCase() === 'female' ? 'Female' : null;
    if (!sex) {
      fail('Sex must be Male or Female.');
      continue;
    }
    if (birthdate !== '' && (!isRealDate(birthdate) || birthdate > today)) {
      fail('Birthdate must be a real date in the format YYYY-MM-DD and not in the future.');
      continue;
    }
    if (seen.has(learnerId.toLowerCase())) {
      skipped += 1;
      results.push({ row: rowNumber, status: 'skipped', learner_id: learnerId, message: 'A learner with this ID already exists in your school.' });
      continue;
    }

    try {
      await db.query(
        `INSERT INTO learners (teacher_id, school_id, first_name, last_name, learner_id, sex, birthdate)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.teacher.id, schoolId, firstName, lastName, learnerId, sex, birthdate === '' ? null : birthdate]
      );
      seen.add(learnerId.toLowerCase());
      added += 1;
      results.push({ row: rowNumber, status: 'added', learner_id: learnerId, message: `${lastName}, ${firstName} added.` });
    } catch (error) {
      if (error && error.code === '23505') {
        skipped += 1;
        results.push({ row: rowNumber, status: 'skipped', learner_id: learnerId, message: 'A learner with this ID already exists in your school.' });
      } else {
        throw error;
      }
    }
  }

  res.status(201).json({
    summary: { added, skipped, failed, total: dataRows.length },
    results,
  });
}

// ---------- Enrolment ----------

// GET /api/teacher/classes/:id/learners  (the learners enrolled in this class)
async function listClassLearners(req, res) {
  const { id } = req.valid.params;
  await findClass(id, req.teacher.id);
  const result = await db.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex,
            l.birthdate::text AS birthdate, l.school_id, s.name AS school_name, cl.enrolled_at
       FROM class_learners cl JOIN learners l ON l.id = cl.learner_id
       JOIN schools s ON s.id = l.school_id
      WHERE cl.class_id = $1 ORDER BY l.last_name, l.first_name, l.id`,
    [id]
  );
  res.json({ items: result.rows });
}

// POST /api/teacher/classes/:id/learners  { learner_id }
async function enrolLearner(req, res) {
  const { id } = req.valid.params;
  const { learner_id } = req.valid.body;
  await findClass(id, req.teacher.id);
  await findLearner(learner_id, req.teacher.id);
  try {
    await db.query('INSERT INTO class_learners (class_id, learner_id) VALUES ($1, $2)', [id, learner_id]);
  } catch (error) {
    uniqueError(error, 'That learner is already enrolled in this class.');
  }
  res.status(201).json({ class: await findClass(id, req.teacher.id) });
}

// DELETE /api/teacher/classes/:id/learners/:learnerId
async function removeLearner(req, res) {
  const { id, learnerId } = req.valid.params;
  await findClass(id, req.teacher.id);
  await findLearner(learnerId, req.teacher.id);
  const removed = await db.query('DELETE FROM class_learners WHERE class_id = $1 AND learner_id = $2', [id, learnerId]);
  if (removed.rowCount === 0) throw notFound('That learner is not enrolled in this class.');
  res.json({ class: await findClass(id, req.teacher.id) });
}

// ---------- Meetings ----------

// GET /api/teacher/meetings?class_id=&day_of_week=&page=&page_size=
async function listMeetings(req, res) {
  const { class_id, day_of_week, page, page_size } = req.valid.query;
  const where = ['c.teacher_id = $1'];
  const params = [req.teacher.id];
  if (class_id) {
    params.push(class_id);
    where.push(`m.class_id = $${params.length}`);
  }
  if (day_of_week) {
    params.push(day_of_week);
    where.push(`m.day_of_week = $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = await db.query(
    `SELECT COUNT(*)::int AS count FROM class_meetings m JOIN classes c ON c.id = m.class_id ${whereSql}`,
    params
  );
  const rows = await db.query(
    `${MEETING_SELECT} ${whereSql} ORDER BY m.day_of_week, m.start_time, s.name, c.section_name, m.id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, (page - 1) * page_size]
  );
  res.json({ items: rows.rows, total: total.rows[0].count, page, page_size });
}

// POST /api/teacher/meetings
// With repeat_week the same meeting is added on every weekday (Monday to
// Friday). A day that would clash is skipped and reported plainly, so one
// busy day never blocks the rest of the week.
async function createMeeting(req, res) {
  const { class_id, day_of_week, start_time, end_time, room, repeat_week } = req.valid.body;
  const klass = await findClass(class_id, req.teacher.id);
  const meetingRoom = room || klass.room;

  const addOneDay = async (day) => {
    await db.withTransaction(async (client) => {
      await assertNoConflict(client, req.teacher.id, {
        dayOfWeek: day,
        startTime: start_time,
        endTime: end_time,
        room: meetingRoom,
      });
      try {
        await client.query(
          `INSERT INTO class_meetings (class_id, day_of_week, start_time, end_time, room)
           VALUES ($1, $2, $3, $4, $5)`,
          [class_id, day, start_time, end_time, meetingRoom]
        );
      } catch (error) {
        if (error && error.code === '23505') {
          throw conflict(
            `${klass.subject_name} · ${klass.section_name} already has a meeting on ${DAY_NAMES[day - 1]} at ${formatTime(start_time)}.`
          );
        }
        throw error;
      }
    });
    const created = await db.query(
      `${MEETING_SELECT} WHERE m.class_id = $1 AND m.day_of_week = $2 AND m.start_time = $3 ORDER BY m.id DESC LIMIT 1`,
      [class_id, day, start_time]
    );
    return created.rows[0];
  };

  if (repeat_week) {
    const created = [];
    const skipped = [];
    for (let day = 1; day <= 5; day += 1) {
      try {
        created.push(await addOneDay(day));
      } catch (error) {
        if (error && error.status === 409) {
          skipped.push({ day_of_week: day, day_name: DAY_NAMES[day - 1], reason: error.message });
        } else {
          throw error;
        }
      }
    }
    if (created.length === 0) {
      throw conflict(
        `No meeting was added: ${skipped.map((skip) => `${skip.day_name} — ${skip.reason}`).join(' ')}`
      );
    }
    return res.status(201).json({
      meetings: created,
      skipped,
      message:
        skipped.length === 0
          ? `Meeting added Monday to Friday.`
          : `Meeting added on ${created.map((meeting) => meeting.day_name).join(', ')}. Skipped: ${skipped.map((skip) => `${skip.day_name} (${skip.reason})`).join('; ')}.`,
    });
  }

  const meeting = await addOneDay(day_of_week);
  res.status(201).json({ meeting });
}

// PATCH /api/teacher/meetings/:id
async function updateMeeting(req, res) {
  const { id } = req.valid.params;
  const { day_of_week, start_time, end_time, room } = req.valid.body;
  const meeting = await findMeeting(id, req.teacher.id);
  const klass = await findClass(meeting.class_id, req.teacher.id);

  await db.withTransaction(async (client) => {
    await assertNoConflict(client, req.teacher.id, {
      dayOfWeek: day_of_week,
      startTime: start_time,
      endTime: end_time,
      room: room || klass.room,
      excludeId: id,
    });
    await client.query(
      `UPDATE class_meetings SET day_of_week = $1, start_time = $2, end_time = $3, room = $4, updated_at = NOW() WHERE id = $5`,
      [day_of_week, start_time, end_time, room || klass.room, id]
    );
  });
  res.json({ meeting: await findMeeting(id, req.teacher.id) });
}

// DELETE /api/teacher/meetings/:id
async function deleteMeeting(req, res) {
  const { id } = req.valid.params;
  await findMeeting(id, req.teacher.id);
  await db.query('DELETE FROM class_meetings WHERE id = $1', [id]);
  res.json({ message: 'Meeting deleted.' });
}

// ---------- Weekly timetable ----------

// One week of the teacher's meetings, with a date on each meeting so the grid can
// show it. Meetings repeat every week; only the dates change from week to week.
// With a year, only that year's classes show — the timetable for a past year.
async function weekMeetings(teacherId, weekStart, academicYear) {
  const where = ['c.teacher_id = $1'];
  const params = [teacherId];
  if (academicYear) {
    params.push(academicYear);
    where.push(`c.academic_year = $${params.length}`);
  }
  const result = await db.query(
    `${MEETING_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.day_of_week, m.start_time, s.name, c.section_name, m.id`,
    params
  );
  return result.rows.map((meeting) => ({
    ...meeting,
    date: addDays(weekStart, meeting.day_of_week - 1),
    day_name: DAY_NAMES[meeting.day_of_week - 1],
  }));
}

// GET /api/teacher/schedules?week_start=&format=  (JSON, or format=csv to download)
async function getSchedules(req, res) {
  const { week_start, academic_year, format } = req.valid.query;
  const today = manilaParts().date;
  const weekStart = mondayOf(week_start || today);
  const weekEnd = addDays(weekStart, 4);
  const meetings = await weekMeetings(req.teacher.id, weekStart, academic_year);

  if (format === 'csv') {
    sendCsv(
      res,
      `timetable-${weekStart}.csv`,
      [
        { header: 'Day', value: (row) => row.day_name },
        { header: 'Date', value: (row) => row.date },
        { header: 'Start time', value: (row) => row.start_time.slice(0, 5) },
        { header: 'End time', value: (row) => row.end_time.slice(0, 5) },
        { header: 'Subject', value: (row) => row.subject_name },
        { header: 'Section', value: (row) => `Grade ${row.grade_level} – ${row.section_name}` },
        { header: 'Room', value: (row) => row.room },
      ],
      meetings
    );
    return;
  }

  res.json({
    week_start: weekStart,
    week_end: weekEnd,
    days: [1, 2, 3, 4, 5].map((day) => ({
      date: addDays(weekStart, day - 1),
      day_of_week: day,
      day_name: DAY_NAMES[day - 1],
    })),
    meetings,
  });
}

// ---------- Today (for the sign-in panel and the dashboard) ----------

// The teacher's classes today, in Asia/Manila time: the class in progress ("now")
// and the following one ("next"). Nothing is shown for past classes, weekends,
// or a teacher with no meetings today.
async function fetchTodayClasses(teacherId) {
  const { date, time } = manilaParts();
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  if (weekday === 0 || weekday === 6) return [];

  // Today means the current year only: a past year's class that met on
  // this weekday is not a class today.
  const year = await db.query("SELECT value FROM settings WHERE key = 'academic_year'");
  const currentYear = year.rows[0] ? year.rows[0].value : null;
  const result = await db.query(
    `${MEETING_SELECT} WHERE c.teacher_id = $1 AND c.academic_year = $2 AND m.day_of_week = $3 AND m.end_time > $4::time
     ORDER BY m.start_time, m.id`,
    [teacherId, currentYear, weekday, time]
  );

  const items = [];
  for (const meeting of result.rows) {
    const status = meeting.start_time <= time ? 'now' : 'next';
    if (status === 'now') {
      items.push({
        id: meeting.id,
        class_id: meeting.class_id,
        title: `${meeting.subject_name} · ${meeting.section_name}`,
        room: meeting.room,
        start_time: meeting.start_time.slice(0, 5),
        end_time: meeting.end_time.slice(0, 5),
        status,
      });
    } else if (!items.some((item) => item.status === 'next')) {
      items.push({
        id: meeting.id,
        class_id: meeting.class_id,
        title: `${meeting.subject_name} · ${meeting.section_name}`,
        room: meeting.room,
        start_time: meeting.start_time.slice(0, 5),
        end_time: meeting.end_time.slice(0, 5),
        status,
      });
      break;
    }
  }
  return items;
}

module.exports = {
  DAY_NAMES,
  DAY_SHORT,
  manilaParts,
  mondayOf,
  addDays,
  formatTime,
  fetchTodayClasses,
  findClass,
  findLearner,
  teacherSchoolId,
  listSubjects,
  getSubject,
  createSubject,
  updateSubject,
  deleteSubject,
  listClasses,
  createClass,
  getClass,
  updateClass,
  deleteClass,
  listLearners,
  createLearner,
  updateLearner,
  deleteLearner,
  downloadLearnerTemplate,
  uploadLearners,
  listClassLearners,
  enrolLearner,
  removeLearner,
  listMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getSchedules,
};
