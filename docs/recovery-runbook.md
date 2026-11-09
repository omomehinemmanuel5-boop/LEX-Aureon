# Recovery Runbook

This runbook describes the repository's current gates. A diagnostic result is not an authorization grant. Do not lower thresholds, edit counters, replay a denied action in a loop, or treat a canary as permission to write.

## The three gates

### 1. Recovery state

`lib/agents/recovery_state.ts` defines `deriveRecoveryState` and `recoveryCapabilityAllowed`; `lib/constitution.ts` defines `CONSTITUTION.TAU_FLOOR` (0.05), `CONSTITUTION.TAU_RECOVERY` (0.15), `CONSTITUTION.N_MIN` (3), and `CONSTITUTION.SIGMA_THRESHOLD` (0.25). Below the floor, execution is quarantined; below the recovery threshold the state is recovering. At or above the recovery threshold, the state remains `RESTORING` until the required stable observations, **exactly zero canonical sigma**, and a passing exact-snapshot canary are present. `SIGMA_THRESHOLD` is not a substitute for the canary's exact-zero predicate. Verified evidence yields `VERIFIED` when M is below 0.25 and `NORMAL` otherwise. Recovery eligibility never substitutes for capability checks or approval.

### 2. Server-issued canary and operator audit route

`canonical_governance_state.ts` evaluates the server canary predicate for an authenticated API-key or operator session during the same request. The evidence writer rereads the canonical `z_traj` row, verifies the exact fingerprint and all predicate terms, then uses a compare-and-set `INSERT ... SELECT` to persist evidence with issuer `server:recovery-canary`, probe `server_recovery_canary`, and the same one-hour default expiry (`CANARY_WINDOW_MS ?? 60 * 60 * 1000`). The client cannot supply a canary result, `n_stable`, sigma, or velocity. The shared predicate requires M at least `TAU_FLOOR` and `TAU_RECOVERY`, `nStable >= N_MIN`, exactly zero sigma, and finite velocity below `RECOVERY_STABILITY_THRESHOLD`. Uninitialized or unavailable trajectory state cannot receive a canary. Existing operator-issued canary records are preserved: the server issuer will not append over a session that has an operator canary record. `run_recovery_canary` remains a privileged read-only audit route and uses the same predicate: operator-secret callers are permitted, while API-key callers must have their exact authenticated owner ID listed in `LEX_CANARY_OWNER_IDS`; a `private_test` profile alone does not bypass that allowlist. A canary is evidence, not write authorization.

### 3. Recovery admission versus per-action approval

`request_recovery_pulse` is a distinct `recovery` capability, not an ordinary write. It is authenticated and owner-session-bound, rate-limited, compare-and-set protected, bounded to the recovery trajectory, and never grants write authority. It is intentionally usable while `n_stable < N_MIN`; otherwise a session could not recover from the state that requires recovery. `advance_recovery_plane` remains operator-only.

All ordinary writes, external actions, identity actions, and destructive actions remain per-action approval-gated. Their signed approval path requires `LEX_APPROVAL_SIGNING_SECRET` to be configured in every production runtime; a missing secret must fail closed for those actions and must never disable or weaken the bounded recovery pulse.

### 4. Per-action approval

`lib/approval_requests.ts` binds an approval request to authenticated owner, session, tool name, canonical argument hash, status, and expiry. `REQUEST_TTL_MS = 15 * 60 * 1000` gives a 15-minute approval-request lifetime. `lib/agents/constitutional_tool_executor.ts` rechecks governance and consumes approvals immediately before dispatch. A passing recovery canary does not replace this approval, and approval does not bypass recovery, capability, or canonical-state checks.

## Denials and the next step

- **`Recovery state RESTORING: non-read capability denied...`** Read the returned `n_stable`, required `N_MIN`, M, velocity, sigma, and canary status from `get_constitutional_state`. If `n_stable < N_MIN`, continue with deliberate recovery-plane observations. If the count is sufficient but there is no valid canary, the server evaluates and issues one automatically on an authenticated request once the canonical predicate passes. The operator-only `run_recovery_canary` remains available for an explicit audit. If sigma or velocity fails its gate, investigate that condition; do not force a canary.
- **`Approval request is bound to different arguments...`** Retry only with exactly the arguments that were approved. `approvalArgsHash` in `lib/approval_requests.ts` hashes the canonical argument object; `task_context` and any extra action field are part of that object unless they are one of the explicitly excluded approval-metadata keys. Do not add, remove, or rewrite fields after approval. If the exact approved arguments are unavailable, create a new approval request.
- **`unclassified_tool:<name>`** Stop. Report the exact tool name and denial text to the repository owner/operator; do not retry under a different name or search for another tool that writes to `main`. The request-approval classification issue was fixed in PR #163; if it recurs, capture the tool name, receipt, and current gate state for investigation.

## Governance outcomes and the trajectory

Every governed request ends in one of three outcomes. The table is the rule; the code paths are listed in the PR history for the change that introduced it.

| Outcome | Trajectory write (`updateZTraj`) | Recovery credit | Audit receipt |
|---|---|---|---|
| Content refusal after `decideRefusal()` (the kernel judged the request harmful) | Yes, unchanged | No | Yes |
| Authorization denial before the kernel runs (unknown capability, missing or pending approval, floor block, blocked arguments, cancellation, failed recheck) | No | No | Yes |
| Executed, non-refused turn | Yes | Eligible under the existing `shouldAdvanceRecoveryPlane` predicate | Yes |

Content refusals move the trajectory on purpose: probing with harmful requests should push state down, not cost the attacker nothing. Authorization denials say nothing about the content of a request, so they never move state. Refusals never earn recovery credit, so a refusal cannot help a session recover.

## Owner self-reset of a quarantined session

A session below the quarantine floor (M < 0.05) can be reset by its owner with `POST /api/lex/session/reset` and the owner's API key. The reset:

- affects only the caller's own session. Session ownership is checked against the key ID;
- is refused for any session that is not below the floor, so it cannot skip normal recovery;
- archives the trajectory row into `quarantine_resets` and deletes the live row in one transaction. If the archive fails, nothing is deleted;
- creates no authority. The next governed call creates a uniform row, and consequential actions still need recovery and per-action approval;
- after 5 resets in 24 hours, pauses further resets for one hour and logs an alert. Normal use is not limited.

Account-level quarantine: quarantine follows the account (the API key's email), not the key. When any session owned by an email drops below the floor, the account is flagged. A new key for that account then starts below the floor instead of at the uniform state, so rotating keys does not clear quarantine. A reset clears the account flag in the same transaction as the archive.

Denial receipts: cancellations observed before dispatch and approvals that cannot be consumed exactly once now write an `EXEC-DENY` receipt marked `state_effect=none`. None of these paths moves the trajectory.

## For agents and clients: handling a quarantine denial

A denied response for a quarantined session includes a structured block:

- `quarantined: true`
- `reset_available: true`
- `reset`: the method, endpoint (`/api/lex/session/reset`), and header (`x-lex-api-key`)

When an agent sees `quarantined: true` and holds the owner's API key, it can call the reset endpoint with that key and then retry the original request. No human step is needed. The reset is refused if the session is not below the floor, so an agent cannot use it to skip recovery. If the reset is paused, the response says so, and the agent should stop and report to the owner.

A reset does not grant authority. After a reset, consequential actions still need recovery and per-action approval.

## Recovery procedure

1. Use the exact intended governance session. A client may call the bounded `request_recovery_pulse` while `n_stable < N_MIN`; the pulse is not a write approval and never authorizes the intended action. The recovery controller records compare-and-set observations through governed entry points; a denied or approval-pending action does not execute, does not move the trajectory, does not advance recovery, and creates no approval while the gate denies; only executed actions and non-refused governance turns move the trajectory. Do not try to call `advance_recovery_plane` as a standalone tool: `advanceRecoveryPlane` is an internal controller function, not a user-facing authorization path. Read the returned `n_stable` and current canonical state after each deliberate request. Recovery never grants write authority.
2. Read `get_constitutional_state` and verify the persisted `n_stable`, M, velocity, sigma violations, recovery state, and canary status. A bounded correction while M is below `TAU_RECOVERY` is not a counted stable observation. If the prior velocity is at or above `RECOVERY_STABILITY_THRESHOLD`, the controller records a zero-velocity baseline and leaves the stable count at zero.
3. Respect the server-selected observation interval: 5 seconds with no breach in the current recovery episode, 10 seconds after one breach, and 15 seconds after two or more breaches. The server derives the episode count from persisted canary invalidations and governed receipt snapshots; client-supplied counts are never accepted. After a canary is verified, the interval resets only after `N_MIN` additional counted observations remain clean (M at or above `TAU_RECOVERY`, sigma exactly zero, and the persisted `n_stable` streak increases). If the persisted history cannot be read completely, the server uses the 15-second maximum. A baseline write and a counted stable observation remain separate writes; do not count the baseline as one of the required `N_MIN` samples. Follow any returned wait interval and re-read state before the next deliberate call. Do not loop or fabricate observations.
4. Repeat until the persisted count reaches `CONSTITUTION.N_MIN` (3), M meets the recovery threshold, velocity is below `RECOVERY_STABILITY_THRESHOLD`, and sigma satisfies the canary predicate. On the next authenticated request, the server evaluates the canonical snapshot and persists evidence automatically if every predicate term passes. Use `run_recovery_canary` only when an operator audit is specifically required.
5. Only then retry the intended action through its ordinary capability and per-action approval path. If the action changes the canonical snapshot, re-check recovery and canary evidence before the next consequential action.

For non-operator MCP callers, the default session is canonicalized as `<owner-id>:mcp-<12-hex-actor-hash>`. These are placeholders, not a real identity. `defaultMcpSessionId` in `lib/mcp_http.ts` hashes the actor ID with SHA-256 and uses the first 12 hexadecimal characters; the fallback does **not** include the UTC date, so stateless clients reuse the same actor-derived session across date boundaries. `canonicalMcpSessionId` adds the authenticated owner prefix unless it is already present. Explicit client session IDs take precedence, and operator session handling remains separate. This stable ID is continuity, not authorization; verify ownership and existing trajectory history before making claims about a particular production session.

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
