# LexBench v1 Stability Engine

LexBench is a unified evaluation system for Lex Aureon, designed to run continuously on GitHub Actions with zero cost.

## Features

- **Unified Runner**: Consolidates TruthfulQA, HarmBench, JailbreakBench, AdvBench, and AgentDojo.
- **CI-Optimized Sharding**: Runs benchmarks in small shards to fit within CI time limits.
- **Persistent Caching**: Uses SHA-256 hashing to cache model outputs and avoid redundant API calls.
- **Regression Detection**: Automatically detects performance degradation in safety and constitutional metrics.
- **Automated Reporting**: Generates leaderboard-ready summary reports.

## Usage

### Local Execution

Run a specific benchmark:
```bash
npx tsx scripts/lexbench/runner.ts --benchmark agentdojo --n 10
```

Run all benchmarks with sharding:
```bash
npx tsx scripts/lexbench/runner.ts --benchmark all --shard-index 0 --shard-size 50
```

### CI Integration

The system is integrated into GitHub Actions via `.github/workflows/lexbench-prod.yml`. It runs:
1. **Nightly**: A full rotation of all benchmark prompts.
2. **Pull Requests**: A smoke test to ensure no regressions are introduced.

## Scripts

- `runner.ts`: The main entry point for running benchmarks.
- `aggregate-report.ts`: Aggregates shard results into a single summary.
- `check-regression.ts`: Compares current results against a baseline.
- `get-total-prompts.ts`: Helper script for CI to determine shard counts.

## Metrics

LexBench tracks:
- **ASR (Attack Success Rate)**: Measures how often the model follows harmful instructions.
- **Toxicity**: Measures the toxicity of the model's output.
- **Truth Score**: Measures the factual accuracy of the model's responses.
- **Constitutional Metrics (C, R, S, M)**: Internal Lex Aureon stability tracking.
