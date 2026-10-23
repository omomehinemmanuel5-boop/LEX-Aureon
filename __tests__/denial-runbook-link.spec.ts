import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('denial runbook links', () => {
  it('includes the recovery runbook path in recovery and approval denials', () => {
    const route = readFileSync(resolve(process.cwd(), 'app/api/mcp/route.ts'), 'utf8');
    const approvals = readFileSync(resolve(process.cwd(), 'lib/approval_requests.ts'), 'utf8');
    const recoveryDenialStart = route.indexOf('Continue safe governed observations, at least 5 seconds apart');
    const recoveryDenial = route.slice(recoveryDenialStart, recoveryDenialStart + 500);

    expect(recoveryDenial).toContain('docs/recovery-runbook.md');
    expect(approvals).toContain('Approval request is bound to different arguments. Retry with exactly the arguments shown on the approval screen; fields such as task_context are part of the binding and must be omitted unless they were approved. See docs/recovery-runbook.md.');
  });
});
