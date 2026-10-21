/**
 * Branch-name validation shared by GitHub write tools.
 * Validation is intentionally local and runs before any GitHub request.
 */

export function validateTargetBranch(branch: unknown): string | null {
  if (typeof branch !== 'string' || branch.length === 0) {
    return 'branch must be a non-empty string starting with "govern/" or "fix/".';
  }
  if (branch.length > 100) return 'branch must be at most 100 characters.';
  if (branch === 'main') return 'branch must not be the default branch "main".';
  if (!(branch.startsWith('govern/') || branch.startsWith('fix/'))) {
    return 'branch must start with "govern/" or "fix/".';
  }
  if (branch.includes('..')) return 'branch must not contain "..".';
  if (branch.includes(' ')) return 'branch must not contain spaces.';
  if (/[\u0000-\u001f\u007f]/.test(branch)) return 'branch must not contain control characters.';
  if (branch.endsWith('/') || branch.includes('//')) return 'branch must not contain empty path segments.';
  return null;
}

/** Validate a source/base ref while allowing "main" and existing non-prefixed branches. */
export function validateBaseBranch(branch: unknown, fieldName = 'from_branch'): string | null {
  if (typeof branch !== 'string' || branch.length === 0) {
    return `${fieldName} must be a non-empty branch name.`;
  }
  if (branch.length > 100) return `${fieldName} must be at most 100 characters.`;
  if (branch.includes('..')) return `${fieldName} must not contain "..".`;
  if (branch.includes(' ')) return `${fieldName} must not contain spaces.`;
  if (/[\u0000-\u001f\u007f]/.test(branch)) return `${fieldName} must not contain control characters.`;
  if (branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) {
    return `${fieldName} must be a valid branch ref.`;
  }
  return null;
}
