# Stable MCP session bootstrap

> **Current source behavior and remaining production verification.** PR #210 was merged to `main` as commit `b310e204fec275c77bb8347f9cab0973873ad4ca`. This document records the code change; it does not claim that the selected production trajectory or deployment has been inspected.

## Default session identity

`defaultMcpSessionId(actorId)` now returns a stable actor-derived fallback ID:

```ts
const actorHash = crypto.createHash('sha256').update(actorId).digest('hex').slice(0, 12);
return `mcp-${actorHash}`;
```

The UTC date is no longer part of the fallback. A stateless MCP client that omits `session_id` therefore reuses the same fallback across UTC rollovers. Explicit client session IDs still take precedence. For non-operator callers, `canonicalMcpSessionId` adds the authenticated owner prefix unless the session ID already has that prefix; the effective form is `<owner-id>:mcp-<12-hex-actor-hash>`. Operator session handling remains separate.

The ID change is a continuity change, **not** a recovery or authorization grant. It may select an existing trajectory under the stable ID, so production history/collision implications must not be inferred from unit tests.

## MCP bootstrap behavior

The MCP route calls `ensureCanonicalTrajectoryState(sessionId)` during admission. That function uses `INSERT ... ON CONFLICT DO NOTHING` to seed a missing `z_traj` row with neutral CRS values (`C=R=S=1/3`), zero velocity, `n_stable=0`, `sigma_viol=0`, and a bootstrap drift label. It does not overwrite a pre-existing row.

This differs from a direct canonical-state read when no row exists: the diagnostic fallback reports `health_band: "UNINITIALIZED"`, `recovery_state: "QUARANTINED"`, `trajectory_available: false`, `n_stable: 0`, `sigma_viol: 1`, and consequential authorization denied. That fallback is not a persisted trajectory and is not evidence of a passing canary. `advanceRecoveryPlane` itself returns `UNINITIALIZED` if it is called before a trajectory exists; the MCP route's admission bootstrap is a separate operation.

For an existing stable-ID trajectory, `ON CONFLICT DO NOTHING` preserves its current state and history. That is why the selected production row must be inspected before treating the merge as operationally validated.

## Recovery prerequisites remain unchanged

The current source requires all existing recovery conditions before consequential execution can proceed:

- (M = \min(C,R,S) \ge \texttt{CONSTITUTION.TAU_RECOVERY}) (currently 0.15).
- Velocity strictly below `RECOVERY_STABILITY_THRESHOLD` (currently 0.02).
- At least `CONSTITUTION.N_MIN` stable observations (currently 3).
- Zero `sigma_viol` for canary eligibility, plus a passing operator-only canary bound to the exact current snapshot.
- Counted stable observations must be separated by at least five seconds. If the preceding velocity is too high, the recovery runtime records a baseline without counting it as stable.

The canary's exact-zero sigma rule has **not** been relaxed. The sigma decay/reset mechanism and the number of observations/time needed from a real production starting state are not established by this session-ID change.

## Required production verification — still outstanding

Use an authorized read-only production data path to inspect the exact effective session ID for the intended actor and owner. Record, without exposing credentials:

1. Whether a `z_traj` row already exists for that exact ID.
2. Its current (C,R,S,M), health band, velocity, `n_stable`, `sigma_viol`, and `updated_at`.
3. Whether its history belongs to the expected owner/agent and whether adopting it would carry forward prior state.
4. If no row exists, confirm the deployed MCP admission path bootstraps it as expected and that ordinary consequential calls remain gated until recovery and approval conditions are satisfied.

**Status:** PR #210 is merged and its PR-triggered CI, Auto Review, and LexBench Production workflow runs passed. The merge-commit post-merge three-arm smoke workflow also passed. These results validate automated checks, not the live production trajectory, current (M), health band, deployment state, or absence of session-history collisions. Those live facts remain **unverified** here.

## Session ownership and safety boundary

For non-operator sessions, use the authenticated caller's actual owner prefix. The owner prefix is an ownership boundary, not a secret. Do not copy another caller's owner ID or assume a stable session ID grants elevated capabilities.

A persistent session ID does not bypass recovery, capability restrictions, or per-action approval. A passing canary is health evidence, not write authority.
