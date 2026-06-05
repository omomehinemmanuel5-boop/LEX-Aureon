import { describe, it, expect } from 'vitest'
import { envSchema } from '../src/lib/env'
import { z } from 'zod'

describe('env schema', () => {
  it('parses valid environment', () => {
    const input = {
      NODE_ENV: 'development',
      GROQ_API_KEY: 'grok-key',
      JINA_API_KEY: 'jina-key',
      TURSO_DATABASE_URL: 'libsql://example.turso.io',
      TURSO_AUTH_TOKEN: 'token1234',
      ADMIN_PASSWORD: 'password123',
      CRON_SECRET: 'secret1234',
    }

    const parsed = envSchema.parse(input)
    expect(parsed.GROQ_API_KEY).toBe('grok-key')
    expect(parsed.TURSO_DATABASE_URL).toBe('libsql://example.turso.io')
  })

  it('rejects missing required variables', () => {
    const input = {
      NODE_ENV: 'development',
      // GROQ_API_KEY missing
      JINA_API_KEY: 'jina-key',
      TURSO_DATABASE_URL: 'libsql://example.turso.io',
      TURSO_AUTH_TOKEN: 'token1234',
      ADMIN_PASSWORD: 'password123',
      CRON_SECRET: 'secret1234',
    }

    expect(() => envSchema.parse(input)).toThrow()
  })

  it('rejects invalid TURSO_DATABASE_URL', () => {
    const input = {
      NODE_ENV: 'development',
      GROQ_API_KEY: 'grok-key',
      JINA_API_KEY: 'jina-key',
      TURSO_DATABASE_URL: 'postgres://invalid',
      TURSO_AUTH_TOKEN: 'token1234',
      ADMIN_PASSWORD: 'password123',
      CRON_SECRET: 'secret1234',
    }

    expect(() => envSchema.parse(input)).toThrow()
  })
})
