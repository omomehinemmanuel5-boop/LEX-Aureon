# Stability trace: `updateZTraj` and `n_stable`

**Scope:** source trace on `docs/stability-trace`, based on the refreshed `main` checkout available during this task. This report changes documentation only.

## Findings at a glance

- There are **two direct `updateZTraj` call sites**: `writeKernelReceipt` in `lib/kernel_bridge.ts:316`, and `advanceRecoveryPlane` in `lib/agents/recovery_runtime.ts:116`.
- A normal MCP governed tool call does **not** call `writeKernelReceipt`. Its ordinary governance state/receipt is persisted in `tool_sessions` and `tool_receipts` by `commitGovernanceDecision` (`lib/agents/governance_commit.ts:49-99`), which does not write `z_traj`.
- MCP admission separately calls `ensureCanonicalTrajectoryState()` (`app/api/mcp/route.ts:768-783`), which inserts a missing `z_traj` row with `n_stable=0` and `ON CONFLICT DO NOTHING` (`lib/agents/canonical_governance_state.ts:41-60`). This can initialize `z_traj`, but does not increment an existing row's counter.
- MCP calls can nevertheless reach `updateZTraj` indirectly through `advanceRecoveryPlane` under a restricted recovery-state condition. In particular, the executor skips the recovery write when `M >= 0.15`; that includes healthy sessions.
- `/api/lex/govern`, `/api/lex/govern/stream`, and the compatibility `/api/lex/kernel` endpoint reach `writeKernelReceipt` on their non-simulation/successful-turn paths. That function attempts `updateZTraj` before writing the `praxis_receipts` receipt.
- No direct `updateZTraj`, `writeKernelReceipt`, `advanceRecoveryPlane`, or `executeGovern` call was found in the inspected scheduled/cron routes or `lib/governor_loop.ts`.

## 1. Every direct `updateZTraj` caller and its entry point

| Direct caller | Function and call | Entry point reaching it | What the code shows |
|---|---|---|---|
| `lib/kernel_bridge.ts:316` | `writeKernelReceipt()` calls `updateZTraj(sessionId, currentCRS, prevCRS, result.attack_pressure, lawEvents)` | `lib/governance_service.ts:421` calls it from `executeGovern()`; the public JSON entry point is `POST /api/lex/govern` at `app/api/lex/govern/route.ts:175-179`. Also called directly by `POST /api/lex/govern/stream` at `app/api/lex/govern/stream/route.ts:414-416`, and `POST /api/lex/kernel` at `app/api/lex/kernel/route.ts:123-139`. | `writeKernelReceipt` derives `currentCRS` from `result.state` and `prevCRS` from `result.receipt.raw_state`; it attempts the z-trajectory update at lines 310-319. The three web entry points listed above are the only application call sites found for this function. |
| `lib/agents/recovery_runtime.ts:116-121` | `advanceRecoveryPlane()` calls `updateZTraj(sessionId, next, x, current.attack_pressure)` | Called from the governed MCP executor at `lib/agents/constitutional_tool_executor.ts:255-265` and `:294-307`; also from `executeGovern()` at `lib/governance_service.ts:183-188`, reached by `POST /api/lex/govern` (`app/api/lex/govern/route.ts:175-179`). | The recovery-runtime function returns before this call if no trajectory exists, `M >= TAU_RECOVERY`, or `M < TAU_FLOOR`; see `lib/agents/recovery_runtime.ts:37-73`. Thus it reaches `updateZTraj` only for an existing trajectory with `0.05 <= M < 0.15` (`lib/constitution.ts:4-9`). |

### Scheduled/background jobs

The repository-wide search found only those two direct `updateZTraj()` calls. The follow-up search across `app/api/cron`, `app`, `lib`, and `lib/governor_loop.ts` found no cron/background call to `updateZTraj`, `writeKernelReceipt`, `advanceRecoveryPlane`, or `executeGovern`. The cron routes present in the searched tree therefore do not directly reach these writers in the inspected source. This is a source-call-site finding, not a claim about external systems invoking HTTP routes.

## 2. MCP `tools/call` chain and `z_traj` outcome

1. `POST` in `app/api/mcp/route.ts` handles MCP requests (`:113` onward). In the `tools/call` branch, the route resolves and authorizes the named tool (`:698-737`), establishes the authenticated session (`:740-783`), and binds the session to tool arguments (`:813-830`). Before executor dispatch, it calls `runZTrajMigrations()` and `ensureCanonicalTrajectoryState(sessionId)` (`:768-783`); the latter only inserts a missing neutral row with `n_stable=0` (`lib/agents/canonical_governance_state.ts:41-60`).
2. For a tool without a declared trajectory, the route invokes `executeGovernedTool(...)` at `app/api/mcp/route.ts:1108-1119`. For a tool with an active trajectory, it calls `executeGovernedTrajectoryAction(...)` at `:913-926`; that function delegates to `executeGovernedToolStructured(...)` at `lib/agents/trajectory_executor.ts:127-139`. The canary and diagnostics have a trajectory bypass but still use the governed executor (`app/api/mcp/route.ts:865-870`, `:983-1001`).
3. `executeGovernedTool()` is a wrapper around `executeGovernedToolStructured()` (`lib/agents/constitutional_tool_executor.ts:559-583`). The structured executor reads canonical state, may call `advanceRecoveryPlane`, then calls `interceptToolCall` (`:245-270`, `:338-345`). The handler is invoked later at `:516-532` after governance checks.
4. The ordinary MCP governance commit writes the independent `tool_sessions` counters/state and `tool_receipts` record atomically (`lib/agents/governance_commit.ts:49-99`); `lib/agents/tool_interceptor.ts:369-431` computes and commits that updated tool-session `n_stable` for the governed tool decision. These are **not** the `z_traj.n_stable` column.
5. Neither the MCP route's ordinary executor dispatch nor the executor calls `writeKernelReceipt` (the `writeKernelReceipt` application call-site search lists only the three Lex HTTP routes above). There is no ordinary executor-side `updateZTraj` call. The route may initialize a missing `z_traj` row at `n_stable=0`, but does not mutate an existing counter there. The one indirect counter-update exception is the optional `advanceRecoveryPlane` call described next.

**MCP conclusion:** a normal MCP tool call **can** increase an existing `z_traj.n_stable`, but only if the executor reaches `advanceRecoveryPlane`, the stored trajectory is in its writable recovery interval (`0.05 <= M < 0.15`), and the resulting CRS velocity is strictly less than `0.02`. The MCP route can also initialize a missing row at `n_stable=0`, but that is not an increment. The executor's first pulse condition is canonical state available, trajectory present, `M >= 0.05`, and `(M < 0.25 || nStable < 3)` (`lib/agents/constitutional_tool_executor.ts:245-265`); for `M >= 0.15`, `advanceRecoveryPlane` returns before `updateZTraj` (`lib/agents/recovery_runtime.ts:51-61`). A denied non-read capability can trigger a second pulse if the fresh canonical gate still denies and `M >= 0.05` (`constitutional_tool_executor.ts:294-307`). For an ordinary healthy session at or above `M = 0.15`, these recovery pulses do not update `z_traj`; the executor's separate `tool_sessions.n_stable` bookkeeping is not evidence that `z_traj.n_stable` changed.

## 3. `writeKernelReceipt` trace: does it call `updateZTraj`, and who reaches it?

Yes. `writeKernelReceipt()` in `lib/kernel_bridge.ts:223-228` calls `updateZTraj()` at `:310-319`. Specifically, it prepares the final and raw CRS at `:314-316` and attempts the `z_traj` update **before** the `praxis_receipts` insert (`:361-413`). Failure of the trajectory update is caught and logged at `:317-319`; the function continues to receipt persistence. It subsequently performs a best-effort governor-log write (`:429` onward).

Its application entry points are:

- `POST /api/lex/govern`: `app/api/lex/govern/route.ts:175-179` calls `executeGovern`; `lib/governance_service.ts:146-149` is that function, which calls `writeKernelReceipt` at `:419-422` when not in simulation mode.
- `POST /api/lex/govern/stream`: `app/api/lex/govern/stream/route.ts:139` is the POST handler; after a successful kernel result it calls `writeKernelReceipt` at `:414-416`.
- `POST /api/lex/kernel`: `app/api/lex/kernel/route.ts:39` is the POST handler; after a successful kernel result it calls `writeKernelReceipt` at `:123-139`.

No `writeKernelReceipt()` call site was found in `app/api/mcp` or `lib/lex_crs_agent`.

## 4. Every `advanceRecoveryPlane` caller and condition

| Caller | Entry point | Condition visible in source |
|---|---|---|
| `lib/agents/constitutional_tool_executor.ts:255-265` | MCP `tools/call` through `executeGovernedToolStructured()`; both bare MCP dispatch (`app/api/mcp/route.ts:1108-1119`) and trajectory dispatch (`lib/agents/trajectory_executor.ts:127-139`) converge here. | Pre-execution pulse only when canonical state is available, a trajectory exists, `M >= KERNEL_CRITICAL` (`0.05`), and either `M < 0.25` or `nStable < 3`. It refreshes canonical state after the pulse. |
| `lib/agents/constitutional_tool_executor.ts:294-307` | Same MCP executor, after the canonical gate rejects the attempted capability. | Only for a non-read capability, existing trajectory, and `M >= 0.05`; the denied requested action is not executed by this branch. |
| `lib/governance_service.ts:183-188` | `POST /api/lex/govern` -> `executeGovern()` (`app/api/lex/govern/route.ts:175-179`). | Only outside simulation; after `loadKernelState`, calls the recovery plane if the loaded CRS minimum is `< 0.25`. Exceptions are logged and the governance service continues. |

No other production caller was found. Within `advanceRecoveryPlane`, the current row is read first; missing trajectory returns `UNINITIALIZED` (`lib/agents/recovery_runtime.ts:37-49`). If `M >= CONSTITUTION.TAU_RECOVERY` (`0.15`), it returns without updating (`:51-61`). If `M < TAU` (`0.05`), it returns quarantined without updating (`:63-73`). Only the remaining interval proceeds to construct a bounded correction and call `updateZTraj` (`:75-121`).

## 5. Exact `updateZTraj` stability rule

`updateZTraj()` is defined in `lib/kv.ts:278-284`. It computes velocity as the Euclidean/L2 distance between current and previous C/R/S (`:288-291`). It sets

```ts
n_stable = velocity < 0.02 ? (existing?.n_stable ?? 0) + 1 : 0;
```

at `lib/kv.ts:293-295`. The comparison is strict: velocity equal to `0.02` resets the counter to zero; only velocity **below** `0.02` increments it. The computed `n_stable` is included in the `z_traj` upsert at `:342-357` and persisted by the `INSERT ... ON CONFLICT ... UPDATE` at `:361-383` (with a migration retry at `:384-417`).

## 6. Short answer

**Yes, conditionally:** a normal MCP governed tool call can increase an existing `z_traj.n_stable` only through the executor’s `advanceRecoveryPlane()` call (`lib/agents/constitutional_tool_executor.ts:255-265`, or its denied-nonread branch at `:294-307`), which reaches `updateZTraj()` only for `0.05 <= M < 0.15` (`lib/agents/recovery_runtime.ts:51-73,116-121`), and increments only when the correction’s L2 velocity is `< 0.02` (`lib/kv.ts:288-295`). MCP admission can separately create a missing row at zero (`lib/agents/canonical_governance_state.ts:41-60`), but this is initialization, not an increase. For `M >= 0.15`, the recovery function exits without updating; ordinary MCP governance bookkeeping instead changes `tool_sessions.n_stable`, not `z_traj.n_stable` (`lib/agents/governance_commit.ts:49-99`).

## Commands and source views used

Repository searches run:

```sh
rg -n 'updateZTraj\s*\(' --glob '!node_modules/**' --glob '!docs/**' .
rg -n 'advanceRecoveryPlane\s*\(' --glob '!node_modules/**' --glob '!docs/**' .
rg -n 'writeKernelReceipt\s*\(' --glob '!node_modules/**' --glob '!docs/**' .
rg -n 'writeKernelReceipt\s*\(' app lib --glob '*.ts'
rg -n 'executeGovern\s*\(' app lib --glob '*.ts'
rg -n 'updateZTraj|writeKernelReceipt|advanceRecoveryPlane' lib/lex_crs_agent app/api/mcp --glob '*.ts'
rg -n 'updateZTraj|writeKernelReceipt|advanceRecoveryPlane|executeGovern\s*\(' app/api/cron app lib/governor_loop.ts --glob '*.ts'
rg -n -i '(insert\s+into|insert\s+or\s+ignore\s+into|update)\s+z_traj|z_traj\s*\(' app lib --glob '*.ts'
rg -n 'export const TAU\b|const TAU\s*=' lib/aureonics_core.ts lib/aureonics_math.ts lib/constitution.ts
```

Source ranges inspected (line numbers refer to the checked-out source cited above):

- `lib/kv.ts:245-435`
- `lib/agents/recovery_runtime.ts:1-149`
- `lib/agents/canonical_governance_state.ts:1-230`
- `lib/constitution.ts:1-14`
- `lib/kernel_bridge.ts:210-435`
- `lib/governance_service.ts:110-220, 385-440`
- `app/api/lex/govern/route.ts:80-202`
- `app/api/lex/govern/stream/route.ts:1-220, 360-435`
- `app/api/lex/kernel/route.ts:1-150`
- `app/api/mcp/route.ts:1-150, 680-737, 740-783, 813-870, 913-926, 960-1138`
- `lib/agents/constitutional_tool_executor.ts:235-435, 510-583`
- `lib/agents/trajectory_executor.ts:85-220`
- `lib/agents/governance_commit.ts:1-180`
- `lib/agents/tool_interceptor.ts:80-455`


## 7. Canonical sigma decay and exact-zero canary gate

This section follows the canonical `z_traj.sigma_viol` field used by `readCanonicalGovernanceState()`; it does not treat the separate `tool_sessions.sigma_viol` counter as equivalent.

### Update equation

In `lib/kv.ts`, `updateZTraj()` calculates:

```ts
const viol = M < TAU_LYP ? (TAU_LYP - M) : 0;
const prevSigma = existing?.sigma_viol ?? 0;
const sigma_viol = prevSigma * ((SIGMA_WINDOW - 1) / SIGMA_WINDOW) + viol / SIGMA_WINDOW;
```

With `SIGMA_WINDOW = 10`, when `M >= TAU_LYP` (currently 0.08), the update is `sigma_next = 0.9 * sigma_previous`. This is exponential decay, not a finite-time reset. For a positive starting value, repeated multiplication by 0.9 remains positive in ordinary floating-point arithmetic until it eventually underflows; it does not intentionally set the value to zero at a defined recovery boundary. When `M < 0.08`, the positive stress term also contributes to sigma, so the value can increase or settle above zero.

The canary eligibility predicate in `lib/agents/recovery_canary_evidence.ts` requires `sigma_viol === 0`. Therefore, a session with positive canonical sigma can satisfy that predicate only after the persisted value reaches exactly zero through some other explicit reset path or floating-point underflow. The current `resetZTraj()` definition sets sigma to 1 (quarantine), and repository search on this revision found no direct caller. Its existence is not evidence of an active recovery reset mechanism.

### Important path distinction

- `writeKernelReceipt()` calls `updateZTraj()` for successful non-simulation turns through the Lex governance/kernel HTTP paths.
- `advanceRecoveryPlane()` calls `updateZTraj()` only for an existing trajectory in the recovery interval `0.05 <= M < 0.15`. At `M >= 0.15`, its stable-observation path uses `recordZTrajObservation()`, which updates CRS/velocity/stability count but does not update sigma.
- Ordinary MCP governance commits update `tool_sessions` through `governance_commit.ts`; this is separate from canonical `z_traj`. The `tool_interceptor.ts` LOW/ULTRA_LOW branch that subtracts 0.05 from `tool_sessions.sigma_viol` does not by itself reduce the canonical `z_traj.sigma_viol` consumed by the recovery gate.
- The recovery state currently accepts `sigmaViol <= SIGMA_THRESHOLD` for state derivation, while canary evidence requires exact zero. These are distinct conditions and should not be conflated.

### Regression-test and policy implications

This source trace identifies a liveness mismatch: the canary asks for exact zero, while the canonical accumulator has no explicit finite-time zeroing rule for a positive value during healthy observations. Do **not** relax the canary predicate or change the sigma formula solely to make recovery pass. A runtime fix requires an explicit owner decision about what canonical evidence qualifies as zero (for example, a documented numerical tolerance and an auditable clamp, or a separate verified reset event), plus tests proving that active stress cannot be erased and that the canary remains bound to the exact current snapshot.

**Verified from source:** update equation, call paths, the separate `tool_sessions` counter, and exact-zero canary predicate.

**Not verified:** a live production session's sigma value, how often it receives canonical `updateZTraj()` writes, or whether any external/administrative process alters the persisted row. No production database was queried.


## Canonical sigma finite-time decay policy

`updateZTraj()` and the compare-and-set `recordZTrajObservation()` path both delegate the canonical sigma accumulator calculation to `lib/agents/sigma_decay.ts`. This is important because the recovery plane uses `recordZTrajObservation()` to collect safe stability samples. Both paths preserve the rolling-window recurrence:

```ts
next = previousSigma * ((window - 1) / window) + currentViolation / window;
```

When the current observation has **no** Lyapunov stress (`currentViolation === 0`), a finite, non-negative residual at or below `SIGMA_ZERO_TOLERANCE = 1e-6` is normalized to exact zero. This creates a finite-time path to the existing exact-zero canary predicate without changing that predicate or recovery thresholds.

A positive current-stress contribution is never rounded away, even if the result is below tolerance. Non-finite and negative accumulator values are not normalized to healthy zero. This numerical cleanup does not grant authority, bypass snapshot/evidence binding, or change `M >= 0.15`, `n_stable >= 3`, velocity, evidence expiry, operator restrictions, or approval requirements.

Focused helper tests live in `__tests__/sigma-decay.spec.ts`, and the compare-and-set path is covered in `__tests__/governed-tool-observation.spec.ts`. Passing CI validates the branch's configured checks; it does not establish live production recovery. No production database is queried by this change.


## Canary preflight and exact-zero sigma

The operator canary preflight and the diagnostic `next_step` now require canonical `sigma_viol === 0`, matching the recovery-evidence validators. The older `SIGMA_THRESHOLD` remains a separate stress/classification threshold; it is not sufficient for canary eligibility. A positive residual must decay through healthy observations before the canary is attempted. This is guidance and preflight alignment only: no recovery threshold, evidence binding, operator restriction, or authority rule is relaxed.

Regression coverage in `__tests__/recovery-canary-tool.spec.ts` verifies that a positive sigma value below the former threshold is rejected before the probe and that the diagnostic tells the operator how to proceed.


## Canonical recovery execution invariants

Canary evidence requires canonical velocity to be finite and strictly below `RECOVERY_STABILITY_THRESHOLD` (0.02). The exported `canonicalExecutionAllowed()` gate repeats that invariant for ordinary non-read capabilities when a state claims a passing canary, protecting against stale or caller-assembled state objects. Bounded `recovery` and `recovery_probe` capabilities remain outside this additional ordinary-execution check.

Recovery-state classification also requires exact-zero sigma for VERIFIED/NORMAL. The general `SIGMA_THRESHOLD` remains a separate diagnostic/classification constant; it does not define canary validity. This prevents a caller-assembled state with `canaryPassed: true` and positive residual sigma from being classified as recovered. Neither change grants authority or replaces ordinary authorization/approval checks.


The operator canary preflight now also requires velocity to be finite and strictly below `RECOVERY_STABILITY_THRESHOLD` before starting the diagnostic probe, and rechecks velocity in the diagnostic and post-probe canonical state. This closes a second preflight/evidence mismatch: a canary must not be attempted when the evidence validator will reject it for unstable velocity.
