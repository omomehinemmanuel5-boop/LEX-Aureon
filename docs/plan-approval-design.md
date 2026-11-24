# Plan approval design

Status: proposed. Decisions recorded below. Not implemented. Tests are written from this spec before any build.

## Goal

Let one human approval cover a bounded batch of writes, without weakening per-action control. Every write still has to match what the human approved, and recovery still has to pass before each write.

## Scope

Tier 1 (this spec):
- Branches: `fix/*` and `govern/*` only. Never `main`. Created from `main` or from a plan branch.
- Paths: `docs/**` and `__tests__/**`, plus any path named in the plan that also matches this allowlist.
- Draft PRs from a plan branch, only if the plan lists the PR.

Tier 2 (runtime `lib/**`, `app/**`): not in this spec. Requires its own spec, a merge gate on the unit suite, and an explicit list of functions each plan may touch. No plan can touch these paths until that spec is approved.

## Permanently out of scope

- The governance layer: `lib/approval*`, `lib/scoped_grants.ts`, `lib/rate_limit.ts`, `lib/agents/recovery_*`, `lib/agents/constitutional_*`, constitutional thresholds, trajectory logic.
- Merging, pushing to `main`, deleting branches, marking a PR ready for review, deploys.
- Secrets, environment settings, workflow dispatch.
- Anything outside the repository.

## Who can do what

- **Anyone working with Lex can draft a plan.** Drafting means writing the plan, listing the files and their resulting hashes, and running a dry-run of every write. A dry-run applies nothing. The agent may draft and simulate plans ahead of time.
- **Only the operator can approve a plan.** Approval turns a draft into an executable plan. It is the single human decision that binds the exact hashes.
- A draft without approval can never execute, and an approved plan cannot be changed. Changing any field requires a new draft and a new approval.

## Plan format

A plan contains:

- `plan_id`: unique, never reused.
- `branch`: must match `fix/*` or `govern/*`.
- `base`: `main` or the plan's own branch.
- `expires_at`: at most 60 minutes after approval.
- `max_writes`: at most 20.
- `max_files`: at most 10.
- `writes`: an ordered list. Each entry has `index`, `path`, `op` (`create` or `replace`), and `result_sha256`, which is the SHA-256 of the complete file content after the write.
- `pr` (optional): `{ draft: true, title_sha256, body_sha256 }`.
- `plan_hash`: SHA-256 of the canonical JSON of all fields above.

The approval binds `plan_hash`. Changing any field, including one write's hash, invalidates the approval.

## Execution rules

1. The plan is approved by the operator and becomes ACTIVE. Recovery must be VERIFIED before the first write and is checked again before every write.
2. Each write must match the next unexecuted entry in `writes`: same index, path, op, and the SHA-256 of the complete resulting content. Any mismatch refuses the write and suspends the plan. Suspended plans are not retried automatically.
3. Writes are counted. Exceeding `max_writes` or `max_files` is refused.
4. No write is accepted after `expires_at`. An expired plan is closed.
5. Any failed step closes the plan. Remaining writes need a new plan.
6. A write whose measurement is a `fallback` blocks the plan. The plan stops at that step and the remaining writes need a new plan.
7. A plan cannot open a PR against `main`. Draft PRs are allowed only if the plan lists them. Marking ready, or merging, needs its own per-action approval.
8. Recovery rules are unchanged. A plan does not waive the velocity threshold, the canary requirement, or the stability observations.
9. A plan is single use. Its approval is consumed when the plan is approved, as with per-action approvals today.
10. Only one active plan per owner at a time.

## Limits

- Lifetime: 60 minutes at most.
- Writes per plan: 20 at most.
- Files per plan: 10 at most.
- PRs per plan: 1 at most.
- Approval-request rate limit counts created requests, not denied attempts (see separate change).

## Receipts

Each write records:
- `plan_id`, `index`, `path`, `op`, `result_sha256`.
- The commit SHA.
- Measured state before and after the write, from real task context. Placeholder values such as `1,1,1,1` are not allowed.
- `measurement`: `task_context` or `fallback`. A `fallback` measurement is recorded and blocks the plan under rule 6.

## Required tests before the build can merge

- A write with the wrong hash is refused and the plan is suspended.
- A write out of order is refused.
- A write after `expires_at` is refused.
- A write beyond `max_writes` (20) is refused.
- A write beyond `max_files` (10) is refused.
- A plan with a path outside the allowlist is refused at creation.
- A plan with a `lib/` or `app/` path in tier 1 is refused at creation.
- A plan with `main` as the branch or base is refused at creation.
- A draft plan cannot execute before the operator approves it.
- A write while recovery is not VERIFIED is refused.
- A write with a `fallback` measurement blocks the plan.
- A replayed `plan_id` is refused.
- A second active plan for the same owner is refused.
- A grant or receipt with placeholder measurements is refused.

## Decisions

1. Anyone working with Lex can draft and simulate plans. Only the operator can approve them.
2. Limits: 20 writes, 10 files, 60 minutes, 1 PR, one active plan per owner.
3. A `fallback` measurement blocks further writes.
4. Runtime code in `lib/` and `app/` needs its own spec before any plan can touch it.
