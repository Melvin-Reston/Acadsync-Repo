-- AcadSync Batch 8 fix 10: the teacher enters the school calendar on the
-- dashboard, so SF2 stops counting days before classes open, after they
-- end, and on holidays. The first and last day of classes live on the
-- teacher's own record with the other DepEd-form school details
-- (migration 010); both are optional and SF2 behaves as before when
-- they are unset. Holidays are one row per date per teacher, named by
-- the teacher; a date can be a holiday only once. All three are the
-- teacher's own entries — the school directory in the admin console
-- does not hold them.
ALTER TABLE teachers ADD COLUMN classes_start_date DATE;
ALTER TABLE teachers ADD COLUMN classes_end_date DATE;

CREATE TABLE teacher_holidays (
  id         SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_holidays_teacher_date_key UNIQUE (teacher_id, date)
);

CREATE INDEX teacher_holidays_teacher_date_idx ON teacher_holidays (teacher_id, date);
