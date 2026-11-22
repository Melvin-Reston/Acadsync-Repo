-- AcadSync Batch 8 fix 2: the teacher enters the school head's name for the
-- "Attested by" line on the SF2 footer. It lives on the teacher's own
-- record with the other DepEd-form school details (migration 010), and
-- prints blank until the teacher fills it in.
ALTER TABLE teachers ADD COLUMN school_head_name TEXT;
