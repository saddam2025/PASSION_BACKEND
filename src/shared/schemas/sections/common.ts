import { z } from 'zod';

export const BilingualTextSchema = z
  .object({ ar: z.string().trim().max(6000), en: z.unknown().optional().transform(() => '') })
  .strict();
export const SafeUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value || value.includes('\\') || value.startsWith('//')) return false;
    if (value.startsWith('/')) return true;
    try {
      const url = new URL(value);
      return (
        ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) &&
        (url.protocol !== 'https:' || url.hostname.length > 0)
      );
    } catch {
      return /^https?:\/\/wa\.me\//i.test(value);
    }
  }, 'Invalid URL');
export const IconNameSchema = z.enum(['Award', 'BookOpen', 'CheckCircle2', 'Compass', 'Users']);
export const MediaKeySchema = z
  .string()
  .max(240)
  .refine((value) => {
    if (value.includes('\\') || value.includes('..') || value.includes('?') || value.includes('#'))
      return false;
    if (/^\/images\/[A-Za-z0-9/_-]+\.(?:avif|jpe?g|png|webp)$/i.test(value)) return true;
    return /^media\/\d{4}\/(?:0[1-9]|1[0-2])\/[A-Za-z0-9_-]{16,80}\.(?:avif|jpe?g|png|webp)$/i.test(
      value,
    );
  }, 'Image source must be a same-origin /images path or a relative media key.');
export const ImageRefSchema = z
  .object({
    assetId: z.string().min(1).max(100).optional(),
    src: MediaKeySchema,
    alt: BilingualTextSchema,
    decorative: z.boolean().default(false),
  })
  .strict()
  .superRefine((image, ctx) => {
    if (!image.decorative && !image.alt.ar.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide Arabic alt text or mark the image decorative.',
        path: ['alt'],
      });
    }
  });
export const CtaDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), href: SafeUrlSchema }).strict(),
  z
    .object({ kind: z.literal('action'), action: z.enum(['scrollToRegister', 'whatsapp', 'call']) })
    .strict(),
]);
export const CtaLinkSchema = z
  .object({ label: BilingualTextSchema, destination: CtaDestinationSchema })
  .strict();
export const ExpandableDetailSchema = z.object({
  icon: IconNameSchema.optional(),
  title: BilingualTextSchema,
  text: BilingualTextSchema.optional(),
}).strict();
export const ExpandableDetailsModeSchema = z.enum(['inline', 'modal']).default('inline');
export const SectionSettingsSchema = z
  .object({
    background: z.enum(['none', 'subtle', 'brand', 'dark', 'softGradient']).default('none'),
    spacing: z.enum(['sm', 'md', 'lg', 'xl']).default('lg'),
    width: z.enum(['contained', 'wide', 'full']).default('contained'),
    reveal: z.enum(['none', 'fadeUp']).default('none'),
  })
  .strict();
export const SectionHeadingSchema = z.object({
  eyebrow: BilingualTextSchema.optional(),
  title: BilingualTextSchema.optional(),
  titleAccent: BilingualTextSchema.optional(),
  subtitle: BilingualTextSchema.optional(),
  highlight: z.enum(['none', 'underline']).default('none'),
}).strict();
export const createSectionSchema = <const T extends string, C extends z.ZodTypeAny>(
  type: T,
  content: C,
) =>
  z
    .object({
      id: z.string().uuid(),
      type: z.literal(type),
      visible: z.boolean().default(true),
      settings: SectionSettingsSchema.default({
        background: 'none',
        spacing: 'lg',
        width: 'contained',
        reveal: 'none',
      }),
      heading: SectionHeadingSchema.optional(),
      content,
    })
    .strict();
export type BilingualText = z.infer<typeof BilingualTextSchema>;
export type ImageRef = z.infer<typeof ImageRefSchema>;
export type CtaLink = z.infer<typeof CtaLinkSchema>;
export type SectionSettings = z.infer<typeof SectionSettingsSchema>;

export type IconName = z.infer<typeof IconNameSchema>;
