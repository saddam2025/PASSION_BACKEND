import { z } from 'zod';

const answerValueSchema = z.union([z.string().max(4_000), z.boolean()]);
const answerMapSchema = z.record(z.string().min(1).max(40), answerValueSchema);
const answerListSchema = z.array(z.object({ id: z.string().min(1).max(40), value: answerValueSchema }).strip()).max(20).superRefine((answers, context) => {
  const ids = answers.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'لازم كل إجابة يكون ليها معرّف مختلف.' });
}).transform((answers) => Object.fromEntries(answers.map(({ id, value }) => [id, value])));

const attributionSchema = z.object({
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  referrer: z.string().max(2_000).optional(),
}).strip();

export const publicRegistrationBodySchema = z.object({
  courseSlug: z.string().trim().min(1).max(160),
  fullName: z.string().max(400).optional(),
  email: z.string().max(400).optional(),
  phone: z.string().max(100).optional(),
  answers: z.union([answerMapSchema, answerListSchema]).default({}),
  consent: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
  website: z.string().max(200).optional(),
  formStartedAt: z.union([z.number().finite(), z.string().trim().max(40)]).optional(),
  // These two aliases preserve the current frontend mock service contract during API migration.
  honeypot: z.string().max(200).optional(),
  renderedAt: z.union([z.number().finite(), z.string().trim().max(40)]).optional(),
  attribution: attributionSchema.optional(),
}).strip();

export const registrationReferenceParamsSchema = z.object({ reference: z.string().trim().min(1).max(80) }).strip();

export type PublicRegistrationBody = z.infer<typeof publicRegistrationBodySchema>;
