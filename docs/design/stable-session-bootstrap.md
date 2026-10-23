# Stable session bootstrap

> **Documentation of current behavior and open verification requirements.** This document does not change `defaultMcpSessionId` or runtime behavior.

## Default session and daily reset

In `app/api/mcp/route.ts`, `defaultMcpSessionId(actorId)` derives a fallback session ID from the current UTC date and the first 12 hexadecimal characters of SHA-256(actor ID):

```ts
return `mcp-${day}-${actorHash}`;
```

Because the UTC date is included, stateless MCP clients that omit `session_id` receive a different default session each UTC day. For non-operator callers, `canonicalMcpSessionId` prefixes the authenticated owner ID unless the supplied session already begins with that owner's prefix. Explicit session IDs take precedence over the date-derived default. **Do not change `defaultMcpSessionId`.**

## Observed result for a new stable session ID

The observed new-session result was quarantined and uninitialized: `QUARANTINED`, sigma violations `1.0`, no `z_traj` row, and consequential execution suspended. The canonical-state implementation in `lib/agents/canonical_governance_state.ts` represents that state with the following exact response fields and values:

```json
{
  "healthBand": "UNINITIALIZED",
  "recoveryState": "QUARANTINED",
  "sigmaViol": 1,
  "velocity": 0,
  "trajectoryAvailable": false,
  "nStable": 0,
  "canaryPassed": false,
  "canaryReceiptId": null,
  "stateFingerprint": null,
  "trajectoryUpdatedAt": null,
  "authorization": "denied",
  "reason": "Canonical trajectory state is uninitialized; read-only diagnostics remain available for bootstrap, while consequential execution remains suspended until z_traj exists."
}
```

These are the canonical-state field names/values in source; diagnostic tools may serialize selected fields using snake_case (for example, `sigma_viol`). The code's missing-trajectory branch uses numeric `sigmaViol: 1`, equivalent to the observed `1.0`. Do not interpret this as a successful bootstrap or a passing canary.

## What must be proven before an agent switches to a stable session

A stable ID makes trajectory continuity possible, but does not itself initialize or recover the session. Before adopting it for an agent, the repository owner should require evidence for all of the following:

1. **A real bootstrap path from quarantine.** Demonstrate how a session with no `z_traj` row reaches an initialized canonical trajectory and then meets the existing recovery prerequisites. In current source, `advanceRecoveryPlane` returns `UNINITIALIZED` when the trajectory is absent; it does not create the missing row.
2. **The sigma decay/reset rate and mechanism.** Establish how `sigma_viol = 1.0` can become exactly zero, which persisted state is authoritative, what event causes decay/reset, and whether this is safe and auditable. Do not assume sigma decays merely with time or ordinary reads.
3. **The number of calls and elapsed time required.** Measure the sequence from the actual quarantined starting state through bootstrap, recovery, stable observations, and operator canary. Current recovery logic requires (M \ge \texttt{TAU_RECOVERY}), velocity strictly below `RECOVERY_STABILITY_THRESHOLD`, zero sigma violations for canary eligibility, and at least `CONSTITUTION.N_MIN` stable observations (currently 3). Counted stability observations require at least five seconds between observations; if the prior velocity is too high, the controller first records a zero-velocity baseline without incrementing the stable count. This does **not** establish a fixed number of calls from a no-trajectory/sigma-1 starting state.

Do not switch an agent's production connector to a stable session until these points are demonstrated with reproducible runtime evidence and owner review.

## Session ID format and ownership

The MCP route returns the exact ownership validation message:

```text
session_id must belong to the authenticated caller
```

For non-operator sessions, use the owner-scoped format:

```text
<owner-id>:<name>
```

Here, `<owner-id>` must be the authenticated caller's actual owner ID, and `<name>` should be a stable, unique, descriptive identifier for that agent. The owner prefix is an ownership boundary, not a secret or an authorization grant. Do not copy another caller's owner ID or assume a stable session ID grants elevated capabilities.

## Safety boundary

A persistent session ID is a continuity choice only. It does not bypass recovery, capability restrictions, or per-action approval. A passing canary is health evidence, not write authority; consequential actions continue to require the existing authorization and approval path.

---

**Verification status:** the no-trajectory behavior and recovery prerequisites are grounded in source. A complete production bootstrap path, sigma decay/reset behavior, and call count from the observed quarantined state remain **unverified**.
