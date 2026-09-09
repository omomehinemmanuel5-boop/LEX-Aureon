import { describe, expect, it } from 'vitest';
import { isEvalSession } from '@/lib/governance_service';

describe('governance service evaluation-session classification', () => {
  it.each([
    'lexbench-run-1',
    'synthetic_session_42',
    'bench-release-2026',
    'jbb_attack_1',
    'adv_prompt_7',
    'hb_case_9',
  ])('recognizes %s as evaluation traffic', (sessionId) => {
    expect(isEvalSession(sessionId)).toBe(true);
  });

  it.each(['session-1', 'user-demo', 'production-chat', 'benchmark'])(
    'does not classify %s as evaluation traffic',
    (sessionId) => {
      expect(isEvalSession(sessionId)).toBe(false);
    },
  );
});
