// Test setup: uses a separate database (TEST_DB_NAME), wipes it, runs the migrations
// and creates two test admin accounts. Your real database is never touched.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? process.env.JWT_SECRET : 'test-secret-test-secret-test-secret-test-secret';
process.env.AUTH_RATE_LIMIT_MAX = '10000';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Uploaded test images go to a temporary folder, never to backend/uploads.
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acadsync-test-uploads-'));

require('dotenv').config({ quiet: true });
refuseToWipeRealDatabase();

const { Client } = require('pg');
const request = require('supertest');
const { config } = require('../src/config');
const { pool } = require('../src/db');
const { createApp } = require('../src/app');
const { runMigrations } = require('../src/utils/migrator');
const { hashPassword } = require('../src/utils/passwords');

const SUPER = { email: 'super@test.local', password: 'SuperPass123', name: 'Test Super User' };
const ADMIN = { email: 'admin@test.local', password: 'AdminPass123', name: 'Test Admin' };

// The tests wipe their database on every run. Stop before anything happens
// when the test database is the same one the app itself uses.
function refuseToWipeRealDatabase() {
  const stop = (reason) => {
    console.error('\nThe tests did not run, to keep your real data safe.');
    console.error(reason);
    console.error('The tests wipe their database every time they run, so they need a database of their own.\n');
    process.exit(1);
  };

  // Same server and same database name = same database, even if the rest of the address differs.
  const target = (connectionString) => {
    try {
      const url = new URL(connectionString);
      return `${url.hostname}:${url.port || 5432}${url.pathname}`.toLowerCase();
    } catch {
      return connectionString.trim();
    }
  };

  const testUrl = (process.env.TEST_DATABASE_URL || '').trim();
  const realUrl = (process.env.DATABASE_URL || '').trim();
  if (testUrl) {
    if (realUrl && (testUrl === realUrl || target(testUrl) === target(realUrl))) {
      stop('TEST_DATABASE_URL points to the same database as DATABASE_URL in backend/.env. Give TEST_DATABASE_URL a different database.');
    }
    return;
  }

  const testName = process.env.TEST_DB_NAME || 'acadsync_test';
  const realName = process.env.DB_NAME || 'acadsync';
  if (testName === realName) {
    stop(`TEST_DB_NAME and DB_NAME are both "${realName}" in backend/.env. Change TEST_DB_NAME, for example to acadsync_test.`);
  }
}

async function createTestDatabaseIfMissing() {
  if (config.db.connectionString) return; // TEST_DATABASE_URL: the database must already exist

  const client = new Client({ ...config.db, database: 'postgres' });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.db.database]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE "${config.db.database.replace(/"/g, '')}"`);
    }
  } finally {
    await client.end();
  }
}

async function resetDatabase() {
  await createTestDatabaseIfMissing();
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO admins (role, full_name, email, password_hash) VALUES
       ('super_user', $1, $2, $3),
       ('admin', $4, $5, $6)`,
    [SUPER.name, SUPER.email, await hashPassword(SUPER.password), ADMIN.name, ADMIN.email, await hashPassword(ADMIN.password)]
  );
}

const app = createApp();
const api = () => request(app);

async function signIn(account) {
  const response = await api().post('/api/auth/login').send({ email: account.email, password: account.password });
  if (response.status !== 200) throw new Error(`Sign-in failed for ${account.email}: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.token;
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// Removes the temporary upload folder. Call it once, after the last test.
function removeTestUploads() {
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
}

module.exports = { api, pool, resetDatabase, signIn, bearer, removeTestUploads, SUPER, ADMIN };
