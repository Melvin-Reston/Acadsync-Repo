// Paper exam checker (Batch 10): a teacher makes a paper exam for one
// class and one period, enters one answer key for the whole exam, prints
// one answer sheet per learner, and checks each sheet from a photo of
// the shaded circles. The photo is read in the browser; nothing about
// the photo is sent to the server. What the server saves is the
// teacher-reviewed answers, and the score is always recomputed here
// from the stored answer key — a score sent by the browser is never
// trusted. Scores go into an Examinations column in the Grades page,
// labelled with the exam number.
//
// One choice count per question: every question carries its own
// 2 to 5 choices (a 2-choice question may be True/False), so the key
// is one entry per question holding its choices and its correct
// position, and the printed sheet has as many circles in a row as
// that question has choices. Once any sheet has been saved, the key,
// the question count and the points can no longer change: a saved
// score was computed under them, and changing them underneath it
// would rewrite history.
const db = require('../db');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { sendCsv } = require('../utils/csv');
const { findClass } = require('./classes.controller');
const grading = require('../utils/grading');
const grades = require('./grades.controller');

// ---------- Small helpers ----------

function normalizeQuestions(value, questionCount) {
  const raw = Array.isArray(value) ? value : [];
  const questions = raw.map((entry) => ({
    choices: Number.isInteger(entry.choices) ? entry.choices : 4,
    correct: Number.isInteger(entry.correct) ? entry.correct : null,
    kind: entry.kind === 'true_false' ? 'true_false' : 'mcq',
  }));
  // A question past the exam's count is dropped; a short list is
  // padded with the default 4-choice question, so the sheet and the
  // reader always have one entry per question.
  const padded = questions.slice(0, questionCount);
  while (padded.length < questionCount) padded.push({ choices: 4, correct: null, kind: 'mcq' });
  return padded;
}

function keyIsComplete(exam) {
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  return questions.length === exam.question_count && questions.every((entry) => Number.isInteger(entry.correct));
}

function totalPoints(exam) {
  return exam.question_count * exam.points_each;
}

function examShape(row) {
  const questions = normalizeQuestions(row.questions, row.question_count);
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    class_id: row.class_id,
    quarter: row.quarter,
    exam_number: row.exam_number,
    title: row.title,
    instructions: row.instructions,
    question_count: row.question_count,
    points_each: row.points_each,
    questions,
    key_complete: questions.every((entry) => Number.isInteger(entry.correct)),
    total_points: row.question_count * row.points_each,
    grade_column_id: row.grade_column_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subject_name: row.subject_name,
    grade_level: row.grade_level,
    section_name: row.section_name,
    academic_year: row.academic_year,
    scan_count: Number(row.scan_count || 0),
  };
}

const EXAM_SELECT = `
  SELECT e.id, e.teacher_id, e.class_id, e.quarter, e.exam_number, e.title,
         e.instructions, e.question_count,
         e.points_each, e.questions, e.grade_column_id,
         e.created_at, e.updated_at,
         s.name AS subject_name, c.grade_level, c.section_name, c.academic_year,
         (SELECT COUNT(*)::int FROM exam_scans es WHERE es.exam_id = e.id) AS scan_count
    FROM exams e
    JOIN classes c ON c.id = e.class_id
    JOIN subjects s ON s.id = c.subject_id`;

// One exam of the signed-in teacher, with its class. An id from the
// request can never reach another teacher's exam.
async function findExam(id, teacherId, client = db) {
  const result = await client.query(`${EXAM_SELECT} WHERE e.id = $1 AND e.teacher_id = $2`, [id, teacherId]);
  if (result.rowCount === 0) throw notFound('Exam not found.');
  return examShape(result.rows[0]);
}

async function scanCount(client, examId) {
  const result = await client.query('SELECT COUNT(*)::int AS count FROM exam_scans WHERE exam_id = $1', [examId]);
  return result.rows[0].count;
}

// The grading profile of the exam's class, and a refusal when the period
// does not exist under it (Term 4 under DO 015, which has three terms).
async function checkExamPeriod(client, classId, quarter) {
  const profile = await grading.getClassGradingProfile(client, classId);
  if (!profile.periods.includes(quarter)) {
    throw badRequest(
      `${profile.periodLabel} ${quarter} does not exist under ${profile.label}. This year has ${profile.periodLabel}s ${profile.periods.join(', ')}.`,
      { errors: { quarter: `Choose ${profile.periodLabel.toLowerCase()} ${profile.periods.join(', ')}.` } }
    );
  }
  return profile;
}

// The key and the setup can change only while no sheet has been saved.
async function assertExamEditable(client, examId) {
  const count = await scanCount(client, examId);
  if (count > 0) {
    throw badRequest(
      `${count} sheet${count === 1 ? ' has' : 's have'} already been saved for this exam, so its answer key and setup can no longer be changed. Delete every checked sheet first if the exam itself was wrong.`,
      { errors: { questions: 'This exam already has saved sheets.' } }
    );
  }
}

// The Examinations column a checked exam writes its scores into. The
// first saved sheet creates the class record's standard columns first
// (so an exam for a period the teacher has never opened in Grades does
// not eat the standard columns), then appends one column at the end of
// Examinations, labelled with the exam number. Like every new
// Examinations column, it starts with a sub-weight of 0 under DO 015,
// so the teacher sets its share on the Grades page; under DO 8 it
// pools with the other Examinations columns straight away.
async function ensureExamColumn(client, exam, profile) {
  if (exam.grade_column_id) return exam.grade_column_id;
  const klass = await findClass(exam.class_id, exam.teacher_id, client);
  const columns = await grades.ensureColumns(client, exam.class_id, exam.quarter, profile);
  const position = columns.filter((column) => column.component === 'EX').length + 1;
  const subWeight = profile.transmutation === 'do8' ? null : 0;
  const inserted = await client.query(
    `INSERT INTO grade_columns (class_id, quarter, component, position, highest_possible, sub_weight, label)
     VALUES ($1, $2, 'EX', $3, $4, $5, $6) RETURNING id`,
    [exam.class_id, exam.quarter, position, totalPoints(exam), subWeight, `Exam ${exam.exam_number}`]
  );
  const columnId = inserted.rows[0].id;
  await client.query('UPDATE exams SET grade_column_id = $1, updated_at = NOW() WHERE id = $2', [columnId, exam.id]);
  await grades.clearSubmission(client, exam.class_id, exam.quarter, klass.academic_year);
  return columnId;
}

// The learner in the exam's school, enrolled in the exam's class. A
// Learner ID of another school, or of a learner not in this class, is
// simply not found — never the row.
async function findExamLearner(client, exam, learnerId) {
  const school = await client.query('SELECT school_id FROM teachers WHERE id = $1', [exam.teacher_id]);
  const schoolId = school.rows[0] ? school.rows[0].school_id : null;
  const found = await client.query('SELECT id FROM learners WHERE id = $1 AND school_id = $2', [learnerId, schoolId]);
  if (found.rowCount === 0) throw notFound('Learner not found.');
  const enrolled = await client.query('SELECT 1 FROM class_learners WHERE class_id = $1 AND learner_id = $2', [exam.class_id, learnerId]);
  if (enrolled.rowCount === 0) throw notFound('This learner is not enrolled in this class.');
  return found.rows[0];
}

// ---------- Teacher: exams ----------

// GET /api/teacher/exams?class_id=&quarter=&academic_year=
async function listExams(req, res) {
  const { class_id, quarter, academic_year } = req.valid.query;
  const where = ['e.teacher_id = $1'];
  const params = [req.teacher.id];
  if (class_id) {
    params.push(class_id);
    where.push(`e.class_id = $${params.length}`);
  }
  if (quarter) {
    params.push(quarter);
    where.push(`e.quarter = $${params.length}`);
  }
  if (academic_year) {
    params.push(academic_year);
    where.push(`c.academic_year = $${params.length}`);
  }
  const result = await db.query(
    `${EXAM_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.academic_year DESC, s.name, c.section_name, e.quarter, e.exam_number, e.id`,
    params
  );
  res.json({ items: result.rows.map(examShape) });
}

// POST /api/teacher/exams
// An exam starts with an empty answer key: the teacher enters the key
// next — one choice count and one correct answer per question — then
// prints the sheets. No sheet can be saved until the key is complete.
async function createExam(req, res) {
  const { class_id, quarter, exam_number, title, instructions, question_count, points_each } = req.valid.body;
  const klass = await findClass(class_id, req.teacher.id);
  await checkExamPeriod(db, class_id, quarter);

  let exam;
  try {
    const inserted = await db.query(
      `INSERT INTO exams (teacher_id, class_id, quarter, exam_number, title, instructions, question_count, points_each)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.teacher.id, class_id, quarter, exam_number, title, instructions, question_count, points_each]
    );
    exam = await findExam(inserted.rows[0].id, req.teacher.id);
  } catch (error) {
    if (error && error.code === '23505') {
      throw conflict(
        `Exam ${exam_number} already exists for ${klass.subject_name} · ${klass.section_name} in this period. Choose another exam number.`,
        { errors: { exam_number: 'This exam number is already used for this class and period.' } }
      );
    }
    throw error;
  }
  res.status(201).json({ exam });
}

// GET /api/teacher/exams/:id  (add ?format=csv to download the results)
// The exam, its answer key, every checked sheet, the full roster with
// who has been checked, and how each question went.
async function getExam(req, res) {
  const { id } = req.valid.params;
  const exam = await findExam(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, exam.class_id);

  const roster = await db.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex,
            sc.score::text AS score, sc.total_points::text AS total_points, sc.source, sc.updated_at
       FROM class_learners cl JOIN learners l ON l.id = cl.learner_id
       LEFT JOIN exam_scans sc ON sc.exam_id = $1 AND sc.learner_id = l.id
      WHERE cl.class_id = $2 ORDER BY l.last_name, l.first_name, l.id`,
    [id, exam.class_id]
  );

  if (req.valid.query && req.valid.query.format === 'csv') {
    const safe = (value) => String(value).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    sendCsv(
      res,
      `exam-${exam.exam_number}-${safe(exam.subject_name)}-${safe(exam.section_name)}.csv`,
      [
        { header: 'Learner', value: (row) => `${row.last_name}, ${row.first_name}` },
        { header: 'Learner ID', value: (row) => row.learner_id },
        { header: 'Sex', value: (row) => row.sex },
        { header: 'Score', value: (row) => (row.score === null ? '' : row.score) },
        { header: 'Total points', value: (row) => totalPoints(exam) },
        { header: 'Checked from', value: (row) => (row.source ? row.source : '') },
        { header: 'Updated at', value: (row) => (row.updated_at ? new Date(row.updated_at).toISOString() : '') },
      ],
      roster.rows.map((row) => ({ ...row, score: row.score === null ? null : Number(row.score) }))
    );
    return;
  }

  const scans = await db.query(
    `SELECT sc.id, sc.learner_id, l.first_name, l.last_name, l.learner_id AS learner_code,
            sc.score::text AS score, sc.total_points::text AS total_points, sc.answers, sc.source,
            sc.created_at, sc.updated_at
       FROM exam_scans sc JOIN learners l ON l.id = sc.learner_id
      WHERE sc.exam_id = $1 ORDER BY sc.updated_at, sc.id`,
    [id]
  );
  const scanRows = scans.rows.map((row) => ({
    id: row.id,
    learner_id: row.learner_id,
    first_name: row.first_name,
    last_name: row.last_name,
    learner_code: row.learner_code,
    score: Number(row.score),
    total_points: Number(row.total_points),
    answers: row.answers,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  // How each question went: right answers over checked sheets.
  const questions = exam.questions;
  const questionStats = Array.from({ length: exam.question_count }, (_, index) => {
    const correct = scanRows.filter((scan) => scan.answers[index] && scan.answers[index].selected === questions[index].correct).length;
    return { position: index + 1, attempts: scanRows.length, correct };
  });

  res.json({
    exam,
    grading: grading.gradingInfo(profile, exam.academic_year),
    roster: roster.rows.map((row) => ({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      learner_id: row.learner_id,
      sex: row.sex,
      scan:
        row.score === null
          ? null
          : { score: Number(row.score), total_points: Number(row.total_points), source: row.source, updated_at: row.updated_at },
    })),
    scans: scanRows,
    question_stats: questionStats,
  });
}

// ---------- Teacher: Test Item Analysis (Batch 12) ----------
//
// The analysis is computed here, from the saved checked sheets, every
// time it is read — it is never stored. Checking or re-checking a
// sheet therefore updates the analysis by itself, with no separate
// "generate" step and no second copy of the answers to go stale.
//
// Grouping follows the method printed on the teacher's Test Item
// Analysis sheet: the checked papers are ranked by total score and
// split at the median, upper group above it, lower group below it.
// A tie at the median is split by name order (last name, first name,
// Learner ID) so the same sheets always give the same groups — the
// sheet's "assigned by chance" cannot be reproduced on demand. With
// an odd number of takers the upper group takes the extra paper.
// Difficulty uses only the two groups, as on the sheet:
//   p = (correct in upper + correct in lower) / (upper size + lower size)
// Discrimination is the difference of the two groups' correct rates:
//   D = upper correct / upper size - lower correct / lower size
// which is the sheet's (upper - lower) / group size when the groups
// are equal. A distractor is judged on two rules from the sheet:
// it should be chosen by at least 5% of takers, and by more
// lower-group than upper-group learners.
function round2(value) {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function difficultyBand(p) {
  if (p >= 0.81) return { label: 'Very Easy', action: 'Reject/Revise' };
  if (p >= 0.61) return { label: 'Easy', action: 'Retain' };
  if (p >= 0.41) return { label: 'Moderately Difficult', action: 'Retain' };
  if (p >= 0.21) return { label: 'Difficult', action: 'Retain' };
  return { label: 'Very Difficult', action: 'Reject/Revise' };
}

function discriminationBand(d) {
  if (d === null) return { label: '—', action: '—' };
  if (d >= 0.5) return { label: 'Very Good Item', action: 'Retain' };
  if (d >= 0.4) return { label: 'Good Item; Very Usable', action: 'Retain' };
  if (d >= 0.3) return { label: 'Fair Quality; Usable Item', action: 'Retain' };
  if (d >= 0.2) return { label: 'Potentially Poor Item', action: 'Revise' };
  return { label: 'Potentially Very Poor', action: 'Reject' };
}

function optionLabel(index, kind) {
  if (kind === 'true_false') return index === 0 ? 'True' : 'False';
  return String.fromCharCode(65 + index);
}

// GET /api/teacher/exams/:id/item-analysis
// The exam, the school header for the printout, the two groups, one
// row per question, and the summary counts — all from the saved
// checked sheets. No migration: exam_scans.answers already holds one
// reviewed answer per question per learner.
async function getItemAnalysis(req, res) {
  const { id } = req.valid.params;
  const exam = await findExam(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, exam.class_id);

  const headerResult = await db.query(
    `SELECT t.first_name, t.last_name, t.region, t.division, t.deped_school_id,
            t.school_head_name, s.name AS school_name, s.city_region AS school_city_region,
            s.seal_path
       FROM teachers t JOIN schools s ON s.id = t.school_id WHERE t.id = $1`,
    [req.teacher.id]
  );
  const headerRow = headerResult.rows[0] || {};
  const header = {
    teacher_name: headerRow.first_name ? `${headerRow.first_name} ${headerRow.last_name}` : null,
    school_name: headerRow.school_name || null,
    school_city_region: headerRow.school_city_region || null,
    region: headerRow.region || null,
    division: headerRow.division || null,
    deped_school_id: headerRow.deped_school_id || null,
    school_head_name: headerRow.school_head_name || null,
    // The print header shows the school's own seal (uploaded on the
    // Dashboard), never the DepEd seal.
    has_school_seal: Boolean(headerRow.seal_path),
  };

  const rosterResult = await db.query('SELECT COUNT(*)::int AS count FROM class_learners WHERE class_id = $1', [exam.class_id]);
  const rosterSize = rosterResult.rows[0].count;

  const scansResult = await db.query(
    `SELECT sc.learner_id, l.first_name, l.last_name, l.learner_id AS learner_code,
            sc.score::text AS score, sc.answers
       FROM exam_scans sc JOIN learners l ON l.id = sc.learner_id
      WHERE sc.exam_id = $1`,
    [id]
  );
  const takers = scansResult.rows
    .map((row) => ({
      learner_id: row.learner_id,
      first_name: row.first_name,
      last_name: row.last_name,
      learner_code: row.learner_code,
      score: Number(row.score),
      answers: Array.isArray(row.answers) ? row.answers : [],
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const name = `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
      if (name !== 0) return name;
      return String(a.learner_code).localeCompare(String(b.learner_code)) || a.learner_id - b.learner_id;
    });
  const takerCount = takers.length;
  const upperSize = Math.ceil(takerCount / 2);
  const upper = takers.slice(0, upperSize);
  const lower = takers.slice(upperSize);
  const groupSize = upperSize + lower.length;
  const total = totalPoints(exam);
  const meanScore = takerCount === 0 ? null : round2(takers.reduce((sum, taker) => sum + taker.score, 0) / takerCount);
  const meanPercent = meanScore === null ? null : round2((meanScore / total) * 100);

  const items = [];
  const difficultyCounts = {
    'Very Easy': 0,
    Easy: 0,
    'Moderately Difficult': 0,
    Difficult: 0,
    'Very Difficult': 0,
  };
  const discriminationCounts = {
    'Very Good Item': 0,
    'Good Item; Very Usable': 0,
    'Fair Quality; Usable Item': 0,
    'Potentially Poor Item': 0,
    'Potentially Very Poor': 0,
  };
  const distractorCounts = { retain: 0, rephrase: 0, replace: 0 };

  exam.questions.forEach((question, index) => {
    const countSelected = (group, choice) =>
      group.filter((taker) => {
        const answer = taker.answers[index];
        return answer && answer.selected === choice;
      }).length;
    const upperCorrect = countSelected(upper, question.correct);
    const lowerCorrect = countSelected(lower, question.correct);
    const totalCorrect = upperCorrect + lowerCorrect;
    const blankCount = takers.filter((taker) => {
      const answer = taker.answers[index];
      return !answer || answer.selected === null || answer.selected === undefined;
    }).length;
    const difficulty = groupSize === 0 ? null : round2(totalCorrect / groupSize);
    const diffBand = difficulty === null ? { label: '—', action: '—' } : difficultyBand(difficulty);
    const discrimination =
      lower.length === 0 ? null : round2(upperCorrect / upperSize - lowerCorrect / lower.length);
    const discBand = discriminationBand(discrimination);
    if (difficulty !== null) difficultyCounts[diffBand.label] += 1;
    if (discrimination !== null) discriminationCounts[discBand.label] += 1;

    const distractors = Array.from({ length: question.choices }, (_, choice) => {
      const upperCount = countSelected(upper, choice);
      const lowerCount = countSelected(lower, choice);
      const optionTotal = upperCount + lowerCount;
      const plausibilityRatio = groupSize === 0 ? 0 : optionTotal / groupSize;
      const isCorrect = Number.isInteger(question.correct) && choice === question.correct;
      let remark;
      let action;
      if (isCorrect) {
        remark = 'Correct Answer';
        action = 'Correct Answer';
      } else if (optionTotal === 0) {
        remark = 'Replace or rewrite: non-functioning distractor';
        action = 'Replace or rewrite';
      } else if (plausibilityRatio < 0.05) {
        remark = 'Replace or rewrite: Option is too obvious, absurd, or unappealing.';
        action = 'Replace or rewrite';
      } else if (upperCount > lowerCount) {
        remark = 'Rephrase or check for trick wording: Option is misleading, double-keyed, or rewards partial misinterpretations.';
        action = 'Rephrase or check';
      } else if (lowerCount > upperCount) {
        remark = 'Retain: Good distractor';
        action = 'Retain';
      } else {
        remark = 'Retain: Plausible and meaningful distractor';
        action = 'Retain';
      }
      // The print form splits the combined remark into its two
      // judgements: plausibility (was the option chosen at all, and
      // by at least 5%?) and direction (which group chose it more?).
      // The combined remark and action above stay as they are: the
      // screen table and the summary counts use them.
      let plausibilityRemark;
      let directionRemark;
      if (isCorrect) {
        plausibilityRemark = 'Correct Answer';
        directionRemark = '—';
      } else if (optionTotal === 0) {
        plausibilityRemark = 'Replace or rewrite: non-functioning distractor';
        directionRemark = '—';
      } else {
        plausibilityRemark =
          plausibilityRatio < 0.05
            ? 'Replace or rewrite: Option is too obvious, absurd, or unappealing.'
            : 'Plausible';
        directionRemark =
          upperCount > lowerCount
            ? 'Rephrase or check for trick wording: Option is misleading, double-keyed, or rewards partial misinterpretations.'
            : lowerCount > upperCount
              ? 'Retain: Good distractor'
              : 'Retain: Plausible and meaningful distractor';
      }
      if (!isCorrect) {
        if (action === 'Retain') distractorCounts.retain += 1;
        else if (action === 'Rephrase or check') distractorCounts.rephrase += 1;
        else distractorCounts.replace += 1;
      }
      return {
        option_index: choice,
        label: optionLabel(choice, question.kind),
        is_correct: isCorrect,
        upper: upperCount,
        lower: lowerCount,
        total: optionTotal,
        plausibility: round2(plausibilityRatio),
        direction: upperCount - lowerCount,
        remark,
        action,
        plausibility_remark: plausibilityRemark,
        direction_remark: directionRemark,
      };
    });

    items.push({
      position: index + 1,
      kind: question.kind,
      choices: question.choices,
      correct: question.correct,
      correct_label: Number.isInteger(question.correct) ? optionLabel(question.correct, question.kind) : '—',
      upper_correct: upperCorrect,
      lower_correct: lowerCorrect,
      total_correct: totalCorrect,
      blank_count: blankCount,
      difficulty,
      difficulty_label: diffBand.label,
      difficulty_action: diffBand.action,
      discrimination,
      discrimination_label: discBand.label,
      discrimination_action: discBand.action,
      negative: discrimination !== null && discrimination < 0,
      distractors,
    });
  });

  const difficulties = items.map((item) => item.difficulty).filter((value) => value !== null);
  const maxDifficulty = difficulties.length ? Math.max(...difficulties) : null;
  const minDifficulty = difficulties.length ? Math.min(...difficulties) : null;

  res.json({
    exam,
    grading: grading.gradingInfo(profile, exam.academic_year),
    header,
    roster_size: rosterSize,
    takers: takerCount,
    groups: {
      method: 'median',
      upper_size: upperSize,
      lower_size: lower.length,
      tie_note:
        'Papers are ranked by total score and split at the median. A tie at the median is split by name order, so the same checked sheets always give the same groups.',
    },
    ready: takerCount >= 2,
    mean_score: meanScore,
    mean_percent: meanPercent,
    total_points: total,
    items,
    summary: {
      difficulty_counts: difficultyCounts,
      discrimination_counts: discriminationCounts,
      distractor_counts: distractorCounts,
      negative_items: items.filter((item) => item.negative).map((item) => item.position),
      most_learned: maxDifficulty === null ? [] : items.filter((item) => item.difficulty === maxDifficulty).map((item) => item.position),
      least_learned: minDifficulty === null ? [] : items.filter((item) => item.difficulty === minDifficulty).map((item) => item.position),
    },
  });
}

// PATCH /api/teacher/exams/:id  { title, instructions, and — before any
// sheet is saved — question_count, points_each }
// Growing the question count pads the key with default 4-choice
// questions; shrinking it trims the key. The per-question choice
// counts live in the key itself and are changed with it, never here.
async function updateExam(req, res) {
  const { id } = req.valid.params;
  const exam = await findExam(id, req.teacher.id);
  const body = req.valid.body;
  const setupChanging = body.question_count !== undefined || body.points_each !== undefined;

  const updated = await db.withTransaction(async (client) => {
    if (setupChanging) {
      await assertExamEditable(client, id);
      const nextCount = body.question_count !== undefined ? body.question_count : exam.question_count;
      const resized = normalizeQuestions(exam.questions, nextCount);
      await client.query(
        `UPDATE exams
            SET question_count = $1, points_each = $2, questions = $3::jsonb, updated_at = NOW()
          WHERE id = $4`,
        [nextCount, body.points_each !== undefined ? body.points_each : exam.points_each, JSON.stringify(resized), id]
      );
    }
    const sets = [];
    const params = [];
    if (body.title !== undefined) {
      params.push(body.title);
      sets.push(`title = $${params.length}`);
    }
    if (body.instructions !== undefined) {
      params.push(body.instructions);
      sets.push(`instructions = $${params.length}`);
    }
    if (sets.length > 0) {
      params.push(id);
      await client.query(`UPDATE exams SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
    }
    return findExam(id, req.teacher.id, client);
  });
  res.json({ exam: updated });
}

// PUT /api/teacher/exams/:id/key  { questions }
// The whole key at once: one entry per question, carrying that
// question's choice count, its correct answer, and whether it is
// True/False. A question with no answer yet saves with correct null;
// sheets can only be saved once every question has an answer.
async function saveKey(req, res) {
  const { id } = req.valid.params;
  const exam = await findExam(id, req.teacher.id);
  const questions = req.valid.body.questions;
  const saved = await db.withTransaction(async (client) => {
    await assertExamEditable(client, id);
    if (questions.length !== exam.question_count) {
      throw badRequest(`The answer key has ${questions.length} entries for ${exam.question_count} questions.`, {
        errors: { questions: 'The key needs one entry per question.' },
      });
    }
    const normalized = questions.map((entry) => ({
      choices: entry.choices,
      correct: entry.correct,
      kind: entry.kind,
    }));
    await client.query('UPDATE exams SET questions = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(normalized), id]);
    return findExam(id, req.teacher.id, client);
  });
  res.json({ exam: saved, message: keyIsComplete(saved) ? 'Answer key complete. Sheets can now be checked.' : 'Answer key saved.' });
}

// DELETE /api/teacher/exams/:id
// The exam, its checked sheets, and its Examinations column (with the
// scores in it) all go together, so no orphan column is left behind in
// the Grades page.
async function deleteExam(req, res) {
  const { id } = req.valid.params;
  const exam = await findExam(id, req.teacher.id);
  await db.withTransaction(async (client) => {
    if (exam.grade_column_id) {
      await client.query('DELETE FROM grade_columns WHERE id = $1', [exam.grade_column_id]);
    }
    await client.query('DELETE FROM exams WHERE id = $1', [id]);
  });
  res.json({ message: `"${exam.title}" and its checked sheets were deleted.` });
}

// ---------- Teacher: checked sheets ----------

// POST /api/teacher/exams/:id/scans  { learner_id, answers, source }
// The score is recomputed here from the stored key. Checking the same
// learner again replaces their answers and score — the sheet they hand
// in second is the one that counts — and the Grades column follows.
async function saveScan(req, res) {
  const { id } = req.valid.params;
  const exam = await findExam(id, req.teacher.id);
  const { learner_id, answers, source } = req.valid.body;

  const result = await db.withTransaction(async (client) => {
    if (!keyIsComplete(exam)) {
      throw badRequest('Finish the answer key first. Sheets cannot be saved with an incomplete key.', {
        errors: { questions: 'The answer key is not complete yet.' },
      });
    }
    if (answers.length !== exam.question_count) {
      throw badRequest(`Give an answer for every question: ${exam.question_count} answers, not ${answers.length}.`, {
        errors: { answers: 'Give an answer for every question.' },
      });
    }
    if (answers.some((answer, index) => answer.selected !== null && answer.selected >= exam.questions[index].choices)) {
      throw badRequest('One answer is past the number of choices for its question.', {
        errors: { answers: 'One answer is past the number of choices for its question.' },
      });
    }
    await findExamLearner(client, exam, learner_id);
    const profile = await checkExamPeriod(client, exam.class_id, exam.quarter);
    const questions = exam.questions;
    const correctCount = answers.reduce(
      (count, answer, index) => count + (answer.selected !== null && answer.selected === questions[index].correct ? 1 : 0),
      0
    );
    const score = correctCount * exam.points_each;
    const total = totalPoints(exam);
    const normalized = answers.map((answer) => ({
      selected: answer.selected,
      uncertain: Boolean(answer.uncertain),
      multiple: Boolean(answer.multiple),
    }));

    const inserted = await client.query(
      `INSERT INTO exam_scans (exam_id, learner_id, score, total_points, answers, source)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (exam_id, learner_id) DO UPDATE
         SET score = EXCLUDED.score, total_points = EXCLUDED.total_points,
             answers = EXCLUDED.answers, source = EXCLUDED.source, updated_at = NOW()
       RETURNING id, updated_at`,
      [id, learner_id, score, total, JSON.stringify(normalized), source]
    );

    const columnId = await ensureExamColumn(client, exam, profile);
    await client.query(
      `INSERT INTO grade_scores (column_id, learner_id, score) VALUES ($1, $2, $3)
       ON CONFLICT (column_id, learner_id) DO UPDATE SET score = $3, updated_at = NOW()`,
      [columnId, learner_id, score]
    );
    const klass = await findClass(exam.class_id, exam.teacher_id, client);
    await grades.clearSubmission(client, exam.class_id, exam.quarter, klass.academic_year);

    return { scan_id: inserted.rows[0].id, score, total_points: total, correct_count: correctCount, updated_at: inserted.rows[0].updated_at };
  });

  res.status(201).json({ ...result, message: `Checked. ${result.score} out of ${result.total_points}.` });
}

// DELETE /api/teacher/exams/:id/scans/:scanId
// The checked sheet and its score leave the Grades page together, so
// the learner is simply unchecked again.
async function deleteScan(req, res) {
  const { id, scanId } = req.valid.params;
  const exam = await findExam(id, req.teacher.id);
  const removed = await db.withTransaction(async (client) => {
    const found = await client.query(
      `SELECT sc.id, sc.learner_id, l.first_name, l.last_name
         FROM exam_scans sc JOIN learners l ON l.id = sc.learner_id
        WHERE sc.id = $1 AND sc.exam_id = $2`,
      [scanId, id]
    );
    if (found.rowCount === 0) throw notFound('Checked sheet not found.');
    if (exam.grade_column_id) {
      await client.query('DELETE FROM grade_scores WHERE column_id = $1 AND learner_id = $2', [exam.grade_column_id, found.rows[0].learner_id]);
    }
    await client.query('DELETE FROM exam_scans WHERE id = $1', [scanId]);
    return found.rows[0];
  });
  res.json({ message: `${removed.first_name} ${removed.last_name} is unchecked. Their score was removed from the Grades page.` });
}

module.exports = {
  listExams,
  createExam,
  getExam,
  getItemAnalysis,
  updateExam,
  saveKey,
  deleteExam,
  saveScan,
  deleteScan,
};
