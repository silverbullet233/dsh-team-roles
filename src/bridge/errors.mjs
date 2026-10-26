/** Stable errors crossing the local bridge transport. */
export class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

/** Validate a JSON request without accepting prototype-bearing objects. */
export function object(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError('INVALID_REQUEST', 'Expected a request object.');
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new BridgeError('INVALID_REQUEST', `Unexpected field: ${key}`);
  }
  return value;
}

/** Validate bounded text at the process boundary. */
export function text(value, name, limit = 65536) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > limit) {
    throw new BridgeError('INVALID_REQUEST', `${name} must be non-empty text within ${limit} bytes.`);
  }
  return value;
}
