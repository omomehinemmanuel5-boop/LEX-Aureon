# Open Problems

## Concept

Open Problems is the canonical Atlas guide to research questions that remain unresolved or whose scope must be stated carefully. Its source of record is [`research/open-problems.md`](../../../research/open-problems.md).

## Why it exists

Lex Aureon separates a deployed implementation, finite numerical evidence, and analytical proof. This page prevents a result in one category from being misrepresented as a result in another.

## Runtime implementation

- [`lib/sovereign_kernel.ts`](../../../lib/sovereign_kernel.ts) executes the live kernel whose behavior informs the production boundary.
- [`lib/aureonics_core.ts`](../../../lib/aureonics_core.ts) contains deployed governor and barrier calculations.
- [`lib/kv.ts`](../../../lib/kv.ts) implements the stateful z-update rule discussed in resolved research lineage.
- [`app/api/cbf-simulation/route.ts`](../../../app/api/cbf-simulation/route.ts) exposes the simulator used for numerical evidence.

## Research lineage

The active tracker records the guarded multi-pillar invariant as closed and documents why an unrestricted unguarded drift-margin theorem is out of scope without an explicit input envelope. See [`research/open-problems.md`](../../../research/open-problems.md), [`research/empirical-results.md`](../../../research/empirical-results.md), and [`research/paper-updates.md`](../../../research/paper-updates.md).

## Benchmarks and evidence

The finite-horizon simulator evidence is recorded in [`research/empirical-results.md`](../../../research/empirical-results.md). Adversarial benchmark infrastructure lives in [`scripts/lexbench/`](../../../scripts/lexbench/) and published rows are exposed from [`app/api/benchmarks/route.ts`](../../../app/api/benchmarks/route.ts). These remain numerical evidence and do not expand the guarded invariant into an unrestricted unguarded theorem.

## Related concepts

[CRS](crs.md) is the state under analysis; [PRAXIS](praxis.md) is the deployed request pipeline; [Trajectory Governance](trajectory-governance.md) has its own evaluation questions; [MCP Governance](mcp-governance.md) distinguishes design from deployment; [Receipts](receipts.md) records evidence but does not close a theorem.

## Open questions

The resolved boundary is the analytical multi-pillar Lyapunov claim: the deployed guarded invariant is supported, while an unrestricted governor-versus-drift margin is not claimed without a declared drift envelope. Read the source tracker for the exact scope. See [`research/open-problems.md`](../../../research/open-problems.md).

**Implementation:** [map](../implementation-map.md) · **Research:** [source tracker](../../../research/open-problems.md) · **Benchmarks:** [empirical record](../../../research/empirical-results.md) · **Related concepts:** [Atlas index](../index.md)
