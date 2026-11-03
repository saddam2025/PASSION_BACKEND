import { describe, expect, it } from 'vitest';
import { csvAmountFromMinor, csvDocument, escapeCsvCell } from '../lib/csv';
import { derivePaymentStatus, outstandingAmount, type PaymentStatusEnrollment, type PaymentStatusRecord } from '../services/paymentStatus';

const priced: PaymentStatusEnrollment = { enrollmentStatus: 'pending', priceSnapshot: { amount: 10_000, currency: 'EGP' } };
const item = (kind: PaymentStatusRecord['kind'], amount: number, status: PaymentStatusRecord['status'] = 'confirmed'): PaymentStatusRecord => ({ kind, amount, status });

describe('BE-5C derived payment status', () => {
  it.each([
    ['no records is unpaid', priced, [], 'unpaid'],
    ['pending records are pending without a confirmed record', priced, [item('payment', 100, 'pending')], 'pending'],
    ['confirmed partial payment', priced, [item('payment', 2_500)], 'partially_paid'],
    ['exact price is paid', priced, [item('payment', 10_000)], 'paid'],
    ['overpayment remains paid', priced, [item('payment', 12_000)], 'paid'],
    ['refund to zero is refunded', priced, [item('payment', 10_000), item('refund', 10_000)], 'refunded'],
    ['partial refund is partially refunded', priced, [item('payment', 10_000), item('refund', 2_000)], 'partially_refunded'],
    ['voided records do not count', priced, [item('payment', 10_000, 'voided')], 'unpaid'],
    ['cancelled overrides confirmed payment', { ...priced, enrollmentStatus: 'cancelled' }, [item('payment', 10_000)], 'cancelled'],
    ['cancelled with no records is cancelled', { ...priced, enrollmentStatus: 'cancelled' }, [], 'cancelled'],
    ['null price starts unpaid', { ...priced, priceSnapshot: { amount: null, currency: 'EGP' } }, [], 'unpaid'],
    ['null price with confirmed payment stays pending', { ...priced, priceSnapshot: { amount: null, currency: 'EGP' } }, [item('payment', 10_000)], 'pending'],
    ['null price after full refund is refunded', { ...priced, priceSnapshot: { amount: null, currency: 'EGP' } }, [item('payment', 10_000), item('refund', 10_000)], 'refunded'],
    ['voiding a payment after a refund recomputes as refunded', priced, [item('payment', 10_000, 'voided'), item('payment', 3_000, 'confirmed'), item('refund', 3_000)], 'refunded'],
    ['voiding one installment leaves the other installment partial', priced, [item('payment', 5_000, 'voided'), item('payment', 2_000)], 'partially_paid'],
  ] as const)('%s', (_name, enrollment, records, expected) => {
    expect(derivePaymentStatus(enrollment, records)).toBe(expected);
  });

  it('returns null outstanding for null price and clamps known-price overpayment to zero', () => {
    expect(outstandingAmount({ ...priced, priceSnapshot: { amount: null, currency: 'EGP' } }, [item('payment', 500)])).toBeNull();
    expect(outstandingAmount(priced, [item('payment', 12_000)])).toBe(0);
  });
});

describe('BE-5C CSV formatting and injection defense', () => {
  it('neutralizes formulas including those after leading whitespace', () => {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r', ' =', ' \t=', '\u00a0@']) {
      expect(escapeCsvCell(`${prefix}SUM(1,2)`)[1]).toBe("'");
    }
  });

  it('escapes quotes, commas and embedded CRLF and round-trips Arabic after the BOM', () => {
    const csv = csvDocument(['الاسم', 'ملاحظة'], [['علي، أحمد', 'قال "أهلًا"\r\nثم خرج']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(new TextDecoder().decode(new TextEncoder().encode(csv.slice(1)))).toBe(csv.slice(1));
    expect(csv).toContain('"علي، أحمد"');
    expect(csv).toContain('"قال ""أهلًا""\r\nثم خرج"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('converts minor units to currency-specific decimal strings', () => {
    expect(csvAmountFromMinor(12_345, 'EGP')).toBe('123.45');
    expect(csvAmountFromMinor(12_345, 'KWD')).toBe('12.345');
  });
});
