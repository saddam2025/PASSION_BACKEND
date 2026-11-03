import { z } from 'zod';
import { BilingualTextSchema, createSectionSchema } from './common';
export const RegistrationFormSectionSchema = createSectionSchema(
  'registrationForm',
  z
    .object({
      title: BilingualTextSchema.default({ ar: '', en: '' }),
      subtitle: BilingualTextSchema.optional(),
      successNote: BilingualTextSchema.optional(),
      layout: z.literal('card').default('card'),
    })
    .strict()
    .default({ title: { ar: '', en: '' }, layout: 'card' }),
);
