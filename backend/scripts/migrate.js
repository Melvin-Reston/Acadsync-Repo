// Usage: npm run migrate
const { pool } = require('../src/db');
const { describeDbError } = require('../src/utils/dbError');
const { runMigrations } = require('../src/utils/migrator');

async function main() {
  const count = await runMigrations(pool, (message) => console.log(message));
  console.log(count === 0 ? 'Database is already up to date.' : `Done. ${count} migration(s) applied.`);
}

main()
  .catch((error) => {
    console.error(describeDbError(error));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
