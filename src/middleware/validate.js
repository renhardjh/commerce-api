const { z } = require('zod');
const { badRequest } = require('../lib/errors');

const formatIssues = (issues) =>
  issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));

const validate = (shape) => (req, res, next) => {
  const input = {};
  for (const part of ['params', 'query', 'body']) {
    if (!shape[part]) continue;
    const schema = shape[part] instanceof z.ZodType ? shape[part] : z.object(shape[part]);
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      return next(badRequest('Validation failed', formatIssues(result.error.issues)));
    }
    input[part] = result.data;
  }
  req.input = input;
  return next();
};

module.exports = { validate };
