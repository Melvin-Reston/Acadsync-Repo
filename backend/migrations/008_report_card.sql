-- AcadSync Teacher Batch 5: the Report Card (DepEd School Form 9).
-- The card itself is filled from real data — consolidated grades and
-- attendance — so the only thing a teacher types on it is their comment
-- per learner per period. Those comments live here.
--
-- A comment belongs to one learner (the learner row the adviser uses for
-- that school learner ID) and one period of one academic year. Saving a
-- blank comment removes the row, so a cleared comment leaves no trace.
-- Deleting the learner removes their comments with them.

CREATE TABLE report_card_comments (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  period        INTEGER NOT NULL CHECK (period BETWEEN 1 AND 4),
  academic_year TEXT NOT NULL,
  comment       TEXT NOT NULL,
  updated_by    INTEGER REFERENCES teachers (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (learner_id, period, academic_year)
);

CREATE INDEX report_card_comments_learner_year_idx
  ON report_card_comments (learner_id, academic_year);
