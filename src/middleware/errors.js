const { HttpError } = require('../lib/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'route_not_found', message: `Cannot ${req.method} ${req.path}` } });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
  }

  req.log?.error({ err }, 'unhandled error');
  return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
}

module.exports = { notFoundHandler, errorHandler };
