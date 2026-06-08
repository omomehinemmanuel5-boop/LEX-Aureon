import { z } from 'zod'

// Environment schema for runtime validation using Zod
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // Required keys (app refuses to start without these in production)
  GROQ_API_KEY: z.string().min(1, { message: 'GROQ_API_KEY is required' }),
  JINA_API_KEY: z.string().min(1, { message: 'JINA_API_KEY is required' }),
  TURSO_DATABASE_URL: z
    .string()
    .min(1, { message: 'TURSO_DATABASE_URL is required' })
    .refine((s) => s.startsWith('libsql://'), {
      message: 'TURSO_DATABASE_URL must start with libsql://',
    }),
  TURSO_AUTH_TOKEN: z.string().min(1, { message: 'TURSO_AUTH_TOKEN is required' }),
  ADMIN_PASSWORD: z.string().min(8, { message: 'ADMIN_PASSWORD must be at least 8 chars' }),
  CRON_SECRET: z.string().min(8, { message: 'CRON_SECRET must be at least 8 chars' }),

  // Optional values (can be tightened later)
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  LOG_DRAIN_URL: z.string().url().optional(),
  LOG_DRAIN_TOKEN: z.string().optional(),
  NEXT_PUBLIC_PRO_CHECKOUT_URL: z.string().url().optional(),
  Claude_api_key: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

// Parse and export validated environment. This will throw on invalid config.
export const env: Env = envSchema.parse(process.env as Record<string, unknown>)
