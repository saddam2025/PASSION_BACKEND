import { z } from 'zod';
import { HeroSectionSchema } from './hero';
import { ImageTextSectionSchema } from './imageText';
import { TextSectionSchema } from './text';
import { InstructorSectionSchema } from './instructor';
import { FeatureCardsSectionSchema } from './featureCards';
import { CurriculumSectionSchema } from './curriculum';
import { PricingCtaSectionSchema } from './pricingCta';
import { FaqSectionSchema } from './faq';
import { ContactWhatsAppSectionSchema } from './contactWhatsApp';
import { RegistrationFormSectionSchema } from './registrationForm';
import { StepsSectionSchema, StepsContentSchema } from './steps';
import { BannerSectionSchema } from './banner';
import type { BilingualText, IconName, SectionHeadingSchema } from './common';
import { hasRichText } from './richText';
import type { BilingualRichText } from './richText';

export type { IconName, BilingualText, ImageRef, CtaLink, SectionSettings } from './common';
export type { BilingualRichText } from './richText';
export {
  SectionSettingsSchema,
  BilingualTextSchema,
  SafeUrlSchema,
  MediaKeySchema,
  IconNameSchema,
  ImageRefSchema,
  CtaLinkSchema,
  SectionHeadingSchema,
} from './common';
export type SectionHeading = z.infer<typeof SectionHeadingSchema>;
export {
  BilingualRichTextSchema,
  RichTextSchema,
  RichTextBlockSchema,
  RichTextInlineSchema,
} from './richText';
export const SectionSchema = z.discriminatedUnion('type', [
  HeroSectionSchema,
  ImageTextSectionSchema,
  TextSectionSchema,
  InstructorSectionSchema,
  FeatureCardsSectionSchema,
  CurriculumSectionSchema,
  PricingCtaSectionSchema,
  FaqSectionSchema,
  ContactWhatsAppSectionSchema,
  RegistrationFormSectionSchema,
  StepsSectionSchema,
  BannerSectionSchema,
]);
export const PageConfigSchema = z
  .object({ schemaVersion: z.literal(1), sections: z.array(SectionSchema).max(100) })
  .strict();
export type Section =
  | z.infer<typeof HeroSectionSchema>
  | z.infer<typeof ImageTextSectionSchema>
  | z.infer<typeof TextSectionSchema>
  | z.infer<typeof InstructorSectionSchema>
  | z.infer<typeof FeatureCardsSectionSchema>
  | z.infer<typeof CurriculumSectionSchema>
  | z.infer<typeof PricingCtaSectionSchema>
  | z.infer<typeof FaqSectionSchema>
  | z.infer<typeof ContactWhatsAppSectionSchema>
  | z.infer<typeof RegistrationFormSectionSchema>
  | z.infer<typeof StepsSectionSchema>
  | z.infer<typeof BannerSectionSchema>;
export type SectionType = Section['type'];
export type PageConfig = { schemaVersion: 1; sections: Section[] };
export type ValidationIssue = { path: string; message: string };
export type ValidationResult<T> =
  | { success: true; data: T; errors: [] }
  | { success: false; errors: ValidationIssue[] };
export type CoursePriceContext = {
  price?: number | null;
  promoPrice?: number | null;
  contactUs?: boolean;
  instructor?: { name?: BilingualText; bio?: BilingualRichText };
  registrationOpen?: boolean;
  settings?: { whatsappNumber?: string; phone?: string; email?: string };
};
const filled = (value: BilingualText | undefined) => Boolean(value?.ar.trim());
export function isSectionEmpty(section: Section, context?: CoursePriceContext): boolean {
  switch (section.type) {
    case 'hero':
      return !filled(section.content.title);
    case 'imageText':
      return !filled(section.content.title) || (!hasRichText(section.content.richText) && section.content.checklist.length === 0);
    case 'text':
      return (
        !hasRichText(section.content.richText) &&
        !filled(section.content.title) &&
        !filled(section.content.subtitle)
      );
    case 'instructor':
      return !((filled(context?.instructor?.name) && hasRichText(context?.instructor?.bio)) || (filled(section.content.name) && hasRichText(section.content.bio)));
    case 'featureCards':
      return !section.content.items.some((item) =>
        filled(item.title) || filled(item.text) || Boolean(item.image?.src) ||
        item.details.some((detail) => filled(detail.title) || filled(detail.text)),
      );
    case 'curriculum':
      return !section.content.modules.some((module) =>
        filled(module.title) || filled(module.summary) || filled(module.duration) ||
        module.lessons.some((lesson) => filled(lesson.title)),
      );
    case 'pricingCta':
      return (
        !filled(section.content.overrideLabel) &&
        !(section.content.useCoursePrice && (context?.contactUs || context?.promoPrice != null || context?.price != null))
      );
    case 'faq':
      return !section.content.items.some((item) => filled(item.question) || hasRichText(item.answer));
    case 'contactWhatsApp':
      return (
        !filled(section.content.title) ||
        !(
          (section.content.show.whatsapp && context?.settings?.whatsappNumber) ||
          (section.content.show.phone && context?.settings?.phone) ||
          (section.content.show.email && context?.settings?.email)
        )
      );
    case 'registrationForm':
      return !filled(section.content.title);
    case 'steps':
      return !section.content.items.some((item) => filled(item.title) || filled(item.text) || Boolean(item.image?.src));
    case 'banner':
      return !filled(section.content.overlayTitle) && !filled(section.content.overlayText) && !filled(section.content.cta?.label);
  }
  return false;
}
function issues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}
export function validateSection(value: unknown): ValidationResult<Section> {
  const result = SectionSchema.safeParse(value);
  return result.success
    ? { success: true, data: result.data as Section, errors: [] }
    : { success: false, errors: issues(result.error) };
}
export function validatePage(value: unknown): ValidationResult<PageConfig> {
  const result = PageConfigSchema.safeParse(value);
  return result.success
    ? { success: true, data: result.data as PageConfig, errors: [] }
    : { success: false, errors: issues(result.error) };
}
export interface SectionRegistryMeta {
  labelKey: string;
  icon: IconName;
  defaultContent: () => Record<string, unknown>;
  layoutPresets: readonly string[];
}
const emptyText = (): BilingualText => ({ ar: '', en: '' });
const rich = () => ({ ar: [], en: [] });
export const SECTION_REGISTRY_META = {
  hero: {
    labelKey: 'hero',
    icon: 'Award',
    defaultContent: () => ({
      eyebrow: emptyText(),
      title: emptyText(),
      subtitle: emptyText(),
      layout: 'splitStart',
    }),
    layoutPresets: ['splitStart', 'splitEnd', 'centered', 'imageBackground'],
  },
  imageText: {
    labelKey: 'imageText',
    icon: 'BookOpen',
    defaultContent: () => ({
      image: {
        src: '/images/course-cover-default.webp',
        alt: { ar: '', en: '' },
        decorative: true,
      },
      title: emptyText(),
      richText: rich(),
      layout: 'imageStart',
      imageRatio: 'landscape',
    }),
    layoutPresets: ['imageStart', 'imageEnd', 'imageTop'],
  },
  text: {
    labelKey: 'text',
    icon: 'BookOpen',
    defaultContent: () => ({
      title: emptyText(),
      subtitle: emptyText(),
      richText: rich(),
      layout: 'single',
    }),
    layoutPresets: ['single', 'twoColumns'],
  },
  instructor: {
    labelKey: 'instructor',
    icon: 'Users',
    defaultContent: () => ({
      name: emptyText(),
      title: emptyText(),
      bio: rich(),
      credentials: [],
      layout: 'photoStart',
    }),
    layoutPresets: ['photoStart', 'photoEnd'],
  },
  featureCards: {
    labelKey: 'featureCards',
    icon: 'Compass',
    defaultContent: () => ({ title: emptyText(), subtitle: emptyText(), items: [], columns: 3 }),
    layoutPresets: ['grid2', 'grid3', 'bento'],
  },
  curriculum: {
    labelKey: 'curriculum',
    icon: 'BookOpen',
    defaultContent: () => ({ title: emptyText(), modules: [], layout: 'accordion' }),
    layoutPresets: ['accordion', 'timeline', 'numberedCards'],
  },
  pricingCta: {
    labelKey: 'pricingCta',
    icon: 'Award',
    defaultContent: () => ({
      title: emptyText(),
      note: rich(),
      bullets: [],
      useCoursePrice: true,
      layout: 'card',
    }),
    layoutPresets: ['card', 'inline'],
  },
  faq: {
    labelKey: 'faq',
    icon: 'CheckCircle2',
    defaultContent: () => ({ title: emptyText(), items: [], layout: 'accordion' }),
    layoutPresets: ['accordion'],
  },
  contactWhatsApp: {
    labelKey: 'contactWhatsApp',
    icon: 'Users',
    defaultContent: () => ({
      title: emptyText(),
      text: rich(),
      show: { whatsapp: true, phone: false, email: false },
      prefilledMessage: emptyText(),
      layout: 'card',
    }),
    layoutPresets: ['card', 'inline'],
  },
  registrationForm: {
    labelKey: 'registrationForm',
    icon: 'BookOpen',
    defaultContent: () => ({
      title: emptyText(),
      subtitle: emptyText(),
      successNote: emptyText(),
      layout: 'card',
    }),
    layoutPresets: ['card'],
  },
  steps: {
    labelKey: 'steps', icon: 'Compass',
    defaultContent: () => StepsContentSchema.parse({}),
    layoutPresets: ['horizontal', 'vertical'],
  },
  banner: {
    labelKey: 'banner', icon: 'Award',
    defaultContent: () => ({ image: { src: '/images/course-cover-default.webp', alt: emptyText(), decorative: true }, ratio: 'wide', overlayTitle: emptyText(), overlayText: emptyText() }),
    layoutPresets: ['wide', 'cinema', 'standard'],
  },
} satisfies Record<SectionType, SectionRegistryMeta>;
