import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getGitHubCredentialForApprovedAction } = vi.hoisted(() => ({
  getGitHubCredentialForApprovedAction: vi.fn(async () => 'test-github-token'),
}));

vi.mock('../lib/agents/credential_broker', () => ({ getGitHubCredentialForApprovedAction }));

import { write_file, create_branch, open_pr, TOOL_DEFINITIONS } from '../lib/lex_crs_agent/tools';
import { patch_file, PATCH_FILE_DEFINITION } from '../lib/lex_crs_agent/tools/patch_file';
import { validateTargetBranch } from '../lib/lex_crs_agent/tools/github_branch_validation';
import { getToolCapability } from '../lib/agents/tool_capability_registry';

const repo = 'omomehinemmanuel5-boop/LEX-Aureon';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('validated GitHub branch and PR tools', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getGitHubCredentialForApprovedAction.mockResolvedValue('test-github-token');
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'PUT') return jsonResponse({ commit: { sha: 'commit-branch-test' } });
      if (url.includes('/git/ref/heads/fix/exists')) return jsonResponse({ ref: 'refs/heads/fix/exists' });
      if (url.includes('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'main-head-sha' } });
      if (url.endsWith('/git/refs') && method === 'POST') return jsonResponse({ ref: 'refs/heads/fix/new-branch' }, 201);
      if (url.endsWith('/pulls') && method === 'POST') return jsonResponse({
        number: 17,
        html_url: 'https://github.com/omomehinemmanuel5-boop/LEX-Aureon/pull/17',
        head: { ref: 'fix/new-branch', sha: 'head-sha' },
        base: { ref: 'main' },
      }, 201);
      if (url.includes('/contents/')) {
        if (url.includes('patch-target')) {
          return jsonResponse({ content: Buffer.from('const value = 1;\\n').toString('base64'), sha: 'blob-sha' });
        }
        return new Response('', { status: 404 });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('accepts only governed/fix target branch names', () => {
    expect(validateTargetBranch('govern/x')).toBeNull();
    expect(validateTargetBranch('fix/x')).toBeNull();
    expect(validateTargetBranch('main')).toContain('main');
    expect(validateTargetBranch('master')).toContain('govern/');
    expect(validateTargetBranch('../x')).toContain('govern/');
    expect(validateTargetBranch('other/x')).toContain('govern/');
    expect(validateTargetBranch('fix/a..b')).toContain('..');
    expect(validateTargetBranch('fix/has space')).toContain('spaces');
    expect(validateTargetBranch('fix/with\\nnewline')).toContain('control');
    expect(validateTargetBranch('fix/' + 'x'.repeat(97))).toContain('100 characters');
  });

  it('writes to the requested branch using the contents API branch field and branch-specific SHA lookup', async () => {
    const result = await write_file({
      path: 'docs/branch-target.md', content: 'branch content', message: 'branch write', branch: 'govern/x',
    });
    expect(result).toContain('Committed');
    const getCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/contents/docs/branch-target.md'));
    expect(String(getCall?.[0])).toContain('?ref=govern%2Fx');
    const putCall = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeDefined();
    const payload = JSON.parse(String((putCall?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(payload.branch).toBe('govern/x');
    expect(String(putCall?.[0])).toBe('https://api.github.com/repos/' + repo + '/contents/docs/branch-target.md');
  });

  it.each(['main', 'master', '../x', 'other/x'])('write_file rejects invalid branch %s before any GitHub call', async branch => {
    const result = await write_file({ path: 'docs/x.md', content: 'x', message: 'test', branch });
    expect(result).toContain('Error: invalid branch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getGitHubCredentialForApprovedAction).not.toHaveBeenCalled();
  });

  it.each(['main', 'master', '../x', 'other/x'])('patch_file rejects invalid branch %s before any GitHub call', async branch => {
    const result = await patch_file({
      path: 'docs/x.md', old_str: 'old', new_str: 'new', message: 'test', branch,
    });
    expect(result).toContain('Error: invalid branch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getGitHubCredentialForApprovedAction).not.toHaveBeenCalled();
  });

  it('patch_file reads and commits against the requested branch', async () => {
    const result = await patch_file({
      path: 'docs/patch-target.md', old_str: 'value = 1', new_str: 'value = 2',
      message: 'patch branch', branch: 'fix/patch-target',
    });
    expect(result).toContain('Committed');
    const getCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/contents/docs/patch-target.md'));
    expect(String(getCall?.[0])).toContain('?ref=fix%2Fpatch-target');
    const putCall = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'PUT');
    const payload = JSON.parse(String((putCall?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(payload.branch).toBe('fix/patch-target');
  });

  it('creates a branch from main and refuses to overwrite an existing branch', async () => {
    const created = await create_branch({ branch: 'fix/new-branch' });
    expect(created).toContain('Created branch fix/new-branch from main');
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/git/refs')
      && (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(true);

    fetchMock.mockClear();
    const existing = await create_branch({ branch: 'fix/exists' });
    expect(existing).toContain('branch already exists');
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/git/refs')
      && (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('opens a PR without ever calling a merge endpoint', async () => {
    const result = await open_pr({ head: 'fix/new-branch', title: 'Test PR', body: 'Body' });
    expect(result).toContain('/pull/17');
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/pulls') &&
      (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(true);
    expect(fetchMock.mock.calls.some(call => /\/pulls\/[^/]+\/merge(?:\?|$)/.test(String(call[0])))).toBe(false);
    expect(fetchMock.mock.calls.some(call => /\/git\/refs\/heads\/[^/]+$/.test(String(call[0])) &&
      (call[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });

  it('publishes the branch field and new tool input schemas', () => {
    const write = TOOL_DEFINITIONS.find(tool => tool.name === 'write_file') as { parameters: { properties: Record<string, unknown> } } | undefined;
    const create = TOOL_DEFINITIONS.find(tool => tool.name === 'create_branch') as { parameters: { properties: Record<string, unknown> } } | undefined;
    const open = TOOL_DEFINITIONS.find(tool => tool.name === 'open_pr') as { parameters: { properties: Record<string, unknown> } } | undefined;
    expect(write?.parameters.properties).toHaveProperty('branch');
    expect(PATCH_FILE_DEFINITION.inputSchema.properties).toHaveProperty('branch');
    expect(create?.parameters.properties).toHaveProperty('branch');
    expect(create?.parameters.properties).toHaveProperty('from_branch');
    expect(open?.parameters.properties).toHaveProperty('head');
    expect(open?.parameters.properties).toHaveProperty('base');
    expect(open?.parameters.properties).toHaveProperty('title');
    expect(open?.parameters.properties).toHaveProperty('body');
  });

  it('registers create_branch and open_pr as approval-required write capabilities', () => {
    expect(getToolCapability('create_branch')).toMatchObject({ capability: 'write', approvalRequired: true });
    expect(getToolCapability('open_pr')).toMatchObject({ capability: 'write', approvalRequired: true });
  });
});
