// Lesson plans (Batch 11): the teacher's ILAW lesson plans, in the DepEd
// template from the sample plan — Intentions, Learning Experiences,
// Assessment, Ways Forward — with the header filled from the teacher's
// own record and class, and the Declaration of AI Use (DO 3, s. 2026,
// Annex A) on every plan. The template version only: the teacher writes
// the content; nothing here generates it. The printout is rendered by
// the browser from the same detail read, so the screen and the paper
// can never disagree about a plan.
const db = require('../db');
const { badRequest, notFound } = require('../utils/httpError');
const { findClass } = require('./classes.controller');
const grading = require('../utils/grading');
const deped = require('../utils/deped');

const NO_AI_DECLARATION =
  'No AI tools were used in the formulation of this lesson plan. (DO 3, s. 2026, Annex A)';

// Every content column of a plan, in template order. The header fields
// (class, period, week, date, title, AI declaration, status) are handled
// separately; these are the fields a duplicate copies whole.
const CONTENT_FIELDS = [
  'references',
  'competency',
  'objective_knowledge',
  'objective_skill',
  'objective_attitude',
  'objective_values',
  'learner_context',
  'pre_lesson',
  'flow',
  'individual_activity',
  'individual_answers',
  'group_activity',
  'group_answers',
  'inclusion_strategy',
  'practical_applications',
  'generalizations',
  'abstraction',
  'learning_resources',
  'integration',
  'formative_assessment',
  'formative_answer_key',
  'extended_learning',
  'extended_answer_key',
  'reflections',
];

const PLAN_COLUMNS = [
  'lp.id', 'lp.teacher_id', 'lp.class_id', 'lp.quarter', 'lp.week_number',
  'lp.session_date::text AS session_date', 'lp.lesson_title', 'lp."references"',
  'lp.ai_use', 'lp.ai_declaration', 'lp.competency',
  'lp.objective_knowledge', 'lp.objective_skill', 'lp.objective_attitude',
  'lp.objective_values', 'lp.learner_context', 'lp.pre_lesson', 'lp.flow',
  'lp.individual_activity', 'lp.individual_answers', 'lp.group_activity',
  'lp.group_answers', 'lp.inclusion_strategy', 'lp.practical_applications',
  'lp.generalizations', 'lp.abstraction', 'lp.learning_resources',
  'lp.integration', 'lp.formative_assessment', 'lp.formative_answer_key',
  'lp.extended_learning', 'lp.extended_answer_key', 'lp.reflections',
  'lp.checked_by_name', 'lp.status', 'lp.created_at', 'lp.updated_at',
];

// `references` is a reserved word in PostgreSQL, so every SQL fragment
// that names the column quotes it. The JavaScript field stays `references`.
const sqlColumn = (name) => (name === 'references' ? '"references"' : name);

const PLAN_SELECT = `
  SELECT ${PLAN_COLUMNS.join(', ')},
         s.name AS subject_name, c.grade_level, c.section_name, c.academic_year, c.room
    FROM lesson_plans lp
    JOIN classes c ON c.id = lp.class_id
    JOIN subjects s ON s.id = c.subject_id`;

// The period label for a class year: the stored grading profile when the
// admin set one, otherwise the default for that year (Terms from
// 2026-2027, Quarters before it). The list read fetches the profiles
// once and reuses them, so a list of many plans is still one extra query.
async function profileLabels(client = db) {
  const rows = await client.query('SELECT academic_year, profile FROM grading_profiles');
  const byYear = new Map(rows.rows.map((row) => [row.academic_year, row.profile]));
  return (academicYear) => {
    const code = byYear.get(academicYear) || deped.defaultProfileForYear(academicYear);
    return deped.profileFor(code).periodLabel;
  };
}

function planShape(row, periodLabel) {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    class_id: row.class_id,
    quarter: row.quarter,
    week_number: row.week_number,
    session_date: row.session_date,
    lesson_title: row.lesson_title,
    references: row.references,
    ai_use: row.ai_use,
    ai_declaration: row.ai_declaration,
    competency: row.competency,
    objective_knowledge: row.objective_knowledge,
    objective_skill: row.objective_skill,
    objective_attitude: row.objective_attitude,
    objective_values: row.objective_values,
    learner_context: row.learner_context,
    pre_lesson: row.pre_lesson,
    flow: row.flow,
    individual_activity: row.individual_activity,
    individual_answers: row.individual_answers,
    group_activity: row.group_activity,
    group_answers: row.group_answers,
    inclusion_strategy: row.inclusion_strategy,
    practical_applications: row.practical_applications,
    generalizations: row.generalizations,
    abstraction: row.abstraction,
    learning_resources: row.learning_resources,
    integration: row.integration,
    formative_assessment: row.formative_assessment,
    formative_answer_key: row.formative_answer_key,
    extended_learning: row.extended_learning,
    extended_answer_key: row.extended_answer_key,
    reflections: row.reflections,
    checked_by_name: row.checked_by_name,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subject_name: row.subject_name,
    grade_level: row.grade_level,
    section_name: row.section_name,
    academic_year: row.academic_year,
    room: row.room,
    period_label: periodLabel,
  };
}

// One plan of the signed-in teacher. An id from the request can never
// reach another teacher's plan.
async function findPlan(id, teacherId, client = db) {
  const result = await client.query(`${PLAN_SELECT} WHERE lp.id = $1 AND lp.teacher_id = $2`, [id, teacherId]);
  if (result.rowCount === 0) throw notFound('Lesson plan not found.');
  const labelFor = await profileLabels(client);
  return planShape(result.rows[0], labelFor(result.rows[0].academic_year));
}

// The grading profile of the plan's class, and a refusal when the period
// does not exist under it (Term 4 under DO 015, which has three terms).
// Mirrors the quiz period check, so the two pages never disagree.
async function checkPlanPeriod(client, classId, quarter) {
  const profile = await grading.getClassGradingProfile(client, classId);
  if (!profile.periods.includes(quarter)) {
    throw badRequest(
      `${profile.periodLabel} ${quarter} does not exist under ${profile.label}. This year has ${profile.periodLabel}s ${profile.periods.join(', ')}.`,
      { errors: { quarter: `Choose ${profile.periodLabel.toLowerCase()} ${profile.periods.join(', ')}.` } }
    );
  }
  return profile;
}

// The school header for the printout, from the teacher's own record —
// the same entries the DepEd forms use (Region, Division, School ID,
// school head). It prints blank until the teacher fills it in on
// their Profile page; nothing here invents a school detail.
async function fetchPrintHeader(teacherId, client = db) {
  const result = await client.query(
    `SELECT t.first_name, t.last_name, t.region, t.division, t.deped_school_id,
            t.school_head_name, s.name AS school_name, s.city_region AS school_city_region
       FROM teachers t JOIN schools s ON s.id = t.school_id WHERE t.id = $1`,
    [teacherId]
  );
  const row = result.rows[0] || {};
  return {
    teacher_name: row.first_name ? `${row.first_name} ${row.last_name}` : null,
    region: row.region || null,
    division: row.division || null,
    deped_school_id: row.deped_school_id || null,
    school_head_name: row.school_head_name || null,
    school_name: row.school_name || null,
    school_city_region: row.school_city_region || null,
  };
}

// The declaration that is stored: when the teacher says no AI was used
// and leaves the wording blank, the standard sentence is stored, so a
// printed plan always carries a declaration. When AI was used, the
// teacher's own wording is required — a bare "used" says nothing a
// checker can act on.
function normalizeDeclaration(aiUse, declaration) {
  const text = String(declaration || '').trim();
  if (aiUse === 'used' && text.length < 10) {
    throw badRequest('Say how AI was used in this lesson plan: name the tool and what it was used for.', {
      errors: { ai_declaration: 'Describe how AI was used, for example which tool and what it helped with.' },
    });
  }
  if (aiUse === 'none' && text === '') return NO_AI_DECLARATION;
  return text;
}

// What a plan marked Ready must have: the competency, at least one
// objective, the lesson itself (the pre-lesson or the flow), and the
// formative assessment. Everything else may still be filled in later;
// a Ready plan with no assessment to check would be ready in name only.
function assertReady(plan) {
  const missing = [];
  if (!String(plan.competency || '').trim()) missing.push({ field: 'competency', label: 'Learning Competency' });
  const hasObjective = ['objective_knowledge', 'objective_skill', 'objective_attitude', 'objective_values'].some(
    (field) => String(plan[field] || '').trim()
  );
  if (!hasObjective) missing.push({ field: 'objective_knowledge', label: 'at least one Learning Objective' });
  if (!String(plan.pre_lesson || '').trim() && !String(plan.flow || '').trim()) {
    missing.push({ field: 'flow', label: 'the Pre-lesson or the Flow of the lesson' });
  }
  if (!String(plan.formative_assessment || '').trim()) {
    missing.push({ field: 'formative_assessment', label: 'Formative Assessment' });
  }
  if (missing.length > 0) {
    throw badRequest(
      `Before a lesson plan is marked Ready, add ${missing.map((entry) => entry.label).join(', ')}.`,
      { errors: Object.fromEntries(missing.map((entry) => [entry.field, 'Add this before marking the plan Ready.'])) }
    );
  }
}

// ---------- Teacher: lesson plans ----------

// GET /api/teacher/lesson-plans?class_id=&quarter=&status=&academic_year=&search=
async function listLessonPlans(req, res) {
  const { class_id, quarter, status, academic_year, search } = req.valid.query;
  const where = ['lp.teacher_id = $1'];
  const params = [req.teacher.id];
  if (class_id) {
    params.push(class_id);
    where.push(`lp.class_id = $${params.length}`);
  }
  if (quarter) {
    params.push(quarter);
    where.push(`lp.quarter = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`lp.status = $${params.length}`);
  }
  if (academic_year) {
    params.push(academic_year);
    where.push(`c.academic_year = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(lp.lesson_title ILIKE $${params.length} OR lp."references" ILIKE $${params.length})`);
  }
  const result = await db.query(
    `${PLAN_SELECT} WHERE ${where.join(' AND ')} ORDER BY lp.session_date DESC, lp.week_number DESC, lp.id DESC`,
    params
  );
  const labelFor = await profileLabels();
  res.json({ items: result.rows.map((row) => planShape(row, labelFor(row.academic_year))) });
}

// POST /api/teacher/lesson-plans
// A plan starts as a draft with only its header filled in; the teacher
// fills the sections in afterwards. The class and period are checked
// against the class's grading profile before anything is written.
async function createLessonPlan(req, res) {
  const { class_id, quarter } = req.valid.body;
  await findClass(class_id, req.teacher.id);
  await checkPlanPeriod(db, class_id, quarter);
  const body = req.valid.body;
  // A plan created already marked Ready must meet the same bar as one
  // marked Ready afterwards: the check runs on the plan as it would be
  // stored, with every unwritten section blank.
  if (body.status === 'ready') {
    assertReady({ ...Object.fromEntries(CONTENT_FIELDS.map((field) => [field, body[field] ?? ''])), ...body });
  }
  const declaration = normalizeDeclaration(body.ai_use, body.ai_declaration);
  const columns = ['teacher_id', 'class_id', 'quarter', 'week_number', 'session_date', 'lesson_title', 'ai_use', 'ai_declaration', ...CONTENT_FIELDS, 'checked_by_name', 'status'];
  const values = [
    req.teacher.id, class_id, quarter, body.week_number, body.session_date, body.lesson_title,
    body.ai_use, declaration,
    ...CONTENT_FIELDS.map((field) => body[field] ?? ''),
    body.checked_by_name ? String(body.checked_by_name).trim() : null,
    body.status ?? 'draft',
  ];
  const inserted = await db.query(
    `INSERT INTO lesson_plans (${columns.map(sqlColumn).join(', ')})
     VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    values
  );
  res.status(201).json({ plan: await findPlan(inserted.rows[0].id, req.teacher.id) });
}

// GET /api/teacher/lesson-plans/:id  (the plan, its grading info, and the
// school header the printout needs — one read, so the printout and the
// editor always show the same plan)
async function getLessonPlan(req, res) {
  const { id } = req.valid.params;
  const plan = await findPlan(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, plan.class_id);
  res.json({
    plan,
    grading: grading.gradingInfo(profile, plan.academic_year),
    header: await fetchPrintHeader(req.teacher.id),
  });
}

// PATCH /api/teacher/lesson-plans/:id
// Only the fields actually sent change. Moving a plan to another class
// or period re-checks the period against the new class's profile, and
// marking it Ready checks the merged plan, not just the fields sent.
async function updateLessonPlan(req, res) {
  const { id } = req.valid.params;
  const existing = await findPlan(id, req.teacher.id);
  const body = req.valid.body;
  const sent = Object.keys(req.body || {});

  const effectiveClassId = sent.includes('class_id') ? body.class_id : existing.class_id;
  const effectiveQuarter = sent.includes('quarter') ? body.quarter : existing.quarter;
  if (effectiveClassId !== existing.class_id || effectiveQuarter !== existing.quarter) {
    await findClass(effectiveClassId, req.teacher.id);
    await checkPlanPeriod(db, effectiveClassId, effectiveQuarter);
  }

  const merged = { ...existing, ...body };
  const effectiveAiUse = sent.includes('ai_use') ? body.ai_use : existing.ai_use;
  // Changing how AI was used without sending new wording leaves the old
  // wording behind, which would contradict the new choice (a "used"
  // plan carrying the no-AI sentence, or the reverse). A changed choice
  // with no wording starts from blank: "none" refills the standard
  // sentence, "used" is refused until the teacher describes it.
  const effectiveDeclaration = sent.includes('ai_declaration')
    ? body.ai_declaration
    : sent.includes('ai_use')
      ? ''
      : existing.ai_declaration;
  merged.ai_declaration = normalizeDeclaration(effectiveAiUse, effectiveDeclaration);
  if (sent.includes('status') && body.status === 'ready') assertReady(merged);

  const sets = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    sets.push(`${sqlColumn(column)} = $${values.length}`);
  };
  if (sent.includes('class_id')) set('class_id', body.class_id);
  if (sent.includes('quarter')) set('quarter', body.quarter);
  if (sent.includes('week_number')) set('week_number', body.week_number);
  if (sent.includes('session_date')) set('session_date', body.session_date);
  if (sent.includes('lesson_title')) set('lesson_title', body.lesson_title);
  if (sent.includes('ai_use')) set('ai_use', body.ai_use);
  if (sent.includes('ai_declaration') || sent.includes('ai_use')) set('ai_declaration', merged.ai_declaration);
  for (const field of CONTENT_FIELDS) {
    if (sent.includes(field)) set(field, body[field] ?? '');
  }
  if (sent.includes('checked_by_name')) {
    set('checked_by_name', body.checked_by_name ? String(body.checked_by_name).trim() : null);
  }
  if (sent.includes('status')) set('status', body.status);

  if (sets.length > 0) {
    values.push(id);
    await db.query(`UPDATE lesson_plans SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`, values);
  }
  res.json({ plan: await findPlan(id, req.teacher.id) });
}

// POST /api/teacher/lesson-plans/:id/duplicate  { week_number, session_date }
// A fresh draft with every section copied, for teaching the same lesson
// again or carrying a plan into the next week. The copy starts as a
// draft even when the original was Ready or Taught, so a copied plan is
// never presented as checked before the teacher has looked at it.
async function duplicateLessonPlan(req, res) {
  const { id } = req.valid.params;
  const source = await findPlan(id, req.teacher.id);
  await checkPlanPeriod(db, source.class_id, source.quarter);
  const { week_number, session_date } = req.valid.body;
  const columns = ['teacher_id', 'class_id', 'quarter', 'week_number', 'session_date', 'lesson_title', 'ai_use', 'ai_declaration', ...CONTENT_FIELDS, 'checked_by_name', 'status'];
  const values = [
    req.teacher.id, source.class_id, source.quarter, week_number, session_date, source.lesson_title,
    source.ai_use, source.ai_declaration,
    ...CONTENT_FIELDS.map((field) => source[field] ?? ''),
    source.checked_by_name, 'draft',
  ];
  const inserted = await db.query(
    `INSERT INTO lesson_plans (${columns.map(sqlColumn).join(', ')})
     VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    values
  );
  res.status(201).json({ plan: await findPlan(inserted.rows[0].id, req.teacher.id) });
}

// DELETE /api/teacher/lesson-plans/:id
async function deleteLessonPlan(req, res) {
  const { id } = req.valid.params;
  await findPlan(id, req.teacher.id);
  await db.query('DELETE FROM lesson_plans WHERE id = $1', [id]);
  res.json({ message: 'Lesson plan deleted.' });
}

module.exports = {
  listLessonPlans,
  createLessonPlan,
  getLessonPlan,
  updateLessonPlan,
  duplicateLessonPlan,
  deleteLessonPlan,
  findPlan,
  NO_AI_DECLARATION,
};
