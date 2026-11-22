-- AcadSync Batch 8: the teacher enters the school details that the DepEd
-- print forms need (Region, Division, School ID). They live on the
-- teacher's own record — the school directory in the admin console does
-- not hold them — and print blank when unset.
ALTER TABLE teachers ADD COLUMN region TEXT;
ALTER TABLE teachers ADD COLUMN division TEXT;
ALTER TABLE teachers ADD COLUMN deped_school_id TEXT;
