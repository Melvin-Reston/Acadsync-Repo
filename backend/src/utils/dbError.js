// Turns a database error into a clear message for the terminal.
// Some connection errors arrive with an empty message, so we also read the error code.
const { config } = require('../config');

// Where the API is trying to connect. Never includes the password.
function describeTarget() {
  const db = config.db;
  if (db.connectionString) {
    try {
      const url = new URL(db.connectionString);
      return `${url.hostname}:${url.port || 5432}, database "${url.pathname.replace(/^\//, '')}" (from DATABASE_URL)`;
    } catch {
      return 'DATABASE_URL (it is not a valid connection string)';
    }
  }
  return `${db.host}:${db.port}, database "${db.database}" (from the DB_* values)`;
}

function describeDbError(error) {
  const inner = Array.isArray(error.errors) ? error.errors : [];
  const code = error.code || (inner[0] && inner[0].code) || '';
  const detail = error.message || inner.map((item) => item.message).filter(Boolean).join('; ') || code || 'unknown error';

  const hints = {
    ECONNREFUSED: 'Nothing is answering at that address. If you use Neon, check that DATABASE_URL is filled in inside backend/.env (not .env.example). If you use PostgreSQL on this computer, check that it is running.',
    ETIMEDOUT: 'The database did not answer. Check your internet connection, or whether your network blocks port 5432.',
    ENOTFOUND: 'The database address could not be found. Check the host name in DATABASE_URL or DB_HOST, and your internet connection.',
    EAI_AGAIN: 'The database address could not be looked up. Check your internet connection.',
    '28P01': 'The database user name or password is wrong.',
    '28000': 'The database refused this user. Check the user name and password, and set DB_SSL=true if your host requires SSL.',
    '3D000': 'That database does not exist. Create it first, or check the database name.',
    '42P01': 'The tables are missing. Run "npm run migrate" first.',
  };

  const lines = [`Database error: ${detail}`, `Tried to connect to: ${describeTarget()}`];
  if (hints[code]) lines.push(hints[code]);
  return lines.join('\n');
}

module.exports = { describeDbError, describeTarget };
