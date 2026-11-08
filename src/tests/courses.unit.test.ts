import { describe, expect, it } from 'vitest';
import { SnapshotSchema } from '../shared/schemas/course';
import { checkReadiness } from '../shared/schemas/courseReadiness';
import { createCourseTemplateSnapshot } from '../services/coursesService';

describe('BE-4 shared course validation', () => {
  it('builds schema-valid Full, Short and Blank editable templates', () => {
    const full = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'full' });
    const short = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'short' });
    const blank = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'blank' });
    expect(SnapshotSchema.safeParse(full).success).toBe(true);
    expect(full.page.sections.map((section) => section.type)).toEqual(['hero', 'imageText', 'featureCards', 'curriculum', 'instructor', 'pricingCta', 'steps', 'faq', 'registrationForm', 'contactWhatsApp']);
    expect(short.page.sections.map((section) => section.type)).toEqual(['hero', 'text', 'pricingCta', 'registrationForm', 'contactWhatsApp']);
    expect(blank.page.sections.map((section) => section.type)).toEqual(['registrationForm']);
    expect(SnapshotSchema.safeParse(short).success).toBe(true);
    expect(SnapshotSchema.safeParse(blank).success).toBe(true);
  });
  it('applies readiness requirements and accepts a fully completed Arabic snapshot', () => {
    const snapshot = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'blank' });
    expect(checkReadiness(snapshot, 'course-title').errors.length).toBeGreaterThan(0);
    snapshot.details.shortDescription.ar = 'وصف مختصر للكورس';
    snapshot.details.coverImage = { src: '/images/course-cover-default.webp', alt: { ar: '', en: '' }, decorative: true };
    snapshot.details.pricing.price = 12_000;
    const registration = snapshot.page.sections.find((section) => section.type === 'registrationForm');
    expect(registration?.type).toBe('registrationForm');
    if (registration?.type === 'registrationForm') registration.content.title = { ar: 'سجّل بياناتك', en: '' };
    const ready = checkReadiness(snapshot, 'course-title');
    expect(ready.errors).toEqual([]);
  });
  it('rejects malformed form choices and reserved slugs', () => {
    const snapshot = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'blank' });
    snapshot.form.fields = [{ id: 'topic', type: 'select', label: { ar: 'الموضوع', en: '' }, required: true, options: [{ value: 'one', label: { ar: 'اختيار', en: '' } }] }];
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('validates one selected price in either supported currency and rejects the removed dual-price block', () => {
    const snapshot = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'blank' });
    snapshot.details.pricing = { price: 10_000, promo: 7_500, currency: 'USD' };
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(checkReadiness(snapshot).errors.some((entry) => entry.path.startsWith('details.pricing'))).toBe(false);
    snapshot.details.pricing.currency = 'EGP';
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(SnapshotSchema.safeParse({ ...snapshot, details: { ...snapshot.details, foreignPricing: { enabled: true, price: 25_000, currency: 'USD' } } }).success).toBe(false);
  });
});
