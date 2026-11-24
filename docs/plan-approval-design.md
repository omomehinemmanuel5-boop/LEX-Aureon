# Plan approval design

Status: proposed. Not implemented. Requires review before any build.

## Goal

Let one human approval cover a bounded batch of writes, without weakening per-action control. Every write still has to match what the human approved, and recovery still has to pass before each write.

## Scope

Tier 1 (this spec):
- Branches: `fix/*` and `govern/*` only. Never `main`. Created from `main` or from a plan branch.
- Paths: `docs/**` and `__tests__/**`, plus any path named in the plan that also matches this allowlist.
- Draft PRs from a plan branch, only if the plan lists the PR.

Tier 2 (runtime `lib/**`, `app/**`): not in this spec. Needs its own design, a merge gate on the unit suite, and an explicit list of functions each plan may touch.

## Permanently out of scope

- The governance layer: `lib/approval*`, `lib/scoped_grants.ts`, `lib/rate_limit.ts`, `lib/agents/recovery_*`, `lib/agents/constitutional_*`, constitutional thresholds, trajectory logic.
- Merging, pushing to `main`, deleting branches, marking a PR ready for review, deploys.
- Secrets, environment settings, workflow dispatch.
- Anything outside the repository.

## Plan format

A plan is a single request created by the operator and approved by a human. It contains:

- `plan_id`: unique, never reused.
- `branch`: must match `fix/*` or `govern/*`.
- `base`: `main` or the plan's own branch.
- `expires_at`: at most 60 minutes after approval.
- `max_writes`: at most 10.
- `max_files`: at most 5.
- `writes`: an ordered list. Each entry has `index`, `path`, `op` (`create` or `replace`), and `result_sha256`, which is the SHA-256 of the complete file content after the write.
- `pr` (optional): `{ draft: true, title_sha256, body_sha256 }`.
- `plan_hash`: SHA-256 of the canonical JSON of all fields above.

The approval binds `plan_hash`. Changing any field, including one write's hash, invalidates the approval.

## Execution rules

1. Plan is approved, status becomes ACTIVE. Recovery must be VERIFIED before the first write and is checked again before every write.
2. Each write must match the next unexecuted entry in `writes`: same index, path, op, and the SHA-256 of the complete resulting content. Any mismatch refuses the write and suspends the plan. Suspended plans are not retried automatically.
3. Writes are counted. Exceeding `max_writes` or `max_files` is refused.
4. No write is accepted after `expires_at`. An expired plan is closed.
5. Any failed step closes the plan. Remaining writes need a new plan.
6. A plan cannot open a PR against `main`. Draft PRs are allowed only if the plan lists them. Marking ready, or merging, needs its own per-action approval.
7. Recovery rules are unchanged. A plan does not waive the velocity threshold, the canary requirement, or the stability observations.
8. A plan is single use. Its approval is consumed when the plan is created, as with per-action approvals today.
9. Only one active plan per owner at a time.

## Limits

- Lifetime: 60 minutes at most.
- Writes per plan: 10 at most.
- Files per plan: 5 at most.
- PRs per plan: 1 at most.
- Approval-request rate limit counts created requests, not denied attempts (see separate change).

## Receipts

Each write records:
- `plan_id`, `index`, `path`, `op`, `result_sha256`.
- The commit SHA.
- Measured state before and after the write, from real task context. Placeholder values such as `1,1,1,1` are not allowed.
- `measurement`: `task_context` or `fallback`. A `fallback` measurement is flagged in the receipt. Whether a flagged measurement should block further writes is an open question below.

## Required tests before the build can merge

- A write with the wrong hash is refused and the plan is suspended.
- A write out of order is refused.
- A write after `expires_at` is refused.
- A write beyond `max_writes` is refused.
- A plan with a path outside the allowlist is refused at creation.
- A plan with a `lib/` path in tier 1 is refused at creation.
- A plan with `main` as the branch or base is refused at creation.
- A write while recovery is not VERIFIED is refused.
- A replayed `plan_id` is refused.
- A second concurrent plan for the same owner is refused.
- A grant or receipt with placeholder measurements is refused.

## Open questions

1. Who can create a plan? Proposed: operator only, as with scoped grants.
2. Are 10 writes and 60 minutes the right size?
3. Should a `fallback` measurement block further writes, or only be flagged?
4. Should tier 2 (runtime code) have its own spec before any plan can touch `lib/` or `app/`?
