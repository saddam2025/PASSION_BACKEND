import { z } from 'zod';

const arabicName = z.string().trim().min(1).max(120);
const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const categoryIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strip();
export const categoryCreateSchema = z.object({ name: arabicName, slug: slug.optional() }).strip();
export const categoryPatchSchema = z.object({ name: arabicName.optional(), slug: slug.optional() }).strip().refine((value) => Object.keys(value).length > 0);
export const categoryReorderSchema = z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(500) }).strip().refine((value) => new Set(value.ids).size === value.ids.length, 'كرر عنصر في ترتيب التصنيفات.');
