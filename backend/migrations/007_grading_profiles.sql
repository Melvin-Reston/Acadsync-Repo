-- AcadSync Batch 4.1: the grading system is a switch, per academic year.
-- Three profiles: DO 8 s. 2015 (4 quarters), DO 015 s. 2026 adjusted
-- (3 terms, SY 2026-2027 only), DO 015 zero-based (3 terms, from SY 2027-2028).
-- Grades are computed live from scores, never stored, so a profile only ever
-- changes how scores are turned into grades — and a filed submission keeps
-- the profile it was filed under (grade_submissions.profile), so a later
-- switch for the year never recomputes a filed grade.
--
-- Quarter 4 data, if any exists, is left exactly as it is: period 4 stays
-- readable whenever the DO 8 profile is active for that year, and is simply
-- not offered while a DO 015 profile is active. Nothing is deleted here.

-- One grading system per academic year.
CREATE TABLE grading_profiles (
  academic_year TEXT PRIMARY KEY,
  profile       TEXT NOT NULL CHECK (profile IN ('do8_2015', 'do015_adjusted', 'do015_zero_based')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- This school year runs on DO 015 adjusted (Melvin confirmed the switch).
INSERT INTO grading_profiles (academic_year, profile)
SELECT value, 'do015_adjusted' FROM settings WHERE key = 'academic_year'
ON CONFLICT (academic_year) DO NOTHING;

-- Subjects gain a group, so the default weights follow DO 015 Table 9:
-- core subjects 20/50/30, MAPEH and EPP/TLE 20/60/20.
ALTER TABLE subjects ADD COLUMN subject_group TEXT NOT NULL DEFAULT 'core'
  CHECK (subject_group IN ('core', 'mapeh', 'epp_tle'));

-- The clear cases are set by name; a teacher can correct any subject in
-- Manage Subjects. Only MAPEH components and EPP/TLE are detected here —
-- everything else stays core.
UPDATE subjects SET subject_group = 'mapeh' WHERE
  LOWER(name) LIKE '%music%' OR LOWER(name) LIKE '%arts%'
  OR LOWER(name) LIKE '%physical education%' OR LOWER(name) LIKE '%health%'
  OR LOWER(name) = 'pe' OR LOWER(name) LIKE 'pe %' OR LOWER(name) LIKE '% pe';
UPDATE subjects SET subject_group = 'epp_tle' WHERE
  LOWER(name) LIKE 'epp%' OR LOWER(name) LIKE '% epp%'
  OR LOWER(name) LIKE 'tle%' OR LOWER(name) LIKE '% tle%' OR LOWER(name) LIKE '%tle';

-- Examinations replace Quarterly Assessment (DO 015). The third component's
-- columns carry a sub-weight inside the component (Summative Test 1 30%,
-- Summative Test 2 30%, Term Exam 40%) and a display label for the three
-- default EX columns. Old QA columns become EX columns and share the
-- component equally, so grades already encoded do not change.
ALTER TABLE grade_columns ADD COLUMN sub_weight NUMERIC(5, 2);
ALTER TABLE grade_columns ADD COLUMN label TEXT;
-- The old check is dropped first, the QA rows are converted, and only then
-- is the new check added: adding the new check while QA rows still exist
-- would fail, because PostgreSQL checks every row against a new check.
ALTER TABLE grade_columns DROP CONSTRAINT grade_columns_component_check;
UPDATE grade_columns SET component = 'EX' WHERE component = 'QA';
ALTER TABLE grade_columns ADD CONSTRAINT grade_columns_component_check
  CHECK (component IN ('WW', 'PT', 'EX'));
UPDATE grade_columns gc SET sub_weight = CASE
    WHEN gc.position = counts.maxpos THEN 100.0 - ROUND(100.0 / counts.n, 2) * (counts.n - 1)
    ELSE ROUND(100.0 / counts.n, 2)
  END
  FROM (SELECT class_id, quarter, COUNT(*) AS n, MAX(position) AS maxpos
          FROM grade_columns WHERE component = 'EX' GROUP BY class_id, quarter) counts
 WHERE gc.component = 'EX' AND gc.class_id = counts.class_id AND gc.quarter = counts.quarter;

-- The third weight is the Examinations weight now. The sum-to-100 check and
-- the 0–100 range check follow the renamed column automatically.
ALTER TABLE grade_weights RENAME COLUMN qa_weight TO ex_weight;

-- A filed submission keeps the grading system it was filed under. Everything
-- filed so far was filed under DO 8 (Batch 4 only knew DO 8).
ALTER TABLE grade_submissions ADD COLUMN profile TEXT
  CHECK (profile IN ('do8_2015', 'do015_adjusted', 'do015_zero_based'));
UPDATE grade_submissions SET profile = 'do8_2015';
ALTER TABLE grade_submissions ALTER COLUMN profile SET NOT NULL;
