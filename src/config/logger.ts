import pino from 'pino';
import type { DestinationStream } from 'pino';
import { parseEnvironment } from './env';

const sensitiveField = /password|token|cookie|authorization|email|phone|secret/i;

function redactNestedFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNestedFields);
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    sensitiveField.test(key) ? '[REDACTED]' : redactNestedFields(nested),
  ]));
}

export function createLogger(level = parseEnvironment().LOG_LEVEL, destination?: DestinationStream): pino.Logger {
  return pino({
    level,
    redact: {
      paths: [
        'password', '*.password', 'token', '*.token', 'tokenHash', '*.tokenHash',
        'secret', '*.secret', 'authorization', '*.authorization', 'cookie', '*.cookie',
        'headers.authorization', 'headers.cookie', 'headers["set-cookie"]',
        'email', '*.email', 'phone', '*.phone', 'phoneNormalized', '*.phoneNormalized',
      ],
      censor: '[REDACTED]',
    },
    formatters: { log: (object) => redactNestedFields(object) as Record<string, unknown> },
    timestamp: pino.stdTimeFunctions.isoTime,
  }, destination);
}
