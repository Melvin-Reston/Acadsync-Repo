-- Online quizzes (Batch 9): a teacher makes a quiz for one class and one
-- period, adds questions with an answer key, and shares a link. Learners
-- open the link, enter their Learner ID, and answer. The quiz is checked
-- automatically, and each learner's score is written into a Written Works
-- column in the Grades page for that class and period.
--
-- No rows are inserted here: every quiz starts empty, created by a teacher.
-- A Learner ID is not a secret (it is already on the roster and the QR
-- pass), so one attempt per learner is the protection, and the teacher
-- can reset an attempt when something went wrong.

-- One quiz: one class, one period, one quiz number in that period.
-- status: draft (link does not work yet), published (link works),
-- closed (link stops working; the teacher can reopen it).
-- grade_column_id is the Written Works column the scores are written
-- into. It is set when the quiz is first published and stays set after
-- that, so closing and reopening never makes a second column.
CREATE TABLE quizzes (
  id              SERIAL PRIMARY KEY,
  teacher_id      INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  class_id        INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  quarter         INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  quiz_number     INTEGER NOT NULL CHECK (quiz_number BETWEEN 1 AND 20),
  title           TEXT NOT NULL,
  instructions    TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  code            TEXT NOT NULL UNIQUE,
  deadline        TIMESTAMPTZ,
  grade_column_id INTEGER REFERENCES grade_columns (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, class_id, quarter, quiz_number)
);

CREATE INDEX quizzes_teacher_idx ON quizzes (teacher_id);
CREATE INDEX quizzes_class_idx ON quizzes (class_id, quarter);

-- One question of a quiz. options is the list of choices in the order
-- shown to the learner; correct_index is the position of the right one
-- (0-based). True/False questions carry the two options True and False.
-- points is a whole number of points for a right answer.
CREATE TABLE quiz_questions (
  id            SERIAL PRIMARY KEY,
  quiz_id       INTEGER NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position >= 1),
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'true_false')),
  question_text TEXT NOT NULL,
  options       JSONB NOT NULL,
  correct_index INTEGER NOT NULL CHECK (correct_index >= 0),
  points        INTEGER NOT NULL CHECK (points BETWEEN 1 AND 10),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quiz_id, position)
);

CREATE INDEX quiz_questions_quiz_idx ON quiz_questions (quiz_id);

-- One learner's one attempt at a quiz. One attempt per learner per quiz:
-- the unique key is the rule, and the teacher resets an attempt by
-- deleting it, which also removes the score from the Grades page.
CREATE TABLE quiz_attempts (
  id           SERIAL PRIMARY KEY,
  quiz_id      INTEGER NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  learner_id   INTEGER NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  score        NUMERIC(10, 2) NOT NULL CHECK (score >= 0),
  total_points NUMERIC(10, 2) NOT NULL CHECK (total_points > 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quiz_id, learner_id)
);

CREATE INDEX quiz_attempts_quiz_idx ON quiz_attempts (quiz_id);

-- One answer inside an attempt. selected_index is null when the learner
-- left the question blank; a blank answer earns no points.
CREATE TABLE quiz_answers (
  id             SERIAL PRIMARY KEY,
  attempt_id     INTEGER NOT NULL REFERENCES quiz_attempts (id) ON DELETE CASCADE,
  question_id    INTEGER NOT NULL REFERENCES quiz_questions (id) ON DELETE CASCADE,
  selected_index INTEGER CHECK (selected_index >= 0),
  is_correct     BOOLEAN NOT NULL DEFAULT FALSE,
  points_earned  NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (points_earned >= 0),
  UNIQUE (attempt_id, question_id)
);
