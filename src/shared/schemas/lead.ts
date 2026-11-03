import { z } from 'zod';
import { BilingualTextSchema } from './sections/common';
export const LeadSchema = z
  .object({
    id: z.string(),
    fullName: z.string().trim().min(1),
    email: z
      .string()
      .email()
      .transform((v) => v.toLowerCase()),
    phone: z.string(),
    phoneNormalized: z.string(),
    createdAt: z.string(),
    consent: z.object({ acceptedAt: z.string(), policyVersion: z.number().int().nonnegative() }),
    attribution: z.object({
      source: z.string().optional(),
      medium: z.string().optional(),
      campaign: z.string().optional(),
      referrer: z.string().optional(),
      referrerPath: z.string().optional(),
      landingSlug: z.string().optional(),
    }),
    possibleDuplicateOf: z.string().optional(),
    isDemo: z.literal(true).optional(),
  })
  .strict();
export const EnrollmentSchema = z
  .object({
    id: z.string(),
    reference: z.string().regex(/^PAS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/),
    leadId: z.string(),
    courseId: z.string(),
    courseSnapshot: z.object({ title: BilingualTextSchema, slug: z.string() }),
    priceSnapshot: z.object({
      amount: z.number().int().nonnegative().nullable(),
      currency: z.string().length(3),
    }),
    formSnapshot: z.object({
      fields: z.array(z.object({ id: z.string(), label: BilingualTextSchema, type: z.string() })),
    }),
    answers: z.record(z.string(), z.union([z.string(), z.boolean(), z.undefined()])),
    enrollmentStatus: z.enum(['pending', 'confirmed', 'cancelled']),
    followUpStatus: z.enum([
      'new',
      'contacted',
      'interested',
      'awaiting_payment',
      'no_answer',
      'not_interested',
      'closed',
    ]),
    assignedToUserId: z.string().optional(),
    registeredAt: z.string(),
    idempotencyKey: z.string(),
    cancelledReason: z.string().optional(),
    history: z.array(
      z.object({
        type: z.string(),
        actor: z.string(),
        at: z.string(),
        from: z.string().optional(),
        to: z.string().optional(),
        note: z.string().optional(),
      }),
    ),
    isDemo: z.literal(true).optional(),
  })
  .strict();
export type Lead = z.infer<typeof LeadSchema>;
export type Enrollment = z.infer<typeof EnrollmentSchema>;
