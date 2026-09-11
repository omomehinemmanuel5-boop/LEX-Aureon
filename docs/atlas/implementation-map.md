# Atlas Implementation Map

This map names real repository paths only. **Active** means the path is present in the runtime or current support code; it is not a claim that every proposal in related design documents is deployed.

| Concept | Code path | Status | Evidence and boundaries |
|---|---|---|---|
| CRS | [`lib/constitution.ts`](../../lib/constitution.ts), [`lib/sovereign_kernel.ts`](../../lib/sovereign_kernel.ts), [`lib/agents/tool_crs.ts`](../../lib/agents/tool_crs.ts) | active | Simplex checks, text-kernel state, and tool-call measurement. |
| PRAXIS | [`app/api/lex/govern/route.ts`](../../app/api/lex/govern/route.ts), [`lib/governance_service.ts`](../../lib/governance_service.ts), [`lib/praxis.ts`](../../lib/praxis.ts) | active | Canonical govern route, orchestration, and PRAXIS helpers. |
| Trajectory governance | [`lib/agents/trajectory_governance.ts`](../../lib/agents/trajectory_governance.ts), [`lib/agents/trajectory_executor.ts`](../../lib/agents/trajectory_executor.ts) | active | Plan/state authorization and executor integration; persistent trajectory receipts remain future work. |
| MCP governance | [`app/api/mcp/route.ts`](../../app/api/mcp/route.ts), [`lib/agents/tool_interceptor.ts`](../../lib/agents/tool_interceptor.ts), [`lib/agents/tool_crs.ts`](../../lib/agents/tool_crs.ts) | active | JSON-RPC boundary, tool interception, and per-call CRS. |
| Text receipts | [`lib/kernel_bridge.ts`](../../lib/kernel_bridge.ts), [`lib/kv.ts`](../../lib/kv.ts), [`app/api/audits/verify/route.ts`](../../app/api/audits/verify/route.ts) | active | Persisted receipts, core storage, and verification route. |
| Receipt export | [`app/api/audits/[id]/export/route.ts`](../../app/api/audits/[id]/export/route.ts) | active | Canonical machine-readable audit bundle. |
| z-trajectory | [`lib/kv.ts`](../../lib/kv.ts), [`lib/kernel_bridge.ts`](../../lib/kernel_bridge.ts), [`app/api/lex/trajectory/route.ts`](../../app/api/lex/trajectory/route.ts) | active | Update/load behavior and trajectory API. |
| Benchmarks | [`scripts/lexbench/`](../../scripts/lexbench/), [`lib/benchmark_results.ts`](../../lib/benchmark_results.ts), [`app/api/benchmarks/route.ts`](../../app/api/benchmarks/route.ts) | active | Runners, result persistence, and public result API. |
| Numerical CBF evidence | [`lib/cbf_simulation.ts`](../../lib/cbf_simulation.ts), [`app/api/cbf-simulation/route.ts`](../../app/api/cbf-simulation/route.ts) | active | Simulator evidence only; not the open analytical proof. |

## Navigation

**Implementation:** this page · **Research:** [open-problem tracker](../../research/open-problems.md) · **Benchmarks:** [LexBench README](../../LEXBENCH_README.md) · **Related concepts:** [CRS](concepts/crs.md), [PRAXIS](concepts/praxis.md), [Trajectory](concepts/trajectory-governance.md), [MCP](concepts/mcp-governance.md), [Receipts](concepts/receipts.md), [Open Problems](concepts/open-problems.md)
