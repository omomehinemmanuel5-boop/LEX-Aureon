import { z } from 'zod';

export const RunRequestSchema = z.object({
  prompt: z.string().min(1, 'prompt required').max(8000, 'prompt too long'),
  session_id: z.string().min(1, 'session_id required').max(128),
  turn: z.number().int().nonnegative().optional(),
  crs: z
    .object({
      c: z.number().min(0).max(1),
      r: z.number().min(0).max(1),
      s: z.number().min(0).max(1),
    })
    .optional(),
  model: z.string().max(64).optional(),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

export function parseRunRequest(input: unknown):
  | { ok: true; data: RunRequest }
  | { ok: false; error: string } {
  const r = RunRequestSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0];
  const path = first?.path?.length ? first.path.join('.') + ': ' : '';
  return { ok: false, error: `${path}${first?.message ?? 'invalid request'}` };
}
