import { z } from 'zod';
import { BilingualTextSchema, createSectionSchema } from './common';
import { BilingualRichTextSchema } from './richText';
export const TextSectionSchema = createSectionSchema(
  'text',
  z
    .object({
      title: BilingualTextSchema.optional(),
      subtitle: BilingualTextSchema.optional(),
      richText: BilingualRichTextSchema,
      layout: z.enum(['single', 'twoColumns']).default('single'),
    })
    .strict()
    .default({ title: { ar: '', en: '' }, subtitle: { ar: '', en: '' }, richText: { ar: [], en: [] }, layout: 'single' }),
);
