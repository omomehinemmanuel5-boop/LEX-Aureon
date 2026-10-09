import { afterEach, describe, expect, it, vi } from 'vitest';

const { getGitHubCredentialForApprovedAction } = vi.hoisted(() => ({
  getGitHubCredentialForApprovedAction: vi.fn(),
}));

vi.mock('../lib/agents/credential_broker', () => ({ getGitHubCredentialForApprovedAction }));

import { patch_file } from '../lib/lex_crs_agent/tools/patch_file';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('patch_file dry_run', () => {
  it('reads only the configured public repository without a privileged credential or commit', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      return new Response(JSON.stringify({
        content: Buffer.from('const before = true;\n').toString('base64'),
        sha: 'public-sha',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await patch_file({
      path: 'app/example.ts',
      old_str: 'before',
      new_str: 'after',
      message: 'preview only',
      dry_run: true,
    });

    expect(result).toContain('dry_run — no commit made');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getGitHubCredentialForApprovedAction).not.toHaveBeenCalled();
  });

  it('refuses unauthenticated previews of repositories outside the configured public project', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await patch_file({
      path: 'README.md',
      old_str: 'before',
      new_str: 'after',
      message: 'preview only',
      repo: 'someone/private-repository',
      dry_run: true,
    });

    expect(result).toContain('limited to the public repository');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getGitHubCredentialForApprovedAction).not.toHaveBeenCalled();
  });
});
