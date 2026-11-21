// Reads settings from the .env file in one place.
require('dotenv').config({ quiet: true });
const path = require('path');

const isTest = process.env.NODE_ENV === 'test';

function toBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function buildDatabaseConfig() {
  const ssl = toBool(process.env.DB_SSL) ? { rejectUnauthorized: false } : false;

  if (isTest && process.env.TEST_DATABASE_URL) {
    return { connectionString: process.env.TEST_DATABASE_URL, ssl };
  }
  if (!isTest && process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    // Tests always use their own database so real data is never touched.
    database: isTest ? process.env.TEST_DB_NAME || 'acadsync_test' : process.env.DB_NAME || 'acadsync',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl,
  };
}

// A timezone name such as Asia/Manila. Anything unusual falls back to Asia/Manila.
function readTimezone() {
  const value = (process.env.APP_TIMEZONE || '').trim();
  return /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value) ? value : 'Asia/Manila';
}

const config = {
  isTest,
  port: Number(process.env.PORT || 3000),
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:4200').replace(/\/+$/, ''),
  db: buildDatabaseConfig(),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: toBool(process.env.SMTP_SECURE),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'AcadSync <no-reply@example.com>',
  },
  // Billing (Part 2)
  timezone: readTimezone(), // used for "today", due dates and reports
  invoiceDueDays: Math.max(0, Number(process.env.INVOICE_DUE_DAYS || 7)), // days a teacher has to pay an invoice
  uploadDir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: 2 * 1024 * 1024, // 2 MB per image
  // Sign-in protection
  maxFailedAttempts: 5,
  lockMinutes: 15,
  resetTokenMinutes: 30,
};

function assertConfig() {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET is missing or too short. Set a long random value (32+ characters) in backend/.env');
  }
}

module.exports = { config, assertConfig };
