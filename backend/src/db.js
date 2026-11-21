// One shared PostgreSQL connection pool for the whole API.
const { Pool } = require('pg');
const { config } = require('./config');

const pool = new Pool(config.db);

// Run one query: query('SELECT * FROM teachers WHERE id = $1', [id])
function query(text, params) {
  return pool.query(text, params);
}

// Run several queries as one unit. If any of them fails, none of them is saved.
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
