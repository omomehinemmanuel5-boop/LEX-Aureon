# Stable session bootstrap

> **Documentation of current behavior and open verification requirements.** This document does not change `defaultMcpSessionId` or runtime behavior.

## Default session and daily reset

In `app/api/mcp/route.ts`, `defaultMcpSessionId(actorId)` derives a fallback session ID from the current UTC date and the first 12 hexadecimal characters of SHA-256(actor ID):

```ts
return `mcp-${day}-${actorHash}`;
```

Because the UTC date is included, stateless MCP clients that omit `session_id` receive a different default session each UTC day. For non-operator callers, `canonicalMcpSessionId` prefixes the authenticated owner ID unless the supplied session already begins with that owner's prefix. Explicit session IDs take precedence over the date-derived default. The `fix/stable-mcp-session-id` branch proposes removing the date component so fallback IDs remain stable across UTC rollovers. Do not merge this change until the live trajectory selected by the new ID, its current M/health band, and any collision or history-carry-forward implications have been inspected through an authorized read-only production data path.

## Observed result for a new stable session ID

The observed new-session result was quarantined and uninitialized: `QUARANTINED`, sigma violations `1.0`, no `z_traj` row, and consequential execution suspended. For a session-specific call to `get_constitutional_state`, `lib/lex_crs_agent/tools.ts` serializes the canonical state using the following exact response field names and values for the no-trajectory case (unrelated timestamps and session ID omitted):

```json
{
  "available": true,
  "health_band": "UNINITIALIZED",
  "recovery_state": "QUARANTINED",
  "n_stable": 0,
  "n_stable_required": 3,
  "velocity": 0,
  "stability_threshold": 0.02,
  "sigma_viol": 1,
  "canary_passed": false,
  "canary_receipt_id": null,
  "state_fingerprint": null,
  "gate_snapshot": {
    "health_band": "UNINITIALIZED",
    "recovery_state": "QUARANTINED",
    "authorization": "denied",
    "trajectory_available": false,
    "n_stable": 0,
    "n_stable_required": 3,
    "velocity": 0,
    "stability_threshold": 0.02,
    "sigma_viol": 1,
    "canary_passed": false,
    "state_fingerprint": null
  },
  "diagnostic": {
    "trajectory_updated_at": null
  },
  "authorization": "denied",
  "trajectory_available": false,
  "reason": "Canonical trajectory state is uninitialized; read-only diagnostics remain available for bootstrap, while consequential execution remains suspended until z_traj exists.",
  "next_step": "Quarantined below the hard floor; only operator recovery diagnostics are actionable."
}
```

The values above follow the source's missing-trajectory branch: `available: true` means the diagnostic successfully read an uninitialized state, not that a trajectory exists. The JSON uses `sigma_viol: 1` (numeric 1.0), `trajectory_available: false`, and `authorization: "denied"`. Do not interpret this as a successful bootstrap or a passing canary.

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
