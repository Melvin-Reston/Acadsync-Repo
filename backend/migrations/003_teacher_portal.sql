-- AcadSync Teacher Batch 1: teacher sign-in protection, adviser assignment, teacher password reset.
-- Nothing here changes the admin tables; it only adds columns and one table for teachers.

-- Sign-in protection, same as the admin accounts: wrong passwords are counted and the
-- account locks for 15 minutes after 5 wrong attempts. token_version signs out old
-- sessions when a teacher changes their password.
ALTER TABLE teachers ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teachers ADD COLUMN locked_until TIMESTAMPTZ;
ALTER TABLE teachers ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE teachers ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- Advisory assignment, set by the teacher on their dashboard.
ALTER TABLE teachers ADD COLUMN is_adviser BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN advisory_grade INTEGER CHECK (advisory_grade BETWEEN 7 AND 12);
ALTER TABLE teachers ADD COLUMN advisory_section TEXT;

-- Password reset links for teachers. Only the hash is stored, same as the admin links.
CREATE TABLE teacher_password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
