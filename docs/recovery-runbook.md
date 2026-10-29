# Recovery Runbook

This runbook describes the repository's current gates. A diagnostic result is not an authorization grant. Do not lower thresholds, edit counters, replay a denied action in a loop, or treat a canary as permission to write.

## The three gates

### 1. Recovery state

`lib/agents/recovery_state.ts` defines `deriveRecoveryState` and `recoveryCapabilityAllowed`; `lib/constitution.ts` defines `CONSTITUTION.TAU_FLOOR` (0.05), `CONSTITUTION.TAU_RECOVERY` (0.15), `CONSTITUTION.N_MIN` (3), and `CONSTITUTION.SIGMA_THRESHOLD` (0.25). Below the floor, execution is quarantined; below the recovery threshold the state is recovering. At or above the recovery threshold, the state remains `RESTORING` until the required stable observations, **exactly zero canonical sigma**, and a passing exact-snapshot canary are present. `SIGMA_THRESHOLD` is not a substitute for the canary's exact-zero predicate. Verified evidence yields `VERIFIED` when M is below 0.25 and `NORMAL` otherwise. Recovery eligibility never substitutes for capability checks or approval.

### 2. Operator canary

`run_recovery_canary` is an operator-only probe registered in `lib/lex_crs_agent/tools.ts`; its implementation and exact-snapshot evidence checks are in `app/api/mcp/route.ts`, `lib/agents/recovery_canary_evidence.ts`, and `lib/agents/canonical_governance_state.ts`. The canary checks the canonical session snapshot, including the CRS values, stable-observation count, sigma violations, velocity, and fingerprint. The validity predicate requires M at least `CONSTITUTION.TAU_RECOVERY`, `nStable >= CONSTITUTION.N_MIN`, zero current sigma violations, velocity below `RECOVERY_STABILITY_THRESHOLD`, and a current, unexpired exact-snapshot pass. The default validity window is one hour (`CANARY_WINDOW_MS ?? 60 * 60 * 1000` in `lib/agents/recovery_canary_evidence.ts`). A canary is evidence for that snapshot; it is not write authorization.

### 3. Per-action approval

`lib/approval_requests.ts` binds an approval request to authenticated owner, session, tool name, canonical argument hash, status, and expiry. `REQUEST_TTL_MS = 15 * 60 * 1000` gives a 15-minute approval-request lifetime. `lib/agents/constitutional_tool_executor.ts` rechecks governance and consumes approvals immediately before dispatch. A passing recovery canary does not replace this approval, and approval does not bypass recovery, capability, or canonical-state checks.

## Denials and the next step

- **`Recovery state RESTORING: non-read capability denied...`** Read the returned `n_stable`, required `N_MIN`, M, velocity, sigma, and canary status from `get_constitutional_state`. If `n_stable < N_MIN`, continue with deliberate recovery-plane observations. If the count is sufficient but there is no valid canary, run the operator-only canary for that exact session after verifying all other prerequisites. If sigma or velocity fails its gate, investigate that condition; do not force a canary.
- **`Approval request is bound to different arguments...`** Retry only with exactly the arguments that were approved. `approvalArgsHash` in `lib/approval_requests.ts` hashes the canonical argument object; `task_context` and any extra action field are part of that object unless they are one of the explicitly excluded approval-metadata keys. Do not add, remove, or rewrite fields after approval. If the exact approved arguments are unavailable, create a new approval request.
- **`unclassified_tool:<name>`** Stop. Report the exact tool name and denial text to the repository owner/operator; do not retry under a different name or search for another tool that writes to `main`. The request-approval classification issue was fixed in PR #163; if it recurs, capture the tool name, receipt, and current gate state for investigation.

## Recovery procedure

1. Use the exact intended governance session. The recovery controller records compare-and-set observations through governed entry points; a denied consequential action may trigger a bounded recovery pulse, but the denied action itself does not execute and no approval is created while the gate denies. Do not try to call `advance_recovery_plane` as a standalone tool: `advanceRecoveryPlane` is an internal controller function, not a user-facing authorization path. Read the returned `n_stable` and current canonical state after each deliberate request. Recovery never grants write authority.
2. Read `get_constitutional_state` and verify the persisted `n_stable`, M, velocity, sigma violations, recovery state, and canary status. A bounded correction while M is below `TAU_RECOVERY` is not a counted stable observation. If the prior velocity is at or above `RECOVERY_STABILITY_THRESHOLD`, the controller records a zero-velocity baseline and leaves the stable count at zero.
3. Wait at least five seconds between counted observations. The source constant is `RECOVERY_MIN_OBSERVATION_INTERVAL_MS = 5_000` in `lib/agents/recovery_runtime.ts`; the controller also checks the persisted trajectory timestamp. Follow any returned wait interval and re-read state before the next deliberate call. Do not loop or fabricate observations.
4. Repeat until the persisted count reaches `CONSTITUTION.N_MIN` (3), M meets the recovery threshold, velocity is below `RECOVERY_STABILITY_THRESHOLD`, and sigma satisfies the canary predicate. Then call `run_recovery_canary` for the same exact session and re-read state to confirm the pass is current.
5. Only then retry the intended action through its ordinary capability and per-action approval path. If the action changes the canonical snapshot, re-check recovery and canary evidence before the next consequential action.

For non-operator MCP callers, the default session is canonicalized as `<owner-id>:mcp-<UTC date YYYY-MM-DD>-<actor hash>`. These are placeholders, not a real identity. `defaultMcpSessionId` in `app/api/mcp/route.ts` uses the UTC date and the first 12 hexadecimal characters of SHA-256(actor ID); `canonicalMcpSessionId` adds the authenticated owner prefix unless it is already present. Explicit stable session IDs take precedence. Stateless default sessions therefore roll over daily.

## Why writes have a recovery cost

The executor in `lib/agents/constitutional_tool_executor.ts` may advance the recovery plane before an eligible non-read action and may record a trajectory observation after eligible non-read calls. The canary is bound to an exact canonical-state fingerprint in `lib/agents/recovery_canary_evidence.ts`. Treat a consequential write as a reason to re-check the state and canary before the next consequential action; do not assume that old evidence still applies. The source conditions are state-dependent, so this runbook does not claim that every write unconditionally increments or resets `n_stable`.

## Code changes versus live runtime authority

Code changes belong on a named branch and in a pull request opened by an agent with its own GitHub access. Lex governance review and the live runtime recovery/approval gate are separate controls: passing one does not grant the other. Keep the branch and PR scoped to the intended change, and do not push directly to `main`.

## Stop conditions

- No automatic retry loops for a denial, approval mismatch, stale canary, or failed observation.
- Do not search for an alternate tool that writes to `main`, use a default-branch write, or bypass branch/approval controls.
- On denial, report the exact denial text, tool name, receipt if present, session (redacted as appropriate), and the observed recovery state and counters.
- If the state is unavailable, contradictory, or changed during an observation, stop and re-read through the approved diagnostic path before deciding on a next step.
- Never lower `TAU_FLOOR`, `TAU_RECOVERY`, `N_MIN`, `SIGMA_THRESHOLD`, or the stability threshold to make a gate pass.
