/**
 * Agent-governance benchmark v1.
 *
 * This is deliberately a deterministic harness around the constitutional
 * decision boundary rather than a claim of end-to-end agent safety. It tests
 * the properties we need before exposing the MCP path to adaptive evaluation:
 * authorization is evaluated per request, cached execution never bypasses
 * authorization, and write operations are never cached.
 */

type Decision = { approved: boolean };

type Request = {
  toolName: string;
  args: Record<string, unknown>;
  decision: Decision;
};

function isCacheable(toolName: string): boolean {
  return new Set([
    'read_file', 'read_directory', 'list_directory', 'list_files',
    'search_memory', 'fetch_page', 'get_file', 'cat', 'head', 'tail',
    'grep', 'find', 'ls', 'dir', 'glob', 'read_json', 'parse_csv',
  ]).has(toolName);
}

function cacheKey(sessionId: string, toolName: string, args: Record<string, unknown>): string {
  return `${sessionId}:${toolName}:${JSON.stringify(args)}`;
}

function simulate(requests: Request[]) {
  const executions: string[] = [];
  const cache = new Map<string, string>();

  for (const request of requests) {
    // Authorization happens first for every request.
    if (!request.decision.approved) continue;

    const key = cacheKey('benchmark', request.toolName, request.args);
    if (isCacheable(request.toolName) && cache.has(key)) continue;

    executions.push(request.toolName);
    if (isCacheable(request.toolName)) cache.set(key, 'result');
  }

  return executions;
}

describe('agent governance benchmark v1', () => {
  test('denied read cannot execute even when an earlier identical request was approved', () => {
    const executions = simulate([
      { toolName: 'read_file', args: { path: 'README.md' }, decision: { approved: true } },
      { toolName: 'read_file', args: { path: 'README.md' }, decision: { approved: false } },
    ]);
    expect(executions).toEqual(['read_file']);
  });

  test('approved identical read can reuse execution result', () => {
    const executions = simulate([
      { toolName: 'read_file', args: { path: 'README.md' }, decision: { approved: true } },
      { toolName: 'read_file', args: { path: 'README.md' }, decision: { approved: true } },
    ]);
    expect(executions).toEqual(['read_file']);
  });

  test('write operations are executed for each approved request and are never cached', () => {
    const executions = simulate([
      { toolName: 'write_file', args: { path: 'a.ts' }, decision: { approved: true } },
      { toolName: 'write_file', args: { path: 'a.ts' }, decision: { approved: true } },
    ]);
    expect(executions).toEqual(['write_file', 'write_file']);
  });

  test('repeated probing after denial does not produce tool execution', () => {
    const executions = simulate([
      { toolName: 'read_file', args: { path: '.env' }, decision: { approved: false } },
      { toolName: 'read_file', args: { path: '.env' }, decision: { approved: false } },
      { toolName: 'write_file', args: { path: '.env' }, decision: { approved: false } },
    ]);
    expect(executions).toEqual([]);
  });
});
