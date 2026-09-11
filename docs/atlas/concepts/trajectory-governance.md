# Trajectory Governance

## Concept

Trajectory governance is plan-level authorization for ordered agent actions. It adds scope, risk-ceiling, step-order, and outcome-reconciliation checks above—not instead of—the per-tool constitutional gate.

## Why it exists

An individually acceptable tool call can still be unsafe when it is out of scope, too risky for the plan, or out of sequence. The trajectory layer makes those plan constraints explicit.

## Runtime implementation

- [`lib/agents/trajectory_governance.ts`](../../../lib/agents/trajectory_governance.ts) creates plans and states, authorizes actions, and reconciles outcomes.
- [`lib/agents/trajectory_executor.ts`](../../../lib/agents/trajectory_executor.ts) places trajectory authorization ahead of governed tool execution.
- [`lib/agents/tool_interceptor.ts`](../../../lib/agents/tool_interceptor.ts) remains the per-tool authorization layer.
- [`docs/agent-trajectory-governance.md`](../../agent-trajectory-governance.md) is the existing focused implementation note.

## Research lineage

The implementation note describes the layer as additive and identifies validated semantic-effect verification and persistent trajectory receipts as future work. The agent-task evaluation plan defines the evidence needed to support trajectory claims. See [`docs/agent-trajectory-governance.md`](../../agent-trajectory-governance.md) and [`docs/agent-task-evaluation-plan.md`](../../agent-task-evaluation-plan.md).

## Benchmarks and evidence

[`docs/agent-task-evaluation-plan.md`](../../agent-task-evaluation-plan.md) is the repository’s evaluation plan for agent actions. [`scripts/agentdojo/`](../../../scripts/agentdojo/) and [`scripts/agentdojo-real/`](../../../scripts/agentdojo-real/) are existing agent-task benchmark harnesses; this page does not claim a completed trajectory-specific result.

## Related concepts

[CRS](crs.md) defines constitutional measurement; [PRAXIS](praxis.md) governs text; [MCP Governance](mcp-governance.md) is the tool transport boundary; [Receipts](receipts.md) records audit artifacts; [Open Problems](open-problems.md) separates open validation work from closed results.

## Open questions

A validated semantic verifier for declared intent versus actual effect and durable trajectory receipts remain identified future work. See [`docs/agent-trajectory-governance.md`](../../agent-trajectory-governance.md).

**Implementation:** [map](../implementation-map.md) · **Research:** [evaluation plan](../../agent-task-evaluation-plan.md) · **Benchmarks:** [AgentDojo harnesses](../../../scripts/agentdojo/) · **Related concepts:** [Atlas index](../index.md)
