// Validates req.body / req.query / req.params with a zod schema before the controller runs.
const { badRequest } = require('../utils/httpError');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});

    if (!result.success) {
      const errors = {};
      for (const issue of result.error.issues) {
        const field = issue.path.join('.') || 'form';
        if (!errors[field]) errors[field] = issue.message;
      }
      throw badRequest('Please check the highlighted fields.', { code: 'VALIDATION_ERROR', errors });
    }

    // Cleaned values (trimmed text, numbers converted) are kept in req.valid.
    req.valid = { ...(req.valid || {}), [source]: result.data };
    next();
  };
}

module.exports = { validate };
