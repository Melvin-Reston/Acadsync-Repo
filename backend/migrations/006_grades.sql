-- AcadSync Teacher Batch 4: grades and academic consolidation.
-- A class record is one class, one quarter: score columns, scores, weights,
-- a submission to the adviser, and reminders from the adviser.
-- No rows are inserted here: every grade sheet starts empty, with the standard
-- columns (WW1–WW4 at 25, PT1–PT4 at 50, QA1 at 50) created the first time a
-- teacher opens that class and quarter.

-- Component weights for one class (WW / PT / QA), default 30 / 50 / 20.
-- The three weights must always add up to 100.
CREATE TABLE grade_weights (
  class_id   INTEGER PRIMARY KEY REFERENCES classes (id) ON DELETE CASCADE,
  ww_weight  INTEGER NOT NULL CHECK (ww_weight BETWEEN 0 AND 100),
  pt_weight  INTEGER NOT NULL CHECK (pt_weight BETWEEN 0 AND 100),
  qa_weight  INTEGER NOT NULL CHECK (qa_weight BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ww_weight + pt_weight + qa_weight = 100)
);

-- One score column of a class record: WW1, PT2, QA1 and so on. position is the
-- number inside its component (WW1 is position 1 of WW). The name is worked out
-- from the component and position, so removing a column renumbers the rest.
CREATE TABLE grade_columns (
  id               SERIAL PRIMARY KEY,
  class_id         INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  quarter          INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  component        TEXT NOT NULL CHECK (component IN ('WW', 'PT', 'QA')),
  position         INTEGER NOT NULL CHECK (position >= 1),
  highest_possible NUMERIC(10, 2) NOT NULL CHECK (highest_possible > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, quarter, component, position)
);

-- One score: a learner's mark in one column. A missing row means "not yet
-- encoded" — never 0. Removing a column deletes its scores with it.
CREATE TABLE grade_scores (
  id         SERIAL PRIMARY KEY,
  column_id  INTEGER NOT NULL REFERENCES grade_columns (id) ON DELETE CASCADE,
  learner_id INTEGER NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  score      NUMERIC(10, 2) NOT NULL CHECK (score >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (column_id, learner_id)
);

CREATE INDEX grade_scores_learner_idx ON grade_scores (learner_id);

-- A class record filed with the adviser for one quarter. Re-submitting after
-- edits replaces the row (the submitted_at moves to the new filing). Editing
-- scores, columns or weights after a submission clears the row, so the adviser
-- only ever sees grades as they were filed.
CREATE TABLE grade_submissions (
  id            SERIAL PRIMARY KEY,
  class_id      INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  quarter       INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  academic_year TEXT NOT NULL,
  submitted_by  INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, quarter, academic_year)
);

-- A reminder from an adviser to a subject teacher, one per class and quarter.
-- Reminding again moves updated_at; the subject teacher sees the banner on
-- their Grades page while the reminder is newer than the last submission.
CREATE TABLE grade_reminders (
  id            SERIAL PRIMARY KEY,
  class_id      INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  quarter       INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  academic_year TEXT NOT NULL,
  adviser_id    INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, quarter, academic_year)
);
