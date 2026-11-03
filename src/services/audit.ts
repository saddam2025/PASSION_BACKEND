import mongoose from 'mongoose';
import type pino from 'pino';
import { AuditLog } from '../models/AuditLog';
import { SYSTEM_ACTOR_ID } from './authTokens';

export interface AuditInput {
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeStatus?: string;
  afterStatus?: string;
  note?: string;
}

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(password|token|secret|authorization|cookie)/i.test(key))
      .map(([key, nested]) => [key, redactAuditValue(nested)]));
  }
  return value;
}

export async function writeAudit(input: AuditInput, logger: pino.Logger): Promise<void> {
  try {
    const safe = redactAuditValue({ note: input.note });
    const note = safe && typeof safe === 'object' && 'note' in safe ? (safe as { note?: unknown }).note : undefined;
    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(input.actorId ?? SYSTEM_ACTOR_ID),
      action: input.action,
      entityType: input.entityType,
      entityId: new mongoose.Types.ObjectId(input.entityId ?? SYSTEM_ACTOR_ID),
      ...(input.beforeStatus ? { beforeStatus: input.beforeStatus } : {}),
      ...(input.afterStatus ? { afterStatus: input.afterStatus } : {}),
      ...(typeof note === 'string' ? { note: note.slice(0, 2000) } : {}),
      occurredAt: new Date(),
    });
  } catch (error) {
    logger.error({ action: input.action, errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Audit record could not be written');
  }
}
