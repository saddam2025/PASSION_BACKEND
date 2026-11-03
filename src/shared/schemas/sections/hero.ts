import { z } from 'zod';
import { BilingualTextSchema, CtaLinkSchema, ImageRefSchema, createSectionSchema } from './common';
export const HeroSectionSchema = createSectionSchema(
  'hero',
  z
    .object({
      eyebrow: BilingualTextSchema.optional(),
      title: BilingualTextSchema.superRefine((value, ctx) => {
        if (value.ar.split('\n').length > 3) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'العنوان ما ينفعش يزيد عن 3 سطور.', path: ['ar'] });
      }),
      subtitle: BilingualTextSchema.optional(),
      primaryCta: CtaLinkSchema.optional(),
      secondaryCta: CtaLinkSchema.optional(),
      image: ImageRefSchema.optional(),
      layout: z
        .enum(['splitStart', 'splitEnd', 'centered', 'imageBackground'])
        .default('splitStart'),
    })
    .strict()
    .default({ title: { ar: '', en: '' }, layout: 'splitStart' }),
);
