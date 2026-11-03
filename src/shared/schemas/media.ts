import { z } from 'zod';

export const mediaIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
export const mediaListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(160).optional(), usage: z.enum(['used', 'unused', 'all']).default('all'), sort: z.enum(['newest', 'oldest']).default('newest'),
}).strict();
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;
