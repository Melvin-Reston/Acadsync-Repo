// Password helpers. Passwords are only ever stored as bcrypt hashes.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = 12;

function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

// Returns a message when the password is too weak, or null when it is fine.
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 72) return 'Use 72 characters or fewer.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Include at least one letter and one number.';
  return null;
}

// A random 12-character temporary password without look-alike characters (0/O, 1/l/I).
function generateTemporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (chars) => chars[crypto.randomInt(chars.length)];

  const characters = [pick(letters), pick(digits)];
  while (characters.length < 12) characters.push(pick(all));

  // Shuffle so the guaranteed letter and digit are not always first.
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join('');
}

module.exports = { hashPassword, verifyPassword, passwordProblem, generateTemporaryPassword };
