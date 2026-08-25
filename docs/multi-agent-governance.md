# Multi-agent governance: a real case study, not a hypothetical

## What happened

On 2026-08-22, this session (Claude, connected via the Lex CRS MCP proxy)
was asked to wire up two orphaned components — `GovernanceStateBar.tsx` and
`TimelineReplayControls.tsx` — into `/observability`. That work landed,
reviewed, merged.

Separately, and without either side aware of the other, a branch called
`agent/observability-contracts` was independently modifying the *same
surface* — `ObservabilityTimeline`, shared metrics types, session-scoped
filtering. That branch accumulated five failed builds in a row before this
session happened to notice it existed, purely because someone asked
"check out that branch" as an unrelated follow-up question.

Neither agent did anything wrong in isolation. The collision happened
because of a structural gap, not a mistake either agent made on its own.

## Why the Lex CRS governance layer, by itself, could not have caught this

It's tempting to assume "better governance" means a stricter proxy, tighter
CRS thresholds, more aggressive locking. That's not what this incident
shows.

`agent/observability-contracts` was driven by Replit, which pushes to
GitHub through its own integration — it never calls a tool through the Lex
CRS MCP server (`lib/agents/tool_interceptor.ts`, `lib/agents/tool_crs.ts`).
Every C/R/S/M measurement, every slow-drip check, every receipt this session
generated applied *only* to calls that went through that proxy. An agent
that never calls through it is invisible to it — not blocked, not scored,
not logged. There was no technical mechanism available that could have
compared "what Claude is about to touch" against "what Replit is currently
touching," because there is no shared choke point both agents pass through.

This is the actual argument for why governance matters here, and it's a
sharper one than "the governor catches bad code": **a governance layer that
only sees traffic through one gate is blind to everything that enters
through a different door.** The interesting design problem isn't making the
one gate stricter. It's making the coordination surface not depend on
having a single gate at all.

## The fix, and why it's shaped the way it is

`AGENTS.md` is the one artifact every agent working on this repo is already
instructed to read first, regardless of which tool it connects through —
Claude Code, Cursor, Replit, whatever comes next. It requires no new
infrastructure, no new MCP tool, no change to how any agent authenticates.
It's a file. Any agent that can read and write files can participate.

The `ACTIVE AGENT CLAIMS` section added to `AGENTS.md` on 2026-08-24 is
deliberately:

- **Advisory, not enforced.** Nothing technically stops two agents from
  still colliding. A hard lock would require the same missing choke point
  this whole case study is about — and would fight how work here actually
  happens (fast, human-directed, frequently overlapping on purpose).
- **Convention-based, not access-controlled.** It works today, with zero
  code changes to the MCP proxy, for an agent that has never heard of Lex
  CRS. It also degrades gracefully — an agent that ignores it behaves
  exactly as before, no worse.
- **A visibility fix, not a permission fix.** The failure mode wasn't "an
  unauthorized agent did something disallowed." It was "two authorized,
  well-behaved agents had no way to know about each other." Visibility is
  the actual gap; a permissions system would have solved a different
  problem.

## What this demonstrates about Lex Aureon's governance model more broadly

The single-agent CRS layer (C/R/S/M, slow-drip protection, hardcoded
invariants) answers: *is this one action, from this one governed agent,
safe to execute right now?*

This incident shows that's a necessary but insufficient question once more
than one actor touches the same system. The deeper claim Lex Aureon's model
implies — Continuity, Reciprocity, Sovereignty as properties of a system's
relationship to reality and to the people depending on it — doesn't stop
being true just because a second agent enters the picture through an
ungoverned door. If anything, an ungoverned second actor is a more
realistic threat model than a single rogue governed one: nothing here
required malice, only two agents that were each behaving reasonably in
isolation.

A governance system whose guarantees quietly stop applying the moment a
second, differently-integrated agent shows up is a system whose guarantees
were narrower than they looked. Extending coordination to a channel every
agent already reads — rather than requiring every agent to adopt the same
proxy — is the version of that fix that's actually deployable in a
heterogeneous, real-world multi-agent workflow like the one this project
already runs (Claude, Codex, Replit, and whatever comes next).

## What's not solved yet

- This is advisory only. Nothing stops an agent from ignoring the claims
  table entirely — including, honestly, this session, which only checked
  `agent/observability-contracts`'s branch *after* being asked to.
- There's no attribution in the audit trail. `praxis_receipts` and
  `tool_receipts` record what happened, not which agent did it. A claims
  table says "someone is working on X"; it can't yet say "agent Y made
  change Z" after the fact. That's a real next step — likely an `actor_id`
  column threaded through `lib/kernel_bridge.ts`'s receipt-write path — not
  attempted in this pass.
- The claims table itself could go stale exactly like the changelog did
  (see `AGENTS.md`'s CHANGELOG, which had an entry gap covering this
  entire session before this fix). A convention that depends on agents
  remembering to update it has the same failure mode it's trying to fix,
  one level up. Worth watching whether that happens again.
