-- AcadSync finalization: a teacher-set lowest grade (floor) per class,
-- saved with the class's weights on the Grades page.
--
-- floor_grade is NULL when the teacher has never set one: the class then
-- uses its grading profile's own floor — 60 under DO 8 and under DO 015
-- Adjusted (both transmutation tables bottom out at 60), and 0 under
-- DO 015 zero-based (no transmutation, a 0 stays a 0). A set floor is a
-- minimum only: it raises the lowest grade that can appear on the card,
-- it never lowers a grade below what the profile's table gives, because
-- the table itself is the rule for the year. Grades are computed live,
-- so a floor change takes effect on the next sheet load, and like any
-- weights change it clears the class's filed submissions for the year
-- (the teacher re-files under the new floor).
ALTER TABLE grade_weights ADD COLUMN floor_grade NUMERIC(5, 2)
  CHECK (floor_grade BETWEEN 0 AND 100);
