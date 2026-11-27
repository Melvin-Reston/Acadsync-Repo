-- 017: the school seal, uploaded by a teacher on the Dashboard and printed
-- on the right side of the Report Card front, opposite the DepEd seal.
-- Only the file path is stored; the image itself lives in uploads/seals/.
ALTER TABLE schools ADD COLUMN seal_path TEXT;
