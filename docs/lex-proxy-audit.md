# Lex proxy consistency audit

Documentation only. No behavior change. Findings are from reading the code paths
listed below as of 2026-10-11.

## Confirmed findings

1. **Attack vectors break mass conservation.** `lib/kv.ts` documents the law
   direction vectors as zero-sum. `bypass_attempt`, `identity_reframe`, and
   `sycophancy` sum to zero. `multi_attack`, `slow_drip`, and
   `attack_vector_disclosure` each sum to -1 and drain total mass when they fire.
   Governance decision required on corrected vectors.

2. **New sessions seed as OPTIMAL before any evidence.**
   `ensureCanonicalTrajectoryState` inserts every value at 1/3. 1/3 is above the
   0.25 OPTIMAL boundary, so a fresh session reads as healthy with zero
   observations. A missing row already fails closed as UNINITIALIZED, so the seed
   may not be needed.

3. **The OPTIMAL boundary is hardcoded in two places.** `deriveHealthBand`
   (`lib/kv.ts`) and `deriveRecoveryState` (`lib/agents/recovery_state.ts`) both use
   a literal 0.25. `lib/constitution.ts` has no named constant for it.

4. **Stability can be self-generated.** `advanceRecoveryPlane`
   (`lib/agents/recovery_runtime.ts`) calls `updateZTraj` with unchanged CRS once
   M is at or above tau_recovery. Velocity is 0, so `n_stable` increments without
   any real observation. Reaching N_MIN = 3 then depends only on repeated calls.
   Governance decision required.

5. **Per-call scores may not feed the gate.** Per-call CRS values move between
   calls while the canonical state stays at exactly 0.333. `updateZTraj` is called
   from `recovery_runtime.ts`, `kv.ts`, `kernel_bridge.ts`, and `aureonics_math.ts`.
   Whether ordinary governed tool calls reach it is unverified; `kernel_bridge.ts`
   has not been read.

6. **Reset reseeds as healthy.** `resetZTraj` deletes the z_traj row. The next
   governed call reseeds at OPTIMAL, which can clear quarantine and sigma history.
   Callers have not been checked.

7. **Two TAU sources.** `recovery_runtime.ts` imports `TAU` from `aureonics_core`,
   while `recovery_state.ts` uses `CONSTITUTION.TAU_FLOOR`. Equality is not
   asserted by any test.

8. **Fragile test mocks.** `__tests__/canonical-governance-state.spec.ts` feeds
   mocked query results in call order. Parallel queries in
   `readCanonicalGovernanceState` make this break under refactoring.

## Minor

- `getGovernorMode` (`lib/kv.ts`) ends with a redundant fallthrough to `'nudge'`.
- `incrementRunsKv` uses an unexplained dynamic import.
- `lib/constitution.ts` references kernel `TAU_GOV = 0.22`; not found in that file.

## Suggested order

Address finding 4 first, since it allows stability to be generated without real
observations. Then finding 5, which determines whether the gate sees live data at
all. Findings 1, 2, 3, and 6 follow.
