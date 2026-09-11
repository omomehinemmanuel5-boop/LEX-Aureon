# Lex Atlas

## Command Center

This update establishes Atlas as the canonical visual entry point while preserving runtime documentation.

### Dashboard
- Constitutional Health (runtime)
- Active Trajectory
- Latest Receipt
- Implementation Map
- Timeline
- Open Problems

### Concept Graph
- CRS
- PRAXIS
- Trajectory Governance
- MCP Governance
- Receipts
- Open Problems

### Navigation
- implementation-map.md
- timeline.md
- concepts/
- archives/

### Visual Architecture

Atlas is organized as a command center rather than a document index:

```text
                           LEX ATLAS
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   CONSTITUTION            RUNTIME              EVIDENCE
        │                     │                     │
   CRS · PRAXIS        Text Governance      Receipts · Benchmarks
        │              Tool Governance              │
        │                     │                     │
        └──────────────┬──────┴──────┬──────────────┘
                       │             │
                 TRAJECTORY         MCP
                 GOVERNANCE      GOVERNANCE
                       │             │
                       └──────┬──────┘
                              │
                       OPEN PROBLEMS
                              │
                     RESEARCH / HISTORY
```

The graph is an orientation layer, not a duplicate knowledge base. Every node should resolve to an authoritative concept, implementation, research, or evidence page.

### Tool Governance

Tool governance is a first-class Atlas layer, not a footnote to MCP:

- **Admission:** tool requests enter the governed agent boundary.
- **Authorization:** tool intent is evaluated against constitutional state and policy.
- **Interception:** `lib/agents/tool_interceptor.ts` provides the runtime interception surface.
- **Tool CRS:** `lib/agents/tool_crs.ts` connects tool decisions to Continuity, Reciprocity, and Sovereignty.
- **Trajectory:** `docs/atlas/concepts/trajectory-governance.md` covers plan-level constraints above individual tool calls.
- **Receipts:** governed decisions remain auditable through the receipt layer.

See [MCP Governance](concepts/mcp-governance.md), [Trajectory Governance](concepts/trajectory-governance.md), and the [implementation map](implementation-map.md) for the authoritative paths.

### Command Center Cards

| Surface | Purpose |
|---|---|
| Constitutional Health | Current C/R/S state and stability signal |
| Tool Governance | Admission, authorization, interception, and tool receipts |
| Active Trajectory | Plan state, scope, drift, and next action |
| Latest Receipt | Cryptographic/audit evidence for governed decisions |
| LexBench | Empirical evaluation evidence |
| Open Problems | Explicit boundary between evidence and unresolved theory |

### Visual Milestone

The next `/atlas` interface should turn these surfaces into an interactive, mobile-first command center with an SVG knowledge graph, Governance Observatory replay, live receipt cards, and deep links into the existing authoritative pages.

Runtime behavior remains unchanged by this documentation/design layer.