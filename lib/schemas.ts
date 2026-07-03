import { z } from 'zod';

// Zod v4 compatible — error messages use object form { message: '...' }
// z.string().min(1, 'msg') still works in v4 but object form is safer across versions.

// Single source of truth for the prompt-length cap (imported by both the API
// route and the console/chat UI so they never drift).
//
// Raised 5000 → 50000 (2026-07): 5000 chars (~800 words) was far too small for
// real chat/console use — pasting a document or a long question hit the wall.
// 50000 chars (~8–10k words) is effectively unlimited for interactive use.
// It is deliberately NOT unbounded: an arbitrarily large prompt means unbounded
// generation cost, request timeouts, and context-limit errors on the fallback
// models. Two honest notes at this size: (1) the primary generator (Gemini-lite,
// ~1M-token context) handles it fine, but very long prompts may exceed the
// smaller Groq fallback context; (2) the embedding model truncates its input to
// its own token limit, so semantic memory / self-referential detection keys off
// the leading portion of very long prompts.
export const MAX_PROMPT_CHARS = 50000;

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
