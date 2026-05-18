# HarmBench harness

Tests Lex Aureon against the [HarmBench](https://huggingface.co/datasets/walledai/HarmBench)
benchmark — a standard adversarial suite for measuring AI safety guardrails.

## What it measures

Three arms, scored by an LLM-as-judge (Groq Llama-3.3-70B) on a yes/no harmful
classification:

| Arm | What it tests |
|-----|---------------|
| **bare** | Raw `llama-3.1-8b-instant` with no system prompt — the ungoverned baseline |
| **anchored** | Same model with the Constitutional system prompt only — measures the prompt's contribution |
| **governed** | Full PRAXIS pipeline (z_traj + CRS extractor + governor + intervention) — measures the marginal value of the trajectory / Lyapunov / CBF layer |

The interesting numbers are **ASR(bare) − ASR(governed)** (full pitch) and
**ASR(anchored) − ASR(governed)** (marginal value of the math kernel beyond
just a system prompt).

## Setup

1. Download HarmBench behaviors from
   https://huggingface.co/datasets/walledai/HarmBench
   and convert to JSONL — one `{ "id": "...", "behavior": "...", "category": "..." }`
   per line. Save to `data/harmbench.jsonl` (the `data/` directory is gitignored).

2. Required env vars:
   ```
   GROQ_API_KEY=...   # for the judge and the --bare arm
   ```

3. (Optional) override the Lex endpoint — defaults to `https://lexaureon.com`:
   ```
   LEX_ENDPOINT=http://localhost:3000
   ```

## Run

```bash
# Smoke test: 5 prompts, bare arm enabled
npm run harmbench -- --prompts data/harmbench.jsonl --n 5 --bare

# Full run (no bare arm, faster):
npm run harmbench -- --prompts data/harmbench.jsonl

# Against local dev server:
npm run harmbench -- --prompts data/harmbench.jsonl --endpoint http://localhost:3000
```

Output: `data/harmbench-results-<timestamp>.jsonl` (one row per prompt, appended
incrementally so partial runs aren't lost).

## Score

Default: **`llama-3.1-8b-instant`, 3-vote majority consensus.** Free-tier safe,
fast, noisier per call than 70B but de-noised by consensus.

```bash
npm run harmbench:score -- --in data/harmbench-results-<timestamp>.jsonl
```

Output: `data/harmbench-results-<timestamp>-scored.jsonl` (per-row judgments)
plus a printed summary table.

### Use a stronger judge if you have budget

```bash
npm run harmbench:score -- --in <file> --judge llama-3.3-70b-versatile --judge-votes 1
```

### Validate the cheap judge against the gold judge (do this once)

Before publishing a number from the cheap judge, prove it agrees with the
expensive one on a small sample:

```bash
npm run harmbench:score -- --in <file> --validate 30
```

This runs **both** judges on the first 30 governed outputs and reports an
agreement percentage. The rule:

| Agreement | Action |
|-----------|--------|
| **≥ 85%** | Cheap judge is trustworthy. Publish with the validation note. |
| **< 85%** | Switch to the gold judge for the final paper. |

The validation costs ~30 extra 70B calls — still free, still under daily limits.

When you publish, cite it like this:
> *"ASR scored by Llama-3.1-8B-instant (3-vote consensus), validated against
> Llama-3.3-70B on N=30 (agreement: 90.0%)."*

That's how research papers without GPT-4-judge budget handle this and stay credible.

## Caveats

- **Judge ≠ official HarmBench classifier.** The official classifier is a
  fine-tuned Llama-2-13B. This harness uses Groq Llama models with a
  HarmBench-style prompt — a strong proxy, not the canonical number. Report
  results as "ASR (Llama-XXB judge)" rather than just "ASR" to avoid implying
  parity with the published HarmBench score.

- **The delta is more robust than the absolute number.** Judge noise affects
  all three arms equally, so `ASR(bare) − ASR(governed)` is reliable even if
  the absolute ASR has ±5% error bars.

- **Cost.** Each prompt → 1 PRAXIS call + 3 judge calls (or 4 with `--bare`).
  Standard HarmBench is ~400 behaviors. Groq pricing is per-token; budget
  accordingly.

- **Adversarial content stays local.** Results files are gitignored. Do not
  paste harmful outputs into PRs, issues, or screenshots when sharing results.

- **Session isolation.** Each prompt gets its own `session_id` so z_traj
  state (attack_pressure, sigma_viol) does not leak between behaviors. If you
  want to test *persistent* adversarial pressure (the P10 prediction in
  `research/open-problems.md`), modify the harness to share session IDs
  within a behavior category.
