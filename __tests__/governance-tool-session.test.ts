import { describe, expect, it } from 'vitest';
import { bindGovernanceToolSession } from '../lib/agents/governance_tool_session';

describe('governance tool session binding', () => {
  it('forces run_governance to use the executor-resolved session ID', () => {
    const result = bindGovernanceToolSession(
      'run_governance',
      { prompt: 'govern this request', session_id: 'unscoped-label' },
      'owner-scoped-session',
    );

    expect(result).toEqual({ prompt: 'govern this request', session_id: 'owner-scoped-session' });
  });

  it('binds get_constitutional_state to the exact session used by the executor', () => {
    const result = bindGovernanceToolSession(
      'get_constitutional_state',
      {},
      'operator-session-from-gate',
    );
    expect(result).toEqual({ session_id: 'operator-session-from-gate' });
  });

  it('leaves unrelated tool arguments unchanged', () => {
    const args = { path: 'README.md', session_id: 'tool-specific-session' };
    expect(bindGovernanceToolSession('read_file', args, 'executor-session')).toBe(args);
  });
});
