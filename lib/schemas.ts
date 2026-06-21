import { z } from 'zod';

// Zod v4 compatible — error messages use object form { message: '...' }
// z.string().min(1, 'msg') still works in v4 but object form is safer across versions.

// Single source of truth for the prompt-length cap. Previously this file
// allowed 8000 chars while app/api/lex/govern/route.ts independently
// hardcoded a 5000-char rejection — two different limits for the same
// field, drifting silently. 5000 is the one actually enforced in
// production (and the one every receipt to date was written under), so
// that's the canonical value; route.ts now imports this instead of
// hardcoding its own copy.
export const MAX_PROMPT_CHARS = 5000;

export const RunRequestSchema = z.object({
  prompt:       z.string().min(1, { message: 'prompt required' }).max(MAX_PROMPT_CHARS, { message: 'prompt too long' }),
  session_id:   z.string().min(1, { message: 'session_id required' }).max(128),
  jurisdiction: z.string().max(32).optional().default('global'),
  domain:       z.string().max(32).optional().default('general'),
  format:       z.enum(['api', 'web', 'pdf', 'terminal']).optional().default('api'),
  turn:         z.number().int().nonnegative().optional(),
  crs: z.object({
    c: z.number().min(0).max(1),
    r: z.number().min(0).max(1),
    s: z.number().min(0).max(1),
  }).optional(),
  model: z.string().max(64).optional(),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

export function parseRunRequest(input: unknown):
  | { ok: true;  data: RunRequest }
  | { ok: false; error: string } {
  const r = RunRequestSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  // Zod v3: r.error.errors[0] or r.error.issues[0] — both work
  // Zod v4: r.error.issues[0] is canonical
  const issues = r.error?.issues ?? (r.error as { errors?: { path: (string|number)[]; message: string }[] })?.errors ?? [];
  const first  = issues[0];
  const path   = first?.path?.length ? first.path.join('.') + ': ' : '';
  return { ok: false, error: `${path}${first?.message ?? 'invalid request'}` };
}
