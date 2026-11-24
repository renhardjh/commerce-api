class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
const forbidden = (message = 'You do not have access to this resource') => new HttpError(403, 'forbidden', message);
const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
const conflict = (code, message, details) => new HttpError(409, code, message, details);
const unprocessable = (code, message, details) => new HttpError(422, code, message, details);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
