import { describe, expect, it } from 'vitest';
import {
  scopedGrantMatchesAction,
  validateScopedGrantInput,
  type ScopedGrantRecord,
} from '../lib/scoped_grants';

const now = 1_800_000_000_000;
const grant: ScopedGrantRecord = {
  grant_id: 'grant-1',
  owner_id: 'owner-a',
  allowed_tools: ['create_branch', 'write_file', 'patch_file', 'open_pr'],
  branch_prefixes: ['govern/', 'fix/'],
  path_prefixes: ['docs/', 'lib/'],
  max_uses: 2,
  uses: 0,
  expires_at: now + 60 * 60 * 1000,
  revoked_at: null,
  created_at: now,
};

describe('scoped branch grants — test-first policy contract', () => {
  it('matches create_branch and write_file only inside the owner-approved govern/ scope', () => {
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'create_branch', args: { branch: 'govern/scoped' }, nowMs: now })).toBe(true);
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'write_file', args: { branch: 'govern/scoped', path: 'docs/plan.md' }, nowMs: now })).toBe(true);
  });

  it('does not authorize a second use when max_uses is one', () => {
    const single = { ...grant, max_uses: 1, uses: 1 };
    expect(scopedGrantMatchesAction(single, { ownerId: 'owner-a', toolName: 'create_branch', args: { branch: 'govern/scoped' }, nowMs: now })).toBe(false);
  });

  it('rejects an expired grant', () => {
    expect(scopedGrantMatchesAction({ ...grant, expires_at: now }, { ownerId: 'owner-a', toolName: 'create_branch', args: { branch: 'govern/scoped' }, nowMs: now })).toBe(false);
  });

  it('rejects a revoked grant immediately', () => {
    expect(scopedGrantMatchesAction({ ...grant, revoked_at: now - 1 }, { ownerId: 'owner-a', toolName: 'create_branch', args: { branch: 'govern/scoped' }, nowMs: now })).toBe(false);
  });

  it('never authorizes a branch named main', () => {
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'create_branch', args: { branch: 'main' }, nowMs: now })).toBe(false);
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'write_file', args: { branch: 'main', path: 'docs/plan.md' }, nowMs: now })).toBe(false);
  });

  it('rejects a path outside the owner-approved path prefixes', () => {
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'write_file', args: { branch: 'govern/scoped', path: 'app/api/route.ts' }, nowMs: now })).toBe(false);
  });

  it('requires open_pr to target base main and a scoped head branch', () => {
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'open_pr', args: { head: 'govern/scoped', base: 'release' }, nowMs: now })).toBe(false);
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'open_pr', args: { head: 'main', base: 'main' }, nowMs: now })).toBe(false);
  });

  it('does not authorize tools outside the four-tool allowlist', () => {
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'dispatch_workflow', args: { branch: 'govern/scoped' }, nowMs: now })).toBe(false);
  });

  it('does not match a grant owned by another caller', () => {
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-b', toolName: 'create_branch', args: { branch: 'govern/scoped' }, nowMs: now })).toBe(false);
  });

  it('rejects expiry more than 60 minutes ahead', () => {
    expect(() => validateScopedGrantInput({
      owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'],
      expires_at: now + 60 * 60 * 1000 + 1, max_uses: 1,
    }, now)).toThrow(/60 minutes/i);
  });

  it('rejects branch prefixes containing main', () => {
    expect(() => validateScopedGrantInput({
      owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'],
      branch_prefixes: ['main'], expires_at: now + 30_000, max_uses: 1,
    }, now)).toThrow(/main/i);
  });

  it('does not match if the recovery gate is RESTORING', () => {
    // The route/executor must check recovery before consuming a grant.
    expect(scopedGrantMatchesAction(grant, {
      ownerId: 'owner-a', toolName: 'create_branch',
      args: { branch: 'govern/scoped' }, nowMs: now, recoveryAllowed: false,
    })).toBe(false);
  });

  it('returns exactly one auditable use number for a successful grant consumption', () => {
    // Contract assertion: use numbers are allocated atomically by consumeScopedGrant;
    // the matching function itself must not mutate the use counter.
    expect(grant.uses).toBe(0);
    expect(scopedGrantMatchesAction(grant, { ownerId: 'owner-a', toolName: 'create_branch', args: { branch: 'govern/scoped' }, nowMs: now })).toBe(true);
    expect(grant.uses).toBe(0);
  });

  it('rejects grant input outside the four allowed tools', () => {
    expect(() => validateScopedGrantInput({
      owner_id: 'owner-a', allowed_tools: ['dispatch_workflow'], path_prefixes: ['docs/'],
      expires_at: now + 30_000, max_uses: 1,
    }, now)).toThrow(/allowed_tools/i);
  });
});
