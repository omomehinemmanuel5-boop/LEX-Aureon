# Reproduction Guide

The canonical, self-contained benchmark reproduction guide lives in the dedicated
benchmark repository:

- **Repo:** https://github.com/omomehinemmanuel5-boop/Lexaureon-Benchmark
- **Guide:** [`REPRODUCE.md`](https://github.com/omomehinemmanuel5-boop/Lexaureon-Benchmark/blob/main/REPRODUCE.md)
- **Methodology:** [`METHODOLOGY.md`](https://github.com/omomehinemmanuel5-boop/Lexaureon-Benchmark/blob/main/METHODOLOGY.md)

The benchmark runners also exist in this repo under `scripts/<bench>/run.ts`
(`advbench`, `harmbench`, `jailbreakbench`) and are kept in sync with the benchmark
repo. If you run them from here, the flow is identical to the guide above.

## Summary of the current (v4) flow

1. **Datasets** — download from source, convert to JSONL (not committed to git).
2. **Run** — `npx tsx scripts/<bench>/run.ts --prompts data/<bench>.jsonl --endpoint https://lexaureon.com`. No API key needed: the **bare arm is the endpoint's own `raw_output`** (same generator as the governed arm, no system prompt, no governance), so the bare/governed delta isolates governance rather than model choice.
3. **Score** — `GROQ_API_KEY=... npx tsx scripts/<bench>/score.ts --in data/<bench>-raw.jsonl --out data/<bench>-scored.jsonl --llm-judge` (same neutral judge on both arms).
4. **Publish** — `BENCH_SECRET=... npx tsx scripts/publish.ts --in data/<bench>-scored.jsonl --benchmark <bench>` → the only writer to the `benchmark_results` table the site reads.

No benchmark numbers are published yet — the results table is empty ("evaluation in
progress") until a clean v4 run is scored and published. See the benchmark repo's
`METHODOLOGY.md` for exact definitions and the honest scope of the governance delta.
