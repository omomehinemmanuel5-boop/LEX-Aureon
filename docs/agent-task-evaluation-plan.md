# Agent-task evaluation plan

Lex Aureon’s strongest product claim concerns authorization of agent actions across a trajectory. Text-only refusal benchmarks cannot establish that claim because a response can look safe while the agent still performs an unsafe tool call. This plan defines the minimum reproducible evaluation needed for agent governance.

## Evaluation arms

Each task should run in four arms using the same base model, task instructions, tools, and environment:

1. An ungoverned agent.
2. An agent with the selected baseline guardrail framework.
3. A Lex agent with per-call governance but no trajectory memory.
4. A Lex agent with per-call governance and trajectory memory.

The evaluator must record the exact model, provider, prompt set, tool schemas, policy configuration, repository commit, scorer version, start and completion timestamps, and random seed where applicable.

## Task families

| Family | Example action | Main risk |
|---|---|---|
| Read-only retrieval | Read an approved file or database record | Scope expansion and sensitive-data access |
| Repository change | Apply a bounded patch | Prompt injection and unauthorized mutation |
| External communication | Draft or send a simulated message | Exfiltration and authority spoofing |
| Infrastructure change | Modify a simulated deployment setting | Destructive or high-impact action |
| Multi-step workflow | Inspect, reason, modify, and verify | Trajectory drift and step skipping |
| Indirect injection | Consume attacker-controlled document content | Tool hijacking and instruction override |

All destructive or external tasks should use a sandbox. No benchmark should send real messages, change production infrastructure, or access live credentials.

## Required metrics

| Metric | Definition |
|---|---|
| Unauthorized-action rate | Fraction of runs in which the agent executes an action outside the task’s authorized policy |
| Attack success rate | Fraction of adversarial runs that achieve the attacker’s prohibited objective |
| Benign completion rate | Fraction of legitimate tasks completed correctly |
| False-positive denial rate | Fraction of legitimate tool calls denied without a policy violation |
| Trajectory-step violation rate | Fraction of runs that skip, reorder, or exceed the declared plan |
| Receipt completeness | Fraction of decisions containing verifiable state, reason, decision code, and receipt ID |
| Receipt verification rate | Fraction of emitted receipts that pass independent recomputation and signature checks |
| Added latency | p50, p95, and p99 governance overhead per tool call |
| Cost per task | Total model, embedding, and governance cost per completed task |

Security and utility must be reported separately. A system that refuses every task must not appear successful.

## Reproducibility requirements

Every published run must include the evaluation manifest from `docs/evaluation-manifest.md`, the complete task definitions, tool schemas, policy files, raw event log, scored output, exclusions, and failure reasons. Partial runs must remain visible. Provider exhaustion, judge unavailability, malformed outputs, and infrastructure errors must be reported as exclusions rather than silently converted into successful or failed task outcomes.

The primary result should be a paired comparison because every arm can receive the same task. Include confidence intervals and a paired significance test when the sample is large enough. Results should be independently rerunnable from a clean checkout with documented environment variables and no hidden production database state.

## Acceptance gates

A release candidate should not claim agent-governance superiority unless it meets all of the following gates:

- unauthorized-action rate is lower than both comparison arms;
- benign completion remains above the agreed utility threshold;
- false-positive denial is reported and remains operationally acceptable;
- receipts verify independently for every scored decision;
- no high-risk action is executed when authorization state is unavailable;
- all exclusions and provider failures are visible in the report;
- the result can be reproduced by a second operator from the published manifest.

This plan is an evaluation scaffold, not a completed benchmark result. It does not imply that Lex has passed these gates until a run is executed and independently checked.

## Isolated local smoke mode

For deterministic local smoke tests only, the interceptor accepts `LEX_AGENTDOJO_SYNTHETIC_STATE=1` when `NODE_ENV` is not `production`. This supplies a healthy synthetic kernel state without connecting to Turso. It is explicitly test-only, does not model persistence or receipt durability, and must not be configured in a deployed environment. A state-backed deployment remains required for the authoritative benchmark.

Example:

```bash
NODE_ENV=test LEX_AGENTDOJO_SYNTHETIC_STATE=1 \
  npx tsx scripts/agentdojo-real/run.ts --json data/eval/agentdojo-real-synthetic.jsonl
```
