-- AcadSync Admin, Part 2: plans, subscriptions, invoices, payments, announcements, payment QR settings.
-- All money is stored as NUMERIC(10,2) in Philippine pesos.

CREATE TABLE plans (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  price           NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  -- monthly and yearly plans renew; a one_time plan ends after its duration.
  billing_cycle   TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly', 'one_time')),
  duration_months INTEGER NOT NULL CHECK (duration_months BETWEEN 1 AND 120),
  trial_days      INTEGER NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 365),
  features        TEXT[] NOT NULL DEFAULT '{}',
  is_popular      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX plans_name_key ON plans (LOWER(name));

-- The two starting plans. More can be added in Plans & Packages.
INSERT INTO plans (name, price, billing_cycle, duration_months, trial_days, features, is_popular, sort_order) VALUES
  ('Teacher Free', 0.00, 'one_time', 1, 0, '{}', FALSE, 1),
  ('Teacher Pro', 100.00, 'monthly', 1, 30,
   ARRAY['Consolidation', 'Report cards (SF9)', 'Rankings & honors', 'QR Scanning attendance'], TRUE, 2);

-- One row per subscription of one teacher. The plan name, price and billing cycle are copied in,
-- so changing a plan later never changes subscriptions that already exist.
CREATE TABLE subscriptions (
  id                   SERIAL PRIMARY KEY,
  teacher_id           INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  plan_id              INTEGER NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
  plan_name            TEXT NOT NULL,
  price                NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  billing_cycle        TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly', 'one_time')),
  duration_months      INTEGER NOT NULL CHECK (duration_months BETWEEN 1 AND 120),
  status               TEXT NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'expired', 'cancelled')),
  started_at           TIMESTAMPTZ NOT NULL,
  trial_ends_at        TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end   TIMESTAMPTZ NOT NULL,
  ended_at             TIMESTAMPTZ,
  end_reason           TEXT,
  created_by           INTEGER REFERENCES admins (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A teacher can have only one current subscription (trial, active or past due).
CREATE UNIQUE INDEX subscriptions_one_current_key ON subscriptions (teacher_id)
  WHERE status IN ('trial', 'active', 'past_due');
CREATE INDEX subscriptions_teacher_id_idx ON subscriptions (teacher_id);
CREATE INDEX subscriptions_plan_id_idx ON subscriptions (plan_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);

CREATE SEQUENCE invoice_number_seq;

-- The amount is copied from the subscription when the invoice is issued and never changes.
CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  invoice_number  TEXT NOT NULL UNIQUE,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  teacher_id      INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  plan_name       TEXT NOT NULL,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  issued_at       TIMESTAMPTZ NOT NULL,
  due_date        DATE NOT NULL,
  paid_at         TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX invoices_subscription_id_idx ON invoices (subscription_id);
CREATE INDEX invoices_teacher_id_idx ON invoices (teacher_id);
CREATE INDEX invoices_status_idx ON invoices (status);

CREATE TABLE payments (
  id               SERIAL PRIMARY KEY,
  invoice_id       INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  teacher_id       INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  reference_number TEXT NOT NULL,
  -- Only the file path is stored. The image itself is in the uploads folder.
  screenshot_path  TEXT,
  -- teacher = sent by the teacher after paying by QR code; admin = recorded by hand.
  source           TEXT NOT NULL CHECK (source IN ('teacher', 'admin')),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  paid_on          DATE NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  rejection_reason TEXT,
  reviewed_by      INTEGER REFERENCES admins (id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An invoice can have only one payment waiting for confirmation, and only one confirmed payment.
CREATE UNIQUE INDEX payments_one_pending_key ON payments (invoice_id) WHERE status = 'pending';
CREATE UNIQUE INDEX payments_one_confirmed_key ON payments (invoice_id) WHERE status = 'confirmed';
CREATE INDEX payments_invoice_id_idx ON payments (invoice_id);
CREATE INDEX payments_teacher_id_idx ON payments (teacher_id);
CREATE INDEX payments_status_idx ON payments (status);
CREATE INDEX payments_paid_on_idx ON payments (paid_on);

CREATE TABLE announcements (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  -- all = every teacher, free = teachers without a paid plan, pro = teachers on a paid plan.
  audience   TEXT NOT NULL CHECK (audience IN ('all', 'free', 'pro')),
  starts_on  DATE,
  ends_on    DATE NOT NULL,
  created_by INTEGER REFERENCES admins (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (starts_on IS NULL OR starts_on <= ends_on)
);

CREATE INDEX announcements_ends_on_idx ON announcements (ends_on);

-- Payment QR code shown to teachers when they pay.
INSERT INTO settings (key, value) VALUES
  ('payment_qr_path', ''),
  ('payment_account_name', ''),
  ('payment_instructions', '')
ON CONFLICT (key) DO NOTHING;
