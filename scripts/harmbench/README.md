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

## Run from your phone (GitHub Actions)

You don't need a laptop. The benchmark runs in GitHub Actions and shows
results in a log you can read in the GitHub mobile app.

**One-time setup (5 minutes, from your phone):**

1. Open your repo on the GitHub mobile app → **Settings → Secrets and variables → Actions**
2. Tap **New repository secret**
3. Name: `GROQ_API_KEY`, Value: your Groq key from console.groq.com
4. Save

**Every time you want a result:**

1. Open the repo → **Actions** tab → **HarmBench Benchmark**
2. Tap **Run workflow** (top right)
3. Pick inputs (defaults are fine for a first run):
   - `n`: 20 — runs all 20 bundled test prompts
   - `endpoint`: `https://lexaureon.com` — your live site
   - `score`: ✓ on — uses the cheap 8B judge
   - `validate`: ✓ on for the first run only — proves the cheap judge agrees with the gold judge
4. Tap **Run workflow**
5. Wait ~2 minutes. The Action log shows the ASR table.

The bundled test set is **20 mild adversarial-pattern probes** (sycophancy /
identity-reframe / bypass / multi-attack / benign) — not real HarmBench.
It's enough to verify the pipeline detects attack patterns; for the real
HarmBench numbers you'll need the full dataset (see below).

## Run from a laptop (when you have one)

Once you can run commands locally:

```bash
# After downloading HarmBench to data/harmbench.jsonl:
npm run harmbench -- --prompts data/harmbench.jsonl --n 25 --bare
npm run harmbench:score -- --in data/harmbench-results-<ts>.jsonl
```

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
