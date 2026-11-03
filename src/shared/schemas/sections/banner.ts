import { z } from 'zod';
import { BilingualTextSchema, CtaLinkSchema, ImageRefSchema, createSectionSchema } from './common';

export const BannerSectionSchema = createSectionSchema('banner', z.object({
  image: ImageRefSchema.default({ src: '/images/course-cover-default.webp', alt: { ar: '', en: '' }, decorative: true }),
  ratio: z.enum(['wide', 'cinema', 'standard']).default('wide'),
  overlayTitle: BilingualTextSchema.optional(),
  overlayText: BilingualTextSchema.optional(),
  cta: CtaLinkSchema.optional(),
}).strict().default({ image: { src: '/images/course-cover-default.webp', alt: { ar: '', en: '' }, decorative: true }, ratio: 'wide' }));
