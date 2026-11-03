import { z } from 'zod';

export const reservedSlugs = new Set([
  'admin',
  'assistant',
  'api',
  'courses',
  'login',
  'invite',
  'dev',
  'privacy',
  'terms',
  'register-confirmation',
]);

export const CourseDraftInputSchema = z
  .object({
    title: z.object({ ar: z.string().trim().max(180), en: z.unknown().optional().transform(() => '') }).strict(),
    slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .refine((slug) => !reservedSlugs.has(slug), 'This slug is reserved.'),
    category: z.string().trim().min(1).max(100),
    template: z.enum(['full', 'short', 'blank']).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.title.ar), {
    path: ['title'],
    message: 'اكتب عنوان الكورس بالعربي.',
  });
export type CourseDraftInput = z.infer<typeof CourseDraftInputSchema>;
