import { describe, it, expect } from 'vitest';
import { checkBenchAuth } from '../lib/bench_auth';

// This suite exists to GUARANTEE the 2026-07-04 persistent-401 bug class can
// never silently regress: the auth check trimmed the caller's credential but
// compared it against an untrimmed stored secret, so a stored secret with a
// stray trailing newline (easy on mobile copy-paste, invisible in Vercel's
// masked UI) would 401 forever no matter how carefully the caller's value was
// re-entered. Every scenario below that plausibly caused that incident is
// tested explicitly, not just the happy path.

describe('checkBenchAuth', () => {
  const SECRET = 'my-test-secret-123';

  it('authorizes a clean matching Bearer token', () => {
    expect(checkBenchAuth(`Bearer ${SECRET}`, null, SECRET).ok).toBe(true);
  });

  it('authorizes a clean matching X-Bench-Secret header', () => {
    expect(checkBenchAuth(null, SECRET, SECRET).ok).toBe(true);
  });

  it('THE BUG: authorizes when the STORED secret has a trailing newline', () => {
    // This is the exact scenario that caused persistent 401s in production:
    // the Vercel env var picked up a trailing newline, invisible in the
    // masked UI, and the old code never trimmed the stored side.
    expect(checkBenchAuth(`Bearer ${SECRET}`, null, SECRET + '\n').ok).toBe(true);
  });

  it('authorizes when the STORED secret has leading/trailing spaces', () => {
    expect(checkBenchAuth(`Bearer ${SECRET}`, null, `  ${SECRET}  `).ok).toBe(true);
  });

  it('authorizes when the PROVIDED token has a trailing newline (e.g. a GitHub secret paste)', () => {
    expect(checkBenchAuth(`Bearer ${SECRET}\n`, null, SECRET).ok).toBe(true);
  });

  it('authorizes when BOTH sides have stray whitespace', () => {
    expect(checkBenchAuth(`Bearer ${SECRET}\n`, null, `  ${SECRET}\n`).ok).toBe(true);
  });

  it('authorizes via X-Bench-Secret even with stored-secret whitespace', () => {
    expect(checkBenchAuth(null, SECRET, SECRET + '\n').ok).toBe(true);
  });

  it('accepts a case-insensitive "Bearer" scheme prefix', () => {
    expect(checkBenchAuth(`bearer ${SECRET}`, null, SECRET).ok).toBe(true);
    expect(checkBenchAuth(`BEARER ${SECRET}`, null, SECRET).ok).toBe(true);
  });

  it('falls back to X-Bench-Secret when Authorization is absent', () => {
    expect(checkBenchAuth(null, SECRET, SECRET).ok).toBe(true);
  });

  it('rejects a genuinely wrong secret and says so diagnostically', () => {
    const r = checkBenchAuth(`Bearer completely-wrong-value`, null, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/mismatch/);
  });

  it('rejects when no credential is provided at all', () => {
    const r = checkBenchAuth(null, null, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no credential/);
  });

  it('rejects an empty Bearer value', () => {
    expect(checkBenchAuth(`Bearer `, null, SECRET).ok).toBe(false);
    expect(checkBenchAuth(`Bearer `, null, SECRET).ok).toBe(false);
  });

  it('is case-sensitive on the secret itself (does not treat different case as equal)', () => {
    expect(checkBenchAuth(`Bearer ${SECRET.toUpperCase()}`, null, SECRET).ok).toBe(false);
  });

  it('never leaks the secret value in the failure reason', () => {
    const r = checkBenchAuth(`Bearer wrong`, null, SECRET);
    expect(r.reason).not.toContain(SECRET);
    expect(r.reason).not.toContain('wrong');
  });

  it('reports a whitespace-shaped reason distinct from a plain mismatch reason', () => {
    // A credential that only differs from the secret by surrounding whitespace
    // never reaches this branch (it authorizes — see the whitespace tests
    // above). This confirms the diagnostic differentiates "raw value had
    // whitespace trimmed off before comparing" from "genuinely wrong length",
    // for a wrong-but-whitespace-padded credential.
    const r = checkBenchAuth(`Bearer  wrong-value-here  `, null, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/whitespace/);
  });
});
