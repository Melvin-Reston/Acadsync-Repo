-- AcadSync Admin, Part 1: admin accounts, schools, teachers, activity log, settings.

CREATE TABLE admins (
  id                   SERIAL PRIMARY KEY,
  role                 TEXT NOT NULL UNIQUE CHECK (role IN ('super_user', 'admin')),
  full_name            TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  token_version        INTEGER NOT NULL DEFAULT 0,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE schools (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('Primary', 'Secondary')),
  school_type       TEXT NOT NULL CHECK (school_type IN ('Public', 'Private')),
  city_region       TEXT NOT NULL,
  principal_contact TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The same school name can exist in two places, but not twice in the same place.
CREATE UNIQUE INDEX schools_name_place_key ON schools (LOWER(name), LOWER(city_region));

CREATE TABLE teachers (
  id                   SERIAL PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  mobile               TEXT NOT NULL,
  present_address      TEXT NOT NULL DEFAULT '',
  username             TEXT NOT NULL UNIQUE,
  school_id            INTEGER NOT NULL REFERENCES schools (id) ON DELETE RESTRICT,
  password_hash        TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_restricted        BOOLEAN NOT NULL DEFAULT FALSE,
  restriction_reason   TEXT,
  restricted_at        TIMESTAMPTZ,
  restricted_by        INTEGER REFERENCES admins (id) ON DELETE SET NULL,
  created_by           INTEGER REFERENCES admins (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX teachers_school_id_idx ON teachers (school_id);
CREATE INDEX teachers_created_at_idx ON teachers (created_at);

CREATE TABLE activity_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    INTEGER REFERENCES admins (id) ON DELETE SET NULL,
  admin_name  TEXT NOT NULL,
  admin_role  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  description TEXT NOT NULL,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_log_created_at_idx ON activity_log (created_at DESC);
CREATE INDEX activity_log_action_idx ON activity_log (action);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES ('academic_year', '2026-2027');
