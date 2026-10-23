# Lex Aureon security invariant test plan

## Scope

This suite tests the reference monitor and recovery gate as safety properties. It is not a production penetration test and does not prove that every external provider or deployed environment behaves correctly. Unit/integration tests use controlled dependencies and must never dispatch real external actions.

## Trust boundaries

1. **Identity** — authenticated actor/owner and session identity are inputs, not proof of permission.
2. **Capability registry** — unknown tools fail closed; tool names determine the capability class, not caller-provided labels.
3. **Canonical governance state** — trajectory availability, CRS floor, recovery evidence, and authorization are checked before consequential execution.
4. **Approval** — approval is bound to owner/actor, session, tool, and canonicalized arguments; expiry and one-time consumption are enforced.
5. **Side-effect boundary** — provider mutation must not happen before every applicable gate has passed.
6. **Evidence** — receipts and post-action verification describe what actually happened; a policy decision alone is not evidence of a side effect.

## Required invariants

| ID | Threat / condition | Required result | Independent observation |
|---|---|---|---|
| SEC-001 | Unknown capability/tool | Deny; no handler dispatch | Dispatch/side-effect counter remains zero |
| SEC-002 | Approval replay | Deny second use | Exactly one provider mutation |
| SEC-003 | Approval used by another owner/session/tool | Deny | No provider mutation |
| SEC-004 | Arguments changed after approval | Deny | No provider mutation |
| SEC-005 | Approval store unavailable | Fail closed | No provider mutation |
| SEC-006 | Canonical state unavailable or uninitialized | Consequential action denied | No provider mutation |
| SEC-007 | M below the configured safety floor | All execution denied | No provider mutation |
| REC-001 | Recovery threshold met but canary/stability evidence missing | Ordinary writes remain denied | No provider mutation |
| REC-002 | Canary failed, stale, or tied to a different state fingerprint | Ordinary writes remain denied | No provider mutation |
| REC-003 | Recovery controller invoked below the floor | Deny | No trajectory write |
| REC-004 | Fully verified recovery | Normal capability-specific authorization still applies | Successful authorized path and receipt |
| AUD-001 | Receipt contents do not match deterministic replay/hash | Verification reports mismatch | Tampered receipt rejected |
| TRAJ-001 | Reproducible seeded trajectory | Every generated state preserves floor, evidence, and capability invariants | Seed + case index + failing state retained |

## Test design rules

- Keep the harness deterministic: every randomized run records a fixed seed and case index.
- Randomized testing is supplementary to named regression tests; it must not replace exact boundary tests.
- Test the actual policy functions and governed executor wherever practical. A pure model test alone is not an execution-boundary test.
- Side-effect assertions must inspect the mocked provider boundary (for example, a PUT/commit count), not merely the returned decision string.
- Never weaken `TAU`, `TAU_RECOVERY`, `N_MIN`, `SIGMA_THRESHOLD`, the M floor, CRS bounds, approval binding, canary requirements, or human-approval requirements to make a test pass.
- Do not use production credentials, real provider mutations, timer-triggered actions, or live recovery-state mutation in this test suite.
- Keep destructive operations human-approved. A test fixture may simulate an approval, but must not mint production authority.

## Execution and release criteria

The pull request must pass the repository's normal CI checks (lint, typecheck, tests, coverage, dependency audit, build, and container build). A green mocked test suite is not proof that production recovery is healthy. A separate explicitly authorized staging/live test must independently verify the before/after resource state, authorization context, receipt linkage, and absence of side effects on denial.

A failure report should include: test ID, seed, case index, pre-state, requested capability, evidence inputs, expected result, actual result, and provider-side-effect count. Do not include secrets or raw approval tokens.
