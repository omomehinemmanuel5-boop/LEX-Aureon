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

```text
                         LEX ATLAS
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
         CRS             PRAXIS           RECEIPTS
          │                 │                 │
     Continuity       Text Governance    Audit Evidence
     Reciprocity      Runtime Path       Decision Trace
     Sovereignty
          │                 │                 │
          └──────────┬──────┴───────┬─────────┘
                     │              │
              TRAJECTORY          MCP
              GOVERNANCE       GOVERNANCE
                     │              │
                     └──────┬───────┘
                            │
                     BENCHMARK EVIDENCE
                            │
                      OPEN PROBLEMS
```

The graph is an orientation layer, not a duplicate knowledge base: each node should resolve to the authoritative Atlas concept, implementation, research, or evidence page.

### Next Visual Milestone
- Interactive SVG knowledge graph
- Governance Observatory replay cards
- Live constitutional-health widgets backed by receipts
- Mobile-first `/atlas` command-center interface

This commit upgrades presentation only; runtime behavior is unchanged.