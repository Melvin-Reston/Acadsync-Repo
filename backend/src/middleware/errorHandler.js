// Turns any error into a clean JSON response: { message, code?, errors? }
const { HttpError } = require('../utils/httpError');
const { config } = require('../config');

// Friendly messages for "this value is already used" database errors.
const UNIQUE_MESSAGES = {
  teachers_email_key: { field: 'email', message: 'This email is already used by another teacher.' },
  teachers_username_key: { field: 'username', message: 'This username is already taken.' },
  admins_email_key: { field: 'email', message: 'This email is already used by the other admin account.' },
  plans_name_key: { field: 'name', message: 'A plan with this name already exists.' },
  subscriptions_one_current_key: { field: 'teacher_id', message: 'This teacher already has a current subscription.' },
  payments_one_pending_key: { field: 'reference_number', message: 'A payment for this invoice is already waiting for confirmation.' },
  payments_one_confirmed_key: { field: 'reference_number', message: 'This invoice already has a confirmed payment.' },
  schools_name_place_key: { field: 'name', message: 'A school with this name already exists in that city or region.' },
};

function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Not found.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message, ...error.extra });
  }

  // PostgreSQL unique violation
  if (error.code === '23505') {
    const known = UNIQUE_MESSAGES[error.constraint];
    const message = known ? known.message : 'That value is already in use.';
    return res.status(409).json({
      message,
      code: 'ALREADY_EXISTS',
      errors: known ? { [known.field]: known.message } : undefined,
    });
  }

  // Broken JSON in the request body
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'The request could not be read.' });
  }

  if (!config.isTest) console.error(error);
  res.status(500).json({ message: 'Something went wrong on the server. Please try again.' });
}

module.exports = { notFoundHandler, errorHandler };
