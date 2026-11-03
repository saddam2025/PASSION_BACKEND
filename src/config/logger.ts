import pino from 'pino';
import { parseEnvironment } from './env';

export function createLogger(level = parseEnvironment().LOG_LEVEL): pino.Logger {
  return pino({
    level,
    redact: {
      paths: [
        'password', '*.password', 'token', '*.token', 'tokenHash', '*.tokenHash',
        'secret', '*.secret', 'authorization', '*.authorization', 'cookie', '*.cookie',
        'headers.authorization', 'headers.cookie', 'headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
