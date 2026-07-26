# Lex Aureon — Chat Interface Specification

**Route:** `/chat` → `app/chat/page.tsx`
**Endpoint:** `POST /api/lex/govern/stream` (SSE) via `lib/use_lex_stream.ts`
**Last verified against the implementation:** 2026-07-26

This document describes what the chat interface actually does, verified against
the source rather than intended behaviour. Where something is a stub or unproven
it says so.

---

## 1. What this surface is

A **governed chatbot**. The conversation is the product; the governance
measurement is evidence available on demand. That ordering is deliberate and it
is a change from the earlier design, where every turn rendered a four-row C/R/S
panel unconditionally and telemetry occupied two to three times the vertical
space of the answer it described.

The design rule that follows from it:

> Every governance measurement is retained and reachable in one tap. None of it
> competes with the conversation for primary attention.

---

## 2. Conversation

| Feature | Behaviour |
|---|---|
| Streaming responses | Token-by-token over SSE. A `● streaming` indicator carries `role="status" aria-live="polite"` so assistive tech is told a reply began. |
| Stop generation | Interrupts an in-flight stream. Icon-only button, labelled `Stop generating`. |
| Send | Disabled while input is empty or the per-session call ceiling (`MAX_CALLS = 10`) is reached. Labelled `Send message`. |
| Message rendering | Prose plus fenced code blocks, parsed and rendered by `MessageContent`. |
| Code blocks | Rendered by `CodeViewer` (memoised). Individual blocks can be saved to the Sandbox. |
| Empty state | Mode-aware prompt with an entry point into the Suggestions sheet. |

**Session continuity.** As of 2026-07-26 the governed route injects two distinct
retrievals before generation:

- **Session transcript** — `retrieveSessionHistory(session_id, 6)`, the actual
  turn sequence for this conversation, chronological. This is an ordering
  question, resolved by an indexed lookup on `session_id`.
- **Semantic recall** — `retrieveSimilar(embedding, 5)`, loosely related past
  episodes across sessions. This is a similarity question.

Both are fenced in an `<untrusted_recall>` block with excerpts capped at 280
characters, because recalled text is user-authored and therefore a
prompt-injection surface.

Known limits, stated plainly:
- Semantic recall scans only the **300 most recent rows globally** — roughly 1%
  of stored history. Cross-session recall beyond that window does not happen.
- `governed_response` text has only been stored since 2026-07-26. Rows written
  before that carry a hash only, and a hash is one-way, so those responses are
  permanently unrecoverable. The injected context marks this explicitly: where an
  `answered:` line is absent, the model is instructed not to claim recall.

---

## 3. Governance disclosure, per turn

Always visible:

- **Status chips** — health band (`OPTIMAL` / `ALERT` / `STRESSED` / `CRITICAL`),
  `corrected` when an intervention fired, `⟳ mem` when memory was injected.
- **Stability chip** — `M 0.302 ▲0.03`. The stability margin `M = min(C,R,S)`
  with its direction of travel against `mBefore`. Green up, red down. This is the
  one number that answers "did this turn stay stable", which is what a reader
  glancing at a turn wants.

One tap away, as four mutually exclusive disclosures:

| Tab | Contents |
|---|---|
| `state` | Full C/R/S/M before → after bars (`CRSDelta`), or `CRSBar` when no pre-governance reading exists |
| `raw` | The ungoverned model output, side by side with what governance produced |
| `audit` | Receipt identifiers, input/output hashes, brittleness `B` |
| `analysis` | Kernel diagnostics — θ, Lyapunov `V`, ΔV, attack pressure, provider identities |

Only one is open per turn: `openTab` is shared state, so opening `raw` closes
`state`.

---

## 4. Modes

Set via the Mode sheet; each prepends a `MODE_PREFIX` to the governed request.

| Mode | Icon | Purpose |
|---|---|---|
| Chat | ◈ | General constitutional dialogue |
| Code | `</>` | Code generation with sandbox integration |
| Research | ∇ | Rigorous analysis |
| Probe | ⊗ | Governance stress testing |

---

## 5. Tools

| Tool | Behaviour |
|---|---|
| Run self-test | End-to-end governance check; result shown in a dismissible banner |
| Sandbox | Multi-file workspace; code blocks from any turn can be saved into it |
| This session | Session-level metadata and controls |

---

## 6. Mobile behaviour

The keyboard problem is solved on both platforms, and both halves are required
because the two behave differently:

- **iOS auto-zoom** — Safari force-zooms any focused field under 16px. The rule
  `textarea, input, select { font-size: 16px }` covers all three field types.
  `.lex-code-editor` stays at 16px on touch and tightens to 13px only under
  `@media (pointer: fine)`.
- **iOS keyboard** — Safari ignores `interactive-widget`, so a
  `visualViewport` listener writes `--lex-vvh` and the shell height reads
  `var(--lex-vvh, 100dvh)`, with an SSR-safe fallback.
- **Android keyboard** — `interactive-widget=resizes-content` in the viewport
  meta.

Pinch-zoom remains enabled to 5× deliberately; that is an accessibility
requirement and was never the cause of the auto-zoom.

---

## 7. Accessibility

Implemented:
- Accessible names on all icon-only controls (send, stop, three dismiss buttons)
- `role="dialog"` + `aria-modal` + `aria-label` on the shared BottomSheet, so all
  four sheets announce
- Focus trap: focus moves into a sheet on open, Tab/Shift+Tab wrap, Escape
  closes, focus returns to the opening element on dismiss
- `role="status" aria-live="polite"` on the streaming indicator
- `aria-expanded` on the stability chip
- Decorative scrim marked `aria-hidden`
- 30 `lex-focusable` focus rings; `prefers-reduced-motion` honoured

Not yet done:
- 44px minimum touch targets are not applied consistently across small controls
- No visual regression coverage; every UI change here has been verified by
  typecheck, lint and reasoning, not by rendering

---

## 8. Limits and honest gaps

| Item | Status |
|---|---|
| `MAX_CALLS = 10` per session | Enforced; send disables at the ceiling |
| Provider exhaustion | Surfaces as a static constitutional string. Distinguishable in `audit` via `governed_source: unavailable` |
| `VaulturexAgent` compliance | **Stub.** `v0.1` structural flags only; `risk_level` is hardcoded `LOW`. Displayed as telemetry, feeds no decision |
| Refusal behaviour | Substitutes `CANONICAL_REFUSAL`. Grounding injection — correcting rather than refusing — is not implemented |
| Cross-session recall depth | Capped by the 300-row scan above |

---

## 9. Route parity

Both `/api/lex/govern` (JSON, used by the public API and LexBench) and
`/api/lex/govern/stream` (SSE, used by chat and console) run an identical output
pipeline as of 2026-07-26, verified by sha256 comparison of the governed output
for the same prompt on both routes.

This matters for a specific reason: before that change, chat applied
`CelesteAgent` and `StyleAgent` to the output and the benchmark did not, so no
published XSTest or TruthfulQA number described what a user actually received.
Parity is what makes the benchmark canonical, and it is a property to re-verify
whenever either route changes.
