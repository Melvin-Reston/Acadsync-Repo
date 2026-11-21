// An error that carries an HTTP status, so controllers can simply "throw".
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra; // e.g. { code: 'ACCOUNT_LOCKED' } or { errors: { email: '...' } }
  }
}

const badRequest = (message, extra) => new HttpError(400, message, extra);
const unauthorized = (message, extra) => new HttpError(401, message, extra);
const forbidden = (message, extra) => new HttpError(403, message, extra);
const notFound = (message, extra) => new HttpError(404, message, extra);
const conflict = (message, extra) => new HttpError(409, message, extra);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
