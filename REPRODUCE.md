# Reproduction Guide

Step-by-step instructions to run the Lex Aureon benchmarks from scratch.

> **There are no published numbers to "verify against" yet.** The `benchmark_results`
> table is empty and the site shows "evaluation in progress" until a clean run with the
> v4 same-model runners is scored and published. This guide produces the numbers; it
> does not check them against a stored answer key.

---

## What the benchmark measures

Two arms, **same model**, per prompt:

- **Bare arm** = the kernel's own `raw_output` — the generator called with the user
  prompt and **no system prompt, no governance**.
- **Governed arm** = the full `/api/lex/govern` pipeline.

Because both arms come from the same generator (`generateGoverned`, Gemini-lite
primary), the reported **delta** (governed − bare ASR, and over-refusal on benign)
isolates the governance wrapper rather than model choice. See `METHODOLOGY.md` for the
full definitions and the honest scope of that delta.

---

## Prerequisites

```bash
node >= 20
npm  >= 9
# The RUN needs no API key (the bare arm is the endpoint's own raw_output).
# The SCORER needs a Groq API key (llm-judge).
# PUBLISHING needs BENCH_SECRET (same value as the Vercel env var).
```

---

## Step 1 — Clone

```bash
git clone https://github.com/omomehinemmanuel5-boop/Lexaureon-Benchmark
cd Lexaureon-Benchmark
npm install
```

---

## Step 2 — Get the prompt datasets

Datasets are **not** committed — download from source and convert to JSONL.

**HarmBench** → `{id, behavior, category?}`
```bash
pip install datasets
python3 -c "
from datasets import load_dataset
import json, os
os.makedirs('data', exist_ok=True)
ds = load_dataset('walledai/HarmBench', split='train')
with open('data/harmbench.jsonl','w') as f:
    for i,row in enumerate(ds):
        f.write(json.dumps({'id':str(i),'behavior':row['behavior'],'category':row.get('SemanticCategory','')})+'\n')
print(f'Saved {len(ds)} behaviors')
"
```

**AdvBench** → `{id, behavior, target?, category?, source?, type?}`
```bash
curl -o data/advbench_raw.csv \
  https://raw.githubusercontent.com/llm-attacks/llm-attacks/main/data/advbench/harmful_behaviors.csv
python3 -c "
import csv, json
with open('data/advbench_raw.csv') as f, open('data/advbench.jsonl','w') as out:
    for i,row in enumerate(csv.DictReader(f)):
        out.write(json.dumps({'id':str(i),'behavior':row['goal'],'target':row.get('target',''),'category':'','source':'advbench','type':'harmful'})+'\n')
"
```

**JailbreakBench** → `{id, behavior, category, source, type}` — **must include the
`type` field** (`'harmful'` | `'benign'`); the runner and scorer split ASR (harmful)
from over-refusal (benign) on it. JBB-Behaviors ships 100 harmful + 100 benign; include
both, tagging each row's `type`. A run with no benign rows produces no over-refusal
number.

---

## Step 3 — Run (no API key required)

```bash
export EP=https://lexaureon.com   # or http://localhost:3000

npx tsx scripts/harmbench/run.ts      --prompts data/harmbench.jsonl      --n 200 --endpoint $EP
npx tsx scripts/advbench/run.ts       --prompts data/advbench.jsonl               --endpoint $EP
npx tsx scripts/jailbreakbench/run.ts --prompts data/jailbreakbench.jsonl --n 200 --endpoint $EP
```

Each runner writes raw JSONL to `data/<bench>-raw.jsonl` containing `bare_output`
(= endpoint `raw_output`) and `governed_output` for every prompt, plus `sovereignty_raw`
and `capitulation_signal` per row. Runs are resumable — re-running skips ids already in
the output file.

---

## Step 4 — Score (needs `GROQ_API_KEY`)

The scorer applies the **same** neutral judge to both arms (see `METHODOLOGY.md`).

```bash
GROQ_API_KEY=... npx tsx scripts/harmbench/score.ts      --in data/harmbench-raw.jsonl  --out data/harmbench-scored.jsonl  --llm-judge
GROQ_API_KEY=... npx tsx scripts/advbench/score.ts       --in data/advbench-raw.jsonl   --out data/advbench-scored.jsonl   --llm-judge
GROQ_API_KEY=... npx tsx scripts/jailbreakbench/score.ts --in data/jbb-raw.jsonl        --out data/jbb-scored.jsonl        --llm-judge
```

Scored rows carry `bare_verdict` and `governed_verdict` (`FULFILL`|`RESIST`|`BLOCKED`),
and (JailbreakBench) `type`.

---

## Step 5 — Publish (needs `BENCH_SECRET`)

`publish.ts` aggregates a scored file into ASR (FULFILL rate over harmful, per arm) and
over-refusal (non-FULFILL over benign) and POSTs the summary to
`/api/benchmarks/publish` — the only writer to the `benchmark_results` table the site
reads.

```bash
# Preview the payload without sending:
npx tsx scripts/publish.ts --in data/jbb-scored.jsonl --benchmark jailbreakbench --dry-run

# Publish (records bare + governed models in the note for provenance):
BENCH_SECRET=... npx tsx scripts/publish.ts \
  --in data/jbb-scored.jsonl --benchmark jailbreakbench \
  --notes "same-model bare=raw_output; generator gemini-3.1-flash-lite; llm-judge llama-3.1-8b; kernel <commit>"
```

---

## Notes

- **No per-IP rate limit** on the govern endpoint — the inter-prompt delay in the
  runners is only to be polite to the upstream providers' free-tier quotas.
- **Provenance** — record the deployed kernel commit in `--notes` for every run; there
  is no committed results file to diff against.
- **Judges** — the heuristic judge is a weak baseline; use `--llm-judge` for anything
  cited, and report two-judge agreement (add the official `walledai/HarmBench`
  classifier for HarmBench).
