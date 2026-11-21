// Migration 009: learners move from "one teacher's" to "one school's".
// This test proves the backfill on pre-009 data: two teachers of the same
// school who both created the same learner ID are merged into the earliest
// row, with every enrolment, attendance mark and grade score re-pointed to
// it, and the duplicate row removed. It runs against a scratch database of
// its own (acadsync_migration009), never the test database the other files use.
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { describe, test, before, after } = require('node:test');
const { Client, Pool } = require('pg');
const { config } = require('../src/config');

const SCRATCH_DB = 'acadsync_migration009';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

let scratch;

async function runMigrationFile(pool, filename) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${filename} failed: ${error.message}`);
  } finally {
    client.release();
  }
}

// A connection string names one database, so a scratch database cannot be
// built from it. In that setup the whole merge test is skipped; the merge is
// also covered by the API tests.
const describeMigration = config.db.connectionString ? describe.skip : describe;

describeMigration('Migration 009 on pre-009 data', () => {
  before(async () => {
    // A fresh scratch database, built up to migration 008 only.
    const admin = new Client({ ...config.db, database: 'postgres' });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
      await admin.query(`CREATE DATABASE "${SCRATCH_DB}"`);
    } finally {
      await admin.end();
    }
    scratch = new Pool({ ...config.db, database: SCRATCH_DB });
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
    for (const filename of files) {
      if (filename >= '009_learners_school.sql') continue;
      await runMigrationFile(scratch, filename);
    }
  });

  after(async () => {
    if (scratch) await scratch.end();
    const admin = new Client({ ...config.db, database: 'postgres' });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    } finally {
      await admin.end();
    }
  });

  test('duplicate learner IDs in one school merge into the earliest row, with enrolments, attendance and scores re-pointed', async () => {
    const school = await scratch.query(
      `INSERT INTO schools (name, category, school_type, city_region, principal_contact)
       VALUES ('Migration Test School', 'Secondary', 'Private', 'Test City', 'Test Principal') RETURNING id`
    );
    const schoolId = school.rows[0].id;

    const teachers = await scratch.query(
      `INSERT INTO teachers (first_name, last_name, email, username, password_hash, school_id, mobile)
       VALUES ('First', 'Teacher', 'first@test.local', 'first', 'x', $1, ''),
              ('Second', 'Teacher', 'second@test.local', 'second', 'x', $1, '')
       RETURNING id`,
      [schoolId]
    );
    const [teacherOne, teacherTwo] = teachers.rows.map((row) => row.id).sort((a, b) => a - b);

    const subjects = await scratch.query(
      `INSERT INTO subjects (teacher_id, name, grade_level) VALUES
         ($1, 'Sacraments', 10), ($2, 'Sacraments', 10) RETURNING id`,
      [teacherOne, teacherTwo]
    );
    const classes = await scratch.query(
      `INSERT INTO classes (teacher_id, subject_id, grade_level, section_name, room, academic_year) VALUES
         ($1, $2, 10, 'Luke', 'Room 1', '2026-2027'),
         ($3, $4, 10, 'Saint Augustine', 'Room 2', '2026-2027') RETURNING id`,
      [teacherOne, subjects.rows[0].id, teacherTwo, subjects.rows[1].id]
    );
    const [classOne, classTwo] = classes.rows.map((row) => row.id).sort((a, b) => a - b);

    // The same learner ID, created by two teachers of the same school.
    const learners = await scratch.query(
      `INSERT INTO learners (teacher_id, first_name, last_name, learner_id, sex) VALUES
         ($1, 'Alex', 'Rivera', 'STU-2026-1048', 'Male'),
         ($2, 'Alex', 'Rivera', 'STU-2026-1048', 'Male') RETURNING id`,
      [teacherOne, teacherTwo]
    );
    const [keptId, duplicateId] = learners.rows.map((row) => row.id).sort((a, b) => a - b);

    // The duplicate has its own enrolment, attendance mark and grade score.
    await scratch.query('INSERT INTO class_learners (class_id, learner_id) VALUES ($1, $2), ($3, $4)', [
      classOne, keptId, classTwo, duplicateId,
    ]);
    await scratch.query(
      `INSERT INTO attendance (teacher_id, class_id, learner_id, date, status, time_in, method)
       VALUES ($1, $2, $3, '2026-11-10', 'present', '07:31', 'manual')`,
      [teacherTwo, classTwo, duplicateId]
    );
    const column = await scratch.query(
      `INSERT INTO grade_columns (class_id, quarter, component, position, highest_possible)
       VALUES ($1, 1, 'WW', 1, 25) RETURNING id`,
      [classTwo]
    );
    await scratch.query('INSERT INTO grade_scores (column_id, learner_id, score) VALUES ($1, $2, 20)', [
      column.rows[0].id, duplicateId,
    ]);

    await runMigrationFile(scratch, '009_learners_school.sql');

    // One learner row remains: the earliest, now belonging to the school.
    const remaining = await scratch.query(
      'SELECT id, school_id, birthdate FROM learners WHERE learner_id = $1',
      ['STU-2026-1048']
    );
    assert.equal(remaining.rows.length, 1);
    assert.equal(remaining.rows[0].id, keptId);
    assert.equal(remaining.rows[0].school_id, schoolId);

    // Every reference now points at the kept row; the duplicate is gone.
    const enrolments = await scratch.query('SELECT learner_id FROM class_learners WHERE class_id = $1', [classTwo]);
    assert.equal(enrolments.rows[0].learner_id, keptId);
    const marks = await scratch.query('SELECT learner_id FROM attendance WHERE class_id = $1', [classTwo]);
    assert.equal(marks.rows[0].learner_id, keptId);
    const scores = await scratch.query('SELECT learner_id FROM grade_scores WHERE column_id = $1', [column.rows[0].id]);
    assert.equal(scores.rows[0].learner_id, keptId);
    assert.equal((await scratch.query('SELECT COUNT(*)::int AS count FROM learners')).rows[0].count, 1);

    // The learner ID is now unique per school.
    await assert.rejects(
      scratch.query(
        `INSERT INTO learners (teacher_id, school_id, first_name, last_name, learner_id, sex)
         VALUES ($1, $2, 'Other', 'Person', 'STU-2026-1048', 'Female')`,
        [teacherTwo, schoolId]
      ),
      (error) => error.code === '23505'
    );
  });
});
