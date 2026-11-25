-- Paper exam checker (Batch 10): a teacher makes a paper exam for one class
-- and one period, enters one answer key for the whole exam, prints one
-- answer sheet per learner (name and Learner ID already printed on it),
-- and checks each sheet from a photo of the shaded circles. Checking
-- happens in the browser; the server only ever trusts its own stored key
-- when a reviewed sheet is saved, and writes the score into an
-- Examinations column in the Grades page.
--
-- Choices per question (Melvin's choice, 2026-11-25): every question
-- carries its own number of choices, 2 to 5, just like the online
-- quizzes. A 2-choice question may use True/False labels instead of
-- A/B. The printed sheet lines every row up on the same five circle
-- positions, so a row simply has fewer circles when it has fewer
-- choices, and the letters stay in the same columns.
--
-- No rows are inserted here: every exam starts empty, created by a teacher.
-- A sheet photo is never stored: only the reviewed answers, the score,
-- and whether the answers came from a photo or were typed in by hand.

-- One exam: one class, one period, one exam number in that period.
-- questions is one entry per question, in question order:
-- { choices: <2 to 5>, correct: <0-based choice position, or null
--   while the teacher has not entered it yet>,
--   kind: <'mcq' or 'true_false'> }. A 2-choice question may be
-- 'true_false'; any other count must be 'mcq'. The key is complete
-- when questions has exactly question_count entries and every
-- correct is set. grade_column_id is the Examinations column the
-- scores are written into. It is set when the first sheet is saved and
-- stays set after that, so re-checking a learner never makes a second
-- column.
CREATE TABLE exams (
  id              SERIAL PRIMARY KEY,
  teacher_id      INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  class_id        INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  quarter         INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  exam_number     INTEGER NOT NULL CHECK (exam_number BETWEEN 1 AND 20),
  title           TEXT NOT NULL,
  instructions    TEXT NOT NULL DEFAULT '',
  question_count  INTEGER NOT NULL CHECK (question_count BETWEEN 5 AND 50),
  points_each     INTEGER NOT NULL CHECK (points_each BETWEEN 1 AND 10),
  questions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  grade_column_id INTEGER REFERENCES grade_columns (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, class_id, quarter, exam_number)
);

CREATE INDEX exams_teacher_idx ON exams (teacher_id);
CREATE INDEX exams_class_idx ON exams (class_id, quarter);

-- One learner's checked sheet. One row per learner per exam: checking
-- the same learner again replaces the answers and the score, it never
-- adds a second row. answers is one entry per question, in question
-- order: { selected: <choice position or null for blank>, uncertain:
-- <true when the checker was unsure and the teacher should look again>,
-- multiple: <true when more than one circle looked shaded> }.
-- The score is always recomputed from the stored answer key when the
-- row is saved; a score sent by the browser is never trusted.
CREATE TABLE exam_scans (
  id           SERIAL PRIMARY KEY,
  exam_id      INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  learner_id   INTEGER NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  score        NUMERIC(10, 2) NOT NULL CHECK (score >= 0),
  total_points NUMERIC(10, 2) NOT NULL CHECK (total_points > 0),
  answers      JSONB NOT NULL,
  source       TEXT NOT NULL DEFAULT 'photo' CHECK (source IN ('photo', 'manual')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, learner_id)
);

CREATE INDEX exam_scans_exam_idx ON exam_scans (exam_id);
