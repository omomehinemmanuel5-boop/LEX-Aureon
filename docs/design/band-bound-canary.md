# Band-bound recovery canary

> **Proposal, not implemented.** This document describes a design option only. It does not change runtime behavior, thresholds, or authorization.

## Problem: exact-snapshot binding

The current canary evidence is bound to an exact canonical-state fingerprint. In `lib/agents/recovery_canary_evidence.ts`, `recoverySnapshotFingerprint` hashes the session ID, policy version, C, R, S, `nStable`, and `sigmaViol` (numeric values use 17-digit precision). `lib/agents/canonical_governance_state.ts` computes that fingerprint from the canonical trajectory and passes it to the canary evidence reader.

Consequently, a governed write that changes one of those fingerprinted values makes the previous pass inapplicable to the new snapshot, even if the system remains healthy. Observation timestamps and receipt IDs are intentionally excluded from the fingerprint; that does not make the fingerprint a health band.

## Proposal: bind validity to a bounded health band

Replace the exact-fingerprint equality requirement for canary validity with a defined band predicate. A canary remains valid only while all of the following hold for the same session and policy version:

- (M = \min(C,R,S) \ge \texttt{CONSTITUTION.TAU_RECOVERY}).
- `sigma_viol` is exactly zero.
- Velocity is finite and strictly below `RECOVERY_STABILITY_THRESHOLD` (currently `0.02` in `lib/agents/recovery_state.ts`).
- The canary has not expired and all other existing safety checks remain satisfied.

Any breach invalidates the canary immediately. Recovery of the metrics back into the band does not revive previously invalidated evidence; a fresh operator canary is required. Keep the validity lifetime at one hour. This proposal does not assume that a write is safe merely because the band remains satisfied.

The band definition, its persisted evidence representation, and how a breach is made atomic with a write are open implementation questions—not implemented behavior.

## Required boundary tests

Before implementation, add tests for at least these boundaries:

1. **M at the threshold:** (M = \texttt{TAU_RECOVERY}) remains in-band; a value just below it is out-of-band.
2. **Velocity below the limit:** a finite value just below `RECOVERY_STABILITY_THRESHOLD` remains in-band.
3. **Velocity above the limit:** a value just above the limit invalidates the canary. Also test equality explicitly because the current predicate is strict (`velocity < threshold`).
4. **Sigma above zero:** any positive `sigma_viol`, however small, invalidates the canary.
5. **Expiry at exactly one hour:** evidence is invalid at the expiry instant, not only after it.
6. **Breach on the first write:** if the first write causes any band predicate to fail, the canary must be invalid before any subsequent consequential action can proceed. Include a race/concurrency test so a stale pre-write check cannot authorize a post-breach action.

## Explicit non-goals and invariants

- A canary is a **health precondition/evidence**, not authority to write.
- Live consequential writes continue to require their ordinary, exact-action, single-use human approval and all existing capability/governance checks.
- Do not lower `TAU_RECOVERY`, `RECOVERY_STABILITY_THRESHOLD`, or any other threshold to make a canary pass.
- Do not weaken operator-only restrictions on running the canary.
- This proposal does not grant blanket or multi-write approval.

## Quarantine and bootstrap: unresolved evidence

`lib/agents/recovery_state.ts` derives `QUARANTINED` below `TAU_FLOOR` (currently 0.05). The recovery plane in `lib/agents/recovery_runtime.ts` is a bounded recovery controller, not ordinary write authority. It reports `UNINITIALIZED` and fails closed when no canonical trajectory exists; it does not itself bootstrap a missing `z_traj` row. The canonical-state reader in `lib/agents/canonical_governance_state.ts` reports an absent trajectory as `QUARANTINED`, `sigmaViol: 1`, and consequential execution suspended.

A canary-eligible path would therefore need to establish a canonical trajectory, recover M to at least `TAU_RECOVERY`, obtain zero sigma violations, record at least `CONSTITUTION.N_MIN` (currently 3) stable observations with velocity below the limit, and then run the operator canary for that session. The current recovery runbook specifies observations at least five seconds apart. These are prerequisites, not proof that a session starting with no trajectory and sigma 1.0 can reach them.

**Not verified:** a complete, production-tested bootstrap path from the stated `QUARANTINED` / `sigma_viol = 1.0` / no-`z_traj` condition; the mechanism and rate by which sigma could return to zero; and whether initialization/reset semantics preserve auditability. Do not assume a canary can pass from that initial condition.

## Open decisions for the repository owner

1. Which exact metrics and policy/session identifiers belong to the band, and must policy-version changes always invalidate evidence?
2. Should `nStable` remain a minimum at canary issuance only, or must it remain part of ongoing validity?
3. How should the band breach be recorded and checked atomically with a write, including concurrent writes and a breach on the first write?
4. Does a failed canary or band breach permanently supersede that canary ID, and what audit event records the invalidation?
5. Should the existing governed-write-count cap remain in force, and how does it interact with band validity?
6. What is the approved bootstrap and sigma-reset/decay path for a session with no trajectory and sigma 1.0?
7. What clock source and exact expiry semantics should be used in production and tests?

---

**Status: proposal, not implemented.**
