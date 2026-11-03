import { z } from 'zod';
import { EnrollmentSchema } from './lead';

export const EnrollmentInputSchema = EnrollmentSchema.omit({ id: true, reference: true, history: true, registeredAt: true, isDemo: true }).extend({
  consent: z.object({ acceptedAt: z.string(), policyVersion: z.number().int().nonnegative() }).strict(),
});
export const EnrollmentStateSchema = z.enum(['pending', 'confirmed', 'cancelled']);
export const FollowUpStateSchema = z.enum(['new', 'contacted', 'interested', 'awaiting_payment', 'no_answer', 'not_interested', 'closed']);
