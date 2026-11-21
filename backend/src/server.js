// Starts the API: npm start  (or "npm run dev" to restart automatically when a file changes)
const { config, assertConfig } = require('./config');
const { pool } = require('./db');
const { createApp } = require('./app');
const { describeDbError } = require('./utils/dbError');
const { startBillingTimer } = require('./utils/billing');

async function start() {
  assertConfig();

  // Fail early with a clear message when the database is not ready.
  try {
    await pool.query('SELECT 1 FROM admins LIMIT 1');
    await pool.query('SELECT 1 FROM plans LIMIT 1'); // added in Part 2: needs "npm run migrate" after an upgrade
    await pool.query('SELECT 1 FROM teacher_password_reset_tokens LIMIT 1'); // added in Teacher Batch 1
  } catch (error) {
    throw new Error(describeDbError(error));
  }

  // Express passes a start-up error (for example a busy port) to this callback.
  createApp().listen(config.port, (error) => {
    if (error) {
      const busy = error.code === 'EADDRINUSE';
      console.error(busy ? `Port ${config.port} is already in use. Close the other backend terminal or change PORT in backend/.env` : error.message);
      process.exit(1);
    }
    console.log(`AcadSync API is running at http://localhost:${config.port}/api`);
    console.log(`Allowed frontend address: ${config.frontendUrl}`);

    // Ends trials and free periods that are over, and issues invoices that are due.
    startBillingTimer();
  });
}

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
