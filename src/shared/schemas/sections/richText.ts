import { z } from 'zod';
import { SafeUrlSchema } from './common';
const InlineSchema = z
  .object({
    text: z.string().max(2000),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    link: SafeUrlSchema.optional(),
  })
  .strict();
const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), children: z.array(InlineSchema).max(100) }).strict(),
  z
    .object({
      type: z.literal('heading'),
      level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      children: z.array(InlineSchema).max(30),
    })
    .strict(),
  z.object({ type: z.literal('bulletList'), children: z.array(InlineSchema).max(60) }).strict(),
  z.object({ type: z.literal('orderedList'), children: z.array(InlineSchema).max(60) }).strict(),
  z.object({ type: z.literal('quote'), children: z.array(InlineSchema).max(60) }).strict(),
]);
export const RichTextSchema = z.array(BlockSchema).max(100);
export const BilingualRichTextSchema = z
  .object({
    ar: RichTextSchema,
    en: z.unknown().optional().transform((): z.infer<typeof RichTextSchema> => []),
  })
  .strict();
export const RichTextBlockSchema = BlockSchema;
export const RichTextInlineSchema = InlineSchema;
export const hasRichText = (value: z.infer<typeof BilingualRichTextSchema> | undefined): boolean =>
  Boolean(value?.ar.some((block) => block.children.some((child) => child.text.trim())));

export type BilingualRichText = z.infer<typeof BilingualRichTextSchema>;
