# Client-Scoped Recovery Controller v1

**Status:** Proposed implementation contract  
**Scope:** MCP client recovery progression without client-controlled certification or authority restoration  
**Security posture:** Fail closed; preserve all existing recovery thresholds and operator controls

## 1. Decision

Expose a new public MCP operation, `request_recovery_pulse`, for an authenticated client to request one bounded recovery-controller step for its own canonical MCP session.

Do not make the existing `advance_recovery_plane` operator control-plane operation public. Do not make `run_recovery_canary` public. The new operation is a constrained request to the existing internal recovery controller; it is not an execution capability.

The client cannot choose an arbitrary target session, set CRS values, increment stability counters, supply recovery evidence, run a canary, or restore its own execution permissions.

## 2. Existing mechanisms to preserve

The implementation must reuse, not fork, the existing mechanisms:

- `advanceRecoveryPlane(sessionId)` in `lib/agents/recovery_runtime.ts`.
- `deriveRecoveryState` and `recoveryCapabilityAllowed` in `lib/agents/recovery_state.ts`.
- `readCanonicalGovernanceState` and the verified trajectory bootstrap in `lib/agents/canonical_governance_state.ts`.
- Existing canary evidence validation and operator/owner restrictions.
- Existing per-action capability checks and approval binding.

Do not change `TAU_FLOOR=0.05`, `TAU_RECOVERY=0.15`, `N_MIN=3`, exact-zero sigma eligibility, the velocity stability threshold, the five-second minimum observation interval, or canary expiry.

## 3. Client API contract

### Tool

`request_recovery_pulse`

Input schema: empty object. In particular, **no `session_id` field** is accepted from the client.

The MCP route derives the canonical session from authenticated owner and actor identity using the existing session-resolution path. It passes that server-derived session ID to the internal recovery controller.

The route must reject the request if the resolved session is absent, anonymous, uninitialized, or cannot be verified as belonging to the authenticated owner. It must never fall back to a caller-supplied session identifier.

### Response

Return a structured result containing:

- `status`: `ADVANCED`, `WAITING`, `BLOCKED`, or `UNAVAILABLE`.
- `recovery_state`: canonical state after the pulse.
- `M`, `velocity`, `sigma_viol`.
- `stable_observations` and `required_observations`.
- `next_allowed_observation_at` or a wait duration when the controller enforces the observation interval.
- `receipt_id` for the governed request, when available.
- `grants_write_authority: false` (always).

Do not return another tenant's identifiers, raw database errors, credentials, or internal owner IDs.

### Semantics

One request performs at most one existing bounded recovery pulse. It must not loop, sleep-and-retry, fabricate observations, or run multiple pulses to force recovery.

- Below the hard floor: return `BLOCKED`; do not mutate the trajectory.
- Between the floor and recovery threshold: the existing bounded governor correction may run.
- At or above the recovery threshold: the existing controller may record at most one observation and only if its dwell-time and velocity preconditions pass.
- If the observation interval has not elapsed: return `WAITING`; do not increment `n_stable`.
- If storage, compare-and-set, ownership, or canonical-state verification fails: fail closed and return `UNAVAILABLE` or `BLOCKED`.

A denied ordinary action must not be used as an implicit recovery trigger by the client contract. Recovery is an explicit, separately receipted request.

## 4. Authority separation

| Operation | Client agent | Lex runtime | Operator |
|---|---:|---:|---:|
| Read own recovery status | Yes | Yes | Yes |
| Request one bounded recovery pulse | Yes | Executes bounded controller | Yes |
| Choose recovery values/counters | No | No arbitrary client input | No |
| Certify recovery evidence | No | Trusted canary service | Authorized operator path |
| Run exact-snapshot canary | No | Trusted service under operator control | Yes |
| Restore consequential authority | No | Only normal gate evaluation | No direct bypass |
| Break-glass hard-lock override | No | No | Explicit authorized operator path |

A passing canary is evidence, not a capability grant. A NORMAL recovery state only permits the ordinary authorization pipeline to evaluate an action; it does not bypass capability checks, owner approval, single-use action binding, or external adapter consumption.

## 5. Hard-lock and escalation policy

The client pulse must not clear or bypass hard locks.

Require operator escalation when any of the following applies:

- M is below the quarantine floor.
- Identity, owner, tenant, or session binding is missing or contradictory.
- A sovereignty/authority breach or explicit hard-lock condition is present.
- Canonical storage is unavailable or compare-and-set repeatedly fails.
- Sigma or velocity remains outside the canary predicate after bounded recovery attempts.
- Recovery evidence is malformed, expired, or inconsistent with the current canonical snapshot.

Do not add a client option to override these conditions.

## 6. Abuse controls

Before exposing the tool publicly, add:

1. Server-derived session binding; reject any attempt to pass a target session.
2. Per-owner and per-session rate limiting for pulse requests.
3. A single pulse per call; no internal retry loop.
4. Existing five-second observation dwell enforcement in the recovery controller.
5. Audit receipts for accepted, waiting, and denied requests, without logging secrets.
6. Explicit idempotency/concurrency handling: concurrent requests must not count the same canonical sample twice. Preserve compare-and-set semantics.
7. Response redaction so callers receive only their own session's recovery diagnostics.

The rate limit is an abuse-control ceiling, not a way to weaken the five-second dwell requirement.

## 7. Required tests

### Access control
- Public authenticated client can discover and call `request_recovery_pulse`.
- Anonymous/invalid credentials cannot call it.
- Public client cannot call `advance_recovery_plane` or `run_recovery_canary`.
- Operator-only controls remain operator-only.
- Client cannot supply or substitute another session ID.
- Tenant A cannot read or advance Tenant B's session.

### Recovery behavior
- Below-floor state remains quarantined and unchanged.
- Degraded but above-floor state advances by at most one bounded correction.
- Stable state before the dwell interval returns WAITING and does not increment `n_stable`.
- One eligible request records no more than one stable observation.
- Concurrent requests cannot double-count one sample.
- Storage/CAS failures fail closed.
- Existing exact-zero sigma, velocity, N_MIN and canary predicates remain unchanged.

### Authority
- Pulse response always reports `grants_write_authority: false`.
- Pulse never creates an approval request or approval token.
- Pulse never writes to external systems.
- Client cannot invoke canary persistence or mark evidence passed.
- Even with a valid canary and NORMAL state, consequential actions still require their existing ordinary approvals.

### Regression
- Existing operator recovery pulse tests remain passing.
- Existing canary tests remain passing.
- Existing MCP OAuth, session ownership, approval-binding and hard-lock tests remain passing.

## 8. Rollout plan

**Phase 1 — contract and tests:** approve this contract, add route-level access-control tests and recovery-controller tests.

**Phase 2 — client pulse:** add the new public tool and server-derived session binding while leaving the old operator tool and canary untouched.

**Phase 3 — validation:** run focused Vitest suites, TypeScript/lint/build, all relevant GitHub Actions, and a non-production integration test using two distinct tenant identities. Verify no cross-tenant access and no canary/approval side effects.

**Phase 4 — deployment:** merge only after review and green CI. Verify deployment and test using a dedicated client test session, not the operator's recovered production session.

## 9. Non-goals for v1

- No public canary.
- No automatic hard-lock release.
- No change to CRS formulas, thresholds, or stability semantics.
- No auto-approval or approval-token issuance.
- No background recovery daemon or timer-driven state mutation.
- No cross-session or cross-tenant recovery.
- No production database or environment-variable changes.

## 10. Design rationale

This gives client agents a useful self-service recovery mechanism without making them the authority that certifies their own trustworthiness. The design also makes recovery observable, bounded, auditable, and attributable to the authenticated tenant.

The separation of monitoring, incident response, recovery, and accountable human oversight is consistent with the NIST AI RMF's post-deployment monitoring and recovery guidance (MANAGE 4.1 and 4.3): https://airc.nist.gov/airmf-resources/airmf/5-sec-core/
