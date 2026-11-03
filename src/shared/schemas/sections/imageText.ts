import { z } from 'zod';
import { BilingualTextSchema, CtaLinkSchema, ImageRefSchema, createSectionSchema } from './common';
import { BilingualRichTextSchema } from './richText';
export const ImageTextSectionSchema = createSectionSchema(
  'imageText',
  z
    .object({
      image: ImageRefSchema,
      checklist: z.array(z.object({ text: BilingualTextSchema }).strict()).default([]),
      title: BilingualTextSchema,
      richText: BilingualRichTextSchema,
      cta: CtaLinkSchema.optional(),
      layout: z.enum(['imageStart', 'imageEnd', 'imageTop']).default('imageStart'),
      imageRatio: z.enum(['square', 'landscape', 'portrait']).default('landscape'),
    })
    .strict()
    .default({
      image: { src: '/images/course-cover-default.webp', alt: { ar: '', en: '' }, decorative: true },
      title: { ar: '', en: '' },
      richText: { ar: [], en: [] },
      checklist: [],
      layout: 'imageStart',
      imageRatio: 'landscape',
    }),
);
