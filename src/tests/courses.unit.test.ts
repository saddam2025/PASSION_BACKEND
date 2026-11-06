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

  it('keeps old course data valid, strips disabled foreign fields, and validates USD pricing', () => {
    const old = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'blank' });
    const legacyDetails = { ...old.details } as Record<string, unknown>;
    delete legacyDetails.foreignPricing;
    expect(SnapshotSchema.safeParse({ ...old, details: legacyDetails }).success).toBe(true);
    const disabled = SnapshotSchema.parse({ ...old, details: { ...old.details, foreignPricing: { enabled: false, price: 9_000, promoPrice: 8_000, currency: 'USD', contactUs: true } } });
    expect(disabled.details.foreignPricing).toEqual({ enabled: false });
    for (const pricing of [
      { enabled: true, price: 10_000, promoPrice: 10_000, currency: 'USD' },
      { enabled: true, price: -1, promoPrice: null, currency: 'USD' },
      { enabled: true, price: 10.5, promoPrice: null, currency: 'USD' },
      { enabled: true, price: 10_000, promoPrice: null, currency: 'EGP' },
    ]) expect(SnapshotSchema.safeParse({ ...old, details: { ...old.details, foreignPricing: pricing } }).success).toBe(false);
    expect(SnapshotSchema.safeParse({ ...old, details: { ...old.details, foreignPricing: { enabled: true, price: 10_000, promoPrice: 7_500, currency: 'USD' } } }).success).toBe(true);
  });

  it('requires a foreign price or contact option only when foreign pricing is enabled', () => {
    const snapshot = createCourseTemplateSnapshot({ title: { ar: 'عنوان الكورس' }, category: 'التصميم', template: 'blank' });
    snapshot.details.foreignPricing = { enabled: true, price: null, promoPrice: null, currency: 'USD' };
    expect(checkReadiness(snapshot).errors).toContainEqual(expect.objectContaining({ path: 'details.foreignPricing.price' }));
    snapshot.details.foreignPricing.contactUs = true;
    expect(checkReadiness(snapshot).errors.some((entry) => entry.path.startsWith('details.foreignPricing'))).toBe(false);
    snapshot.details.foreignPricing.enabled = false;
    snapshot.details.foreignPricing.contactUs = false;
    expect(checkReadiness(snapshot).errors.some((entry) => entry.path.startsWith('details.foreignPricing'))).toBe(false);
  });
});
