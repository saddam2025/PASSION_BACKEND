import { z } from 'zod';

export const CategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  order: z.number().int().nonnegative(),
  deletedAt: z.date().nullable().optional(),
}).strict();
