-- AcadSync Teacher Batch 7: learners belong to the school, not the teacher.
--
-- Before this batch a learner belonged to the teacher who added them, so two
-- teachers in the same school each kept their own copy of the same class.
-- Now a learner belongs to the school: every teacher in the school sees the
-- same learner directory, and a class uploaded once never needs uploading
-- again. teacher_id stays as the created-by record.
--
-- Adds school_id (backfilled from the creating teacher's school) and an
-- optional birthdate. Learner IDs are unique per school, not per teacher.
-- Rows that already duplicated a learner ID inside one school are merged:
-- the earliest row is kept, enrolments, attendance, grade scores and
-- report-card comments are re-pointed to it, and the duplicate rows are
-- removed. Where the kept row already has the same enrolment, mark, score
-- or comment, the kept row wins and the duplicate's copy is dropped.

ALTER TABLE learners ADD COLUMN school_id INTEGER REFERENCES schools (id) ON DELETE RESTRICT;
ALTER TABLE learners ADD COLUMN birthdate DATE;

UPDATE learners l SET school_id = t.school_id FROM teachers t WHERE t.id = l.teacher_id;

ALTER TABLE learners ALTER COLUMN school_id SET NOT NULL;

-- Merge duplicates: same school, same learner ID (case-insensitive, trimmed).
CREATE TEMP TABLE learner_dupes AS
SELECT l.id AS dup_id, m.kept_id AS kept_id
  FROM learners l
  JOIN (
    SELECT school_id, LOWER(TRIM(learner_id)) AS norm_id, MIN(id) AS kept_id
      FROM learners
     GROUP BY school_id, LOWER(TRIM(learner_id))
    HAVING COUNT(*) > 1
  ) m ON m.school_id = l.school_id AND m.norm_id = LOWER(TRIM(l.learner_id))
 WHERE l.id <> m.kept_id;

-- Re-point every table that references a learner. Each table has a unique
-- rule on the learner, so a duplicate's row is dropped first when the kept
-- row already holds the same enrolment, mark, score or comment.
DELETE FROM class_learners cl USING learner_dupes d
 WHERE cl.learner_id = d.dup_id
   AND EXISTS (SELECT 1 FROM class_learners k WHERE k.class_id = cl.class_id AND k.learner_id = d.kept_id);
UPDATE class_learners cl SET learner_id = d.kept_id FROM learner_dupes d WHERE cl.learner_id = d.dup_id;

DELETE FROM attendance a USING learner_dupes d
 WHERE a.learner_id = d.dup_id
   AND EXISTS (SELECT 1 FROM attendance k WHERE k.class_id = a.class_id AND k.learner_id = d.kept_id AND k.date = a.date);
UPDATE attendance a SET learner_id = d.kept_id FROM learner_dupes d WHERE a.learner_id = d.dup_id;

DELETE FROM grade_scores gs USING learner_dupes d
 WHERE gs.learner_id = d.dup_id
   AND EXISTS (SELECT 1 FROM grade_scores k WHERE k.column_id = gs.column_id AND k.learner_id = d.kept_id);
UPDATE grade_scores gs SET learner_id = d.kept_id FROM learner_dupes d WHERE gs.learner_id = d.dup_id;

DELETE FROM report_card_comments rc USING learner_dupes d
 WHERE rc.learner_id = d.dup_id
   AND EXISTS (SELECT 1 FROM report_card_comments k WHERE k.learner_id = d.kept_id AND k.period = rc.period AND k.academic_year = rc.academic_year);
UPDATE report_card_comments rc SET learner_id = d.kept_id FROM learner_dupes d WHERE rc.learner_id = d.dup_id;

DELETE FROM learners l USING learner_dupes d WHERE l.id = d.dup_id;
DROP TABLE learner_dupes;

-- Learner IDs are unique per school now, not per teacher. The old
-- teacher-scoped rule goes, and the new rule is case-insensitive so
-- "STU-2026-1048" and "stu-2026-1048" cannot both exist in one school.
ALTER TABLE learners DROP CONSTRAINT learners_teacher_id_learner_id_key;
CREATE UNIQUE INDEX learners_school_learner_id_key ON learners (school_id, LOWER(TRIM(learner_id)));
CREATE INDEX learners_school_id_idx ON learners (school_id);
CREATE INDEX learners_birthdate_idx ON learners (birthdate);
