# PRAXIS

## Concept

PRAXIS is the project’s text-governance pipeline: it classifies a prompt, produces constitutional signals, runs the kernel, applies the governing decision path, and records an auditable outcome.

## Why it exists

It turns constitutional measurement into a repeatable request lifecycle instead of leaving governance as a post-hoc policy description.

## Runtime implementation

- [`app/api/lex/govern/route.ts`](../../../app/api/lex/govern/route.ts) validates and admits canonical govern requests.
- [`lib/governance_service.ts`](../../../lib/governance_service.ts) orchestrates the governed request lifecycle.
- [`lib/sovereign_kernel.ts`](../../../lib/sovereign_kernel.ts) executes `runCycle`.
- [`lib/praxis.ts`](../../../lib/praxis.ts) contains pre-evaluation, semantic transduction, and correction helpers.
- [`lib/kernel_bridge.ts`](../../../lib/kernel_bridge.ts) loads session z-weights and writes receipts.

## Research lineage

The PRAXIS pipeline is documented in the repository overview and empirical record. The research notes explicitly distinguish idealized proof results from production measurements. See [`README.md`](../../../README.md), [`research/empirical-results.md`](../../../research/empirical-results.md), and [`research/open-problems.md`](../../../research/open-problems.md).

## Benchmarks and evidence

Frozen PRAXIS evaluations are recorded in [`research/empirical-results.md`](../../../research/empirical-results.md). LexBench runners and aggregation live in [`scripts/lexbench/`](../../../scripts/lexbench/); published results are exposed by [`app/api/benchmarks/route.ts`](../../../app/api/benchmarks/route.ts).

## Related concepts

[CRS](crs.md) supplies the state PRAXIS governs; [Trajectory Governance](trajectory-governance.md) addresses ordered actions; [MCP Governance](mcp-governance.md) governs tool transport; [Receipts](receipts.md) preserve outcomes; [Open Problems](open-problems.md) states what PRAXIS does not prove.

## Open questions

Whether the deployed production path satisfies the idealized descent relation on all turns remains an open research boundary, alongside the multi-pillar proof. See [`research/open-problems.md`](../../../research/open-problems.md).

**Implementation:** [map](../implementation-map.md) · **Research:** [empirical record](../../../research/empirical-results.md) · **Benchmarks:** [LexBench](../../../LEXBENCH_README.md) · **Related concepts:** [Atlas index](../index.md)
