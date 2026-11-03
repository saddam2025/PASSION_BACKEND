import { z } from 'zod';
import { BilingualTextSchema, createSectionSchema } from './common';
import { BilingualRichTextSchema } from './richText';
export const FaqSectionSchema = createSectionSchema(
  'faq',
  z
    .object({
      title: BilingualTextSchema.default({ ar: '', en: '' }),
      layout: z.enum(['accordion', 'twoColumn']).default('accordion'),
      items: z
        .array(z.object({ question: BilingualTextSchema, answer: BilingualRichTextSchema, category: BilingualTextSchema.optional() }).strict())
        .default([]),
    })
    .strict()
    .default({ title: { ar: '', en: '' }, layout: 'accordion', items: [] }),
);
