-- AcadSync Teacher Batch 8 fix 10: adviser-created manual subjects for
-- Academic Consolidation, with grades uploaded as a CSV by the adviser.
--
-- A manual subject exists when the subject teacher has no AcadSync account:
-- no class, no scores, no filing from a Grades page. The adviser creates the
-- subject (name + the subject teacher's plain display name), uploads one CSV
-- carrying every period's term grades, and Consolidation treats those grades
-- like filed grades. A manual subject never appears on the Grades page.
-- No rows are inserted here: a manual subject starts with no grades.

CREATE TABLE manual_subjects (
  id             SERIAL PRIMARY KEY,
  adviser_id     INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  school_id      INTEGER NOT NULL REFERENCES schools (id) ON DELETE RESTRICT,
  subject_name   TEXT NOT NULL,
  teacher_name   TEXT NOT NULL,
  grade_level    INTEGER NOT NULL,
  section_name   TEXT NOT NULL,
  academic_year  TEXT NOT NULL,
  profile_code   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One manual subject per name per adviser section and year. The name match
-- is case-insensitive and ignores surrounding spaces, the same way classes
-- are grouped by subject name in Consolidation.
CREATE UNIQUE INDEX manual_subjects_unique_idx
  ON manual_subjects (adviser_id, LOWER(TRIM(subject_name)), grade_level, LOWER(TRIM(section_name)), academic_year);
CREATE INDEX manual_subjects_section_idx
  ON manual_subjects (school_id, grade_level, LOWER(TRIM(section_name)), academic_year);

-- One term grade per learner per period. The learner is identified by the
-- school learner ID as written in the CSV (learner_id_text), matched
-- case-insensitively against the section roster when the grades are filed.
-- A missing row means that period is not filed for that learner — never 0.
-- Grades are the term grades as given by the subject teacher (0–100); no
-- floor is applied, so a zero-based year can legitimately hold a grade
-- below 60.
CREATE TABLE manual_subject_grades (
  id                SERIAL PRIMARY KEY,
  manual_subject_id INTEGER NOT NULL REFERENCES manual_subjects (id) ON DELETE CASCADE,
  learner_id_text   TEXT NOT NULL,
  quarter           INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  grade             NUMERIC(5, 2) NOT NULL CHECK (grade BETWEEN 0 AND 100),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One grade per learner per period: the uniqueness is an index, not a
-- table constraint, because it matches on the normalised learner ID.
CREATE UNIQUE INDEX manual_subject_grades_unique_idx
  ON manual_subject_grades (manual_subject_id, LOWER(TRIM(learner_id_text)), quarter);

CREATE INDEX manual_subject_grades_subject_idx ON manual_subject_grades (manual_subject_id);
