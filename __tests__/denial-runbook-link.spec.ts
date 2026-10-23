import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('denial runbook links', () => {
  it('includes the recovery runbook path in recovery and approval denials', () => {
    const route = readFileSync(resolve(process.cwd(), 'app/api/mcp/route.ts'), 'utf8');
    const approvals = readFileSync(resolve(process.cwd(), 'lib/approval_requests.ts'), 'utf8');

    expect(route).toMatch(/next_step:[\\s\\S]{0,500}docs\\/recovery-runbook\\.md/);
    expect(approvals).toMatch(/Approval request is bound to different arguments[^'\\n]*docs\\/recovery-runbook\\.md/);
  });
});
