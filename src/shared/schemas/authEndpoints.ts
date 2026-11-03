import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth';
import { PermissionKeySchema } from './permissions';
import { UserRoleSchema } from './user';

const passwordPolicyForEmail = (email: string) => passwordSchema.superRefine((value, context) => {
  if (value.toLowerCase() === email.trim().toLowerCase()) context.addIssue({ code: 'custom', message: 'passwordMustDifferFromEmail' });
});

export const loginBodySchema = z.object({ email: emailSchema, password: z.string().min(1).max(256) }).strict();
export const inviteTokenParamsSchema = z.object({ token: z.string().min(40).max(200) }).strict();
export const inviteAcceptBodySchema = z.object({ token: z.string().min(40).max(200), name: z.string().trim().min(1).max(160), password: z.string().min(1).max(256) }).strict().superRefine((value, context) => {
  const result = passwordPolicyForEmail('').safeParse(value.password);
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: ['password', ...issue.path] });
});
export const resetRequestBodySchema = z.object({ email: emailSchema }).strict();
export const resetConfirmBodySchema = z.object({ token: z.string().min(40).max(200), password: z.string().min(1).max(256) }).strict().superRefine((value, context) => {
  const result = passwordPolicyForEmail('').safeParse(value.password);
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: ['password', ...issue.path] });
});
export const changePasswordBodySchema = z.object({ currentPassword: z.string().min(1).max(256), password: z.string().min(1).max(256) }).strict();
export const userIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
export const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(), role: UserRoleSchema.optional(), active: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'email']).default('newest'),
}).strict();
export const userPatchBodySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(), role: UserRoleSchema.optional(), permissions: z.array(PermissionKeySchema).max(7).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const inviteCreateBodySchema = z.object({ email: emailSchema, name: z.string().trim().min(1).max(160).optional(), role: UserRoleSchema.default('assistant'), permissions: z.array(PermissionKeySchema).max(7).default([]), hours: z.union([z.literal(24), z.literal(72), z.literal(168)]).default(72) }).strict();
export const inviteListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), status: z.enum(['pending', 'accepted', 'revoked', 'expired']).optional(), search: z.string().trim().max(100).optional() }).strict();
export const tokenIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
export const validatePasswordForEmail = (email: string, password: string) => passwordPolicyForEmail(email).parse(password);
