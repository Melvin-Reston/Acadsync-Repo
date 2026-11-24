// Online quizzes (Batch 9): a teacher makes a quiz for one class and one
// period, adds questions with an answer key, publishes it, and shares the
// link. Learners open the link, enter their Learner ID, and answer. The
// quiz is checked automatically from the answer key, and each learner's
// score is written into a Written Works column in the Grades page.
//
// The answer key never leaves the server on a public request: the public
// quiz read sends the questions without correct_index, and checking
// happens only in the submit handler, from the stored key.
//
// A Learner ID is not a secret (it is already on the roster and the QR
// pass), so one attempt per learner is the protection, and the teacher
// can reset an attempt when something went wrong. Resetting removes the
// score from the Grades page too.
const crypto = require('crypto');
const db = require('../db');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { sendCsv } = require('../utils/csv');
const { findClass } = require('./classes.controller');
const grading = require('../utils/grading');
const grades = require('./grades.controller');

const TRUE_FALSE_OPTIONS = ['True', 'False'];

// ---------- Small helpers ----------

function learnerIdFromCode(code) {
  const trimmed = String(code || '').trim();
  const prefix = 'acadsync:';
  return trimmed.toLowerCase().startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
}

// A short link code, made only of letters and digits so it survives being
// copied, pasted, and read out loud. 10 characters is far more than the
// number of quizzes a teacher will ever make.
function makeCode() {
  return crypto.randomBytes(8).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'quiz';
}

function quizShape(row) {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    class_id: row.class_id,
    quarter: row.quarter,
    quiz_number: row.quiz_number,
    title: row.title,
    instructions: row.instructions,
    status: row.status,
    code: row.code,
    deadline: row.deadline,
    grade_column_id: row.grade_column_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subject_name: row.subject_name,
    grade_level: row.grade_level,
    section_name: row.section_name,
    academic_year: row.academic_year,
    question_count: Number(row.question_count || 0),
    attempt_count: Number(row.attempt_count || 0),
    total_points: Number(row.total_points || 0),
  };
}

const QUIZ_SELECT = `
  SELECT q.id, q.teacher_id, q.class_id, q.quarter, q.quiz_number, q.title,
         q.instructions, q.status, q.code, q.deadline, q.grade_column_id,
         q.created_at, q.updated_at,
         s.name AS subject_name, c.grade_level, c.section_name, c.academic_year,
         (SELECT COUNT(*)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
         (SELECT COUNT(*)::int FROM quiz_attempts qa WHERE qa.quiz_id = q.id) AS attempt_count,
         (SELECT COALESCE(SUM(qq.points), 0)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS total_points
    FROM quizzes q
    JOIN classes c ON c.id = q.class_id
    JOIN subjects s ON s.id = c.subject_id`;

// One quiz of the signed-in teacher, with its class. An id from the
// request can never reach another teacher's quiz.
async function findQuiz(id, teacherId, client = db) {
  const result = await client.query(`${QUIZ_SELECT} WHERE q.id = $1 AND q.teacher_id = $2`, [id, teacherId]);
  if (result.rowCount === 0) throw notFound('Quiz not found.');
  return quizShape(result.rows[0]);
}

// The public quiz read, kept separate so the teacher-scoped select above
// is never confused with the public one.
async function findPublicQuiz(code, client = db) {
  const result = await client.query(
    `SELECT q.id, q.teacher_id, q.class_id, q.quarter, q.quiz_number, q.title,
            q.instructions, q.status, q.code, q.deadline, q.grade_column_id,
            q.created_at, q.updated_at,
            s.name AS subject_name, c.grade_level, c.section_name, c.academic_year,
            t.first_name AS teacher_first_name, t.last_name AS teacher_last_name,
            (SELECT COUNT(*)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
            (SELECT COUNT(*)::int FROM quiz_attempts qa WHERE qa.quiz_id = q.id) AS attempt_count,
            (SELECT COALESCE(SUM(qq.points), 0)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS total_points
       FROM quizzes q
       JOIN classes c ON c.id = q.class_id
       JOIN subjects s ON s.id = c.subject_id
       JOIN teachers t ON t.id = q.teacher_id
      WHERE q.code = $1`,
    [code]
  );
  if (result.rowCount === 0) throw notFound('This quiz link is not valid. Check the link your teacher sent.');
  return quizShape(result.rows[0]);
}

async function listQuestions(client, quizId, includeAnswers = true) {
  const result = await client.query(
    `SELECT id, quiz_id, position, question_type, question_text, options,
            correct_index, points
       FROM quiz_questions WHERE quiz_id = $1 ORDER BY position, id`,
    [quizId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    quiz_id: row.quiz_id,
    position: row.position,
    question_type: row.question_type,
    question_text: row.question_text,
    options: row.options,
    ...(includeAnswers ? { correct_index: row.correct_index } : {}),
    points: Number(row.points),
  }));
}

async function questionTotal(client, quizId) {
  const result = await client.query('SELECT COALESCE(SUM(points), 0)::int AS total FROM quiz_questions WHERE quiz_id = $1', [quizId]);
  return Number(result.rows[0].total);
}

async function attemptCount(client, quizId) {
  const result = await client.query('SELECT COUNT(*)::int AS count FROM quiz_attempts WHERE quiz_id = $1', [quizId]);
  return result.rows[0].count;
}

// The grading profile of the quiz's class, and a refusal when the period
// does not exist under it (Term 4 under DO 015, which has three terms).
async function checkQuizPeriod(client, classId, quarter) {
  const profile = await grading.getClassGradingProfile(client, classId);
  if (!profile.periods.includes(quarter)) {
    throw badRequest(
      `${profile.periodLabel} ${quarter} does not exist under ${profile.label}. This year has ${profile.periodLabel}s ${profile.periods.join(', ')}.`,
      { errors: { quarter: `Choose ${profile.periodLabel.toLowerCase()} ${profile.periods.join(', ')}.` } }
    );
  }
  return profile;
}

// Questions can change only while nobody has taken the quiz: a score
// already written to the Grades page was computed from the questions as
// they were, and changing them underneath it would rewrite history.
async function assertQuestionsEditable(client, quizId) {
  const count = await attemptCount(client, quizId);
  if (count > 0) {
    throw badRequest(
      `${count} learner${count === 1 ? ' has' : 's have'} already taken this quiz, so its questions can no longer be changed. Reset every attempt first if the quiz itself was wrong.`,
      { errors: { questions: 'This quiz already has attempts.' } }
    );
  }
}

// The Written Works column a published quiz writes its scores into. The
// first publish creates the class record's standard columns first (so a
// quiz for a period the teacher has never opened in Grades does not eat
// the standard WW1–WW4 / PT / EX columns), then appends one column at
// the end of Written Works, labelled with the quiz number so the Grades
// page shows "Quiz 1" instead of "WW5". The column's highest possible
// score is the quiz's total points.
async function ensureQuizColumn(client, quiz, profile) {
  if (quiz.grade_column_id) return quiz.grade_column_id;
  const klass = await findClass(quiz.class_id, quiz.teacher_id, client);
  const columns = await grades.ensureColumns(client, quiz.class_id, quiz.quarter, profile);
  const total = await questionTotal(client, quiz.id);
  const position = columns.filter((column) => column.component === 'WW').length + 1;
  const inserted = await client.query(
    `INSERT INTO grade_columns (class_id, quarter, component, position, highest_possible, label)
     VALUES ($1, $2, 'WW', $3, $4, $5) RETURNING id`,
    [quiz.class_id, quiz.quarter, position, total, `Quiz ${quiz.quiz_number}`]
  );
  const columnId = inserted.rows[0].id;
  await client.query('UPDATE quizzes SET grade_column_id = $1, updated_at = NOW() WHERE id = $2', [columnId, quiz.id]);
  await grades.clearSubmission(client, quiz.class_id, quiz.quarter, klass.academic_year);
  return columnId;
}

// After a question changes (before any attempt), the linked column's
// highest possible score follows the quiz's new total. There are no
// scores in it yet — questions are locked once anyone has taken it.
async function syncColumnTotal(client, quiz) {
  if (!quiz.grade_column_id) return;
  const total = await questionTotal(client, quiz.id);
  if (total > 0) {
    await client.query('UPDATE grade_columns SET highest_possible = $1, updated_at = NOW() WHERE id = $2', [total, quiz.grade_column_id]);
  }
}

// ---------- Teacher: quizzes ----------

// GET /api/teacher/quizzes?class_id=&quarter=&status=&academic_year=
async function listQuizzes(req, res) {
  const { class_id, quarter, status, academic_year } = req.valid.query;
  const where = ['q.teacher_id = $1'];
  const params = [req.teacher.id];
  if (class_id) {
    params.push(class_id);
    where.push(`q.class_id = $${params.length}`);
  }
  if (quarter) {
    params.push(quarter);
    where.push(`q.quarter = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`q.status = $${params.length}`);
  }
  if (academic_year) {
    params.push(academic_year);
    where.push(`c.academic_year = $${params.length}`);
  }
  const result = await db.query(
    `${QUIZ_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.academic_year DESC, s.name, c.section_name, q.quarter, q.quiz_number, q.id`,
    params
  );
  res.json({ items: result.rows.map(quizShape) });
}

// POST /api/teacher/quizzes  { class_id, quarter, quiz_number, title, instructions }
// A quiz starts as a draft: the link does not work until it is published,
// and publishing is what creates its Written Works column.
async function createQuiz(req, res) {
  const { class_id, quarter, quiz_number, title, instructions } = req.valid.body;
  const klass = await findClass(class_id, req.teacher.id);
  await checkQuizPeriod(db, class_id, quarter);

  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await db.query('SELECT 1 FROM quizzes WHERE code = $1', [code]);
    if (existing.rowCount === 0) break;
    code = makeCode();
  }

  let quiz;
  try {
    const inserted = await db.query(
      `INSERT INTO quizzes (teacher_id, class_id, quarter, quiz_number, title, instructions, code)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.teacher.id, class_id, quarter, quiz_number, title, instructions, code]
    );
    quiz = await findQuiz(inserted.rows[0].id, req.teacher.id);
  } catch (error) {
    if (error && error.code === '23505') {
      throw conflict(
        `Quiz ${quiz_number} already exists for ${klass.subject_name} · ${klass.section_name} in this period. Choose another quiz number.`,
        { errors: { quiz_number: 'This quiz number is already used for this class and period.' } }
      );
    }
    throw error;
  }
  res.status(201).json({ quiz });
}

// GET /api/teacher/quizzes/:id  (the quiz, its questions with the answer
// key, every attempt, the full roster with who has taken it, and how each
// question went; add ?format=csv to download the results instead)
async function getQuiz(req, res) {
  const { id } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  const profile = await grading.getClassGradingProfile(db, quiz.class_id);
  const questions = await listQuestions(db, id, true);

  const roster = await db.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex,
            a.score::text AS score, a.total_points::text AS total_points, a.submitted_at
       FROM class_learners cl JOIN learners l ON l.id = cl.learner_id
       LEFT JOIN quiz_attempts a ON a.quiz_id = $1 AND a.learner_id = l.id
      WHERE cl.class_id = $2 ORDER BY l.last_name, l.first_name, l.id`,
    [id, quiz.class_id]
  );

  if (req.valid.query && req.valid.query.format === 'csv') {
    const safe = (value) => String(value).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    sendCsv(
      res,
      `quiz-${quiz.quiz_number}-${safe(quiz.subject_name)}-${safe(quiz.section_name)}.csv`,
      [
        { header: 'Learner', value: (row) => `${row.last_name}, ${row.first_name}` },
        { header: 'Learner ID', value: (row) => row.learner_id },
        { header: 'Sex', value: (row) => row.sex },
        { header: 'Score', value: (row) => (row.score === null ? '' : row.score) },
        { header: 'Total points', value: (row) => quiz.total_points },
        { header: 'Submitted at', value: (row) => (row.submitted_at ? new Date(row.submitted_at).toISOString() : '') },
      ],
      roster.rows.map((row) => ({ ...row, score: row.score === null ? null : Number(row.score) }))
    );
    return;
  }

  const attempts = await db.query(
    `SELECT a.id, a.learner_id, l.first_name, l.last_name, l.learner_id AS learner_code,
            a.score::text AS score, a.total_points::text AS total_points, a.submitted_at
       FROM quiz_attempts a JOIN learners l ON l.id = a.learner_id
      WHERE a.quiz_id = $1 ORDER BY a.submitted_at, a.id`,
    [id]
  );

  // How each question went, across every attempt: right answers over
  // attempts that answered it (a blank answer counts as answered wrong,
  // so the denominator is every attempt).
  const questionStats = await db.query(
    `SELECT qq.id AS question_id,
            COUNT(a.id)::int AS attempts,
            COALESCE(SUM(CASE WHEN ans.is_correct THEN 1 ELSE 0 END), 0)::int AS correct
       FROM quiz_questions qq
       LEFT JOIN quiz_answers ans ON ans.question_id = qq.id
       LEFT JOIN quiz_attempts a ON a.id = ans.attempt_id
      WHERE qq.quiz_id = $1 GROUP BY qq.id`,
    [id]
  );
  const statsByQuestion = new Map(questionStats.rows.map((row) => [row.question_id, row]));

  res.json({
    quiz,
    grading: grading.gradingInfo(profile, quiz.academic_year),
    questions,
    roster: roster.rows.map((row) => ({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      learner_id: row.learner_id,
      sex: row.sex,
      attempt:
        row.score === null
          ? null
          : { score: Number(row.score), total_points: Number(row.total_points), submitted_at: row.submitted_at },
    })),
    attempts: attempts.rows.map((row) => ({
      id: row.id,
      learner_id: row.learner_id,
      first_name: row.first_name,
      last_name: row.last_name,
      learner_code: row.learner_code,
      score: Number(row.score),
      total_points: Number(row.total_points),
      submitted_at: row.submitted_at,
    })),
    question_stats: questions.map((question) => {
      const stats = statsByQuestion.get(question.id) || { attempts: 0, correct: 0 };
      return { question_id: question.id, attempts: stats.attempts, correct: stats.correct };
    }),
  });
}

// PATCH /api/teacher/quizzes/:id  { title, instructions, deadline }
async function updateQuiz(req, res) {
  const { id } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  const { title, instructions, deadline, clear_deadline } = req.valid.body;
  const sets = [];
  const params = [];
  if (title !== undefined) {
    params.push(title);
    sets.push(`title = $${params.length}`);
  }
  if (instructions !== undefined) {
    params.push(instructions);
    sets.push(`instructions = $${params.length}`);
  }
  if (clear_deadline) {
    sets.push('deadline = NULL');
  } else if (deadline !== undefined) {
    params.push(deadline);
    sets.push(`deadline = $${params.length}`);
  }
  params.push(id);
  await db.query(`UPDATE quizzes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
  res.json({ quiz: await findQuiz(id, req.teacher.id) });
}

// POST /api/teacher/quizzes/:id/publish
// Needs at least one question. Publishing creates the Written Works
// column; reopening a closed quiz reuses the same column.
async function publishQuiz(req, res) {
  const { id } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  if (quiz.status === 'published') return res.json({ quiz, message: 'This quiz is already published.' });
  if (quiz.deadline && new Date(quiz.deadline) <= new Date()) {
    throw badRequest('The deadline has already passed. Change it or remove it before publishing.', {
      errors: { deadline: 'The deadline has already passed.' },
    });
  }
  const profile = await checkQuizPeriod(db, quiz.class_id, quiz.quarter);
  const published = await db.withTransaction(async (client) => {
    const questions = await listQuestions(client, id, true);
    if (questions.length === 0) {
      throw badRequest('Add at least one question before publishing.', {
        errors: { questions: 'Add at least one question.' },
      });
    }
    await ensureQuizColumn(client, quiz, profile);
    await client.query("UPDATE quizzes SET status = 'published', updated_at = NOW() WHERE id = $1", [id]);
    return findQuiz(id, req.teacher.id, client);
  });
  res.json({ quiz: published, message: 'Quiz published. Share its link with your learners.' });
}

// POST /api/teacher/quizzes/:id/close
async function closeQuiz(req, res) {
  const { id } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  if (quiz.status !== 'published') {
    throw badRequest('Only a published quiz can be closed.', { errors: { status: 'This quiz is not published.' } });
  }
  await db.query("UPDATE quizzes SET status = 'closed', updated_at = NOW() WHERE id = $1", [id]);
  res.json({ quiz: await findQuiz(id, req.teacher.id), message: 'Quiz closed. The link no longer works, and the scores stay in the Grades page.' });
}

// DELETE /api/teacher/quizzes/:id
// The quiz, its questions, its attempts, and its Written Works column
// (with the scores in it) all go together, so no orphan column is left
// behind in the Grades page.
async function deleteQuiz(req, res) {
  const { id } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  await db.withTransaction(async (client) => {
    if (quiz.grade_column_id) {
      await client.query('DELETE FROM grade_columns WHERE id = $1', [quiz.grade_column_id]);
    }
    await client.query('DELETE FROM quizzes WHERE id = $1', [id]);
  });
  res.json({ message: `"${quiz.title}" and its scores were deleted.` });
}

// ---------- Teacher: questions ----------

function normalizedOptions(body) {
  if (body.question_type === 'true_false') return TRUE_FALSE_OPTIONS;
  return body.options;
}

// POST /api/teacher/quizzes/:id/questions
async function addQuestion(req, res) {
  const { id } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  const question = await db.withTransaction(async (client) => {
    await assertQuestionsEditable(client, id);
    const count = await client.query('SELECT COUNT(*)::int AS count FROM quiz_questions WHERE quiz_id = $1', [id]);
    const inserted = await client.query(
      `INSERT INTO quiz_questions (quiz_id, position, question_type, question_text, options, correct_index, points)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id, quiz_id, position, question_type, question_text, options, correct_index, points`,
      [id, count.rows[0].count + 1, req.valid.body.question_type, req.valid.body.question_text, JSON.stringify(normalizedOptions(req.valid.body)), req.valid.body.correct_index, req.valid.body.points]
    );
    const row = inserted.rows[0];
    await syncColumnTotal(client, quiz);
    return { ...row, points: Number(row.points) };
  });
  res.status(201).json({ question });
}

// PATCH /api/teacher/quizzes/:id/questions/:questionId
async function updateQuestion(req, res) {
  const { id, questionId } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  const question = await db.withTransaction(async (client) => {
    await assertQuestionsEditable(client, id);
    const found = await client.query('SELECT id FROM quiz_questions WHERE id = $1 AND quiz_id = $2', [questionId, id]);
    if (found.rowCount === 0) throw notFound('Question not found.');
    const updated = await client.query(
      `UPDATE quiz_questions
          SET question_type = $1, question_text = $2, options = $3::jsonb, correct_index = $4, points = $5, updated_at = NOW()
        WHERE id = $6 RETURNING id, quiz_id, position, question_type, question_text, options, correct_index, points`,
      [req.valid.body.question_type, req.valid.body.question_text, JSON.stringify(normalizedOptions(req.valid.body)), req.valid.body.correct_index, req.valid.body.points, questionId]
    );
    const row = updated.rows[0];
    await syncColumnTotal(client, quiz);
    return { ...row, points: Number(row.points) };
  });
  res.json({ question });
}

// DELETE /api/teacher/quizzes/:id/questions/:questionId
async function deleteQuestion(req, res) {
  const { id, questionId } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  await db.withTransaction(async (client) => {
    await assertQuestionsEditable(client, id);
    const found = await client.query('SELECT id, position FROM quiz_questions WHERE id = $1 AND quiz_id = $2', [questionId, id]);
    if (found.rowCount === 0) throw notFound('Question not found.');
    const remaining = await client.query('SELECT COUNT(*)::int AS count FROM quiz_questions WHERE quiz_id = $1', [id]);
    if (remaining.rows[0].count <= 1 && quiz.status === 'published') {
      throw badRequest('A published quiz needs at least one question. Close the quiz first if you want to remove its last question.', {
        errors: { questions: 'A published quiz needs at least one question.' },
      });
    }
    await client.query('DELETE FROM quiz_questions WHERE id = $1', [questionId]);
    await client.query(
      'UPDATE quiz_questions SET position = position - 1 WHERE quiz_id = $1 AND position > $2',
      [id, found.rows[0].position]
    );
    await syncColumnTotal(client, quiz);
  });
  res.json({ message: 'Question deleted.' });
}

// POST /api/teacher/quizzes/:id/attempts/:attemptId/reset
// The learner can take the quiz again, and the old score leaves the
// Grades page with the attempt.
async function resetAttempt(req, res) {
  const { id, attemptId } = req.valid.params;
  const quiz = await findQuiz(id, req.teacher.id);
  const removed = await db.withTransaction(async (client) => {
    const found = await client.query(
      `SELECT a.id, l.first_name, l.last_name, a.learner_id
         FROM quiz_attempts a JOIN learners l ON l.id = a.learner_id
        WHERE a.id = $1 AND a.quiz_id = $2`,
      [attemptId, id]
    );
    if (found.rowCount === 0) throw notFound('Attempt not found.');
    if (quiz.grade_column_id) {
      await client.query('DELETE FROM grade_scores WHERE column_id = $1 AND learner_id = $2', [quiz.grade_column_id, found.rows[0].learner_id]);
    }
    await client.query('DELETE FROM quiz_attempts WHERE id = $1', [attemptId]);
    return found.rows[0];
  });
  res.json({ message: `${removed.first_name} ${removed.last_name} can take the quiz again. Their old score was removed from the Grades page.` });
}

// ---------- Public: taking a quiz ----------

// Whether the link is open right now: published, and before any deadline.
function quizOpen(quiz) {
  if (quiz.status !== 'published') return false;
  if (quiz.deadline && new Date(quiz.deadline) <= new Date()) return false;
  return true;
}

// GET /api/quiz/:code  (no sign-in: this is the link the teacher shares)
// The questions arrive without the answer key. A draft or closed quiz
// sends no questions at all, only its state, so the page can say plainly
// why the link does not work yet.
async function getPublicQuiz(req, res) {
  const { code } = req.valid.params;
  const quiz = await findPublicQuiz(code);
  const profile = await grading.getClassGradingProfile(db, quiz.class_id);
  const open = quizOpen(quiz);
  const questions = open ? await listQuestions(db, quiz.id, false) : [];
  res.json({
    quiz: {
      code: quiz.code,
      title: quiz.title,
      instructions: quiz.instructions,
      status: quiz.status,
      deadline: quiz.deadline,
      quiz_number: quiz.quiz_number,
      quarter: quiz.quarter,
      period_label: profile.periodLabel,
      total_points: quiz.total_points,
      question_count: quiz.question_count,
      teacher_name: `${quiz.teacher_first_name} ${quiz.teacher_last_name}`,
      class: {
        subject_name: quiz.subject_name,
        grade_level: quiz.grade_level,
        section_name: quiz.section_name,
        academic_year: quiz.academic_year,
      },
      open,
    },
    questions,
  });
}

// The learner in the quiz's school, enrolled in the quiz's class. A
// Learner ID of another school, or of a learner not in this class, is
// simply not found — never the row.
async function findQuizLearner(client, quiz, learnerCode) {
  const school = await client.query('SELECT school_id FROM teachers WHERE id = $1', [quiz.teacher_id]);
  const schoolId = school.rows[0] ? school.rows[0].school_id : null;
  const found = await client.query(
    'SELECT id, first_name, last_name, learner_id, sex FROM learners WHERE school_id = $1 AND LOWER(learner_id) = LOWER($2)',
    [schoolId, learnerCode]
  );
  if (found.rowCount === 0) {
    throw notFound('No learner with that ID is enrolled in this class. Check the ID and try again.');
  }
  const learner = found.rows[0];
  const enrolled = await client.query('SELECT 1 FROM class_learners WHERE class_id = $1 AND learner_id = $2', [quiz.class_id, learner.id]);
  if (enrolled.rowCount === 0) {
    throw notFound('No learner with that ID is enrolled in this class. Check the ID and try again.');
  }
  return learner;
}

// GET /api/quiz/:code/lookup?learner_id=  (no sign-in)
// Confirms who the learner is before the questions show, and says plainly
// when they have already submitted.
async function lookupPublicLearner(req, res) {
  const { code } = req.valid.params;
  const quiz = await findPublicQuiz(code);
  const learnerCode = learnerIdFromCode(req.valid.query.learner_id);
  const learner = await findQuizLearner(db, quiz, learnerCode);
  const attempt = await db.query(
    'SELECT score::text AS score, total_points::text AS total_points, submitted_at FROM quiz_attempts WHERE quiz_id = $1 AND learner_id = $2',
    [quiz.id, learner.id]
  );
  res.json({
    learner: {
      first_name: learner.first_name,
      last_name: learner.last_name,
      learner_id: learner.learner_id,
      sex: learner.sex,
    },
    already_submitted: attempt.rowCount > 0,
    attempt: attempt.rows[0]
      ? { score: Number(attempt.rows[0].score), total_points: Number(attempt.rows[0].total_points), submitted_at: attempt.rows[0].submitted_at }
      : null,
    open: quizOpen(quiz),
  });
}

// POST /api/quiz/:code/submit  (no sign-in)  { learner_id, answers }
// Checking happens here, from the stored answer key. The score is the
// sum of the points of the questions answered right; a blank answer
// earns nothing. The score is written into the quiz's Written Works
// column in the same transaction, and a filing for the period is cleared
// the same way a typed score clears it.
async function submitPublicQuiz(req, res) {
  const { code } = req.valid.params;
  const { learner_id, answers } = req.valid.body;
  const quiz = await findPublicQuiz(code);
  if (!quizOpen(quiz)) {
    throw badRequest(
      quiz.status === 'closed'
        ? 'This quiz is closed. Ask your teacher if it will open again.'
        : quiz.deadline && new Date(quiz.deadline) <= new Date()
          ? 'The deadline for this quiz has passed.'
          : 'This quiz is not open yet. Ask your teacher for the link when it is published.',
      { errors: { quiz: 'This quiz is not open.' } }
    );
  }

  const result = await db.withTransaction(async (client) => {
    const learnerCode = learnerIdFromCode(learner_id);
    const learner = await findQuizLearner(client, quiz, learnerCode);

    const existing = await client.query('SELECT 1 FROM quiz_attempts WHERE quiz_id = $1 AND learner_id = $2', [quiz.id, learner.id]);
    if (existing.rowCount > 0) {
      throw conflict('You have already submitted this quiz. Ask your teacher to reset your attempt if something went wrong.');
    }

    const questions = await listQuestions(client, quiz.id, true);
    if (questions.length === 0) {
      throw badRequest('This quiz has no questions yet.');
    }
    const byId = new Map(questions.map((question) => [question.id, question]));
    const seen = new Set();
    for (const answer of answers) {
      if (!byId.has(answer.question_id)) throw badRequest('One of the answers is not for a question in this quiz.');
      if (seen.has(answer.question_id)) throw badRequest('An answer appears twice.');
      seen.add(answer.question_id);
      if (answer.selected_index !== null) {
        const options = byId.get(answer.question_id).options;
        if (answer.selected_index < 0 || answer.selected_index >= options.length) {
          throw badRequest('One of the answers is not one of the choices.');
        }
      }
    }

    const totalPoints = questions.reduce((sum, question) => sum + question.points, 0);
    let score = 0;
    let correctCount = 0;
    const rows = questions.map((question) => {
      const answer = answers.find((entry) => entry.question_id === question.id);
      const selected = answer ? answer.selected_index : null;
      const isCorrect = selected !== null && selected === question.correct_index;
      const earned = isCorrect ? question.points : 0;
      score += earned;
      if (isCorrect) correctCount += 1;
      return { question_id: question.id, selected_index: selected, is_correct: isCorrect, points_earned: earned };
    });

    const inserted = await client.query(
      'INSERT INTO quiz_attempts (quiz_id, learner_id, score, total_points) VALUES ($1, $2, $3, $4) RETURNING id, submitted_at',
      [quiz.id, learner.id, score, totalPoints]
    );
    const attemptId = inserted.rows[0].id;
    for (const row of rows) {
      await client.query(
        'INSERT INTO quiz_answers (attempt_id, question_id, selected_index, is_correct, points_earned) VALUES ($1, $2, $3, $4, $5)',
        [attemptId, row.question_id, row.selected_index, row.is_correct, row.points_earned]
      );
    }

    if (quiz.grade_column_id) {
      await client.query(
        `INSERT INTO grade_scores (column_id, learner_id, score) VALUES ($1, $2, $3)
         ON CONFLICT (column_id, learner_id) DO UPDATE SET score = $3, updated_at = NOW()`,
        [quiz.grade_column_id, learner.id, score]
      );
      const klass = await findClass(quiz.class_id, quiz.teacher_id, client);
      await grades.clearSubmission(client, quiz.class_id, quiz.quarter, klass.academic_year);
    }

    return {
      score,
      total_points: totalPoints,
      correct_count: correctCount,
      total_questions: questions.length,
      submitted_at: inserted.rows[0].submitted_at,
      learner_name: `${learner.first_name} ${learner.last_name}`,
    };
  });

  res.status(201).json({
    ...result,
    message: `Submitted. You scored ${result.score} out of ${result.total_points}.`,
  });
}

module.exports = {
  listQuizzes,
  createQuiz,
  getQuiz,
  updateQuiz,
  publishQuiz,
  closeQuiz,
  deleteQuiz,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  resetAttempt,
  getPublicQuiz,
  lookupPublicLearner,
  submitPublicQuiz,
  quizOpen,
};
