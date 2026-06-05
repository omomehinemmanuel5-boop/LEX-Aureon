#!/usr/bin/env node

import './.sourcemap-register'
import { env } from '../src/lib/env'

function redact(value: string | undefined) {
  if (!value) return undefined
  if (value.length <= 8) return '********'
  return value.slice(0, 4) + '...' + value.slice(-4)
}

console.log('Validating environment variables...')
try {
  // Log only non-sensitive values; redact secrets
  const safe = {
    NODE_ENV: env.NODE_ENV,
    GROQ_API_KEY: redact(process.env.GROQ_API_KEY),
    JINA_API_KEY: redact(process.env.JINA_API_KEY),
    TURSO_DATABASE_URL: redact(process.env.TURSO_DATABASE_URL),
    TURSO_AUTH_TOKEN: redact(process.env.TURSO_AUTH_TOKEN),
    NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
  }
  console.log('Environment OK:', JSON.stringify(safe, null, 2))
  process.exit(0)
} catch (err) {
  console.error('Environment validation failed:')
  if (err && typeof err === 'object' && 'errors' in err) {
    // ZodError
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e: any = err
    for (const issue of e.errors ?? []) {
      console.error(`- ${issue.path.join('.')} : ${issue.message}`)
    }
  } else {
    console.error(err)
  }
  process.exit(2)
}
