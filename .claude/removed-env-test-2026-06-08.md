# env.test.ts — REMOVED 2026-06-08

This test was deleted because:

1. It imported from `../src/lib/env` — that path does not exist.
   The actual env module is at `lib/env.ts` (no `src/` prefix).

2. It imported `envSchema` — that export does not exist in `lib/env.ts`.
   The env module uses a Proxy pattern, not a Zod schema.

3. It would always fail with `Cannot find module '../src/lib/env'`
   and was causing the CI run to report failure on every commit.

## What replaced it

The env module (`lib/env.ts`) is validated indirectly through:
- `__tests__/api.integration.test.ts` — stubs env vars correctly
- `__tests__/schemas.test.ts` — validates input parsing
- CI workflow env stubs — confirm the Proxy throws correctly when vars are missing

## If you want a real env test in future

Add it to `__tests__/env.test.ts` with correct imports:

```ts
import { env } from '../lib/env';

it('throws when GROQ_API_KEY is missing', () => {
  const original = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  expect(() => env.GROQ_API_KEY).toThrow(/Missing required env var/);
  process.env.GROQ_API_KEY = original;
});
```
