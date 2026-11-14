// http.js - error type, async wrapper, input validators, and MySQL error mapping.
class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function toInt(value, name, { min = -2147483648, max = 2147483647 } = {}) {
  let v = value;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) v = Number(v);
  if (!Number.isInteger(v) || v < min || v > max) throw new AppError(400, `${name} must be an integer between ${min} and ${max}`, 'VALIDATION');
  return v;
}

function toStr(value, name, max = 255) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new AppError(400, `${name} must be a non-empty text of at most ${max} characters`, 'VALIDATION');
  }
  return value.trim();
}

function toEnum(value, name, allowed) {
  if (!allowed.includes(value)) throw new AppError(400, `${name} must be one of: ${allowed.join(', ')}`, 'VALIDATION');
  return value;
}

// Vector of non-negative integers with a fixed length (resource quantities).
function toVec(value, name, length) {
  if (!Array.isArray(value) || value.length !== length) throw new AppError(400, `${name} must be an array of ${length} integers`, 'VALIDATION');
  return value.map((x, i) => toInt(x, `${name}[${i}]`, { min: 0, max: 1000000 }));
}

function mapDbError(err) {
  const down = ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ENOTFOUND', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'];
  if (down.includes(err.code)) return new AppError(503, 'Database unavailable. Check MySQL is running and the .env settings are correct.', 'DB_UNAVAILABLE');
  switch (err.errno) {
    case 1062: return new AppError(409, 'A record with the same unique value already exists.', 'DUPLICATE');
    case 1452: return new AppError(400, 'Referenced record does not exist (invalid foreign key).', 'BAD_REFERENCE');
    case 1451: return new AppError(409, 'This record is still referenced by other records and cannot be deleted.', 'IN_USE');
    case 3819: return new AppError(400, 'Value violates a database constraint.', 'CONSTRAINT');
    case 1048: return new AppError(400, 'A required value is missing.', 'VALIDATION');
    default: return null;
  }
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let e = err;
  if (!(e instanceof AppError)) {
    if (e.type === 'entity.parse.failed') e = new AppError(400, 'Request body is not valid JSON.', 'BAD_JSON');
    else if (e.type === 'entity.too.large') e = new AppError(413, 'Request body too large.', 'TOO_LARGE');
    else e = mapDbError(e) || new AppError(500, 'Internal server error.', 'INTERNAL');
    if (e.status === 500) console.error('[internal]', err.message); // message only: no stack trace in responses
  }
  res.status(e.status).json({ ok: false, error: { code: e.code, message: e.message } });
}

module.exports = { AppError, wrap, toInt, toStr, toEnum, toVec, errorHandler };
