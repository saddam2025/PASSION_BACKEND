import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const mongoConnectionString = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return ['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}, 'Must be a valid mongodb:// or mongodb+srv:// connection string');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65_535),
  MONGODB_URI: mongoConnectionString,
  ACCESS_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  COOKIE_DOMAIN: z.string().min(1),
  COOKIE_SECURE: booleanFromString,
  COOKIE_SAME_SITE: z.enum(['lax', 'strict']).default('lax'),
  CORS_ORIGINS: z.string().min(1).transform((value) =>
    value.split(',').map((origin) => origin.trim()).filter(Boolean),
  ).pipe(z.array(z.string().url()).min(1)),
  APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BUCKET: z.string().optional(),
  R2_PRIVATE_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  RECEIPT_SIGNED_URL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  EMAIL_FROM: z.string().optional(),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(1).optional(),
  SEED_ADMIN_NAME: z.string().trim().min(1).max(160).optional(),
}).superRefine((value, context) => {
  if (value.ACCESS_TOKEN_SECRET === value.REFRESH_TOKEN_SECRET) {
    context.addIssue({ code: 'custom', path: ['REFRESH_TOKEN_SECRET'], message: 'Must differ from ACCESS_TOKEN_SECRET' });
  }
  if (value.NODE_ENV === 'production' && !value.COOKIE_SECURE) {
    context.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Must be true in production' });
  }
  const r2Values = [value.R2_ACCOUNT_ID, value.R2_ACCESS_KEY_ID, value.R2_SECRET_ACCESS_KEY, value.R2_PUBLIC_BUCKET, value.R2_PRIVATE_BUCKET, value.R2_PUBLIC_BASE_URL];
  const configured = r2Values.filter(Boolean).length;
  if (configured !== 0 && configured !== r2Values.length) {
    for (const [index, key] of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BUCKET', 'R2_PRIVATE_BUCKET', 'R2_PUBLIC_BASE_URL'].entries()) {
      if (!r2Values[index]) context.addIssue({ code: 'custom', path: [key], message: 'Required when R2 storage is configured' });
    }
  }
  if (value.NODE_ENV === 'production' && configured !== r2Values.length) context.addIssue({ code: 'custom', path: ['R2_ACCOUNT_ID'], message: 'All R2 variables are required in production' });
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => {
      const variable = issue.path.join('.') || 'environment';
      return `  - ${variable}: ${issue.message}`;
    });
    throw new Error(`Invalid environment configuration:\n${reasons.join('\n')}`);
  }
  return parsed.data;
}
