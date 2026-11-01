# Unified Recovery Control Plane and Operator Client-Parity Mode v1

**Status:** Architecture proposal  
**Related:** `docs/client-scoped-recovery-controller-v1.md`  
**Principle:** One server-side recovery engine; distinct authenticated identities and authority profiles.

## 1. Decision

Lex should own recovery as a server-side control-plane service used by every integration, including the operator's own sessions. Do not implement separate client and operator recovery engines.

The same recovery service should accept authenticated, scoped requests and apply the same canonical recovery state machine, thresholds, dwell-time, evidence binding, audit and failure semantics.

The operator should additionally have a **client-parity mode**: a way to exercise the public client contract with the same tool discovery, input schema, rate limits, tenant scoping, recovery workflow, approval requirements and denial behavior as an ordinary customer integration.

Client-parity mode is a test harness, not an elevation of client permissions and not an impersonation of a real customer.

## 2. Three distinct layers

### A. Shared server-side recovery service

One internal service owns:
- Canonical recovery-state reads.
- Bounded recovery progression.
- Stable-observation dwell enforcement.
- Concurrency/idempotency and compare-and-set.
- Recovery audit receipts.
- Canary eligibility and evidence verification.
- Recovery status and next-step diagnostics.

All public MCP, private-test, operator, and future SDK/API adapters call this service. Adapters must not duplicate recovery math or write canonical trajectory rows directly.

### B. Identity and policy adapter

Every request is authenticated and resolved to an explicit principal:
- principal ID and principal type;
- tenant/owner ID;
- session ID derived server-side;
- access profile;
- requested operation;
- correlation/request ID.

The service receives this verified context, not identity fields supplied in free-form tool arguments. Operator identity remains distinct from a client owner identity. A private-test key remains attributable to its actual key owner; it must not become an operator merely because it can access selected test tools.

### C. Client-parity test harness

An operator can create or select a dedicated test tenant and use a client-parity profile that is deliberately constrained to the public client tool set.

The harness should:
- Use a dedicated test API key and test tenant.
- Exercise the same MCP `tools/list` and `tools/call` access checks as a public client.
- Use the same rate limits and request validation.
- Show exact client-visible results, errors, approvals, denials and recovery status.
- Expose a separate operator-only diagnostic view that explains why the client request was denied.
- Never silently substitute the operator's own session for a client session.
- Never read, mutate or impersonate a real customer's session.

This gives the operator both perspectives: what the customer experiences and why the control plane made that decision.

## 3. Operator modes

| Mode | Identity | Capabilities | Purpose |
|---|---|---|---|
| Operator-admin | Authenticated operator | Existing operator tools and explicit control-plane actions | Operate and diagnose Lex |
| Operator client-parity | Dedicated test principal and tenant | Exactly the public client surface | Test onboarding, integration and customer experience |
| Customer client | Customer's authenticated principal and tenant | Public client surface plus configured customer grants | Production integration |

Do not create an operator flag that makes a client request pass public authorization checks. The parity harness must use a separate test principal and real public profile.

The operator-admin view may show additional diagnostics, but it must not change the decision returned by the client path.

## 4. Recovery authority model

- A client may read its own recovery status and request one bounded recovery step.
- The server-side recovery service performs only the bounded step permitted by canonical state.
- The service never accepts client-supplied CRS values, stable counters, timestamps, canary fingerprints or evidence.
- The trusted certification path evaluates the exact canonical snapshot.
- Operator-only certification remains an explicit privileged action in v1.
- A canary receipt is evidence, not a permission token.
- NORMAL means the ordinary execution gate may evaluate a request. It does not grant write, financial, identity, execute, delegate or external-action permission.
- Hard locks, quarantine, owner/tenant mismatch, storage errors and sovereignty breaches remain fail-closed and require the existing escalation path.

## 5. Server-side service interface (conceptual)

The internal service should expose typed operations rather than a generic "recover" endpoint:

- `readRecoveryStatus(principalContext, sessionId)`
- `requestRecoveryPulse(principalContext, sessionId, requestId)`
- `evaluateCanaryEligibility(serviceContext, sessionId)`
- `certifyRecoverySnapshot(operatorContext, sessionId)`

These are conceptual names, not claims that functions currently exist. The public adapter must not expose the certification operation. The operator adapter must authenticate and authorize it independently.

All operations must validate tenant/session ownership before reading or mutating state. The recovery service must be the only writer for recovery transitions.

## 6. Observability: make operator failures diagnosable

For every client request, provide two views sharing a correlation ID:

**Client-safe view**
- status and recovery state;
- allowed/denied outcome;
- safe reason code;
- next action and retry-after guidance;
- whether operator intervention is required.

**Operator diagnostic view**
- authenticated principal/profile and tenant binding (redacted identifiers);
- resolved session binding;
- capability and recovery predicates evaluated;
- current state fingerprint/version;
- failed precondition and source subsystem;
- receipt/correlation ID;
- retryability classification;
- whether any state mutation occurred.

Never log API keys, OAuth tokens, operator secrets, approval tokens, or raw sensitive payloads. Diagnostics must not disclose another tenant's identifiers or state.

## 7. Failure and retry semantics

- A timeout after a mutation may have an unknown outcome. Return an explicit unknown status and require a fresh canonical read before retrying.
- A repeated request must not double-count a stability sample.
- A WAITING result must include retry timing and must not mutate the stable count.
- A storage or ownership verification failure must not fall back to a different session or tenant.
- Client retries must be bounded and idempotent by authenticated principal, session, and request identity.
- Operator diagnostics must not silently retry or mutate state.

## 8. Rollout

1. Keep the current recovery engine and operator canary unchanged.
2. Introduce a typed server-side recovery service facade around existing recovery functions, without changing thresholds or state semantics.
3. Add public `request_recovery_pulse` through the facade, with server-derived client session and tenant checks.
4. Add a dedicated operator client-parity test principal/tenant and test harness.
5. Add paired integration tests asserting client response and operator diagnostic explanation share the same correlation ID and decision.
6. Add two-tenant isolation, concurrency, timeout, idempotency, rate-limit and hard-lock tests.
7. Run all relevant test suites and CI before deployment.
8. Validate with a dedicated test tenant. Never use the operator's recovered production session as a destructive test fixture.

## 9. Non-goals

- No shared operator/customer identity.
- No public canary or client self-certification.
- No customer session impersonation.
- No direct database recovery writes from adapters.
- No background timer that mutates recovery state without a request and audit trail.
- No threshold, quarantine, hard-lock, OAuth or approval-binding changes.
- No automatic grant of consequential capabilities after recovery.

## 10. Recommendation

Unify the recovery engine server-side and preserve distinct access profiles. Give the operator a first-class client-parity test mode backed by a dedicated test tenant. This makes Lex easier to operate and gives its creator a faithful way to find integration and policy failures without weakening the customer security model.
