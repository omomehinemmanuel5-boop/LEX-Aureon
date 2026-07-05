/**
 * lib/bench_auth.ts
 *
 * Pure, testable auth check for the BENCH_SECRET-gated benchmark publish
 * endpoint (app/api/benchmarks/publish/route.ts). Extracted from the route
 * so the exact whitespace-handling behavior can be unit-tested directly
 * (see __tests__/bench_auth.test.ts) instead of only being provable by
 * hitting the live deployed endpoint.
 *
 * FIX (2026-07-04): the original inline check trimmed the CLIENT-provided
 * header value but compared it against the STORED secret completely
 * untrimmed. If the secret in Vercel picked up so much as a trailing newline
 * (easy on mobile copy-paste, invisible since Vercel masks the value), every
 * publish attempt would 401 regardless of how carefully the caller's secret
 * was re-entered — the mismatch was on the server's side. Both sides are now
 * trimmed symmetrically before comparison.
 */

export interface BenchAuthResult {
  ok: boolean;
  // Diagnostic only — NEVER includes the actual secret value, only lengths
  // and whitespace shape, safe to log.
  reason?: string;
}

export function checkBenchAuth(
  authorizationHeader: string | null | undefined,
  xBenchSecretHeader: string | null | undefined,
  rawSecret: string,
): BenchAuthResult {
  const secret = rawSecret.trim();

  const authHeader = authorizationHeader ?? '';
  const rawBearer  = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
  const bearer     = rawBearer.trim();

  const rawHeader = xBenchSecretHeader ?? '';
  const header    = rawHeader.trim();

  if (bearer.length > 0 && bearer === secret) return { ok: true };
  if (header.length > 0 && header === secret) return { ok: true };

  if (!bearer && !header) return { ok: false, reason: 'no credential provided' };

  // Whitespace-only mismatch is the most common real-world cause (e.g. a
  // trailing newline picked up when copying a secret on mobile) — flag it
  // specifically so it's diagnosable in logs without ever revealing the secret.
  const providedRaw     = rawBearer || rawHeader;
  const providedTrimmed = bearer || header;
  const rawLengthDiffersFromTrimmed = providedRaw.length !== providedTrimmed.length;

  return {
    ok: false,
    reason: rawLengthDiffersFromTrimmed
      ? `credential has leading/trailing whitespace; trimmed length ${providedTrimmed.length} vs expected ${secret.length}`
      : `credential mismatch; provided length ${providedTrimmed.length} vs expected ${secret.length}`,
  };
}
