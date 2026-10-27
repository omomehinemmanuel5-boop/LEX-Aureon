import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureEvaluationDatabaseEnvironment, evaluationDatabaseCredentials, runEvaluationPreflight } from '../scripts/agentdojo-real/preflight';

afterEach(() => vi.unstubAllEnvs());

describe('evaluation preflight', () => {
  it('rejects a state-backed run when database credentials are missing', async () => {
    vi.stubEnv('TURSO_DATABASE_URL', '');
    vi.stubEnv('TURSO_AUTH_TOKEN', '');
    const result = await runEvaluationPreflight();
    expect(result.ok).toBe(false);
    expect(result.checks[0].name).toBe('credentials');
  });

  it('prefers dedicated evaluation credentials and maps them for Lex internals', () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'production-url');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'production-token');
    vi.stubEnv('TURSO_EVAL_DATABASE_URL', 'evaluation-url');
    vi.stubEnv('TURSO_EVAL_AUTH_TOKEN', 'evaluation-token');
    expect(evaluationDatabaseCredentials()).toEqual({ url: 'evaluation-url', token: 'evaluation-token' });
    configureEvaluationDatabaseEnvironment();
    expect(process.env.TURSO_DATABASE_URL).toBe('evaluation-url');
    expect(process.env.TURSO_AUTH_TOKEN).toBe('evaluation-token');
  });
});
