# Lex Aureon — World-Class Governance Roadmap

**Status:** Lex-governed implementation plan, 2026-09-29

## Governing principle

Lex should earn a world-class claim through independently verifiable evidence, not positioning. Every new capability should preserve the CRS/PRAXIS boundary, remain fail-closed when authority or state is unavailable, and produce an auditable outcome.

## Implemented in this slice

- Tool receipts now carry a policy version, predecessor provenance hash, and hash of the canonical provenance event.
- Provenance events bind actor, session, tool, argument hash, decision, and policy version without storing raw arguments.
- Trajectory executions now persist hash-only trajectory evidence for denials, replay suppression, and completed actions.
- A failed trajectory-receipt write locks the returned trajectory state rather than silently presenting an unaudited successful trajectory.
- Focused transactional receipt tests cover provenance lookup, insertion, and rollback behavior.

## Priority 1 — Production provenance

Acceptance criteria:

1. Every tool receipt has a valid predecessor link or an explicit chain root.
2. A verifier can detect changed, deleted, reordered, or substituted events.
3. Raw prompts, tool arguments, credentials, and tool output are never placed in provenance fields.
4. Receipt-write failure is visible and fail-closed for the governed action boundary.
5. External reviewers can reproduce verification from a documented export.

## Priority 2 — Durable trajectory verification

The current implementation records hash-only trajectory evidence. The next step is semantic effect verification: declared intent and allowed effect predicates must be compared with observed resource state. A non-empty tool response is not proof that the intended resource transition occurred.

Acceptance criteria:

- Precondition and postcondition schemas for bounded task families.
- Signed trajectory receipts that include predicate results and verification status.
- Explicit `unknown` outcomes for inaccessible or ambiguous resource state.
- Lock and recovery behavior for unexpected effects.
- Benchmark coverage across at least 200 multi-step tasks before broad claims.

## Priority 3 — Independent evidence

Expand adversarial evaluation beyond the narrow current harness. Publish frozen inputs, raw traces, baselines, utility results, confidence intervals where applicable, and known limitations. Include coding, retrieval, workflow, multimodal, multi-agent, cross-session, and multi-turn injection cases.

Suggested targets:

- Zero unauthorized consequential actions within the declared benchmark scope.
- Receipt integrity at 100% for evaluated runs.
- At least 95% valid trajectory-effect verification on tasks with observable effects.
- False-denial and latency costs reported beside safety results.
- Two independent external reproductions before any best-in-world positioning.

## Priority 4 — Enterprise control plane

After the evidence layer is stable, add versioned policy storage, tenant isolation, role-based access, key lifecycle management, signed policy changes, audit export, retention controls, deployment guidance, and incident response. A policy marketplace is a later extension, not a substitute for these foundations.

## Explicit boundaries

- The unrestricted global Lyapunov theorem is not a product guarantee.
- Hash chaining proves tamper evidence and event linkage; it does not by itself prove that a real-world side effect occurred.
- A passing internal benchmark is not independent validation.
- Enterprise adoption, regulatory suitability, and economic performance require separate evidence.

## Delivery order

1. Production provenance and verifier.
2. Semantic trajectory effect verification.
3. Broader adversarial and benign utility evaluation.
4. Independent reproducibility challenge.
5. Enterprise controls and ecosystem integrations.
