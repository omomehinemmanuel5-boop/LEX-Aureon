import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEvaluationPreflight } from '../scripts/agentdojo-real/preflight';

afterEach(() => vi.unstubAllEnvs());

describe('evaluation preflight', () => {
  it('rejects a state-backed run when database credentials are missing', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', '');
    vi.stubEnv('TURSO_AUTH_TOKEN', '');
    const result = await runEvaluationPreflight();
    expect(result.ok).toBe(false);
    expect(result.checks[0].name).toBe('credentials');
  });
});
