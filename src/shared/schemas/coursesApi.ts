import { z } from 'zod';
import { CourseStatusSchema, SnapshotSchema } from './course';
import { BilingualTextSchema } from './sections/common';
import { reservedSlugs } from './courseDraft';

const slug = z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine((value) => !reservedSlugs.has(value), 'الرابط المختصر محجوز.');
export const courseIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
export const featuredCourseBodySchema = z.object({ featured: z.boolean() }).strict();
export const slugParamsSchema = z.object({ slug }).strict();
export const courseListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(), status: CourseStatusSchema.optional(), category: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
}).strict();
export const publicCourseListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(), category: z.string().trim().max(100).optional(), featured: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12),
}).strict();
export const createCourseBodySchema = z.union([
  z.object({ slug, draft: SnapshotSchema, featured: z.boolean().optional() }).strict(),
  z.object({ slug, title: BilingualTextSchema, category: z.string().trim().min(1).max(100), template: z.enum(['full', 'short', 'blank']).default('full'), featured: z.boolean().optional() }).strict(),
]);
export const saveCourseDraftBodySchema = z.object({ expectedVersion: z.number().int().min(0), draft: SnapshotSchema }).strict();
export const checkCourseSlugQuerySchema = z.object({ slug, exceptId: z.string().regex(/^[a-f\d]{24}$/i).optional() }).strict();
export const publishCourseBodySchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();
export const softDeleteBodySchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();
