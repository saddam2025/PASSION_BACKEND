import { z } from 'zod';
import { BilingualTextSchema, createSectionSchema } from './common';
import { BilingualRichTextSchema } from './richText';
export const ContactWhatsAppSectionSchema = createSectionSchema(
  'contactWhatsApp',
  z
    .object({
      title: BilingualTextSchema.default({ ar: '', en: '' }),
      text: BilingualRichTextSchema.optional(),
      show: z
        .object({
          whatsapp: z.boolean().default(true),
          phone: z.boolean().default(false),
          email: z.boolean().default(false),
        })
        .strict()
        .default({ whatsapp: true, phone: false, email: false }),
      prefilledMessage: BilingualTextSchema.optional(),
      layout: z.enum(['card', 'inline']).default('card'),
    })
    .strict()
    .default({ title: { ar: '', en: '' }, show: { whatsapp: true, phone: false, email: false }, layout: 'card' }),
);
