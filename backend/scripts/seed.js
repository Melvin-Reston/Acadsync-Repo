// Usage:
//   npm run seed                       creates the Super User and Admin accounts from .env
//   npm run seed:reset                 also replaces the passwords of accounts that already exist
const { pool } = require('../src/db');
const { describeDbError } = require('../src/utils/dbError');
const { hashPassword, passwordProblem } = require('../src/utils/passwords');

const resetPasswords = process.argv.includes('--reset-passwords');

const accounts = [
  { role: 'super_user', label: 'Super User', prefix: 'SUPER_USER' },
  { role: 'admin', label: 'Admin', prefix: 'ADMIN' },
];

function readAccount({ role, label, prefix }) {
  const fullName = (process.env[`${prefix}_NAME`] || '').trim();
  const email = (process.env[`${prefix}_EMAIL`] || '').trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`] || '';

  const problems = [];
  if (!fullName) problems.push(`${prefix}_NAME is empty`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`${prefix}_EMAIL is not a valid email`);
  const weak = passwordProblem(password);
  if (weak) problems.push(`${prefix}_PASSWORD: ${weak}`);

  return { role, label, fullName, email, password, problems };
}

async function main() {
  const list = accounts.map(readAccount);

  const problems = list.flatMap((account) => account.problems);
  if (list[0].email && list[0].email === list[1].email) {
    problems.push('SUPER_USER_EMAIL and ADMIN_EMAIL must be different');
  }
  if (problems.length > 0) {
    console.error('Fix these values in backend/.env, then run "npm run seed" again:');
    problems.forEach((problem) => console.error(`  - ${problem}`));
    if (list.some((account) => passwordProblem(account.password))) {
      console.error('');
      console.error('If your password contains a # character, wrap the whole value in double quotes:');
      console.error('  ADMIN_PASSWORD="abc#12345"');
      console.error('Without the quotes, everything from the # onward is ignored, so the password ends up too short.');
      console.error('Also check that the file is named exactly .env (not .env.example) and that it is saved.');
    }
    process.exitCode = 1;
    return;
  }

  for (const account of list) {
    const existing = await pool.query('SELECT id FROM admins WHERE role = $1', [account.role]);

    if (existing.rowCount === 0) {
      await pool.query(
        'INSERT INTO admins (role, full_name, email, password_hash) VALUES ($1, $2, $3, $4)',
        [account.role, account.fullName, account.email, await hashPassword(account.password)]
      );
      console.log(`Created ${account.label}: ${account.email}`);
    } else if (resetPasswords) {
      await pool.query(
        `UPDATE admins
            SET password_hash = $1, failed_attempts = 0, locked_until = NULL, is_active = TRUE,
                must_change_password = FALSE, token_version = token_version + 1, updated_at = NOW()
          WHERE role = $2`,
        [await hashPassword(account.password), account.role]
      );
      console.log(`${account.label} already exists. Password replaced with the one in .env.`);
    } else {
      console.log(`${account.label} already exists. Left unchanged.`);
    }
  }
}

main()
  .catch((error) => {
    console.error(describeDbError(error));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
