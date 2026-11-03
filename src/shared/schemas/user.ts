import { z } from 'zod';
export const UserRoleSchema = z.enum(['admin', 'assistant']);
export const UserPermissionsSchema = z.object({
  viewLeads: z.boolean().default(false), updateFollowUp: z.boolean().default(false), viewPayments: z.boolean().default(false),
  recordPayments: z.boolean().default(false), exportCsv: z.boolean().default(false), viewFinancialReports: z.boolean().default(false), manageNotes: z.boolean().default(false),
}).strict();
export const UserSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(160),
  passwordHash: z.string().min(20),
  role: UserRoleSchema,
  permissions: UserPermissionsSchema,
  isActive: z.boolean().default(true),
  failedLoginCount: z.number().int().nonnegative().default(0),
  lockedUntil: z.date().nullable().default(null),
  lastLoginAt: z.date().nullable().default(null),
  tokenVersion: z.number().int().nonnegative().default(0),
}).strict();
export type UserInput = z.input<typeof UserSchema>;
