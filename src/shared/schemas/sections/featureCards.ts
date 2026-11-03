import { z } from 'zod';
import { BilingualTextSchema, IconNameSchema, ImageRefSchema, ExpandableDetailSchema, createSectionSchema } from './common';
export const FeatureCardsSectionSchema = createSectionSchema(
  'featureCards',
  z
    .object({
      title: BilingualTextSchema.optional(),
      subtitle: BilingualTextSchema.optional(),
      items: z
        .array(
          z
            .object({ icon: IconNameSchema.optional(), image: ImageRefSchema.optional(), badge: BilingualTextSchema.optional(), title: BilingualTextSchema, text: BilingualTextSchema, details: z.array(ExpandableDetailSchema).default([]), detailsMode: z.enum(['inline', 'modal']).default('inline'), ratio: z.enum(['square', 'landscape', 'portrait']).default('landscape') })
            .strict(),
        )
        .default([]),
      columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
      layout: z.enum(['grid2', 'grid3', 'bento']).default('grid3'),
      variant: z.enum(['standard', 'bonuses']).default('standard'),
    })
    .strict()
    .default({ items: [], columns: 3, layout: 'grid3', variant: 'standard' }),
);
