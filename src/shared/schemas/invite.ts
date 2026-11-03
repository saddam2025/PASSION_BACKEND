import { z } from 'zod';
import { PermissionListSchema } from './permissions';

export const Sha256HashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const InviteSchema = z.object({
  tokenHash: Sha256HashSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(['admin', 'assistant']),
  permissions: PermissionListSchema,
  invitedBy: z.string().min(1),
  expiresAt: z.date(),
  purgeAt: z.date(),
  usedAt: z.date().nullable().default(null),
  revokedAt: z.date().nullable().default(null),
}).strict();
