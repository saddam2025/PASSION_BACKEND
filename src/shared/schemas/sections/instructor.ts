import { z } from 'zod';
import { BilingualTextSchema, ImageRefSchema, ExpandableDetailSchema, createSectionSchema } from './common';
import { BilingualRichTextSchema } from './richText';
export const InstructorSectionSchema = createSectionSchema(
  'instructor',
  z
    .object({
      name: BilingualTextSchema.default({ ar: '', en: '' }),
      title: BilingualTextSchema.optional(),
      photo: ImageRefSchema.optional(),
      bio: BilingualRichTextSchema.default({ ar: [], en: [] }),
      credentials: z.array(z.object({ text: BilingualTextSchema.default({ ar: '', en: '' }), details: z.array(ExpandableDetailSchema).default([]), detailsMode: z.enum(['inline', 'modal']).default('inline') }).strict()).default([]),
      layout: z.enum(['photoStart', 'photoEnd']).default('photoStart'),
    })
    .strict()
    .default({ name: { ar: '', en: '' }, bio: { ar: [], en: [] }, credentials: [], layout: 'photoStart' }),
);
