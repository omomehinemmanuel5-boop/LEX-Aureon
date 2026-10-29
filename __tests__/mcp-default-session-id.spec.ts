import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/lex_crs_agent/mcp_access', () => ({
  isOperatorSecret: vi.fn(() => false),
}));

import { defaultMcpSessionId } from '../lib/mcp_http';

describe('default MCP session identity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the same actor-scoped fallback ID across UTC dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T23:59:59.000Z'));
    const beforeUtcRollover = defaultMcpSessionId('actor-stable-test');

    vi.setSystemTime(new Date('2026-10-29T00:00:01.000Z'));
    const afterUtcRollover = defaultMcpSessionId('actor-stable-test');

    expect(beforeUtcRollover).toMatch(/^mcp-[a-f0-9]{12}$/);
    expect(afterUtcRollover).toBe(beforeUtcRollover);
  });

  it('keeps different actor identities in separate fallback sessions', () => {
    expect(defaultMcpSessionId('actor-one')).not.toBe(defaultMcpSessionId('actor-two'));
  });
});
