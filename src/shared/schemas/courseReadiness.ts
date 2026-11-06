import { FormDefinitionSchema, type FormDefinition } from './registrationForm';
import { isSectionEmpty, validateSection, type PageConfig, type Section } from './sections/index.js';
import type { CourseDetails, CourseSeo, Snapshot } from './course';

export interface ReadinessIssue {
  path: string;
  message: string;
  sectionId?: string;
  tab: 'page' | 'details' | 'form' | 'seo';
  value?: unknown;
}

export type CourseSnapshot = Snapshot | {
  details: CourseDetails;
  pageConfig?: PageConfig;
  page?: PageConfig;
  form?: FormDefinition;
  seo?: CourseSeo;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkReadiness(snapshot: CourseSnapshot, slug?: string): {
  errors: ReadinessIssue[];
  warnings: ReadinessIssue[];
} {
  const details = snapshot.details;
  const page = snapshot.page ?? ('pageConfig' in snapshot ? snapshot.pageConfig : undefined);
  const errors: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];
  const issue = (tab: ReadinessIssue['tab'], path: string, message: string, value: unknown, sectionId?: string) =>
    errors.push({ tab, path, message, value, ...(sectionId ? { sectionId } : {}) });

  if (!details.title.ar?.trim()) issue('details', 'details.title.ar', 'اكتب عنوان الكورس بالعربي.', details.title.ar);
  if (!details.shortDescription.ar?.trim()) issue('details', 'details.shortDescription.ar', 'اكتب وصف مختصر للكورس بالعربي.', details.shortDescription.ar);
  if (!details.category?.trim()) issue('details', 'details.category', 'اختار تصنيف للكورس.', details.category);
  const checkedSlug = slug ?? details.slug;
  if (checkedSlug !== undefined && (!slugPattern.test(checkedSlug) || checkedSlug.length < 3 || checkedSlug.length > 80)) issue('details', 'slug', 'اكتب رابط مختصر صالح للكورس.', checkedSlug);
  if (!details.coverImage?.src?.trim()) issue('details', 'details.coverImage.src', 'اختار صورة غلاف للكورس.', details.coverImage?.src);

  const price = details.pricing.price;
  if (price === null && details.pricing.contactUs !== true) {
    issue('details', 'details.pricing.price', 'السعر مطلوب — اكتب السعر أو اختار تواصل لمعرفة السعر.', price);
  } else if (price !== null && price < 0) {
    issue('details', 'details.pricing.price', 'السعر لازم يكون صفر أو أكتر.', price);
  }
  const promo = details.pricing.promo ?? details.pricing.promoPrice;
  if (price !== null && promo != null && promo >= price) {
    issue('details', 'details.pricing.promo', 'سعر الخصم لازم يكون أقل من السعر الأساسي.', promo);
  }
  const foreign = details.foreignPricing as { enabled: boolean; price?: number | null; promoPrice?: number | null; contactUs?: boolean };
  if (foreign?.enabled) {
    if (foreign.price == null && foreign.contactUs !== true) {
      issue('details', 'details.foreignPricing.price', 'السعر بالدولار مطلوب — اكتب السعر أو اختار تواصل لمعرفة السعر.', foreign.price);
    }
    if (foreign.price != null && foreign.promoPrice != null && foreign.promoPrice >= foreign.price) {
      issue('details', 'details.foreignPricing.promoPrice', 'سعر العرض لازم يكون أقل من السعر الأساسي.', foreign.promoPrice);
    }
  }

  const visible = (page?.sections ?? []).filter((section: Section) => section.visible);
  const filled = visible.filter((section) => !isSectionEmpty(section, { price, promoPrice: promo ?? null, contactUs: details.pricing.contactUs === true, instructor: details.instructor as never }));
  if (!filled.length) {
    if (!visible.length) issue('page', 'page.sections', 'أضف قسم ظاهر واكتب محتواه.', []);
    else visible.forEach((section) => {
      const field = section.type === 'instructor'
        ? 'name.ar'
        : section.type === 'banner'
          ? 'overlayTitle.ar'
          : section.type === 'featureCards'
            ? section.content.items.length ? 'items.0.title.ar' : 'items'
            : section.type === 'curriculum'
              ? section.content.modules.length ? 'modules.0.title.ar' : 'modules'
              : section.type === 'faq'
                ? section.content.items.length ? 'items.0.question.ar' : 'items'
                : section.type === 'steps'
                  ? section.content.items.length ? 'items.0.title.ar' : 'items'
                  : 'title.ar';
      issue('page', `page.sections.${section.id}.content.${field}`, 'اكتب محتوى في القسم عشان يظهر للزوار.', section.content, section.id);
    });
  }
  for (const section of visible) {
    const result = validateSection(section);
    if (!result.success) {
      result.errors.forEach((entry) => {
        const message = entry.path.includes('alt')
          ? 'اكتب وصف الصورة بالعربي أو اختار إنها للزينة.'
          : entry.path.includes('options')
            ? 'أضف اختيار واحد على الأقل.'
            : entry.path.includes('title')
              ? 'اكتب عنوان القسم بالعربي.'
              : 'راجع القيمة واكتب بيانات صحيحة.';
        issue('page', `page.sections.${section.id}.${entry.path}`, message, entry.path, section.id);
      });
    }
  }

  const form = 'form' in snapshot ? snapshot.form : details.registrationForm;
  const formResult = FormDefinitionSchema.safeParse(form ?? { fields: [] });
  if (!formResult.success) {
    formResult.error.issues.forEach((entry) => issue('form', `form.${entry.path.join('.')}`, 'راجع إعدادات نموذج التسجيل.', entry.message));
  }

  const seo = snapshot.seo ?? details.seo;
  if (!seo?.description?.ar?.trim()) {
    warnings.push({ tab: 'seo', path: 'seo.description.ar', message: 'ضيف وصف بالعربي عشان الكورس يظهر بشكل أوضح في البحث.' });
  }
  if (!details.instructor.name.ar?.trim()) {
    warnings.push({ tab: 'details', path: 'details.instructor.name.ar', message: 'ضيف اسم المدرب بالعربي.' });
  }

  return { errors, warnings };
}
