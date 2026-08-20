# Agent Trajectory Governance

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
