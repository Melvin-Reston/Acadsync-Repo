// Images stored in the database (migration 020), so they survive a
// redeploy on a host whose disk is wiped on every deploy: the two
// payment QR codes and the two DepEd logos. The school seal lives on
// the school row instead (one seal per school), in the same byte form.
//
// The DepEd logos are the national logos: they do not change. Their
// originals ship with the backend in backend/assets/ and are copied
// into the database the first time they are needed, only when no row
// exists yet — so an admin replacement is never overwritten by a later
// deploy or upgrade. An admin replaces a logo through Settings; the
// bundled files are never read again once a row exists.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { detectImageType } = require('./uploads');

const PAYMENT_QR_KEY = 'payment_qr';
const PAYMENT_QR2_KEY = 'payment_qr2';
const DEP_SEAL_KEY = 'deped_seal';
const DEP_LOGO_KEY = 'deped_logo';

// Bundled DepEd originals, copied from frontend/public/. The backend
// cannot read the frontend folder on the live host (it is deployed
// separately), so the copies live here, with the API.
const DEP_FILES = [
  { key: DEP_SEAL_KEY, file: 'deped-seal.png', mime: 'image/png' },
  { key: DEP_LOGO_KEY, file: 'deped-logo.webp', mime: 'image/webp' },
];

async function readBrandingImage(key, client = db) {
  const result = await client.query('SELECT image_data, mime_type FROM branding_images WHERE key = $1', [key]);
  if (result.rowCount === 0) return null;
  return { data: result.rows[0].image_data, mime: result.rows[0].mime_type };
}

async function hasBrandingImage(key, client = db) {
  const result = await client.query('SELECT 1 FROM branding_images WHERE key = $1', [key]);
  return result.rowCount > 0;
}

async function brandingFlags(client = db) {
  const result = await client.query('SELECT key FROM branding_images');
  const keys = new Set(result.rows.map((row) => row.key));
  return {
    has_qr: keys.has(PAYMENT_QR_KEY),
    has_qr2: keys.has(PAYMENT_QR2_KEY),
    has_deped_seal: keys.has(DEP_SEAL_KEY),
    has_deped_logo: keys.has(DEP_LOGO_KEY),
  };
}

async function saveBrandingImage(key, image, client = db) {
  await client.query(
    `INSERT INTO branding_images (key, image_data, mime_type, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET image_data = EXCLUDED.image_data, mime_type = EXCLUDED.mime_type, updated_at = NOW()`,
    [key, image.buffer, image.mime]
  );
}

async function deleteBrandingImage(key, client = db) {
  await client.query('DELETE FROM branding_images WHERE key = $1', [key]);
}

// Copies the bundled DepEd logos into the database, but only for keys
// with no row yet. A row an admin uploaded is left exactly as it is.
async function ensureDepedAssets(client = db) {
  for (const asset of DEP_FILES) {
    if (await hasBrandingImage(asset.key, client)) continue;
    const full = path.join(__dirname, '..', '..', 'assets', asset.file);
    let data;
    try {
      data = await fs.promises.readFile(full);
    } catch {
      continue; // No bundled file (for example, a partial checkout): the logo simply stays unset.
    }
    const type = detectImageType(data);
    await client.query(
      `INSERT INTO branding_images (key, image_data, mime_type, updated_at)
       VALUES ($1, $2, $3, NOW()) ON CONFLICT (key) DO NOTHING`,
      [asset.key, data, type ? type.mime : asset.mime]
    );
  }
}

// Reads a DepEd logo, seeding the bundled originals first when the
// database has no row for it yet.
async function readDepedImage(key, client = db) {
  const found = await readBrandingImage(key, client);
  if (found) return found;
  await ensureDepedAssets(client);
  return readBrandingImage(key, client);
}

module.exports = {
  PAYMENT_QR_KEY,
  PAYMENT_QR2_KEY,
  DEP_SEAL_KEY,
  DEP_LOGO_KEY,
  readBrandingImage,
  hasBrandingImage,
  brandingFlags,
  saveBrandingImage,
  deleteBrandingImage,
  ensureDepedAssets,
  readDepedImage,
};
