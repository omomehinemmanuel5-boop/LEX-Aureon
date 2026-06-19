# PRAXIS-Gated Action Governance — Design Spec

**Status:** Design only. No implementation yet.
**Origin:** Synthesis of existing PRAXIS workflow (Notion: Aureonics OS) and the
Lex Aureon constitutional kernel (`lib/sovereign_kernel.ts`, `lib/cbf.ts`).
**Purpose:** Extend constitutional governance from *text output* to
*agentic tool-call execution*, for a private admin agent loop.

---

## 1. Why this document exists

Lex Aureon currently governs what the model **says**. It does not govern what
an agent **does**. The PRAXIS workflow — designed independently, months
earlier, as a Notion task-management law — already encodes the correct
governance shape for *actions*. This document ports PRAXIS's four Core Laws
onto tool-call objects, so an admin-only agent loop can execute file edits,
commands, and commits under the same constitutional discipline that already
governs text.

This is a **translation**, not a new design. The hard thinking already
happened in PRAXIS. The job here is mapping it onto code.

---

## 2. The Three-Party Authority Model (from PRAXIS, unchanged)

```
Lex     = Law            → evaluates validity, computes M, applies CBF gate
You     = Orchestrator   → final authority; approves/denies high-risk actions
System  = Execution layer → only runs a tool call after BOTH Lex and you clear it
```

This is stricter than typical agent "human-in-the-loop" patterns, which
usually only have two parties (model, human). The third party — Law as a
distinct entity from both the model and the operator — is what makes this
a *constitutional* system rather than a permissioned one. Lex can refuse
to validate an action even if you would have approved it; you can decline
to execute an action even if Lex marks it valid. Both gates must clear.

---

## 3. PRAXIS Core Laws → Action Governance Schema

### Law 1 — "No task is executed unless VALID"
**Action equivalent:** No tool call executes unless it passes the CBF gate.

```
ActionValidity =
  M_action >= τ_action
  AND required_fields_present(call)
  AND scope_declared(call)
```

This is the direct action-space analogue of the existing text-space rule
`M >= τ` in `cbf.ts`. Same inequality, different object being scored.

### Law 2 — "No task exists without a Project" → **Continuity (C)**
**Action equivalent:** No tool call executes without a declared parent task/plan.

A tool call cannot be a free-floating action. It must reference the plan
it belongs to (e.g. `task_id: "fix-truthfulqa-import-bug"`). This is scored
as **C** — does the action stay consistent with the declared trajectory, or
is it a deviation/non-sequitur relative to the stated plan?

```
C_action = cosine_similarity(action.intent_embedding, plan.goal_embedding)
```

Low C = the agent is drifting off-task. This is the action-space version of
the same drift z_traj already detects in text conversations.

### Law 3 — "No task exists without Priority" → **Sovereignty (S)**
**Action equivalent:** No tool call executes without declared scope and risk tier.

Every tool call must self-declare what it's allowed to touch and how
reversible it is. This is scored as **S** — does the action stay inside the
authorized boundary, or does it reach beyond what was granted?

```
S_action = scope_match(action.target, plan.authorized_scope)
           AND risk_tier(action) <= max_approved_tier
```

Risk tiers (proposed):
| Tier | Examples | Default policy |
|---|---|---|
| 0 — read-only | `read_file`, `list_directory`, `search_code` | auto-execute |
| 1 — reversible write | `write_file` (non-prod path), `run tsc` | auto-execute, logged |
| 2 — repo-affecting | `write_file` (prod path), `git commit` | requires your approval |
| 3 — irreversible/external | `git push --force`, `npm publish`, deploy, DB writes | requires your approval + confirmation |

This tier table is the direct successor to the `Priority` field in PRAXIS
tasks — just recast for code actions instead of work items.

### Law 4 — "No completed task is deleted" → **Reciprocity (R) + Audit**
**Action equivalent:** Every executed tool call produces an immutable receipt.
No receipt is ever deleted or rewritten after the fact.

```
R_action = declared_effect == actual_effect   (honesty check)
```

Scored by comparing what the tool call *said* it would do (its description/
intent) against what it *actually* did (diff, exit code, file hash before/
after). A mismatch — e.g. a call labeled "read config" that also writes a
file — is a Reciprocity violation, the action-space equivalent of a
deceptive text output.

---

## 4. Receipt Schema (extends `praxis_receipts`)

The existing `praxis_receipts` table already has the right shape — `m_before`,
`m_after`, `governor_mode`, `intervention`, `created_at`. Action receipts
reuse this table with additive columns rather than a parallel schema:

```sql
ALTER TABLE praxis_receipts ADD COLUMN action_type TEXT;        -- e.g. 'write_file'
ALTER TABLE praxis_receipts ADD COLUMN action_target TEXT;      -- path/command
ALTER TABLE praxis_receipts ADD COLUMN risk_tier INTEGER;       -- 0-3, see table above
ALTER TABLE praxis_receipts ADD COLUMN plan_id TEXT;            -- Continuity anchor
ALTER TABLE praxis_receipts ADD COLUMN c_action REAL;
ALTER TABLE praxis_receipts ADD COLUMN r_action REAL;
ALTER TABLE praxis_receipts ADD COLUMN s_action REAL;
ALTER TABLE praxis_receipts ADD COLUMN m_action REAL;
ALTER TABLE praxis_receipts ADD COLUMN tau_action REAL;         -- floor applied at execution time
ALTER TABLE praxis_receipts ADD COLUMN approved_by TEXT;        -- 'auto' | 'operator'
ALTER TABLE praxis_receipts ADD COLUMN declared_effect TEXT;
ALTER TABLE praxis_receipts ADD COLUMN actual_effect TEXT;
```

Receipts are append-only — Law 4 enforced at the schema level, not just by
convention. No `UPDATE` or `DELETE` permitted against this table from the
agent loop's own code path.

---

## 5. PRAXIS Workflow → Agent Loop Lifecycle

```
INGEST  → your instruction arrives ("fix the TruthfulQA import bug")
PLAN    → agent proposes a plan_id + ordered list of intended tool calls
ROUTE   → each tool call is scored: C (matches plan), S (within risk tier)
EXECUTE → if M_action >= τ_action AND risk_tier <= auto-threshold → run
          else → hold for your approval
VERIFY  → declared_effect compared against actual_effect (R check)
RECEIPT → immutable row written to praxis_receipts, regardless of outcome
```

Critically: **even a blocked or failed action gets a receipt.** This mirrors
"No task is executed unless VALID" — an invalid action doesn't silently
disappear, it's logged as a denial, same as PRAXIS logs invalid tasks
rather than deleting them.

---

## 6. The Action Floor — RESOLVED

**Decision: `τ_action` scales with risk tier, and is always ≥ `τ_text`.**

The reasoning: text governance can tolerate a slightly loose floor because a
borderline output is *recoverable* — you read it, notice it's off, the
conversation continues, nothing is lost. Action governance does not have
that grace. A bad write is not a bad sentence you can mentally discard; it's
a committed file, a pushed branch, a broken deploy. The cost of a false
negative (a bad action slipping through) is asymmetric to the cost of a
false negative in text. The gate has to be asymmetric too.

```
τ_action(tier 0)  = τ_text                  // read-only — no blast radius, no extra strictness needed
τ_action(tier 1)  = τ_text                  // reversible write — same floor, but logged + diffable
τ_action(tier 2)  = τ_text + 0.05           // repo-affecting — meaningfully stricter
τ_action(tier 3)  = τ_text + 0.10           // irreversible/external — strict; near-OPTIMAL only
```

This isn't an arbitrary offset — it mirrors the existing health-band
structure. Tier 3 actions should only ever execute when the system is
sitting comfortably in OPTIMAL, not merely scraping past the floor the way
a borderline text response might. The further an action's blast radius
extends past the boundary of "easily undone," the closer to perfect
constitutional health it should require before the governor allows it.

**Practical effect:** a session sitting at M=0.21 (ALERT band, per real
production data seen in `praxis_receipts`) would still pass Tier 0/1 actions
fine, but would be blocked from Tier 2/3 actions until M recovers — the
governor effectively says "you can look around and make small reversible
edits while stressed, but you cannot push to production until you're
stable."

This value remains open to recalibration once real action-receipt data
exists (the same way `τ_text` itself was calibrated empirically through
benchmark runs, not chosen a priori) — but it is the working default for
the first implementation pass.

---

## 7. Remaining Open Questions (not yet answered — needs your input)

1. **Auto-execute threshold for Tier 0/1 actions** — should *any* M score
   below OPTIMAL pause for approval, even on read-only calls? Or only S/C
   violations matter for low-risk tiers, with M used purely as a Tier 2/3
   gate? (§6's resolution implies the latter — M only binds meaningfully
   at Tier 2+ — but worth confirming that's the intended behavior.)

2. **Plan declaration granularity** — does the agent declare the full plan
   upfront (all steps known before execution starts), or can it extend the
   plan mid-execution (discovering step 4 only after step 3's result)?
   PRAXIS's "No planning → no execution" suggests upfront, but rigid
   upfront planning may not suit exploratory debugging work.

3. **What counts as `declared_effect` for a `run_command` call?** File
   writes are easy to diff. Arbitrary shell commands are harder to verify
   against a stated intent. May need a constrained command allowlist
   rather than arbitrary shell access, at least initially.

---

## 8. Explicitly Out of Scope For Now

- No code in this pass — design only, per instruction.
- No changes to the public `/chat` console — this governs a *separate*,
  authenticated admin surface only.
- No physical/embodied action governance — text and code actions only.
- No multi-user concern — single operator (you) as Orchestrator.

---

## 9. Suggested Next Step (when ready to move past design)

Once the open questions in §7 are resolved, the smallest safe first build
is **Tier 0 only**: `read_file`, `list_directory`, `search_code` wired
through the C/S scoring with receipts written, but with execution always
auto-approved (since read-only carries no blast radius). This validates
the receipt schema and scoring pipeline end-to-end before any write/execute
capability is added. Tier 2/3 — and the stricter `τ_action` floor from
§6 — only get exercised once Tier 0/1 are proven stable in production.
