# Agent Trajectory Governance

> **Atlas:** This focused implementation note is indexed by the canonical [Trajectory Governance lineage page](atlas/concepts/trajectory-governance.md). It remains the source document for the invariants below.

## Purpose

Lex already enforces constitutional authorization at the individual tool-call boundary. This layer adds trajectory-level authorization without replacing that enforcement primitive.

A trajectory is an ordered plan of intended actions. Every action must satisfy the plan's authorized scope, risk ceiling, and expected next-step identity before it reaches the existing constitutional tool executor.

## Invariants

1. Every governed action belongs to a plan.
2. The action must be inside the plan's authorized tool scope.
3. The action risk cannot exceed the plan risk ceiling.
4. Actions cannot skip ahead in the declared trajectory.
5. The next trajectory state is produced only after outcome reconciliation.
6. Unexpected outcomes increase drift and lock the trajectory.
7. Per-tool constitutional authorization remains mandatory; trajectory authorization is an additional gate, not a replacement.

## Research direction

The current implementation deliberately keeps declared intent and actual-effect comparison explicit rather than pretending that string comparison constitutes semantic verification. Future work can plug in a validated semantic effect verifier and persistent trajectory receipts.

## Simulation boundaries and recovery evidence (2026-10-01)

`simulate_agent_plan` is a **policy preview**, not an action executor or a CRS dynamics simulator. It applies the registered capability classification, declared tool scope, ordered plan, risk ceiling, and `recoveryCapabilityAllowed` gate. Unknown tools fail closed; an approval-required action is not treated as approved. Only an allowed step advances a disposable in-memory plan cursor, under an explicitly stated successful-step assumption. No tool runs, approvals are issued, or persisted state changes. CRS before/after values are deliberately identical: without measured action outcomes, risk labels do not define a valid production transition. The default risk ceiling is `read`; inferred scope is a simulation convenience, never an execution grant. Caller-supplied initial CRS and recovery evidence are hypothetical only.

`run_governance` with `governance_mode: "simulate"` is similarly bounded: it starts a fresh neutral kernel rather than reading a live session, runs local keyword-only detection, and emits static placeholder model outputs. It skips model/embedding providers, canonical-state reads/writes, pending-correction consumption, asynchronous governor search, receipts, memory, calibration, and run counters. HTTP authentication, route admission, rate limits, and API-key controls remain active. This is not a production-equivalent model judgment and its local CRS projection must not be read as a forecast of a live run.

Recovery classification now requires the configured stable-call threshold and sigma bound (the current canonical canary predicate) before calling a state `VERIFIED`; a high margin alone no longer satisfies the non-read recovery gate. A newly bootstrapped neutral trajectory starts at `N_MIN` because it has no prior high-risk event to recover from. Subsequent high-risk activity resets the count through the existing state update path. Consequential calls remain subject to their separate approval and trajectory checks.
