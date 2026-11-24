// Grades and Academic Consolidation: the teacher's own class records (DepEd K to 12)
// and the adviser's view of every subject grade for their section.
// Every grade query is scoped to the signed-in teacher; consolidation reads across
// teachers of the same school, but only submitted grades, and only for the
// signed-in teacher's own advisory section.
//
// A score is blank until it is encoded — never 0. The computation lives in
// utils/deped.js (one helper for every grading profile) and is shared by both
// pages. Which profile applies comes from the class's own academic year
// (grading_profiles), so a class from last year keeps last year's system even
// after the admin switches this year's. A filed submission keeps the profile
// it was filed under, so a switch can never recompute a filed grade.
const db = require('../db');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { sendCsv } = require('../utils/csv');
const { findClass } = require('./classes.controller');
const deped = require('../utils/deped');
const grading = require('../utils/grading');

const COMPONENTS = deped.COMPONENTS;
const DEFAULT_MAX = { WW: 25, PT: 50, EX: 50 };

// ---------- Small helpers ----------

async function academicYear(client = db) {
  const result = await client.query("SELECT value FROM settings WHERE key = 'academic_year'");
  return result.rows[0] ? result.rows[0].value : null;
}

// The year a teacher is viewing (Batch 8 fix 13): the validated
// ?academic_year= value when one was sent, else the admin's current year.
// Viewing a past year never changes the stored setting.
async function resolveViewingYear(req, client = db) {
  const requested = req.valid && req.valid.query ? req.valid.query.academic_year : undefined;
  return requested || (await academicYear(client));
}

function columnName(column, profileCode) {
  return deped.columnName(column, profileCode);
}

// The weights for one class: the saved row, or the default for the profile
// and the subject's group (core 20/50/30, MAPEH and EPP/TLE 20/60/20 under
// DO 015; 30/50/20 under DO 8).
async function getWeights(client, classId, profileCode) {
  const result = await client.query(
    'SELECT ww_weight, pt_weight, ex_weight FROM grade_weights WHERE class_id = $1',
    [classId]
  );
  if (result.rowCount === 0) {
    const group = await client.query(
      `SELECT s.subject_group AS "group" FROM classes c
        JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1`,
      [classId]
    );
    return deped.defaultWeights(profileCode, group.rows[0] ? group.rows[0].group : 'core');
  }
  const row = result.rows[0];
  return { ww: row.ww_weight, pt: row.pt_weight, ex: row.ex_weight };
}

// The columns of one class record, in WW / PT / EX order, then by position.
// sub_weight is the share of the Examinations component (null for WW/PT and
// for columns made under DO 8); label is the display name of a default EX
// column ("Summative Test 1") or null.
async function listColumns(client, classId, quarter, profileCode) {
  const result = await client.query(
    `SELECT id, class_id, quarter, component, position, highest_possible::text AS highest_possible,
            sub_weight::text AS sub_weight, label
       FROM grade_columns WHERE class_id = $1 AND quarter = $2
      ORDER BY CASE component WHEN 'WW' THEN 1 WHEN 'PT' THEN 2 ELSE 3 END, position, id`,
    [classId, quarter]
  );
  return result.rows.map((row) => ({
    ...row,
    highest_possible: Number(row.highest_possible),
    sub_weight: row.sub_weight === null ? null : Number(row.sub_weight),
    name: columnName(row, profileCode),
  }));
}

// The first time a teacher opens a class and period, the record starts with
// the standard columns for the profile in force: WW1–WW4 at 25, PT1–PT4 at
// 50, and the Examinations columns (ST1 30%, ST2 30%, Term Exam 40% under
// DO 015; a single Quarterly Assessment column under DO 8). Nothing is
// invented after that: the teacher's own columns are what they left.
async function ensureColumns(client, classId, quarter, profile) {
  let columns = await listColumns(client, classId, quarter, profile.code);
  if (columns.length > 0) return columns;
  const positions = { WW: 0, PT: 0, EX: 0 };
  for (const column of deped.defaultColumns(profile.code)) {
    positions[column.component] += 1;
    await client.query(
      `INSERT INTO grade_columns (class_id, quarter, component, position, highest_possible, sub_weight, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [classId, quarter, column.component, positions[column.component], column.highest_possible, column.sub_weight, column.label]
    );
  }
  columns = await listColumns(client, classId, quarter, profile.code);
  return columns;
}

// Editing scores, columns or weights after a submission clears it, so the adviser
// only ever sees grades as they were filed. The teacher re-submits to file again.
async function clearSubmission(client, classId, quarter, year) {
  const removed = await client.query(
    'DELETE FROM grade_submissions WHERE class_id = $1 AND quarter = $2 AND academic_year = $3',
    [classId, quarter, year]
  );
  return removed.rowCount > 0;
}

// ---------- The dual-role decision (one place) ----------
// Melvin decided on 2026-11-20: when the logged-in teacher is both the
// subject teacher AND the adviser of that class, "Submit to Adviser" becomes
// "Move to Consolidation", filing the grades straight into Academic
// Consolidation. A subject teacher who is not the adviser still submits to
// the adviser. This helper is the one place that decides.
function shouldUseDirectAdd(teacher, klass) {
  const isAdviserOfClass =
    teacher.is_adviser &&
    teacher.advisory_grade === klass.grade_level &&
    String(teacher.advisory_section || '').trim().toLowerCase() ===
      String(klass.section_name || '').trim().toLowerCase();
  return isAdviserOfClass;
}

// A period that does not exist under the profile in force: Quarter 4 under
// DO 015, which has three terms. Quarter 4 data, if it exists, is preserved
// in the database and is readable again when the DO 8 profile is active for
// that year — it is simply not offered while a DO 015 profile is active.
function checkPeriod(profile, quarter) {
  if (!profile.periods.includes(quarter)) {
    throw badRequest(
      `${profile.periodLabel} ${quarter} does not exist under ${profile.label}. This year has ${profile.periodLabel}s ${profile.periods.join(', ')}.`,
      {
        errors: {
          quarter: `Choose ${profile.periodLabel.toLowerCase()} ${profile.periods.join(', ')}.`,
        },
      }
    );
  }
}

// The period to show when none is asked for: the highest period that already
// has columns for this class, otherwise the first period. A period from
// before a switch (Quarter 4) is clamped to the highest period the profile
// offers, so the sheet never opens on a period the profile does not have.
async function resolveQuarter(client, classId, requested, profile) {
  if (requested) return requested;
  // The highest period the teacher has worked on — columns they created, or a
  // period their adviser reminded them about, so the reminder banner is
  // waiting on the sheet that opens.
  const result = await client.query(
    `SELECT MAX(quarter)::int AS quarter FROM (
       SELECT quarter FROM grade_columns WHERE class_id = $1
       UNION ALL
       SELECT quarter FROM grade_reminders WHERE class_id = $1
     ) quarters`,
    [classId]
  );
  const max = result.rows[0].quarter || 1;
  return Math.min(max, profile.periods[profile.periods.length - 1]);
}

// ---------- Loading a grade sheet ----------

// Everything one class record needs: class, weights, columns, the enrolled
// learners with their scores and computed grades, the summary numbers, the
// submission state and any live reminder from the adviser. The grading
// profile is the profile of the class's own academic year.
// `options.klass` / `options.profile` let callers that already read the
// class and its grading profile skip re-reading them; `options.finals`
// (default true) skips the final-grades computation for callers that only
// need this period's checklist (submit check, filing), where finals are
// never read. Skipping them keeps those calls to this period's data only.
async function loadSheet(client, teacherId, classId, quarter, options = {}) {
  const klass = options.klass || (await findClass(classId, teacherId, client));
  const profile = options.profile || (await grading.getClassGradingProfile(client, classId));
  checkPeriod(profile, quarter);
  const year = klass.academic_year;
  const weights = await getWeights(client, classId, profile.code);
  const columns = await ensureColumns(client, classId, quarter, profile);

  const learners = await client.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex
       FROM class_learners cl JOIN learners l ON l.id = cl.learner_id
      WHERE cl.class_id = $1 ORDER BY l.last_name, l.first_name, l.id`,
    [classId]
  );

  const columnIds = columns.map((column) => column.id);
  const scores = new Map(); // learner id -> Map(column id -> score)
  if (columnIds.length > 0) {
    const rows = await client.query(
      `SELECT gs.column_id, gs.learner_id, gs.score::text AS score
         FROM grade_scores gs WHERE gs.column_id = ANY($1::int[])`,
      [columnIds]
    );
    for (const row of rows.rows) {
      if (!scores.has(row.learner_id)) scores.set(row.learner_id, new Map());
      scores.get(row.learner_id).set(row.column_id, Number(row.score));
    }
  }

  const sheetLearners = learners.rows.map((learner) => {
    const learnerScores = scores.get(learner.id) || new Map();
    const computed = deped.computeLearnerGrade(columns, learnerScores, weights, profile.code);
    const scoreMap = {};
    for (const column of columns) {
      const value = learnerScores.get(column.id);
      scoreMap[column.id] = value === undefined ? null : value;
    }
    return { ...learner, scores: scoreMap, computed };
  });

  const submission = await client.query(
    `SELECT submitted_at, profile FROM grade_submissions
      WHERE class_id = $1 AND quarter = $2 AND academic_year = $3`,
    [classId, quarter, year]
  );
  // Every period already filed for this class and year, so the period tabs
  // can mark the filed ones.
  const filedPeriods = await client.query(
    `SELECT quarter FROM grade_submissions WHERE class_id = $1 AND academic_year = $2 ORDER BY quarter`,
    [classId, year]
  );
  const reminder = await client.query(
    `SELECT gr.updated_at AS reminded_at, t.first_name AS adviser_first_name,
            t.last_name AS adviser_last_name
       FROM grade_reminders gr
       JOIN teachers t ON t.id = gr.adviser_id
      WHERE gr.class_id = $1 AND gr.quarter = $2 AND gr.academic_year = $3`,
    [classId, quarter, year]
  );

  // A reminder counts while it is newer than the last submission: once the
  // teacher files again, the banner goes away.
  const submittedAt = submission.rows[0] ? new Date(submission.rows[0].submitted_at) : null;
  const remindedAt = reminder.rows[0] ? new Date(reminder.rows[0].reminded_at) : null;
  const reminderActive = remindedAt !== null && (submittedAt === null || remindedAt > submittedAt);

  // Whether this teacher files straight into Consolidation for this class
  // (they are both its subject teacher and its adviser).
  const teacher = await client.query(
    'SELECT is_adviser, advisory_grade, advisory_section FROM teachers WHERE id = $1',
    [teacherId]
  );
  const directAdd = teacher.rows[0] ? shouldUseDirectAdd(teacher.rows[0], klass) : false;

  // Final grades for this class, from the SAVED scores of every period
  // (Batch 8 fix 15): a period grade shows once that learner's saved
  // record for the period is complete, and the final grade is the mean
  // once every period is complete — whether or not the period was filed.
  // Filing is what sends grades to Consolidation and the Report Card,
  // which stay filed-only; this Grades-page view is the teacher's own
  // working final. Any subject teacher sees it here — no advisory
  // assignment is needed, unlike Consolidation. Callers that skip finals
  // get the same shape with nulls, so the checklist never reads them.
  const finals =
    options.finals === false
      ? { filed_periods: filedPeriods.rows.length, total_periods: profile.periods.length, grades: {}, period_grades: {} }
      : await computeClassFinals(client, classId, year, profile, filedPeriods.rows.length);

  return {
    class: klass,
    quarter,
    academic_year: year,
    grading: grading.gradingInfo(profile, year),
    weights,
    columns,
    learners: sheetLearners,
    stats: deped.computeClassStats(sheetLearners),
    // The mean of the saved period grades, per learner, once every period
    // is complete — null until then. The Grades page shows it as the Final
    // column and in the Final Grades tab.
    finals,
    // The Grades page reads this to label its button: "Move to
    // Consolidation" for the adviser's own class, "Submit to adviser" otherwise.
    direct_add: directAdd,
    submission: submission.rows[0]
      ? { submitted_at: submission.rows[0].submitted_at, profile: submission.rows[0].profile }
      : null,
    submitted_periods: filedPeriods.rows.map((row) => row.quarter),
    // Always an object: the Grades page reads .active without a null check.
    reminder: {
      active: reminderActive,
      reminded_at: reminder.rows[0] ? reminder.rows[0].reminded_at : null,
      adviser_name: reminder.rows[0]
        ? `${reminder.rows[0].adviser_last_name}, ${reminder.rows[0].adviser_first_name}`
        : null,
    },
  };
}

// ---------- Grades ----------

// GET /api/teacher/grades/:id?quarter=&format=  (the class record for one period;
// add format=csv to download the grade sheet instead)
async function getGradeSheet(req, res) {
  const { id } = req.valid.params;
  const { quarter: requestedQuarter, format } = req.valid.query;
  const klass = await findClass(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, id);
  if (requestedQuarter) checkPeriod(profile, requestedQuarter);
  const quarter = await resolveQuarter(db, id, requestedQuarter, profile);
  const sheet = await loadSheet(db, req.teacher.id, id, quarter, { klass, profile });

  if (format === 'csv') {
    const third = profile.thirdShort;
    const headers = [{ header: 'Learner', value: (row) => `${row.last_name}, ${row.first_name}` }];
    headers.push(
      { header: 'LRN', value: (row) => row.learner_id },
      { header: 'Sex', value: (row) => row.sex }
    );
    for (const column of sheet.columns) {
      headers.push({
        header: `${column.name} (${column.highest_possible})`,
        value: (row) => (row.scores[column.id] === null ? '' : row.scores[column.id]),
      });
    }
    for (const component of COMPONENTS) {
      const label = component === 'EX' ? third : component;
      headers.push(
        { header: `${label} Total`, value: (row) => row.computed.components[component].total },
        {
          header: `${label} PS`,
          value: (row) => (row.computed.components[component].ps === null ? '' : row.computed.components[component].ps.toFixed(2)),
        },
        {
          header: `${label} WS`,
          value: (row) => (row.computed.components[component].ws === null ? '' : row.computed.components[component].ws.toFixed(2)),
        }
      );
    }
    headers.push(
      {
        header: 'Initial Grade',
        value: (row) => (row.computed.initial === null ? '' : row.computed.initial.toFixed(2)),
      },
      { header: profile.gradeLabel, value: (row) => (row.computed.qg === null ? '' : row.computed.qg) },
      { header: 'Status', value: (row) => row.computed.status }
    );
    const safe = (value) => String(value).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    sendCsv(res, `class-record-${safe(sheet.class.subject_name)}-${safe(sheet.class.section_name)}-${profile.periodShort.toLowerCase()}${quarter}.csv`, headers, sheet.learners);
    return;
  }

  res.json(sheet);
}

// POST /api/teacher/grades/:id/scores  { quarter, scores: [{ column_id, learner_id, score }] }
// Saves the scores for one period. A null score clears that cell. Saving after a
// submission clears the submission, so the teacher files the record again.
async function saveScores(req, res) {
  const { id } = req.valid.params;
  const { quarter, scores } = req.valid.body;
  const klass = await findClass(id, req.teacher.id); // ownership: the class must be the teacher's own
  const profile = await grading.getClassGradingProfile(db, id);
  checkPeriod(profile, quarter);
  const year = klass.academic_year;

  // Validation needs only this period's columns and the enrolment list —
  // not a full sheet (the old code loaded the whole sheet, finals for
  // every period included, just to check the scores belong here).
  const columns = await ensureColumns(db, id, quarter, profile);
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const enrolledRows = await db.query('SELECT learner_id FROM class_learners WHERE class_id = $1', [id]);
  const enrolled = new Set(enrolledRows.rows.map((row) => row.learner_id));

  for (const entry of scores) {
    const column = columnsById.get(entry.column_id);
    if (!column) throw badRequest('One of the columns does not belong to this class record.');
    if (!enrolled.has(entry.learner_id)) {
      throw badRequest('One of the learners is not enrolled in this class.', {
        errors: { scores: 'Every score must be for a learner enrolled in this class.' },
      });
    }
    if (entry.score !== null && (Number.isNaN(Number(entry.score)) || Number(entry.score) < 0 || Number(entry.score) > column.highest_possible)) {
      throw badRequest(`A score is over the highest possible score of ${column.highest_possible} for ${column.name}.`, {
        errors: { scores: `Scores for ${column.name} must be between 0 and ${column.highest_possible}.` },
      });
    }
  }
  if (new Set(scores.map((entry) => `${entry.column_id}:${entry.learner_id}`)).size !== scores.length) {
    throw badRequest('A score appears twice.', { errors: { scores: 'List each score once.' } });
  }

  const cleared = await db.withTransaction(async (client) => {
    for (const entry of scores) {
      if (entry.score === null) {
        await client.query('DELETE FROM grade_scores WHERE column_id = $1 AND learner_id = $2', [entry.column_id, entry.learner_id]);
      } else {
        await client.query(
          `INSERT INTO grade_scores (column_id, learner_id, score) VALUES ($1, $2, $3)
           ON CONFLICT (column_id, learner_id) DO UPDATE SET score = $3, updated_at = NOW()`,
          [entry.column_id, entry.learner_id, entry.score]
        );
      }
    }
    return clearSubmission(client, id, quarter, year);
  });

  res.json({
    message: 'Scores saved.',
    saved: scores.length,
    submission_cleared: cleared,
  });
}

// POST /api/teacher/grades/:id/columns  { quarter, component }
// Adds one column at the end of its component (WW 25, PT 50, EX 50 to start).
// A new Examinations column starts with a sub-weight of 0, so the shares of
// the period still add up to 100 until the teacher sets its share.
async function addColumn(req, res) {
  const { id } = req.valid.params;
  const { quarter, component } = req.valid.body;
  const klass = await findClass(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, id);
  checkPeriod(profile, quarter);
  const year = klass.academic_year;

  const column = await db.withTransaction(async (client) => {
    const columns = await ensureColumns(client, id, quarter, profile);
    const position = columns.filter((c) => c.component === component).length + 1;
    const subWeight = component === 'EX' && profile.transmutation !== 'do8' ? 0 : null;
    const inserted = await client.query(
      `INSERT INTO grade_columns (class_id, quarter, component, position, highest_possible, sub_weight)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, component, position, highest_possible::text AS highest_possible, sub_weight::text AS sub_weight, label`,
      [id, quarter, component, position, DEFAULT_MAX[component], subWeight]
    );
    const row = inserted.rows[0];
    await clearSubmission(client, id, quarter, year);
    return {
      ...row,
      highest_possible: Number(row.highest_possible),
      sub_weight: row.sub_weight === null ? null : Number(row.sub_weight),
      name: columnName(row, profile.code),
    };
  });
  res.status(201).json({ column, message: `${column.name} column added (highest possible score ${column.highest_possible}).` });
}

// PATCH /api/teacher/grades/:id/columns/:columnId  { highest_possible }
// Refused while a score in the column is higher than the new highest possible:
// lower those scores first, so no saved score is ever over its column.
async function updateColumn(req, res) {
  const { id, columnId } = req.valid.params;
  const { highest_possible } = req.valid.body;
  const klass = await findClass(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, id);
  const year = klass.academic_year;

  const column = await db.withTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, class_id, quarter, component, position, highest_possible::text AS highest_possible,
              sub_weight::text AS sub_weight, label
         FROM grade_columns WHERE id = $1 AND class_id = $2`,
      [columnId, id]
    );
    if (found.rowCount === 0) throw notFound('Column not found.');
    checkPeriod(profile, found.rows[0].quarter);
    const over = await client.query(
      'SELECT COUNT(*)::int AS count FROM grade_scores WHERE column_id = $1 AND score > $2',
      [columnId, highest_possible]
    );
    if (over.rows[0].count > 0) {
      throw badRequest(`${over.rows[0].count} ${over.rows[0].count === 1 ? 'score is' : 'scores are'} higher than ${highest_possible}. Lower ${over.rows[0].count === 1 ? 'it' : 'them'} first.`, {
        errors: { highest_possible: 'Some scores are higher than this.' },
      });
    }
    await client.query(
      'UPDATE grade_columns SET highest_possible = $1, updated_at = NOW() WHERE id = $2',
      [highest_possible, columnId]
    );
    await clearSubmission(client, id, found.rows[0].quarter, year);
    const updated = await client.query(
      `SELECT id, class_id, quarter, component, position, highest_possible::text AS highest_possible,
              sub_weight::text AS sub_weight, label
         FROM grade_columns WHERE id = $1`,
      [columnId]
    );
    const row = updated.rows[0];
    return {
      ...row,
      highest_possible: Number(row.highest_possible),
      sub_weight: row.sub_weight === null ? null : Number(row.sub_weight),
      name: columnName(row, profile.code),
    };
  });
  res.json({ column, message: `Highest possible score for ${column.name} set to ${column.highest_possible}.` });
}

// DELETE /api/teacher/grades/:id/columns/:columnId
// The column and its scores go with it. The last column of a component stays:
// a component with no columns cannot be computed. The columns after it renumber.
// Deleting an Examinations column rescales the remaining shares so they still
// add up to 100 (the largest share takes the rounding remainder).
async function deleteColumn(req, res) {
  const { id, columnId } = req.valid.params;
  const klass = await findClass(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, id);
  const year = klass.academic_year;

  const removed = await db.withTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, class_id, quarter, component, position, label FROM grade_columns WHERE id = $1 AND class_id = $2`,
      [columnId, id]
    );
    if (found.rowCount === 0) throw notFound('Column not found.');
    const column = found.rows[0];
    checkPeriod(profile, column.quarter);
    const count = await client.query(
      'SELECT COUNT(*)::int AS count FROM grade_columns WHERE class_id = $1 AND quarter = $2 AND component = $3',
      [id, column.quarter, column.component]
    );
    if (count.rows[0].count <= 1) {
      throw badRequest(`Keep at least one ${column.component} column.`, {
        errors: { column: 'A component needs at least one column.' },
      });
    }
    await client.query('DELETE FROM grade_columns WHERE id = $1', [columnId]);
    await client.query(
      `UPDATE grade_columns SET position = position - 1
        WHERE class_id = $1 AND quarter = $2 AND component = $3 AND position > $4`,
      [id, column.quarter, column.component, column.position]
    );
    if (column.component === 'EX' && profile.transmutation !== 'do8') {
      await rescaleExSubWeights(client, id, column.quarter);
    }
    await clearSubmission(client, id, column.quarter, year);
    return column;
  });
  res.json({ message: `${columnName(removed, profile.code)} column removed.` });
}

// The Examinations shares of one period, rescaled to add up to 100 after a
// column was deleted. A share of 0 stays 0; the largest share takes the
// rounding remainder so the total is exactly 100.
async function rescaleExSubWeights(client, classId, quarter) {
  const rows = await client.query(
    `SELECT id, sub_weight::text AS sub_weight FROM grade_columns
      WHERE class_id = $1 AND quarter = $2 AND component = 'EX' ORDER BY position`,
    [classId, quarter]
  );
  const total = rows.rows.reduce((sum, row) => sum + (Number(row.sub_weight) || 0), 0);
  if (total === 0 || rows.rows.length === 0) return;
  const scaled = rows.rows.map((row) => ({
    id: row.id,
    weight: Math.round(((Number(row.sub_weight) || 0) / total) * 10000) / 100,
  }));
  const sum = scaled.reduce((total, entry) => total + entry.weight, 0);
  if (scaled.length > 0 && sum !== 100) {
    let largest = scaled[0];
    for (const entry of scaled) if (entry.weight > largest.weight) largest = entry;
    largest.weight = Math.round((largest.weight + (100 - sum)) * 100) / 100;
  }
  for (const entry of scaled) {
    await client.query('UPDATE grade_columns SET sub_weight = $1 WHERE id = $2', [entry.weight, entry.id]);
  }
}

// PATCH /api/teacher/grades/:id/sub-weights  { quarter, sub_weights: [{ column_id, sub_weight }] }
// Saves the Examinations shares of one period together (ST1 30, ST2 30,
// Term Exam 40). The shares must add up to 100, and every column must be an
// Examinations column of this class and period. Saving after a submission
// clears it, like any other change to the record.
async function updateSubWeights(req, res) {
  const { id } = req.valid.params;
  const { quarter, sub_weights } = req.valid.body;
  const klass = await findClass(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, id);
  checkPeriod(profile, quarter);
  const year = klass.academic_year;

  const columns = await db.withTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, component, position, sub_weight::text AS sub_weight, label
         FROM grade_columns WHERE id = ANY($1::int[]) AND class_id = $2 AND quarter = $3`,
      [sub_weights.map((entry) => entry.column_id), id, quarter]
    );
    if (found.rowCount !== sub_weights.length) {
      throw badRequest('One of the columns does not belong to this class record.');
    }
    for (const row of found.rows) {
      if (row.component !== 'EX') {
        throw badRequest('Only Examinations columns have a sub-weight.');
      }
    }
    const byId = new Map(sub_weights.map((entry) => [entry.column_id, entry.sub_weight]));
    for (const row of found.rows) {
      await client.query('UPDATE grade_columns SET sub_weight = $1, updated_at = NOW() WHERE id = $2', [byId.get(row.id), row.id]);
    }
    await clearSubmission(client, id, quarter, year);
    return listColumns(client, id, quarter, profile.code);
  });
  const exColumns = columns.filter((column) => column.component === 'EX');
  res.json({ columns: exColumns, message: 'Examinations sub-weights saved.' });
}

// PATCH /api/teacher/grades/:id/weights  { ww_weight, pt_weight, ex_weight }
// The three weights must add up to 100 (checked by the validator as well as the table).
async function updateWeights(req, res) {
  const { id } = req.valid.params;
  const { ww_weight, pt_weight, ex_weight } = req.valid.body;
  const klass = await findClass(id, req.teacher.id);
  const year = klass.academic_year;

  await db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO grade_weights (class_id, ww_weight, pt_weight, ex_weight)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (class_id) DO UPDATE SET ww_weight = $2, pt_weight = $3, ex_weight = $4, updated_at = NOW()`,
      [id, ww_weight, pt_weight, ex_weight]
    );
    // Weights apply to every period of the class, so any filed period clears.
    await client.query('DELETE FROM grade_submissions WHERE class_id = $1 AND academic_year = $2', [id, year]);
  });
  res.json({ weights: { ww: ww_weight, pt: pt_weight, ex: ex_weight }, message: 'Weights saved.' });
}

// ---------- Submission ----------

// The checklist the Submit modal shows: how far encoding has gone, how many
// records are complete, and how many completed records are below 75.
function submissionChecklist(sheet) {
  const { stats } = sheet;
  const entered = sheet.learners.reduce((sum, learner) => sum + learner.computed.entered, 0);
  const cells = sheet.learners.reduce((sum, learner) => sum + learner.computed.cells, 0);
  return {
    quarter: sheet.quarter,
    academic_year: sheet.academic_year,
    grading: sheet.grading,
    total_learners: stats.total_learners,
    complete_learners: stats.complete_count,
    incomplete_learners: stats.total_learners - stats.complete_count,
    entered_cells: entered,
    total_cells: cells,
    encoding_pct: stats.encoding_pct,
    incomplete_names: sheet.learners
      .filter((learner) => !learner.computed.complete)
      .map((learner) => `${learner.last_name}, ${learner.first_name}`),
    intervention: stats.intervention,
    submitted: sheet.submission !== null,
    submitted_at: sheet.submission ? sheet.submission.submitted_at : null,
  };
}

// GET /api/teacher/grades/:id/submission-check?quarter=
async function getSubmissionCheck(req, res) {
  const { id } = req.valid.params;
  const { quarter: requestedQuarter } = req.valid.query;
  await findClass(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, id);
  if (requestedQuarter) checkPeriod(profile, requestedQuarter);
  const quarter = await resolveQuarter(db, id, requestedQuarter, profile);
  // The checklist needs this period only; the final grades are never read.
  const sheet = await loadSheet(db, req.teacher.id, id, quarter, { finals: false });
  res.json(submissionChecklist(sheet));
}

// POST /api/teacher/grades/:id/submit  { quarter, confirm_blanks }
// Files the class record with the adviser. When learners are still incomplete
// the teacher must explicitly confirm the blanks (confirm_blanks: true).
// Re-submitting after edits replaces the filing with a new timestamp.
// The filing keeps the grading system it was filed under (grade_submissions
// .profile), so a later switch for the year never recomputes it.
async function submitGrades(req, res) {
  const { id } = req.valid.params;
  const { quarter, confirm_blanks } = req.valid.body;
  const klass = await findClass(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, id);
  checkPeriod(profile, quarter);
  const year = klass.academic_year;

  // The dual-role rule (see shouldUseDirectAdd above): the adviser of this
  // class files straight into Consolidation; anyone else submits to the adviser.
  // req.teacher carries no adviser fields, so they are read here.
  const teacher = await db.query(
    'SELECT is_adviser, advisory_grade, advisory_section FROM teachers WHERE id = $1',
    [req.teacher.id]
  );
  const direct = teacher.rows[0] ? shouldUseDirectAdd(teacher.rows[0], klass) : false;

  const sheet = await loadSheet(db, req.teacher.id, id, quarter, { klass, profile, finals: false });
  const checklist = submissionChecklist(sheet);
  if (checklist.complete_learners < checklist.total_learners && !confirm_blanks) {
    throw badRequest(
      `${checklist.total_learners - checklist.complete_learners} ${checklist.total_learners - checklist.complete_learners === 1 ? 'learner still has' : 'learners still have'} blank scores. Confirm to submit anyway.`,
      { code: 'CONFIRM_BLANKS', checklist }
    );
  }

  const submitted = await db.query(
    `INSERT INTO grade_submissions (class_id, quarter, academic_year, submitted_by, profile)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (class_id, quarter, academic_year)
     DO UPDATE SET submitted_by = $4, profile = $5, submitted_at = NOW(), updated_at = NOW()
     RETURNING submitted_at`,
    [id, quarter, year, req.teacher.id, profile.code]
  );
  // The filing itself is the same either way, so Consolidation shows a
  // directly-added grade exactly like a submitted one. Only the words differ.
  res.json({
    message: direct
      ? `${profile.periodLabel} ${quarter} — ${klass.subject_name} moved to Consolidation.`
      : `${profile.periodLabel} ${quarter} — ${klass.subject_name} submitted to the adviser.`,
    direct,
    submission: { submitted_at: submitted.rows[0].submitted_at },
  });
}


// ---------- Academic Consolidation ----------

// The signed-in teacher's advisory assignment, or null when they are not an adviser.
async function adviserOf(client, teacherId) {
  const result = await client.query(
    `SELECT t.id, t.first_name, t.last_name, t.school_id,
            t.is_adviser, t.advisory_grade, t.advisory_section
       FROM teachers t WHERE t.id = $1`,
    [teacherId]
  );
  const teacher = result.rows[0];
  if (!teacher || !teacher.is_adviser || !teacher.advisory_grade || !teacher.advisory_section) return null;
  return teacher;
}

// Every class taught to one section, across all teachers of the same school:
// the section's subjects, whoever teaches them.
async function sectionClasses(client, adviser, year) {
  const result = await client.query(
    `SELECT c.id, c.subject_id, s.name AS subject_name, c.grade_level, c.section_name,
            c.room, c.academic_year, c.teacher_id,
            t.first_name AS teacher_first_name, t.last_name AS teacher_last_name
       FROM classes c
       JOIN subjects s ON s.id = c.subject_id
       JOIN teachers t ON t.id = c.teacher_id
      WHERE c.grade_level = $1
        AND LOWER(TRIM(c.section_name)) = LOWER(TRIM($2))
        AND c.academic_year = $3
        AND t.school_id = $4
      ORDER BY s.name, c.id`,
    [adviser.advisory_grade, adviser.advisory_section, year, adviser.school_id]
  );
  return result.rows;
}

// One class taught to the adviser's section, in any year: a reminder for a
// past-year class must carry that class's own year, or the subject teacher
// (whose Grades page reads the class's year) never sees the banner.
async function sectionClassById(client, adviser, classId) {
  const result = await client.query(
    `SELECT c.id, c.subject_id, s.name AS subject_name, c.grade_level, c.section_name,
            c.room, c.academic_year, c.teacher_id,
            t.first_name AS teacher_first_name, t.last_name AS teacher_last_name
       FROM classes c
       JOIN subjects s ON s.id = c.subject_id
       JOIN teachers t ON t.id = c.teacher_id
      WHERE c.id = $1
        AND c.grade_level = $2
        AND LOWER(TRIM(c.section_name)) = LOWER(TRIM($3))
        AND t.school_id = $4`,
    [classId, adviser.advisory_grade, adviser.advisory_section, adviser.school_id]
  );
  return result.rows[0] || null;
}

// The period to show when none is asked for: the highest period with a
// submission for this section, otherwise the first period. A period from
// before a switch (Quarter 4) is clamped to the highest period the profile
// offers.
async function resolveConsolidationQuarter(client, classIds, requested, profile, manualMaxQuarter = null) {
  if (requested) return requested;
  let max = manualMaxQuarter || profile.periods[0];
  if (classIds.length > 0) {
    const result = await client.query(
      'SELECT MAX(quarter)::int AS quarter FROM grade_submissions WHERE class_id = ANY($1::int[])',
      [classIds]
    );
    if (result.rows[0].quarter) max = Math.max(max, result.rows[0].quarter);
  }
  return Math.min(max, profile.periods[profile.periods.length - 1]);
}

// One subject's grades for one period, for every learner on the roster:
// the grade on the card (qg), or null when the record is not complete.
// The grades are computed under the profile the submission was filed under,
// so a later switch for the year never recomputes them.
async function computeSubjectPeriodGrades(client, classId, quarter, submissionProfile, roster) {
  const columns = await listColumns(client, classId, quarter, submissionProfile);
  const weights = await getWeights(client, classId, submissionProfile);
  const columnIds = columns.map((column) => column.id);
  const scoreRows = columnIds.length === 0
    ? { rows: [] }
    : await client.query(
      `SELECT gs.column_id, gs.learner_id, gs.score::text AS score
         FROM grade_scores gs WHERE gs.column_id = ANY($1::int[])`,
      [columnIds]
    );
  const scoresByLearner = new Map(); // learner PK -> Map(column id -> score)
  for (const row of scoreRows.rows) {
    if (!scoresByLearner.has(row.learner_id)) scoresByLearner.set(row.learner_id, new Map());
    scoresByLearner.get(row.learner_id).set(row.column_id, Number(row.score));
  }
  const perLearner = new Map(); // roster key -> qg or null
  for (const [key, learner] of roster) {
    const learnerPk = learner.byClass.get(classId);
    if (learnerPk === undefined) {
      perLearner.set(key, null);
      continue;
    }
    const computed = deped.computeLearnerGrade(
      columns,
      scoresByLearner.get(learnerPk) || new Map(),
      weights,
      submissionProfile
    );
    perLearner.set(key, computed.qg);
  }
  return perLearner;
}

// The section roster: every learner enrolled in any of the section's classes,
// each learner once, keyed by their school learner ID. When the same learner
// was added by two teachers, the adviser's own row is used for the name.
async function sectionRoster(client, adviser, classIds) {
  const roster = new Map(); // lower learner_id -> { first_name, last_name, learner_id, sex, byClass: Map(classId -> learner PK) }
  if (classIds.length === 0) return roster;
  const enrolled = await client.query(
    `SELECT cl.class_id, l.id, l.first_name, l.last_name, l.learner_id, l.sex, l.birthdate::text AS birthdate, l.teacher_id
       FROM class_learners cl
       JOIN learners l ON l.id = cl.learner_id
      WHERE cl.class_id = ANY($1::int[])
      ORDER BY l.last_name, l.first_name, l.id`,
    [classIds]
  );
  for (const row of enrolled.rows) {
    const key = String(row.learner_id).trim().toLowerCase();
    let learner = roster.get(key);
    if (!learner) {
      learner = {
        first_name: row.first_name,
        last_name: row.last_name,
        learner_id: row.learner_id,
        sex: row.sex,
        birthdate: null,
        byClass: new Map(),
      };
      roster.set(key, learner);
    }
    // The adviser's own learner row wins for the displayed name.
    if (row.teacher_id === adviser.id) {
      learner.first_name = row.first_name;
      learner.last_name = row.last_name;
      learner.sex = row.sex;
      if (row.birthdate) learner.birthdate = row.birthdate;
    } else if (learner.birthdate == null) {
      learner.birthdate = row.birthdate;
    }
    learner.byClass.set(row.class_id, row.id);
  }
  return roster;
}

// One entry per subject name. When two teachers teach the same subject to the
// section, the first filed class carries the grades; the card names both teachers.
function groupSubjectsByName(classes, submissions, reminders) {
  const subjectsByName = new Map();
  for (const klass of classes) {
    const key = klass.subject_name.trim().toLowerCase();
    let subject = subjectsByName.get(key);
    if (!subject) {
      subject = {
        subject_name: klass.subject_name,
        teacher_names: [],
        teacher_ids: [],
        class_ids: [],
        submitted: false,
        submitted_at: null,
        reminded_at: null,
      };
      subjectsByName.set(key, subject);
    }
    subject.teacher_names.push(`${klass.teacher_last_name}, ${klass.teacher_first_name}`);
    subject.teacher_ids.push(klass.teacher_id);
    subject.class_ids.push(klass.id);
    if (submissions.has(klass.id)) {
      subject.submitted = true;
      subject.submitted_at = subject.submitted_at || submissions.get(klass.id).submitted_at;
    }
    if (reminders.has(klass.id)) {
      subject.reminded_at = subject.reminded_at || reminders.get(klass.id);
    }
  }
  return [...subjectsByName.values()];
}

// ---------- Manual subjects (Batch 8 fix 10) ----------
// A manual subject is created by an adviser when the subject teacher has
// no AcadSync account: there is no class, no score columns and no Grades
// page filing. The adviser uploads one CSV carrying every period's term
// grades, and Consolidation (and the Report Card) treat those grades like
// filed grades. A manual grade is the term grade as given — it is never
// recomputed from WW/PT/EX scores and no floor is applied; the profile
// frozen on the subject at creation supplies the descriptor bands.

// Every manual subject for one adviser's section and year, with its
// grades: Map(period -> Map(roster key -> grade)). Roster keys are the
// school learner IDs, lowercased and trimmed, the same keys
// sectionRoster builds.
async function loadManualSubjects(client, adviser, year) {
  const subjects = await client.query(
    `SELECT id, adviser_id, school_id, subject_name, teacher_name, grade_level,
            section_name, academic_year, profile_code, created_at, updated_at
       FROM manual_subjects
      WHERE adviser_id = $1 AND grade_level = $2
        AND LOWER(TRIM(section_name)) = LOWER(TRIM($3))
        AND academic_year = $4 AND school_id = $5
      ORDER BY LOWER(TRIM(subject_name)), id`,
    [adviser.id, adviser.advisory_grade, adviser.advisory_section, year, adviser.school_id]
  );
  const rows = subjects.rows;
  const grades = new Map(); // manual subject id -> Map(period -> Map(roster key -> grade))
  if (rows.length > 0) {
    const gradeRows = await client.query(
      `SELECT manual_subject_id, LOWER(TRIM(learner_id_text)) AS roster_key,
              quarter, grade::text AS grade
         FROM manual_subject_grades
        WHERE manual_subject_id = ANY($1::int[])`,
      [rows.map((row) => row.id)]
    );
    for (const row of gradeRows.rows) {
      if (!grades.has(row.manual_subject_id)) grades.set(row.manual_subject_id, new Map());
      const byPeriod = grades.get(row.manual_subject_id);
      if (!byPeriod.has(row.quarter)) byPeriod.set(row.quarter, new Map());
      byPeriod.get(row.quarter).set(row.roster_key, Number(row.grade));
    }
  }
  return rows.map((row) => ({ ...row, grades: grades.get(row.id) || new Map() }));
}

// Merges manual subjects into subject entries built from real classes
// (groupSubjectsByName / buildFinals / buildReportCards shapes). Each
// entry gains `manual` (the manual subject row, or null). A manual subject
// whose name matches a real class merges into that entry — the real
// filing takes precedence per period, the manual grades fill the rest.
// A manual subject with no real class is inserted in alphabetical
// position, so the merged list keeps Consolidation's existing order.
function attachManualSubjects(entries, manualSubjects) {
  const byKey = new Map(entries.map((entry) => [entry.subject_name.trim().toLowerCase(), entry]));
  const orphans = [];
  for (const manual of manualSubjects) {
    const key = manual.subject_name.trim().toLowerCase();
    const entry = byKey.get(key);
    if (entry) {
      entry.manual = manual;
    } else {
      orphans.push(manual);
    }
  }
  orphans.sort(
    (a, b) =>
      a.subject_name.trim().toLowerCase().localeCompare(b.subject_name.trim().toLowerCase()) || a.id - b.id
  );
  for (const manual of orphans) {
    const key = manual.subject_name.trim().toLowerCase();
    const entry = {
      subject_name: manual.subject_name,
      teacher_names: [manual.teacher_name],
      class_ids: [],
      // A manual subject with no real class has nothing filed yet: the
      // period view fills `submitted` in from its grades, and it must
      // never read as reminded (there is no class to remind).
      submitted: false,
      submitted_at: null,
      reminded_at: null,
      manual,
    };
    const index = entries.findIndex((entry) => entry.subject_name.trim().toLowerCase() > key);
    if (index === -1) entries.push(entry);
    else entries.splice(index, 0, entry);
    byKey.set(key, entry);
  }
  for (const entry of entries) {
    if (!('manual' in entry)) entry.manual = null;
  }
  return entries;
}

// One period's manual grades, one entry per roster learner (null when the
// learner has no manual grade for the period).
function manualPeriodGrades(manual, quarter, roster) {
  const byPeriod = manual ? manual.grades.get(quarter) : undefined;
  const out = new Map();
  for (const key of roster.keys()) out.set(key, byPeriod ? byPeriod.get(key) ?? null : null);
  return out;
}

// A manual subject counts as filed for a period when at least one roster
// learner has a manual grade for it — mirroring "submit anyway" for a
// real filing, where a filed period counts even with blanks left in it.
function manualHasGrades(manual, quarter) {
  const byPeriod = manual ? manual.grades.get(quarter) : undefined;
  return !!byPeriod && byPeriod.size > 0;
}

// The highest period with a manual grade for one adviser's section and
// year, or null when there are no manual grades yet. Used to open
// Consolidation on the highest period that already has data.
async function maxManualQuarter(client, adviser, year) {
  const result = await client.query(
    `SELECT MAX(g.quarter)::int AS quarter
       FROM manual_subject_grades g
       JOIN manual_subjects s ON s.id = g.manual_subject_id
      WHERE s.adviser_id = $1 AND s.grade_level = $2
        AND LOWER(TRIM(s.section_name)) = LOWER(TRIM($3))
        AND s.academic_year = $4 AND s.school_id = $5`,
    [adviser.id, adviser.advisory_grade, adviser.advisory_section, year, adviser.school_id]
  );
  return result.rows[0] ? result.rows[0].quarter : null;
}

// Rank learners by a grade, highest first. Learners with the same grade share a rank.
function rankLearners(learners, gradeKey) {
  const ranked = learners.filter((learner) => learner[gradeKey] !== null).sort((a, b) => b[gradeKey] - a[gradeKey]);
  let rank = 0;
  let previous = null;
  for (const learner of ranked) {
    if (learner[gradeKey] !== previous) {
      rank += 1;
      previous = learner[gradeKey];
    }
    learner.rank = rank;
  }
}

// The filed period grades for one class across the year's periods, from
// filed submissions only: Map(period -> Map(roster key -> qg)). A period
// with no submission is absent. Each period is computed under the profile
// its submission was filed under, so a later switch never recomputes it.
async function classFiledPeriodGrades(client, classId, year, profile, roster) {
  const submitted = await client.query(
    `SELECT quarter, profile FROM grade_submissions WHERE class_id = $1 AND academic_year = $2`,
    [classId, year]
  );
  const byQuarter = new Map(submitted.rows.map((row) => [row.quarter, row.profile]));
  const byPeriod = new Map();
  for (const period of profile.periods) {
    const submissionProfile = byQuarter.get(period);
    if (!submissionProfile) continue;
    byPeriod.set(period, await computeSubjectPeriodGrades(client, classId, period, submissionProfile, roster));
  }
  return byPeriod;
}

// The final grade for every learner of one class, from the SAVED scores
// of every period (Batch 8 fix 15): the mean of the period grades, and
// only once every period of the active profile has a complete saved
// record for that learner. A learner with an incomplete record in any
// period has no final grade yet. Keyed by learner id (the learners table
// primary key), so the Grades page can attach it to its rows — any subject
// teacher sees their own class's finals here, with no advisory assignment
// needed. period_grades carries the saved grade of each period per
// learner (null when that period has no complete saved record), so the
// Final Grades tab can show every period side by side. `filedCount` is
// the number of periods with a filing, carried through so the tab can
// still say how many terms are filed. The periods are computed under the
// profile in force, the same computation the teacher sees when opening
// each period's sheet. One pass: a single columns query and a single
// scores query for all periods, instead of one set of queries per period.
async function computeClassFinals(client, classId, year, profile, filedCount = 0) {
  const enrolled = await client.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex
       FROM class_learners cl JOIN learners l ON l.id = cl.learner_id
      WHERE cl.class_id = $1 ORDER BY l.last_name, l.first_name, l.id`,
    [classId]
  );
  const weights = await getWeights(client, classId, profile.code);
  const columnRows = await client.query(
    `SELECT id, class_id, quarter, component, position, highest_possible::text AS highest_possible,
            sub_weight::text AS sub_weight, label
       FROM grade_columns WHERE class_id = $1 AND quarter = ANY($2::int[])
      ORDER BY quarter, CASE component WHEN 'WW' THEN 1 WHEN 'PT' THEN 2 ELSE 3 END, position, id`,
    [classId, profile.periods]
  );
  const columnsByPeriod = new Map(profile.periods.map((period) => [period, []]));
  for (const row of columnRows.rows) {
    columnsByPeriod.get(row.quarter).push({
      ...row,
      highest_possible: Number(row.highest_possible),
      sub_weight: row.sub_weight === null ? null : Number(row.sub_weight),
      name: columnName(row, profile.code),
    });
  }
  const columnIds = columnRows.rows.map((row) => row.id);
  const scores = new Map(); // learner id -> Map(column id -> score)
  if (columnIds.length > 0) {
    const rows = await client.query(
      `SELECT gs.column_id, gs.learner_id, gs.score::text AS score
         FROM grade_scores gs WHERE gs.column_id = ANY($1::int[])`,
      [columnIds]
    );
    for (const row of rows.rows) {
      if (!scores.has(row.learner_id)) scores.set(row.learner_id, new Map());
      scores.get(row.learner_id).set(row.column_id, Number(row.score));
    }
  }
  const grades = {};
  const periodGrades = {};
  for (const learner of enrolled.rows) {
    const learnerScores = scores.get(learner.id) || new Map();
    periodGrades[learner.id] = {};
    const periodGradeList = [];
    for (const period of profile.periods) {
      const computed = deped.computeLearnerGrade(
        columnsByPeriod.get(period),
        learnerScores,
        weights,
        profile.code
      );
      periodGrades[learner.id][period] = computed.qg;
      periodGradeList.push(computed.qg);
    }
    grades[learner.id] = deped.finalGrade(periodGradeList);
  }
  return { filed_periods: filedCount, total_periods: profile.periods.length, grades, period_grades: periodGrades };
}

// The whole consolidation view for one advisory section and period. Built from
// submitted grades only: a subject that has not been filed shows —, never a
// number the teacher did not file.
async function buildConsolidation(client, adviser, quarter, requestedYear) {
  const year = requestedYear || (await academicYear(client));
  const profile = await grading.getGradingProfile(client, year);
  const classes = await sectionClasses(client, adviser, year);
  const classIds = classes.map((klass) => klass.id);
  const roster = await sectionRoster(client, adviser, classIds);

  // Submissions and reminders for this period. A submission carries the
  // profile it was filed under.
  const submissions = new Map(); // class id -> { submitted_at, profile }
  const reminders = new Map(); // class id -> reminded_at
  if (classIds.length > 0) {
    const submitted = await client.query(
      `SELECT class_id, submitted_at, profile FROM grade_submissions
        WHERE class_id = ANY($1::int[]) AND quarter = $2 AND academic_year = $3`,
      [classIds, quarter, year]
    );
    for (const row of submitted.rows) {
      submissions.set(row.class_id, { submitted_at: row.submitted_at, profile: row.profile });
    }
    const reminded = await client.query(
      `SELECT class_id, updated_at AS reminded_at FROM grade_reminders
        WHERE class_id = ANY($1::int[]) AND quarter = $2 AND academic_year = $3`,
      [classIds, quarter, year]
    );
    for (const row of reminded.rows) reminders.set(row.class_id, row.reminded_at);
  }

  const subjects = attachManualSubjects(
    groupSubjectsByName(classes, submissions, reminders),
    await loadManualSubjects(client, adviser, year)
  );

  // Grades for the submitted subjects, computed under each filing's own profile.
  // For a merged subject, a real filed submission takes precedence for the
  // period; the manual grades fill periods with no real submission.
  const gradesBySubject = new Map(); // subject key -> Map(roster key -> qg or null)
  const averagesBySubject = new Map(); // subject key -> mean grade or null
  for (const subject of subjects) {
    const key = subject.subject_name.trim().toLowerCase();
    const filedClassId = subject.class_ids.find((classId) => submissions.has(classId));
    let perLearner = new Map();
    if (filedClassId !== undefined) {
      perLearner = await computeSubjectPeriodGrades(
        client, filedClassId, quarter, submissions.get(filedClassId).profile, roster
      );
    } else if (subject.manual) {
      perLearner = manualPeriodGrades(subject.manual, quarter, roster);
    } else {
      for (const rosterKey of roster.keys()) perLearner.set(rosterKey, null);
    }
    // A manual subject counts as submitted for the period when at least
    // one roster learner has a manual grade for it.
    if (!subject.submitted && subject.manual && manualHasGrades(subject.manual, quarter)) {
      subject.submitted = true;
    }
    gradesBySubject.set(key, perLearner);
    const filed = [...perLearner.values()].filter((qg) => qg !== null);
    averagesBySubject.set(
      key,
      filed.length === 0 ? null : deped.round2(filed.reduce((sum, qg) => sum + qg, 0) / filed.length)
    );
  }
  for (const subject of subjects) {
    subject.average = averagesBySubject.get(subject.subject_name.trim().toLowerCase());
  }

  // Learner rows: one grade per subject, then the GWA. The GWA is the mean of
  // the grades across submitted subjects only, and it only appears once
  // every subject is in — until then it shows — with the reason why.
  // Honors follow the profile in force for the year (Academic Excellence
  // Award under DO 015, the DO 36 tiers under DO 8).
  const pendingSubjects = subjects.filter((subject) => !subject.submitted).map((subject) => subject.subject_name);
  const learners = [...roster.values()].map((learner) => {
    const key = String(learner.learner_id).trim().toLowerCase();
    const grades = {};
    for (const subject of subjects) {
      grades[subject.subject_name] = gradesBySubject.get(subject.subject_name.trim().toLowerCase()).get(key) ?? null;
    }
    let gwa = null;
    let gwaReason = null;
    if (pendingSubjects.length > 0) {
      gwaReason = `Waiting on ${pendingSubjects.join(', ')}`;
    } else if (subjects.length === 0) {
      gwaReason = 'No subjects for this section yet';
    } else {
      const missing = subjects.filter((subject) => grades[subject.subject_name] === null).map((subject) => subject.subject_name);
      if (missing.length > 0) {
        gwaReason = `Incomplete in ${missing.join(', ')}`;
      } else {
        gwa = deped.round2(
          subjects.reduce((sum, subject) => sum + grades[subject.subject_name], 0) / subjects.length
        );
      }
    }
    const subjectGrades = subjects.map((subject) => grades[subject.subject_name]);
    const honors = deped.honorsFor(gwa, subjectGrades, profile.code);
    const atRisk =
      subjects.some((subject) => grades[subject.subject_name] !== null && grades[subject.subject_name] < 75) ||
      (gwa !== null && gwa < 75);
    const standing = gwa === null ? 'Pending grades' : honors || (atRisk ? 'At risk' : 'Passed');
    return { ...learner, grades, gwa, gwa_reason: gwaReason, honors, at_risk: atRisk, standing, rank: null };
  });

  rankLearners(learners, 'gwa');

  const submittedCount = subjects.filter((subject) => subject.submitted).length;
  const learnerGwas = learners.filter((learner) => learner.gwa !== null).map((learner) => learner.gwa);
  const allGrades = [];
  for (const subject of subjects) {
    for (const learner of learners) {
      if (learner.grades[subject.subject_name] !== null) allGrades.push(learner.grades[subject.subject_name]);
    }
  }
  const honorCount = learners.filter((learner) => learner.honors !== null).length;

  return {
    // The adviser always has an assignment here: getConsolidation refuses
    // teachers without one before this is built.
    has_advisory: true,
    adviser: {
      grade: adviser.advisory_grade,
      section: adviser.advisory_section,
      name: `${adviser.last_name}, ${adviser.first_name}`,
    },
    academic_year: year,
    grading: grading.gradingInfo(profile, year),
    grade: adviser.advisory_grade,
    section: adviser.advisory_section,
    quarter,
    subjects: subjects.map((subject) => {
      // The Remind action goes to the first class of this subject that has
      // not filed yet (or the first class when every class has filed).
      const remindClassId =
        subject.class_ids.find((classId) => !submissions.has(classId)) ?? subject.class_ids[0] ?? null;
      const remindClass = classes.find((klass) => klass.id === remindClassId);
      return {
        subject_name: subject.subject_name,
        class_id: remindClassId,
        teacher_name: subject.teacher_names.join(' · '),
        submitted: subject.submitted,
        submitted_at: subject.submitted_at,
        reminded: subject.reminded_at !== null,
        reminded_at: subject.reminded_at,
        average: subject.average,
        // A manual subject has no class to remind: the adviser manages
        // its grades themself. has_manual covers a merged subject, whose
        // manual grades are managed the same way.
        manual: subject.manual !== null,
        manual_subject_id: subject.manual ? subject.manual.id : null,
        profile_code: subject.manual ? subject.manual.profile_code : null,
        // True when the teacher who still needs to file is the adviser
        // themself: a direct-add needs no reminder, so the Remind button
        // is hidden for this subject in Consolidation.
        own_class: remindClass ? remindClass.teacher_id === adviser.id : false,
      };
    }),
    learners,
    readiness: {
      submitted: submittedCount,
      total: subjects.length,
      pct: subjects.length === 0 ? 0 : Math.round((submittedCount / subjects.length) * 100),
    },
    kpis: {
      class_gwa: learnerGwas.length === 0
        ? null
        : deped.round2(learnerGwas.reduce((sum, value) => sum + value, 0) / learnerGwas.length),
      subject_average: allGrades.length === 0
        ? null
        : deped.round2(allGrades.reduce((sum, value) => sum + value, 0) / allGrades.length),
      honor_count: honorCount,
      honor_pct: learners.length === 0 ? 0 : Math.round((honorCount / learners.length) * 100),
      at_risk_count: learners.filter((learner) => learner.at_risk).length,
    },
  };
}

// The final grades for one advisory section: each subject's final grade is
// the mean of its period grades, rounded to the nearest whole number, and it
// only exists once every period of the year is filed for that subject. The
// final GWA is the mean of the final grades across subjects, and it only
// appears once every subject has a final grade. This is the same final grade
// the Report Card (Batch 5) will print.
async function buildFinals(client, adviser, requestedYear) {
  const year = requestedYear || (await academicYear(client));
  const profile = await grading.getGradingProfile(client, year);
  const classes = await sectionClasses(client, adviser, year);
  const classIds = classes.map((klass) => klass.id);
  const roster = await sectionRoster(client, adviser, classIds);

  // Every submission for the section's classes this year, by period.
  const submissions = new Map(); // class id -> Map(period -> { submitted_at, profile })
  if (classIds.length > 0) {
    const submitted = await client.query(
      `SELECT class_id, quarter, submitted_at, profile FROM grade_submissions
        WHERE class_id = ANY($1::int[]) AND academic_year = $2`,
      [classIds, year]
    );
    for (const row of submitted.rows) {
      if (!submissions.has(row.class_id)) submissions.set(row.class_id, new Map());
      submissions.get(row.class_id).set(row.quarter, { submitted_at: row.submitted_at, profile: row.profile });
    }
  }
  const manualSubjects = await loadManualSubjects(client, adviser, year);
  const hasManualData = manualSubjects.some((manual) =>
    [...manual.grades.values()].some((byPeriod) => byPeriod.size > 0)
  );
  const hasData =
    [...submissions.values()].some((byPeriod) => byPeriod.size > 0) || hasManualData;

  // One entry per subject name, as in the period view.
  const subjectEntries = [];
  {
    const byName = new Map();
    for (const klass of classes) {
      const key = klass.subject_name.trim().toLowerCase();
      let subject = byName.get(key);
      if (!subject) {
        subject = { subject_name: klass.subject_name, teacher_names: [], class_ids: [] };
        byName.set(key, subject);
        subjectEntries.push(subject);
      }
      subject.teacher_names.push(`${klass.teacher_last_name}, ${klass.teacher_first_name}`);
      subject.class_ids.push(klass.id);
    }
  }
  attachManualSubjects(subjectEntries, manualSubjects);

  // Filed period grades per class, computed once and shared with the
  // Grades page finals: the per-period computation lives in one place.
  const filedGradesCache = new Map();
  async function filedGradesFor(classId) {
    if (!filedGradesCache.has(classId)) {
      filedGradesCache.set(classId, await classFiledPeriodGrades(client, classId, year, profile, roster));
    }
    return filedGradesCache.get(classId);
  }

  // Final grade per subject per learner.
  const finalsBySubject = new Map(); // subject key -> Map(roster key -> final grade or null)
  for (const subject of subjectEntries) {
    const key = subject.subject_name.trim().toLowerCase();
    const perLearner = new Map();
    const periodGrades = new Map(); // roster key -> [qg per period]
    let filedPeriods = 0;
    for (const period of profile.periods) {
      const filedClassId = subject.class_ids.find(
        (classId) => submissions.has(classId) && submissions.get(classId).has(period)
      );
      // A real filed submission takes precedence for the period; the
      // manual grades fill periods with no real submission.
      let grades = null;
      if (filedClassId !== undefined) {
        grades = (await filedGradesFor(filedClassId)).get(period);
      } else if (subject.manual && manualHasGrades(subject.manual, period)) {
        grades = manualPeriodGrades(subject.manual, period, roster);
      }
      if (grades === null) continue;
      filedPeriods += 1;
      for (const [rosterKey, qg] of grades) {
        if (!periodGrades.has(rosterKey)) periodGrades.set(rosterKey, []);
        periodGrades.get(rosterKey).push(qg);
      }
    }
    for (const rosterKey of roster.keys()) {
      const grades = periodGrades.get(rosterKey) || [];
      // The final grade needs every period filed for this subject.
      perLearner.set(rosterKey, grades.length === profile.periods.length ? deped.finalGrade(grades) : null);
    }
    finalsBySubject.set(key, perLearner);
    subject.filed_periods = filedPeriods;
    subject.total_periods = profile.periods.length;
    const filed = [...perLearner.values()].filter((grade) => grade !== null);
    subject.average = filed.length === 0
      ? null
      : deped.round2(filed.reduce((sum, grade) => sum + grade, 0) / filed.length);
  }

  const pendingSubjects = subjectEntries
    .filter((subject) => subject.filed_periods < subject.total_periods)
    .map((subject) => subject.subject_name);
  const learners = [...roster.values()].map((learner) => {
    const key = String(learner.learner_id).trim().toLowerCase();
    const grades = {};
    for (const subject of subjectEntries) {
      grades[subject.subject_name] = finalsBySubject.get(subject.subject_name.trim().toLowerCase()).get(key) ?? null;
    }
    let gwa = null;
    let gwaReason = null;
    if (!hasData) {
      gwaReason = 'No grades filed yet';
    } else if (pendingSubjects.length > 0) {
      gwaReason = `Waiting on ${pendingSubjects.join(', ')}`;
    } else if (subjectEntries.length === 0) {
      gwaReason = 'No subjects for this section yet';
    } else {
      const missing = subjectEntries.filter((subject) => grades[subject.subject_name] === null).map((subject) => subject.subject_name);
      if (missing.length > 0) {
        gwaReason = `Incomplete in ${missing.join(', ')}`;
      } else {
        gwa = deped.round2(
          subjectEntries.reduce((sum, subject) => sum + grades[subject.subject_name], 0) / subjectEntries.length
        );
      }
    }
    const subjectGrades = subjectEntries.map((subject) => grades[subject.subject_name]);
    const honors = deped.honorsFor(gwa, subjectGrades, profile.code);
    const atRisk =
      subjectEntries.some((subject) => grades[subject.subject_name] !== null && grades[subject.subject_name] < 75) ||
      (gwa !== null && gwa < 75);
    const standing = gwa === null ? 'Pending grades' : honors || (atRisk ? 'At risk' : 'Passed');
    return { ...learner, grades, gwa, gwa_reason: gwaReason, honors, at_risk: atRisk, standing, rank: null };
  });

  rankLearners(learners, 'gwa');

  const completeSubjects = subjectEntries.filter((subject) => subject.filed_periods >= subject.total_periods).length;
  const learnerGwas = learners.filter((learner) => learner.gwa !== null).map((learner) => learner.gwa);
  return {
    has_data: hasData,
    academic_year: year,
    grading: grading.gradingInfo(profile, year),
    periods: profile.periods,
    period_label: profile.periodLabel,
    subjects: subjectEntries.map((subject) => ({
      subject_name: subject.subject_name,
      teacher_name: subject.teacher_names.join(' · '),
      filed_periods: subject.filed_periods,
      total_periods: subject.total_periods,
      average: subject.average,
      manual: subject.manual !== null,
      manual_subject_id: subject.manual ? subject.manual.id : null,
      profile_code: subject.manual ? subject.manual.profile_code : null,
    })),
    learners,
    readiness: {
      complete: completeSubjects,
      total: subjectEntries.length,
      pct: subjectEntries.length === 0 ? 0 : Math.round((completeSubjects / subjectEntries.length) * 100),
    },
    kpis: {
      class_gwa: learnerGwas.length === 0
        ? null
        : deped.round2(learnerGwas.reduce((sum, value) => sum + value, 0) / learnerGwas.length),
      honor_count: learners.filter((learner) => learner.honors !== null).length,
      at_risk_count: learners.filter((learner) => learner.at_risk).length,
    },
  };
}

// GET /api/teacher/consolidation?quarter=&format=&scope=  (the adviser's section view;
// add format=csv to download the master sheet instead; scope=final shows the
// final grades across the year's periods instead of one period)
async function getConsolidation(req, res) {
  const { quarter: requestedQuarter, format, scope } = req.valid.query;
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  const year = await resolveViewingYear(req);
  const profile = await grading.getGradingProfile(db, year);
  if (requestedQuarter) checkPeriod(profile, requestedQuarter);

  if (scope === 'final') {
    const finals = await buildFinals(db, adviser, year);
    if (format === 'csv') {
      const headers = [
        { header: 'Learner', value: (row) => `${row.last_name}, ${row.first_name}` },
        { header: 'LRN', value: (row) => row.learner_id },
        { header: 'Sex', value: (row) => row.sex },
      ];
      for (const subject of finals.subjects) {
        headers.push({
          header: subject.subject_name,
          value: (row) => (row.grades[subject.subject_name] === null ? '' : row.grades[subject.subject_name]),
        });
      }
      headers.push(
        { header: 'Final GWA', value: (row) => (row.gwa === null ? '' : row.gwa.toFixed(2)) },
        { header: 'Standing', value: (row) => row.standing },
        { header: 'Rank', value: (row) => (row.rank === null ? '' : row.rank) }
      );
      const safe = (value) => String(value).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
      sendCsv(
        res,
        `consolidation-final-grade-${adviser.advisory_grade}-${safe(adviser.advisory_section)}.csv`,
        headers,
        finals.learners
      );
      return;
    }
    res.json({ ...finals, scope: 'final' });
    return;
  }

  const classes = await sectionClasses(db, adviser, year);
  const manualMax = await maxManualQuarter(db, adviser, year);
  const quarter = await resolveConsolidationQuarter(
    db, classes.map((klass) => klass.id), requestedQuarter, profile, manualMax
  );
  const view = await buildConsolidation(db, adviser, quarter, year);

  if (format === 'csv') {
    const headers = [
      { header: 'Learner', value: (row) => `${row.last_name}, ${row.first_name}` },
      { header: 'LRN', value: (row) => row.learner_id },
      { header: 'Sex', value: (row) => row.sex },
    ];
    for (const subject of view.subjects) {
      headers.push({
        header: subject.subject_name,
        value: (row) => (row.grades[subject.subject_name] === null ? '' : row.grades[subject.subject_name]),
      });
    }
    headers.push(
      { header: 'GWA', value: (row) => (row.gwa === null ? '' : row.gwa.toFixed(2)) },
      { header: 'Standing', value: (row) => row.standing },
      { header: 'Rank', value: (row) => (row.rank === null ? '' : row.rank) }
    );
    const safe = (value) => String(value).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    sendCsv(
      res,
      `consolidation-grade-${view.adviser.grade}-${safe(view.adviser.section)}-${profile.periodShort.toLowerCase()}${quarter}.csv`,
      headers,
      view.learners
    );
    return;
  }

  res.json(view);
}

// POST /api/teacher/consolidation/remind  { class_id, quarter }
// The adviser nudges a subject teacher. Reminding again moves the reminder to
// today; the subject teacher sees the banner on their Grades page.
async function remindTeacher(req, res) {
  const { class_id, quarter } = req.valid.body;
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', { code: 'NO_ADVISORY' });
  }
  const klass = await sectionClassById(db, adviser, class_id);
  if (!klass) throw notFound('That class is not part of your advisory section.');
  // The reminder belongs to the class's own year, not the current year.
  const year = klass.academic_year;
  const profile = await grading.getGradingProfile(db, year);
  checkPeriod(profile, quarter);
  // A direct-add needs no reminder: the teacher of this class is the adviser
  // themself, so reminding would only be reminding yourself.
  if (klass.teacher_id === req.teacher.id) {
    throw badRequest('You teach this class yourself, so there is no one to remind. File the grades from the Grades page instead.');
  }

  const reminded = await db.query(
    `INSERT INTO grade_reminders (class_id, quarter, academic_year, adviser_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (class_id, quarter, academic_year)
     DO UPDATE SET updated_at = NOW()
     RETURNING updated_at AS reminded_at`,
    [class_id, quarter, year, req.teacher.id]
  );
  res.json({
    message: `Reminder sent to ${klass.teacher_last_name}, ${klass.teacher_first_name} for ${klass.subject_name} (${profile.periodLabel} ${quarter}).`,
    reminded_at: reminded.rows[0].reminded_at,
  });
}

// ---------- Manual subjects: endpoints (Batch 8 fix 10) ----------

// The one manual subject a signed-in adviser may touch: same adviser,
// same school, same grade/section. The year comes from the subject's own
// row, so a past-year subject stays editable while viewing that year.
async function loadOwnedManualSubject(client, adviser, id) {
  const result = await client.query(
    `SELECT id, adviser_id, school_id, subject_name, teacher_name, grade_level,
            section_name, academic_year, profile_code, created_at, updated_at
       FROM manual_subjects WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (
    !row ||
    row.adviser_id !== adviser.id ||
    row.school_id !== adviser.school_id ||
    row.grade_level !== adviser.advisory_grade ||
    row.section_name.trim().toLowerCase() !== adviser.advisory_section.trim().toLowerCase()
  ) {
    throw notFound('That manual subject was not found.');
  }
  return row;
}

// Does a real class with this subject name already exist for the
// adviser's section and year? A manual subject must not duplicate one:
// the two would merge in Consolidation and the real filing would win
// every period anyway.
async function realClassWithSubject(client, adviser, year, subjectName) {
  const classes = await sectionClasses(client, adviser, year);
  return classes.some(
    (klass) => klass.subject_name.trim().toLowerCase() === subjectName.trim().toLowerCase()
  );
}

async function manualSubjectWithName(client, adviser, year, subjectName, excludeId = null) {
  const result = await client.query(
    `SELECT 1 FROM manual_subjects
      WHERE adviser_id = $1 AND LOWER(TRIM(subject_name)) = LOWER(TRIM($2))
        AND grade_level = $3 AND LOWER(TRIM(section_name)) = LOWER(TRIM($4))
        AND academic_year = $5 AND ($6::int IS NULL OR id <> $6)`,
    [adviser.id, subjectName, adviser.advisory_grade, adviser.advisory_section, year, excludeId]
  );
  return result.rows.length > 0;
}

function manualSubjectShape(row, gradeCount, periodsWithGrades) {
  return {
    id: row.id,
    subject_name: row.subject_name,
    teacher_name: row.teacher_name,
    grade_level: row.grade_level,
    section_name: row.section_name,
    academic_year: row.academic_year,
    profile_code: row.profile_code,
    grade_count: gradeCount,
    periods_with_grades: periodsWithGrades,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/teacher/consolidation/manual-subjects
async function listManualSubjects(req, res) {
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  const year = await resolveViewingYear(req);
  const manualSubjects = await loadManualSubjects(db, adviser, year);
  const subjects = manualSubjects.map((manual) => {
    const periodsWithGrades = [...manual.grades.keys()]
      .filter((quarter) => manual.grades.get(quarter).size > 0)
      .sort((a, b) => a - b);
    const gradeCount = [...manual.grades.values()].reduce((sum, byPeriod) => sum + byPeriod.size, 0);
    return manualSubjectShape(manual, gradeCount, periodsWithGrades);
  });
  res.json({ manual_subjects: subjects });
}

// POST /api/teacher/consolidation/manual-subjects
async function createManualSubject(req, res) {
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  const year = req.valid.body.academic_year || (await academicYear());
  const profile = await grading.getGradingProfile(db, year);
  const { subject_name, teacher_name } = req.valid.body;
  if (await realClassWithSubject(db, adviser, year, subject_name)) {
    throw conflict(`A class for "${subject_name}" already exists for this section. Upload the subject teacher's grades through that class instead.`);
  }
  if (await manualSubjectWithName(db, adviser, year, subject_name)) {
    throw conflict(`You already created a manual subject named "${subject_name}" for this section.`);
  }
  try {
    const result = await db.query(
      `INSERT INTO manual_subjects
         (adviser_id, school_id, subject_name, teacher_name, grade_level, section_name, academic_year, profile_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, adviser_id, school_id, subject_name, teacher_name, grade_level,
                 section_name, academic_year, profile_code, created_at, updated_at`,
      [
        adviser.id,
        adviser.school_id,
        subject_name,
        teacher_name,
        adviser.advisory_grade,
        adviser.advisory_section,
        year,
        profile.code,
      ]
    );
    res.status(201).json({ manual_subject: manualSubjectShape(result.rows[0], 0, []) });
  } catch (error) {
    if (error.code === '23505') {
      throw conflict(`You already created a manual subject named "${subject_name}" for this section.`);
    }
    throw error;
  }
}

// PATCH /api/teacher/consolidation/manual-subjects/:id
async function updateManualSubject(req, res) {
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  const manual = await loadOwnedManualSubject(db, adviser, req.valid.params.id);
  const year = manual.academic_year;
  const { subject_name, teacher_name } = req.valid.body;
  const nextName = subject_name !== undefined ? subject_name : manual.subject_name;
  if (nextName.trim().toLowerCase() !== manual.subject_name.trim().toLowerCase()) {
    if (await realClassWithSubject(db, adviser, year, nextName)) {
      throw conflict(`A class for "${nextName}" already exists for this section, so this manual subject cannot be renamed to it.`);
    }
    if (await manualSubjectWithName(db, adviser, year, nextName, manual.id)) {
      throw conflict(`You already created a manual subject named "${nextName}" for this section.`);
    }
  }
  try {
    const result = await db.query(
      `UPDATE manual_subjects
          SET subject_name = $1, teacher_name = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, adviser_id, school_id, subject_name, teacher_name, grade_level,
                  section_name, academic_year, profile_code, created_at, updated_at`,
      [nextName, teacher_name !== undefined ? teacher_name : manual.teacher_name, manual.id]
    );
    const loaded = await loadManualSubjects(db, adviser, year);
    const refreshed = loaded.find((row) => row.id === manual.id);
    const periodsWithGrades = [...refreshed.grades.keys()]
      .filter((quarter) => refreshed.grades.get(quarter).size > 0)
      .sort((a, b) => a - b);
    const gradeCount = [...refreshed.grades.values()].reduce((sum, byPeriod) => sum + byPeriod.size, 0);
    res.json({ manual_subject: manualSubjectShape(result.rows[0], gradeCount, periodsWithGrades) });
  } catch (error) {
    if (error.code === '23505') {
      throw conflict(`You already created a manual subject named "${nextName}" for this section.`);
    }
    throw error;
  }
}

// DELETE /api/teacher/consolidation/manual-subjects/:id
async function deleteManualSubject(req, res) {
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  const manual = await loadOwnedManualSubject(db, adviser, req.valid.params.id);
  // Grades go with the subject (ON DELETE CASCADE).
  await db.query('DELETE FROM manual_subjects WHERE id = $1', [manual.id]);
  res.json({ message: `Manual subject "${manual.subject_name}" was deleted.` });
}

// GET /api/teacher/consolidation/manual-subjects/:id/template — the CSV
// template, prefilled with one row per roster learner (Learner ID +
// "Last, First", blank grade cells), so the adviser fills grades against
// the correct IDs. An empty roster yields the header only.
async function downloadManualTemplate(req, res) {
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  const manual = await loadOwnedManualSubject(db, adviser, req.valid.params.id);
  const year = manual.academic_year;
  const profile = await grading.getGradingProfile(db, year);
  const classes = await sectionClasses(db, adviser, year);
  const roster = await sectionRoster(db, adviser, classes.map((klass) => klass.id));
  const headers = [
    { header: 'Learner ID', value: (row) => row.learner_id },
    { header: 'Student Name', value: (row) => `${row.last_name}, ${row.first_name}` },
  ];
  for (const period of profile.periods) {
    headers.push({ header: `${profile.periodLabel} ${period}`, value: () => '' });
  }
  const safe = (value) => String(value).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  sendCsv(
    res,
    `manual-grades-${safe(manual.subject_name)}.csv`,
    headers,
    [...roster.values()]
  );
}

// POST /api/teacher/consolidation/manual-subjects/:id/grades — file the
// parsed CSV grades as JSON. The backend re-validates everything against
// the section roster: any invalid row blocks the whole filing
// (all-or-nothing). Re-uploading replaces the subject's grades entirely.
async function fileManualGrades(req, res) {
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  const manual = await loadOwnedManualSubject(db, adviser, req.valid.params.id);
  const year = manual.academic_year;
  const profile = await grading.getGradingProfile(db, year);
  const classes = await sectionClasses(db, adviser, year);
  const roster = await sectionRoster(db, adviser, classes.map((klass) => klass.id));
  if (roster.size === 0) {
    throw badRequest('Enrol learners in this section first before uploading grades.', {
      code: 'EMPTY_ROSTER',
    });
  }
  const invalid = [];
  const seen = new Set();
  const valid = [];
  for (const entry of req.valid.body.grades) {
    const rosterKey = entry.learner_id.trim().toLowerCase();
    const problems = [];
    if (!roster.has(rosterKey)) problems.push('Learner ID not found in this section.');
    if (!profile.periods.includes(entry.quarter)) {
      problems.push(`${profile.periodLabel} ${entry.quarter} is not a period in ${year}.`);
    }
    const duplicateKey = `${rosterKey}|${entry.quarter}`;
    if (seen.has(duplicateKey)) problems.push('Duplicate row for this learner and period.');
    seen.add(duplicateKey);
    if (problems.length > 0) {
      invalid.push({
        learner_id: entry.learner_id,
        quarter: entry.quarter,
        grade: entry.grade,
        errors: problems,
      });
    } else {
      valid.push({ learner_id_text: entry.learner_id.trim(), quarter: entry.quarter, grade: entry.grade });
    }
  }
  if (invalid.length > 0) {
    throw badRequest(
      `${invalid.length} grade row${invalid.length === 1 ? '' : 's'} could not be filed. Fix the rows and upload again — nothing was saved.`,
      { code: 'MANUAL_GRADES_INVALID', invalid_rows: invalid }
    );
  }
  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM manual_subject_grades WHERE manual_subject_id = $1', [manual.id]);
    for (const row of valid) {
      await client.query(
        `INSERT INTO manual_subject_grades (manual_subject_id, learner_id_text, quarter, grade)
         VALUES ($1, $2, $3, $4)`,
        [manual.id, row.learner_id_text, row.quarter, row.grade]
      );
    }
    await client.query('UPDATE manual_subjects SET updated_at = NOW() WHERE id = $1', [manual.id]);
  });
  const loaded = await loadManualSubjects(db, adviser, year);
  const refreshed = loaded.find((row) => row.id === manual.id);
  const periodsWithGrades = [...refreshed.grades.keys()]
    .filter((quarter) => refreshed.grades.get(quarter).size > 0)
    .sort((a, b) => a - b);
  const gradeCount = [...refreshed.grades.values()].reduce((sum, byPeriod) => sum + byPeriod.size, 0);
  res.json({
    manual_subject: manualSubjectShape(refreshed, gradeCount, periodsWithGrades),
    filed: valid.length,
  });
}

// The Dashboard's consolidation card: real readiness for the adviser's section
// (submitted / total subjects for the current period), or null when the teacher
// is not an adviser.
async function fetchConsolidationReadiness(teacherId, requestedYear) {
  const adviser = await adviserOf(db, teacherId);
  if (!adviser) return null;
  const year = requestedYear || (await academicYear());
  const profile = await grading.getGradingProfile(db, year);
  const classes = await sectionClasses(db, adviser, year);
  const manualMax = await maxManualQuarter(db, adviser, year);
  const quarter = await resolveConsolidationQuarter(
    db, classes.map((klass) => klass.id), null, profile, manualMax
  );
  const view = await buildConsolidation(db, adviser, quarter, year);
  return {
    grade: view.adviser.grade,
    section: view.adviser.section,
    quarter: view.quarter,
    academic_year: view.academic_year,
    grading: view.grading,
    submitted: view.readiness.submitted,
    total: view.readiness.total,
    pct: view.readiness.pct,
    learners: view.learners.length,
  };
}

module.exports = {
  getGradeSheet,
  saveScores,
  addColumn,
  updateColumn,
  deleteColumn,
  updateSubWeights,
  updateWeights,
  getSubmissionCheck,
  submitGrades,
  getConsolidation,
  remindTeacher,
  listManualSubjects,
  createManualSubject,
  updateManualSubject,
  deleteManualSubject,
  downloadManualTemplate,
  fileManualGrades,
  fetchConsolidationReadiness,
  // Shared by the Report Card (Batch 5), which reads the same consolidated
  // grades: the card is built from these helpers, never by recomputing.
  adviserOf,
  sectionClasses,
  sectionRoster,
  computeSubjectPeriodGrades,
  academicYear,
  resolveViewingYear,
  buildConsolidation,
  buildFinals,
  // Shared by the Report Card (Batch 8 fix 10): manual grades are read
  // through the same helpers Consolidation uses.
  loadManualSubjects,
  attachManualSubjects,
  manualPeriodGrades,
  manualHasGrades,
};
