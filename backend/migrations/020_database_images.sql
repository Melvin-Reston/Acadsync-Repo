-- 020: images that must survive a redeploy live in the database, not on disk.
-- Render Free has an ephemeral filesystem, so anything written to the
-- uploads folder (the payment QR codes, the school seal) was wiped on
-- every redeploy. The image bytes now live here / on the school row:
--   branding_images: the two payment QR codes and the two DepEd logos,
--     keyed by name, with their MIME type so they can be sent back.
--   schools.seal_data / seal_mime: one seal per school, shared by every
--     teacher of that school.
-- The old seal_path column is left in place (it is no longer read); a
-- seal or QR code uploaded before this migration was a file on the
-- server's disk, which a redeploy has already wiped or will wipe, so
-- each one is uploaded once more after this upgrade and then never
-- again. Payment screenshots stay as files: one arrives per payment,
-- so storing them all here would fill the database.
CREATE TABLE IF NOT EXISTS branding_images (
  key        TEXT PRIMARY KEY,
  image_data BYTEA NOT NULL,
  mime_type  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE schools ADD COLUMN IF NOT EXISTS seal_data BYTEA;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS seal_mime TEXT;
