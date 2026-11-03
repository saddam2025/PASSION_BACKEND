import { z } from 'zod';
import { BilingualTextSchema, createSectionSchema } from './common';
export const CurriculumSectionSchema = createSectionSchema(
  'curriculum',
  z
    .object({
      title: BilingualTextSchema.default({ ar: '', en: '' }),
      modules: z
        .array(
          z
            .object({
              title: BilingualTextSchema.default({ ar: '', en: '' }),
              summary: BilingualTextSchema.optional(),
              lessons: z.array(z.object({ title: BilingualTextSchema.default({ ar: '', en: '' }) }).strict()).default([]),
              duration: BilingualTextSchema.optional(),
            })
            .strict(),
        )
        .default([]),
      layout: z.enum(['accordion', 'timeline', 'numberedCards']).default('accordion'),
    })
    .strict()
    .default({ title: { ar: '', en: '' }, modules: [], layout: 'accordion' }),
);
