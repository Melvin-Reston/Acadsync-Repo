-- Lesson plans (Batch 11): the teacher writes one ILAW lesson plan per
-- class, period and session date, in the DepEd template from the sample
-- plan (Intentions, Learning Experiences, Assessment, Ways Forward),
-- and prints it in that same layout. No rows are inserted here: every
-- plan starts empty, created by a teacher.
--
-- The content lives in one row, one column per section of the template,
-- so a plan can be read, printed and duplicated without joining a dozen
-- tables. Answer keys sit beside the activity they belong to (the
-- individual and group activities, the formative assessment and the
-- assignment), the way the sample plan shows them. The AI declaration
-- is part of every row: DO 3, s. 2026, Annex A asks the teacher to cite
-- how AI was used in formulating the plan, or to say none was used.
--
-- status: draft (still being written), ready (the teacher has checked
-- it and it may be printed for checking), taught (the lesson has been
-- delivered; reflections are filled in afterwards). The status is the
-- teacher's own judgement; the API only checks, when a plan is marked
-- ready, that the competency, at least one objective, the lesson flow
-- and the formative assessment are present.

CREATE TABLE lesson_plans (
  id                        SERIAL PRIMARY KEY,
  teacher_id                INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  class_id                  INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  quarter                   INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  week_number               INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 52),
  session_date              DATE NOT NULL,
  lesson_title              TEXT NOT NULL,
  "references"              TEXT NOT NULL DEFAULT '',
  ai_use                    TEXT NOT NULL DEFAULT 'none' CHECK (ai_use IN ('none', 'used')),
  ai_declaration            TEXT NOT NULL DEFAULT '',
  competency                TEXT NOT NULL DEFAULT '',
  objective_knowledge       TEXT NOT NULL DEFAULT '',
  objective_skill           TEXT NOT NULL DEFAULT '',
  objective_attitude        TEXT NOT NULL DEFAULT '',
  objective_values          TEXT NOT NULL DEFAULT '',
  learner_context           TEXT NOT NULL DEFAULT '',
  pre_lesson                TEXT NOT NULL DEFAULT '',
  flow                      TEXT NOT NULL DEFAULT '',
  individual_activity       TEXT NOT NULL DEFAULT '',
  individual_answers        TEXT NOT NULL DEFAULT '',
  group_activity            TEXT NOT NULL DEFAULT '',
  group_answers             TEXT NOT NULL DEFAULT '',
  inclusion_strategy        TEXT NOT NULL DEFAULT '',
  practical_applications    TEXT NOT NULL DEFAULT '',
  generalizations           TEXT NOT NULL DEFAULT '',
  abstraction               TEXT NOT NULL DEFAULT '',
  learning_resources        TEXT NOT NULL DEFAULT '',
  integration               TEXT NOT NULL DEFAULT '',
  formative_assessment      TEXT NOT NULL DEFAULT '',
  formative_answer_key      TEXT NOT NULL DEFAULT '',
  extended_learning         TEXT NOT NULL DEFAULT '',
  extended_answer_key       TEXT NOT NULL DEFAULT '',
  reflections               TEXT NOT NULL DEFAULT '',
  checked_by_name           TEXT,
  status                    TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'taught')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX lesson_plans_teacher_idx ON lesson_plans (teacher_id, session_date DESC);
CREATE INDEX lesson_plans_class_idx ON lesson_plans (class_id, quarter);
