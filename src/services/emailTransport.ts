import type pino from 'pino';
import type { AppEnvironment } from '../config/env';

export interface EmailTransport {
  sendInviteLink(email: string, link: string, logger: pino.Logger): Promise<void>;
  sendPasswordResetLink(email: string, link: string, logger: pino.Logger): Promise<void>;
}

export function createEmailTransport(environment: AppEnvironment): EmailTransport {
  const deliverDevLink = async (kind: string, _email: string, link: string, logger: pino.Logger) => {
    if (environment.NODE_ENV === 'development') logger.info({ kind, link }, 'Development-only account link; configure a mail provider before production');
  };
  return {
    sendInviteLink: (email, link, logger) => deliverDevLink('invite', email, link, logger),
    sendPasswordResetLink: (email, link, logger) => deliverDevLink('password-reset', email, link, logger),
  };
}
