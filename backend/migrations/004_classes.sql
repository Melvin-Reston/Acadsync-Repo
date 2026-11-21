-- AcadSync Teacher Batch 2: subjects, classes, learners, enrolments, class meetings.
-- Everything belongs to the teacher who added it; a teacher never sees another teacher's rows.
-- No rows are inserted here: the teacher adds their own subjects, classes and learners.

-- The teacher's own subject library. A subject is tied to one grade level
-- (for example "Music and Arts" in Grade 10), so the same name in another grade is a
-- different subject.
CREATE TABLE subjects (
  id           SERIAL PRIMARY KEY,
  teacher_id   INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  grade_level  INTEGER NOT NULL CHECK (grade_level BETWEEN 7 AND 12),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, name, grade_level)
);

-- One class is one subject in one section (for example "Music and Arts, Grade 10, Luke").
-- The grade level always comes from the subject, so it can never disagree with it.
CREATE TABLE classes (
  id           SERIAL PRIMARY KEY,
  teacher_id   INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  subject_id   INTEGER NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  grade_level  INTEGER NOT NULL CHECK (grade_level BETWEEN 7 AND 12),
  section_name TEXT NOT NULL,
  room         TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, subject_id, grade_level, section_name, academic_year)
);

-- Learners belong to the teacher who added them. learner_id is the school's learner
-- number (for example STU-2026-1048); it is unique per teacher, not across the system.
CREATE TABLE learners (
  id           SERIAL PRIMARY KEY,
  teacher_id   INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  learner_id   TEXT NOT NULL,
  sex          TEXT NOT NULL CHECK (sex IN ('Male', 'Female')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, learner_id)
);

-- Which learners are enrolled in which class. A class's student count is the real
-- number of rows here, never a typed-in number.
CREATE TABLE class_learners (
  class_id     INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  learner_id   INTEGER NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (class_id, learner_id)
);

-- One meeting of a class: day_of_week 1 is Monday and 5 is Friday. Meetings repeat
-- every week, so there is no date column; the week is worked out from the day.
CREATE TABLE class_meetings (
  id           SERIAL PRIMARY KEY,
  class_id     INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  room         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  UNIQUE (class_id, day_of_week, start_time)
);

CREATE INDEX class_meetings_teacher_day_idx ON class_meetings (class_id, day_of_week, start_time);
