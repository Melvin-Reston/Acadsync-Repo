// Slows down repeated sign-in and password reset requests from one address.
const { rateLimit } = require('express-rate-limit');
const { config } = require('../config');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few minutes and try again.', code: 'RATE_LIMITED' },
});

module.exports = { authLimiter };
