import { ACADEMY_TIME_ZONE, academyDateParts, cairoDayRange } from '../lib/time';
import { Enrollment } from '../models/Enrollment';
import { Payment } from '../models/Payment';
import { overviewStartsInFuture, type OverviewQuery } from '../shared/schemas/overview';

type Granularity = 'day' | 'week' | 'month';
type SeriesBucket = { bucket: string; registrations: number; paid: number };

function dateKey(date: Date): string {
  const parts = academyDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function utcDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function bucketStart(key: string, granularity: Granularity): string {
  const date = utcDate(key);
  if (granularity === 'month') return `${key.slice(0, 7)}-01`;
  if (granularity === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 1) % 7)); // Saturday start.
  return date.toISOString().slice(0, 10);
}

function nextBucket(key: string, granularity: Granularity): string {
  const date = utcDate(key);
  if (granularity === 'day') date.setUTCDate(date.getUTCDate() + 1);
  else if (granularity === 'week') date.setUTCDate(date.getUTCDate() + 7);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function makeBuckets(from: string, to: string, granularity: Granularity): string[] {
  const output: string[] = [];
  const last = bucketStart(to, granularity);
  for (let current = bucketStart(from, granularity); current <= last; current = nextBucket(current, granularity)) {
    output.push(current);
  }
  return output;
}

function explicitRange(query: OverviewQuery) {
  if (!query.from && !query.to) return null;
  const today = dateKey(new Date());
  const from = query.from;
  const to = query.to && query.to < today ? query.to : today;
  if (from && from > today) return null;
  if (from && from > to) return null;
  return { from, to };
}

function granularityFor(from: string, to: string, allTime: boolean): Granularity {
  if (allTime) return 'month';
  const days = Math.floor((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000) + 1;
  return days <= 62 ? 'day' : days <= 400 ? 'week' : 'month';
}

function registrationMatch(query: OverviewQuery) {
  if (overviewStartsInFuture(query)) return { _id: { $exists: false } };
  const range = cairoDayRange(query.from, query.to);
  return range.from || range.to ? { registeredAt: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } } : {};
}

export const overviewChartsService = {
  async get(query: OverviewQuery) {
    const cohortMatch = registrationMatch(query);
    const [bounds] = await Enrollment.aggregate<{ first: string; last: string }>([
      { $match: cohortMatch },
      { $group: { _id: null, first: { $min: '$registeredAt' }, last: { $max: '$registeredAt' } } },
      { $project: { _id: 0, first: { $dateToString: { format: '%Y-%m-%d', date: '$first', timezone: ACADEMY_TIME_ZONE } }, last: { $dateToString: { format: '%Y-%m-%d', date: '$last', timezone: ACADEMY_TIME_ZONE } } } },
    ]);

    const requested = explicitRange(query);
    const [anyEnrollment] = await Enrollment.aggregate([{ $limit: 1 }, { $project: { _id: 1 } }]);
    const futureFrom = overviewStartsInFuture(query);
    const periodFrom = futureFrom ? undefined : requested?.from ?? bounds?.first;
    const periodTo = futureFrom ? undefined : requested?.to ?? bounds?.last;
    const hasBuckets = Boolean(anyEnrollment && periodFrom && periodTo && periodFrom <= periodTo);
    const granularity: Granularity = hasBuckets ? granularityFor(periodFrom!, periodTo!, !query.from && !query.to) : (!query.from && !query.to ? 'month' : 'day');
    const buckets = hasBuckets ? makeBuckets(periodFrom!, periodTo!, granularity) : [];

    const trunc = (field: string) => ({ $dateTrunc: { date: field, unit: granularity, timezone: ACADEMY_TIME_ZONE, ...(granularity === 'week' ? { startOfWeek: 'saturday' } : {}) } });
    const bucketString = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: trunc(field), timezone: ACADEMY_TIME_ZONE } });
    const [registrationRows, revenueRows, funnelRows, distributionRows, courseRows, audienceRows, audiencePresence, enrollmentCurrencies] = await Promise.all([
      buckets.length ? Enrollment.aggregate<{ _id: string; registrations: number; paid: number }>([
        { $match: cohortMatch },
        { $group: { _id: bucketString('$registeredAt'), registrations: { $sum: 1 }, paid: { $sum: { $cond: [{ $eq: ['$paymentSummary.status', 'paid'] }, 1, 0] } } } },
      ]) : Promise.resolve([]),
      buckets.length ? Payment.aggregate<{ _id: { currency: string; bucket: string }; netRevenue: number }>([
        { $match: { status: 'confirmed', ...(query.from || query.to ? { receivedAt: { ...(query.from ? { $gte: cairoDayRange(query.from).from } : {}), ...(query.to ? { $lte: cairoDayRange(undefined, query.to).to } : {}) } } : {}) } },
        { $group: { _id: { currency: '$currency', bucket: bucketString('$receivedAt') }, netRevenue: { $sum: { $cond: [{ $eq: ['$kind', 'payment'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
        { $sort: { '_id.currency': 1, '_id.bucket': 1 } },
      ]) : Promise.resolve([]),
      Enrollment.aggregate([ 
        { $match: cohortMatch },
        { $lookup: { from: Payment.collection.name, let: { enrollmentId: '$_id' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$enrollmentId', '$$enrollmentId'] }, { $eq: ['$status', 'confirmed'] }, { $eq: ['$kind', 'payment'] }] } } }, { $limit: 1 }, { $project: { _id: 1 } }], as: 'confirmedPayments' } },
        { $addFields: { isCancelled: { $eq: ['$enrollmentStatus', 'cancelled'] }, isPaid: { $eq: ['$paymentSummary.status', 'paid'] }, isContacted: { $or: [{ $ne: ['$followUpStatus', 'new'] }, { $gt: [{ $size: '$confirmedPayments' }, 0] }] } } },
        { $group: {
          _id: null,
          cancelled: { $sum: { $cond: ['$isCancelled', 1, 0] } },
          registered: { $sum: { $cond: ['$isCancelled', 0, 1] } },
          contacted: { $sum: { $cond: [{ $and: [{ $not: ['$isCancelled'] }, '$isContacted'] }, 1, 0] } },
          awaitingPayment: { $sum: { $cond: [{ $and: [{ $not: ['$isCancelled'] }, '$isContacted', { $not: ['$isPaid'] }] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $and: [{ $not: ['$isCancelled'] }, '$isPaid'] }, 1, 0] } },
        } },
      ]),
      Enrollment.aggregate<{ _id: string; count: number }>([
        { $match: cohortMatch }, { $group: { _id: '$paymentSummary.status', count: { $sum: 1 } } }, { $sort: { _id: 1 } },
      ]),
      Enrollment.aggregate<{ top: { _id: unknown; slug: string; title: string; registrations: number; paid: number }[]; rest: { registrations: number; paid: number }[] }>([
        { $match: cohortMatch },
        { $group: { _id: '$courseId', slug: { $first: '$courseSnapshot.slug' }, title: { $first: '$courseSnapshot.title.ar' }, registrations: { $sum: 1 }, paid: { $sum: { $cond: [{ $eq: ['$paymentSummary.status', 'paid'] }, 1, 0] } } } },
        { $facet: {
          top: [{ $sort: { registrations: -1, _id: 1 } }, { $limit: 5 }],
          rest: [{ $sort: { registrations: -1, _id: 1 } }, { $skip: 5 }, { $group: { _id: null, registrations: { $sum: '$registrations' }, paid: { $sum: '$paid' } } }, { $project: { _id: 0, registrations: 1, paid: 1 } }],
        } },
      ]),
      Enrollment.aggregate<{ _id: string; registrations: number; paid: number }>([
        { $match: { ...cohortMatch, audience: { $in: ['egyptian', 'foreign'] } } },
        { $group: { _id: '$audience', registrations: { $sum: 1 }, paid: { $sum: { $cond: [{ $eq: ['$paymentSummary.status', 'paid'] }, 1, 0] } } } },
        { $sort: { _id: 1 } },
      ]),
      Enrollment.aggregate<{ _id: string; count: number }>([
        { $match: cohortMatch }, { $group: { _id: { $type: '$audience' }, count: { $sum: 1 } } },
      ]),
      Enrollment.aggregate<{ _id: string }>([
        { $match: cohortMatch }, { $group: { _id: '$priceSnapshot.currency' } }, { $sort: { _id: 1 } },
      ]),
    ]);

    const registrationByBucket = new Map(registrationRows.map((row) => [row._id, row]));
    const registrationsSeries: SeriesBucket[] = buckets.map((bucket) => {
      const row = registrationByBucket.get(bucket);
      return { bucket, registrations: row?.registrations ?? 0, paid: row?.paid ?? 0 };
    });
    const currencies = [...new Set([...revenueRows.map((row) => row._id.currency), ...enrollmentCurrencies.map((row) => row._id)])].sort();
    const revenueSeriesByCurrency = currencies.map((currency) => {
      const rows = new Map(revenueRows.filter((row) => row._id.currency === currency).map((row) => [row._id.bucket, row.netRevenue]));
      return { currency, series: buckets.map((bucket) => ({ bucket, netRevenue: rows.get(bucket) ?? 0 })) };
    });
    const revenueTotals = new Map<string, number>();
    for (const row of revenueRows) revenueTotals.set(row._id.currency, (revenueTotals.get(row._id.currency) ?? 0) + row.netRevenue);
    const funnel = funnelRows[0] ?? { registered: 0, contacted: 0, awaitingPayment: 0, paid: 0, cancelled: 0 };
    const topCourses = (courseRows[0]?.top ?? []).map((row) => ({ courseId: String(row._id), slug: row.slug, title: row.title, registrations: row.registrations, paid: row.paid }));
    const other = courseRows[0]?.rest[0] ?? { registrations: 0, paid: 0 };
    const byCourse = [...topCourses, ...(other.registrations ? [{ courseId: 'other', slug: '', title: 'أخرى', ...other }] : [])];
    const result: Record<string, unknown> = {
      range: { from: query.from ?? '', to: query.to ?? '', granularity },
      registrations: registrationsSeries.reduce((sum, point) => sum + point.registrations, 0),
      paid: registrationsSeries.reduce((sum, point) => sum + point.paid, 0),
      registrationsSeries,
      revenueSeriesByCurrency,
      netRevenueByCurrency: currencies.map((currency) => ({ currency, netRevenue: revenueTotals.get(currency) ?? 0 })),
      funnel: { registered: funnel.registered, contacted: Math.min(funnel.contacted, funnel.registered), awaitingPayment: Math.min(funnel.awaitingPayment, funnel.contacted), paid: Math.min(funnel.paid, funnel.awaitingPayment), cancelled: funnel.cancelled },
      paymentStatusDistribution: distributionRows.filter((row) => ['unpaid', 'partially_paid', 'paid', 'refunded', 'partially_refunded', 'cancelled'].includes(row._id)).map((row) => ({ status: row._id, count: row.count })),
      byCourse,
    };
    if (audiencePresence.some((row) => row._id !== 'missing' && row.count > 0)) result.byAudience = audienceRows.map((row) => ({ audience: row._id, registrations: row.registrations, paid: row.paid }));
    return result;
  },
};
