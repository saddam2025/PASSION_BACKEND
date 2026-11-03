import { z } from 'zod';
import { BilingualTextSchema, IconNameSchema, ImageRefSchema, CtaLinkSchema, createSectionSchema, type IconName } from './common';

const defaultSteps: Array<{ icon: IconName; title: { ar: string; en: string }; text: { ar: string; en: string } }> = [
  { icon: 'BookOpen', title: { ar: 'سجّل بياناتك', en: '' }, text: { ar: 'اكتب بياناتك في نموذج التسجيل.', en: '' } },
  { icon: 'Users', title: { ar: 'هنتواصل معاك', en: '' }, text: { ar: 'مساعد الأكاديمية هيراجع طلبك ويتواصل معاك.', en: '' } },
  { icon: 'CheckCircle2', title: { ar: 'نسّق الدفع', en: '' }, text: { ar: 'رتّب تفاصيل الدفع مع مساعد الأكاديمية.', en: '' } },
  { icon: 'Award', title: { ar: 'ابدأ الكورس', en: '' }, text: { ar: 'هتوصلك تفاصيل البداية بعد تأكيد مكانك.', en: '' } },
];
export const StepsContentSchema = z.object({
  title: BilingualTextSchema.default({ ar: 'إزاي تشترك؟', en: '' }),
  items: z.array(z.object({
    image: ImageRefSchema.optional(), icon: IconNameSchema.optional(),
    title: BilingualTextSchema.default({ ar: '', en: '' }), text: BilingualTextSchema.default({ ar: '', en: '' }),
  }).strict().superRefine((item, ctx) => {
    if (!item.image && !item.icon) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose an image or icon.', path: ['icon'] });
  })).default(defaultSteps),
  cta: CtaLinkSchema.optional(),
}).strict().default({ title: { ar: 'إزاي تشترك؟', en: '' }, items: defaultSteps });
export const StepsSectionSchema = createSectionSchema('steps', StepsContentSchema);
