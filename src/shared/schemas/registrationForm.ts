import { z } from 'zod';
import { BilingualTextSchema } from './sections/common';

export const RegistrationFieldSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    type: z.enum(['text', 'select', 'radio', 'checkbox', 'textarea']),
    label: BilingualTextSchema,
    placeholder: BilingualTextSchema.optional(),
    helpText: BilingualTextSchema.optional(),
    required: z.boolean().default(false),
    options: z
      .array(
        z.object({ value: z.string().trim().min(1).max(80), label: BilingualTextSchema }).strict(),
      )
      .max(30)
      .optional(),
    maxLength: z.number().int().min(1).max(4000).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (!field.label.ar.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'عنوان الحقل مطلوب.', path: ['label', 'ar'] });
    if (['select', 'radio'].includes(field.type) && (!field.options || field.options.length < 2))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'أضف اختيارين على الأقل.',
        path: ['options'],
      });
    if (
      field.options &&
      new Set(field.options.map((option) => option.value)).size !== field.options.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Option values must be unique.',
        path: ['options'],
      });
    field.options?.forEach((option, index) => {
      if (!option.label.ar.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'اكتب اسم الاختيار بالعربي.',
          path: ['options', index, 'label', 'ar'],
        });
      }
    });
  });
export const FormDefinitionSchema = z
  .object({
    fields: z.array(RegistrationFieldSchema).max(12),
    consentText: BilingualTextSchema.optional(),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const ids = definition.fields.map((field) => field.id);
    if (definition.consentText && !definition.consentText.ar.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'نص الموافقة مطلوب.', path: ['consentText', 'ar'] });
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'معرّفات الحقول لازم تكون مختلفة.',
        path: ['fields'],
      });
    for (const reserved of ['fullName', 'email', 'phone', 'consent'])
      if (ids.includes(reserved))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'الحقول الأساسية ثابتة ومش ممكن استبدالها.',
          path: ['fields'],
        });
  });
export type RegistrationField = z.infer<typeof RegistrationFieldSchema>;
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;
