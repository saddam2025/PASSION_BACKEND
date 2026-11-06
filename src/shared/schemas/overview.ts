import { z } from 'zod';
import { AppError, ValidationError } from '../../lib/errors';
import { academyDateParts } from '../../lib/time';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'اكتب تاريخًا صحيحًا.');

const optionalDate = z.preprocess((value) => value === '' ? undefined : value, dateKey.optional());
export const overviewQuerySchema = z.object({ from: optionalDate, to: optionalDate }).strict();
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export function overviewStartsInFuture(query: OverviewQuery): boolean {
  if (!query.from) return false;
  const today = academyDateParts(new Date());
  return query.from > `${today.year}-${today.month}-${today.day}`;
}

/** Parses the shared overview range and emits stable, typed API errors. */
export function parseOverviewQuery(input: unknown): OverviewQuery {
  const parsed = overviewQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('راجع صيغة التاريخ.', parsed.error.issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    })));
  }
  const range = parsed.data;
  if (range.from && range.to && range.from > range.to) {
    throw new AppError('INVALID_RANGE', 'تاريخ البداية لازم يكون قبل تاريخ النهاية أو في نفس اليوم.', 422, [{ path: ['to'], code: 'INVALID_RANGE' }]);
  }
  if (range.from && range.to) {
    const from = Date.parse(`${range.from}T00:00:00Z`);
    const to = Date.parse(`${range.to}T00:00:00Z`);
    const inclusiveDays = Math.floor((to - from) / 86_400_000) + 1;
    if (inclusiveDays > 400) {
      throw new AppError('RANGE_TOO_LARGE', 'المدى المحدد طويل. اختار فترة ٤٠٠ يوم أو أقل.', 422, [{ path: ['to'], code: 'RANGE_TOO_LARGE', maxDays: 400 }]);
    }
  }
  return range;
}
