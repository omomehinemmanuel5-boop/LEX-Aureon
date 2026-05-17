import { describe, it, expect } from 'vitest';
import { parseRunRequest } from '../lib/schemas';

describe('parseRunRequest', () => {
  it('accepts a minimal valid body', () => {
    const r = parseRunRequest({ prompt: 'hello', session_id: 's1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.prompt).toBe('hello');
  });

  it('rejects missing prompt', () => {
    const r = parseRunRequest({ session_id: 's1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/prompt/i);
  });

  it('rejects empty prompt', () => {
    const r = parseRunRequest({ prompt: '', session_id: 's1' });
    expect(r.ok).toBe(false);
  });

  it('rejects oversize prompt', () => {
    const r = parseRunRequest({ prompt: 'a'.repeat(8001), session_id: 's1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too long|max/i);
  });

  it('rejects missing session_id', () => {
    const r = parseRunRequest({ prompt: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/session_id/);
  });

  it('accepts optional crs vector', () => {
    const r = parseRunRequest({
      prompt: 'hi', session_id: 's1',
      crs: { c: 0.3, r: 0.3, s: 0.4 },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects out-of-range crs values', () => {
    const r = parseRunRequest({
      prompt: 'hi', session_id: 's1',
      crs: { c: 1.5, r: 0.3, s: 0.4 },
    });
    expect(r.ok).toBe(false);
  });
});
