import { z } from 'zod';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'اكتب تاريخًا صحيحًا.');

const optionalDate = z.preprocess((value) => value === '' ? undefined : value, dateKey.optional());
export const overviewQuerySchema = z.object({ from: optionalDate, to: optionalDate }).strict().refine(
  (value) => !value.from || !value.to || value.from <= value.to,
  { path: ['to'], message: 'تاريخ النهاية لازم يكون بعد تاريخ البداية.' },
);
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
