import { describe, expect, it } from 'vitest';
import { validateTargetBranch } from '../lib/lex_crs_agent/tools/github_branch_validation';

describe('governed target branch validation', () => {
  it.each(['govern/policy-fix', 'fix/approval-flow'])('accepts allowed branch %s', branch => {
    expect(validateTargetBranch(branch)).toBeNull();
  });

  it.each([
    'main',
    'feature/not-allowed',
    'fix/../main',
    'govern/has space',
    'fix/control\nchar',
    'fix/' + 'x'.repeat(96),
    'fix//empty-segment',
    'fix/trailing/',
  ])('rejects invalid branch %s', branch => {
    expect(validateTargetBranch(branch)).not.toBeNull();
  });
});
