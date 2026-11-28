// Image uploads (payment screenshots and the payment QR code).
// Files are saved in the uploads folder. Only the file path is stored in the database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { config } = require('../config');
const { badRequest, notFound } = require('./httpError');

// The file is kept in memory first so its real type can be checked before it is saved.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20 },
});

// Reads one optional file from a multipart form: uploadSingle('screenshot')
function uploadSingle(fieldName) {
  const handler = upload.single(fieldName);
  return (req, res, next) => {
    handler(req, res, (error) => {
      if (!error) return next();
      const message =
        error.code === 'LIMIT_FILE_SIZE' ? 'The image is too large. The limit is 2 MB.' : 'The file could not be uploaded.';
      next(badRequest(message, { code: 'UPLOAD_ERROR', errors: { [fieldName]: message } }));
    });
  };
}

// Looks at the first bytes of the file. The file name and the type sent by the browser are not trusted.
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { extension: 'webp', mime: 'image/webp' };
  }
  return null;
}

// Checks an uploaded image without writing it anywhere, for images that
// are stored in the database instead of on disk (payment QR codes, the
// school seal, the DepEd logos). Returns the bytes and their real type.
function readImageFile(file, fieldName) {
  const type = detectImageType(file && file.buffer);
  if (!type) {
    const message = 'Upload a PNG, JPG or WEBP image.';
    throw badRequest(message, { code: 'UPLOAD_ERROR', errors: { [fieldName]: message } });
  }
  return { buffer: file.buffer, mime: type.mime, extension: type.extension };
}

// Sends image bytes read from the database to the browser. Only called
// from routes that already checked the sign-in.
function sendBytes(res, data, mime) {
  if (!data) throw notFound('Image not found.');
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}

// Saves an uploaded image in uploads/<folder>/ and returns the path to store, e.g. "payments/ab12cd.png".
async function saveImage(file, folder, fieldName) {
  const type = detectImageType(file.buffer);
  if (!type) {
    const message = 'Upload a PNG, JPG or WEBP image.';
    throw badRequest(message, { code: 'UPLOAD_ERROR', errors: { [fieldName]: message } });
  }

  const name = `${crypto.randomBytes(16).toString('hex')}.${type.extension}`;
  await fs.promises.mkdir(path.join(config.uploadDir, folder), { recursive: true });
  await fs.promises.writeFile(path.join(config.uploadDir, folder, name), file.buffer);
  return `${folder}/${name}`;
}

// Turns a stored path into a full path, and refuses anything outside the uploads folder.
function resolveStoredPath(storedPath) {
  const full = path.resolve(config.uploadDir, storedPath || '');
  if (!storedPath || !full.startsWith(config.uploadDir + path.sep)) return null;
  return full;
}

async function deleteImage(storedPath) {
  const full = resolveStoredPath(storedPath);
  if (!full) return;
  await fs.promises.unlink(full).catch(() => undefined);
}

// Sends a stored image to the browser. Only called from routes that already checked the sign-in.
async function sendImage(res, storedPath) {
  const full = resolveStoredPath(storedPath);
  if (!full || !fs.existsSync(full)) throw notFound('Image not found.');

  const mimeByExtension = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  res.setHeader('Content-Type', mimeByExtension[path.extname(full)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(await fs.promises.readFile(full));
}

// Reads up to two optional files from a multipart form: the two payment
// QR codes (uploadPaymentQr). The payment settings form can carry both
// images in one save, so neither QR code is wiped by saving the other.
const uploadTwo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 2, fields: 20 },
});

function uploadPaymentQr(req, res, next) {
  const handler = uploadTwo.fields([
    { name: 'qr_image', maxCount: 1 },
    { name: 'qr_image2', maxCount: 1 },
  ]);
  handler(req, res, (error) => {
    if (!error) return next();
    const message =
      error.code === 'LIMIT_FILE_SIZE' ? 'The image is too large. The limit is 2 MB.' : 'The file could not be uploaded.';
    next(badRequest(message, { code: 'UPLOAD_ERROR', errors: { qr_image: message, qr_image2: message } }));
  });
}

module.exports = { uploadSingle, uploadPaymentQr, saveImage, deleteImage, sendImage, detectImageType, readImageFile, sendBytes };
