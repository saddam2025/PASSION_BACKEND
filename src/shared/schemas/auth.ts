import { z } from 'zod';

const commonPasswords = new Set(['password123!', 'password1234', 'qwerty1234!', 'welcome123!']);

export const passwordRules = {
  minLength: (value: string) => value.length >= 10,
  lowercase: (value: string) => /[a-z]/.test(value),
  uppercase: (value: string) => /[A-Z]/.test(value),
  digit: (value: string) => /\d/.test(value),
  symbol: (value: string) => /[^A-Za-z0-9\s]/.test(value),
  noEdgeSpaces: (value: string) => value === value.trim(),
  notCommon: (value: string) => !commonPasswords.has(value.toLowerCase()),
} as const;

export const passwordSchema = z.string().superRefine((value, context) => {
  if (!passwordRules.minLength(value))
    context.addIssue({ code: 'custom', message: 'passwordTooShort' });
  if (!passwordRules.lowercase(value))
    context.addIssue({ code: 'custom', message: 'passwordNeedsLowercase' });
  if (!passwordRules.uppercase(value))
    context.addIssue({ code: 'custom', message: 'passwordNeedsUppercase' });
  if (!passwordRules.digit(value))
    context.addIssue({ code: 'custom', message: 'passwordNeedsDigit' });
  if (!passwordRules.symbol(value))
    context.addIssue({ code: 'custom', message: 'passwordNeedsSymbol' });
  if (!passwordRules.noEdgeSpaces(value))
    context.addIssue({ code: 'custom', message: 'passwordNoEdgeSpaces' });
  if (!passwordRules.notCommon(value))
    context.addIssue({ code: 'custom', message: 'passwordTooCommon' });
});
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
