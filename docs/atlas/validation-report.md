# Lex Atlas Validation Report

## Scope

Atlas is a documentation-only integration. It adds a canonical entry point and curated concept lineage without replacing runtime code or deleting historical documents.

## Dependency map established before editing

| Layer | Repository evidence | Atlas destination |
|---|---|---|
| Text governance | `app/api/lex/govern/route.ts` → `lib/governance_service.ts` → `lib/sovereign_kernel.ts` → `lib/kernel_bridge.ts` / `lib/kv.ts` | [PRAXIS](concepts/praxis.md), [CRS](concepts/crs.md), [Receipts](concepts/receipts.md) |
| Tool governance | `app/api/mcp/route.ts` → `lib/agents/tool_interceptor.ts` → `lib/agents/tool_crs.ts` | [MCP Governance](concepts/mcp-governance.md) |
| Plan governance | `lib/agents/trajectory_governance.ts` → `lib/agents/trajectory_executor.ts` → tool interceptor | [Trajectory Governance](concepts/trajectory-governance.md) |
| Evidence | `scripts/lexbench/` → `lib/benchmark_results.ts` → `app/api/benchmarks/route.ts` | [Benchmarks](index.md#benchmarks) |
| Research | `research/open-problems.md`, `research/empirical-results.md`, `research/paper-updates.md` | [Open Problems](concepts/open-problems.md), [archive](archives/withdrawn-proofs.md) |

## Cross-link report

Every concept page has direct links to implementation paths, research source material, benchmark/evaluation artifacts, the Atlas index, and all five sibling concepts. The index links to every concept, the implementation map, timeline, research sources, benchmarks, and archive. The timeline, implementation map, archive, and this report link back into Atlas plus research and benchmark evidence.

## Checks

- Internal Markdown links are validated by the repository-local link checker described in this document’s final validation command.
- Paths in the implementation map were checked against tracked repository files before writing.
- Existing documentation is preserved: Atlas adds navigation and lineage pages; the existing action and trajectory documents remain source artifacts.
- No runtime source files are changed by this integration.

## Navigation

**Implementation:** [implementation map](implementation-map.md) · **Research:** [active tracker](../../research/open-problems.md) · **Benchmarks:** [LexBench README](../../LEXBENCH_README.md) · **Related concepts:** [Atlas index](index.md)
