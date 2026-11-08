import { describe, it, expect } from 'vitest';
import { measureToolCRS } from '../lib/agents/tool_crs';
import { RECOVERY_PULSE_TOOLS } from '../lib/agents/tool_policy';

const input = (name: string) => ({
  id: 'call-1',
  name,
  arguments: {},
  session_id: 'owner:mcp-0123456789ab',
  actor_id: 'api_key:owner',
  task_context: 'test',
});

describe('recovery pulse tools are classified, not blocked as unclassified', () => {
  it('lists the bounded pulse tools explicitly', () => {
    expect(RECOVERY_PULSE_TOOLS.has('request_recovery_pulse')).toBe(true);
    expect(RECOVERY_PULSE_TOOLS.has('advance_recovery_plane')).toBe(true);
  });

  it('does not block request_recovery_pulse as an unclassified tool', async () => {
    const crs = await measureToolCRS(input('request_recovery_pulse') as never);
    expect(crs.blocked_pattern).toBeNull();
    expect(crs.risk_level).not.toBe('BLOCKED');
  });

  it('still blocks a genuinely unknown tool as unclassified', async () => {
    const crs = await measureToolCRS(input('totally_unknown_tool_xyz') as never);
    expect(crs.blocked_pattern).toBe('unclassified_tool:totally_unknown_tool_xyz');
  });
});
