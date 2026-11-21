-- AcadSync Teacher Batch 3: daily attendance.
-- One row per learner per class per date. A learner who is later unenrolled keeps
-- their rows here (unenrolling only removes the class_learners row), so the
-- history of a day sheet is never lost by changing the roster.
-- No rows are inserted here: attendance starts empty for every class and date.

CREATE TABLE attendance (
  id           SERIAL PRIMARY KEY,
  teacher_id   INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  learner_id   INTEGER NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
  time_in      TIME,
  method       TEXT NOT NULL CHECK (method IN ('manual', 'qr')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, learner_id, date)
);

CREATE INDEX attendance_teacher_date_idx ON attendance (teacher_id, date);
CREATE INDEX attendance_class_date_idx ON attendance (class_id, date);
