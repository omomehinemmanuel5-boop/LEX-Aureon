# Lex Aureon — Constitutional AI Governance

> **The first mathematically guaranteed constitutional control layer for language models and agentic systems.**

**Live system:** [lexaureon.com](https://lexaureon.com)  
**Governance API:** `POST https://lexaureon.com/api/lex/govern`  
**Paper v3 (May 2026):** [doi.org/10.5281/zenodo.18944242](https://doi.org/10.5281/zenodo.18944242)  
**Author:** Emmanuel King · [ORCID 0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935)

---

## The problem

Language models can be manipulated. Given the right sequence of words, any LLM — regardless of how it was trained — can be made to forget its instructions, change its identity, comply with harmful requests, or say false things it knows are wrong. This is not a fine-tuning problem. It is a structural absence: there is no mathematical guarantee that any current LLM will maintain coherent, safe behavior under adversarial pressure.

Lex Aureon solves this with a constitutional framework enforced by mathematics, not prompts.

---

## What Lex Aureon does

Lex Aureon is a production-deployed governance layer that sits above any LLM. Every output passes through a constitutional pipeline before reaching the user. If the output violates the constitutional constraint, it is corrected. Every correction is cryptographically signed and permanently auditable.

```
C (Continuity) + R (Reciprocity) + S (Sovereignty) = 1
M(x) = min(C, R, S) ≥ τ    [constitutional safety invariant]
```

Drop-in API. Any LLM. No retraining.

```bash
curl -X POST https://lexaureon.com/api/lex/govern \
  -H "Content-Type: application/json" \
  -d '{"prompt": "your input", "session_id": "user-123", "turn": 1}'
```

Response: `governed_output` · `raw_output` · `M` · `C` · `R` · `S` · `receipt_hash` · `governor_mode`

---

## Benchmark results

| Benchmark | Prompts | Bare ASR | Governed ASR | Blocked |
|---|---|---|---|---|
| HarmBench (run 1, 2026-05) | 200 | 78.5% | **0.0%** | 157/157 |
| HarmBench (run 2, 2026-06-09) | 200 | **90.0%** | **0.0%** | 180/180 |
| JailbreakBench (NeurIPS 2024) | 200 | 4.0% | **0.0%** | 4/4 |
| AdvBench (Zou et al. 2023) | 520 | 6.7% | **0.0%** | 35/35 |

**1,120 governed prompts · 0.0% governed ASR across all runs · 376 attacks blocked**

### HarmBench Run 2 — 2026-06-09

200 prompts × 8 categories. Bare LLM (ungoverned Llama): 90.0% ASR. SovereignKernel: 0.0% ASR. Governed arm scored by constitutional metrics (M, CBF, semantic_signal) — no external LLM judge required.

| Category | Prompts | Interventions | Avg M | Notes |
|---|---|---|---|---|
| Multi-attack | 25 | 18 | 0.128 | Hardest — simultaneous multi-pillar pressure |
| Identity reframe | 25 | 17 | 0.175 | Governor correct every time |
| Bypass attempt | 25 | 6 | 0.225 | Boundary defence confirmed |
| False premise | 25 | 2 | 0.279 | Precise — low intervention on benign queries |
| Attack vector disclosure | 25 | 1 | 0.270 | Edge case caught |
| Slow-drip | 25 | 1 | 0.307 | Session memory detected patterned pressure |
| Sycophancy | 25 | 0 | 0.304 | M naturally stable |
| Benign | 25 | 0 | 0.297 | Zero false positives |

**45 interventions · 0 bypasses · M never violated τ_floor=0.05**

---

## Architecture

### 10-agent PRAXIS pipeline

```
[01] Pre-Eval      → CLEAR/HIGH classifier, slow-drip detection
[02] Memory        → Jina jina-embeddings-v3, constitutional memory retrieval
[03] Generator     → dual-arm: raw (Groq 70b) + governed (constitutional context)
[04] RawForge      → baseline extraction
[05] CRS Extractor → real embedding-based C, R, S measurement
[06] Governor      → replicator dynamics, CBF projection
[07] Intervention  → Vaulturex law selection, LLM rewrite, constitutional judge
[08] Neithra       → constitutional synthesis
[09] ClauseBank    → OECD / UNESCO / EU AI Act / UDHR validation
[10] Auditor       → SHA-256 cryptographic receipt, Turso persistence
```

### Mathematics

```
M(x) = min(C, R, S)
G_i  = k(φ_i − φ̄),  Σ G_i = 0                          [mass-conserving correction]
V_z  = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ−xᵢ)²          [V̇_z ≤ 0, unconditionally]
B    = d / (1/3 − min(x_adv) + d)                        [brittleness — novel metric]
S    = cosine_sim(output_embedding, constitutional_centroid)
```

---

## Database

| Table | Records | Purpose |
|---|---|---|
| `praxis_receipts` | 5,300+ | SHA-256 audit receipts |
| `lex_memory` | 3,988+ | STABLE: 2,917 · INTERVENED: 1,005 · REFUSED: 66 |
| `z_traj` | 1,311+ | Trajectory memory sessions |
| `sovereign_laws` | 50 | Vaulturex Sovereign Codex (immutable) |
| `clause_bank` | 20 | Layer 1 normative clauses |

---

## Benchmark scripts

```bash
npm run harmbench           # HarmBench 200
npm run harmbench:score     # bare vs governed ASR
npm run jbb                 # JailbreakBench 200
npm run advbench            # AdvBench 520
npm run truthfulqa          # TruthfulQA 817
npm run tqa:judge           # LLM judge — Lin et al. 2022 T×I rubric
```

All runners support `--endpoint http://localhost:3000` and resume from partial runs.

---

## Citation

```bibtex
@misc{king2026aureonics,
  title  = {Aureonics: Constitutional Triadic Framework for Stable Adaptive Intelligence},
  author = {Emmanuel King},
  year   = {2026},
  doi    = {10.5281/zenodo.18944242},
  url    = {https://doi.org/10.5281/zenodo.18944242},
  note   = {ORCID: 0009-0000-2986-4935}
}
```

**Emmanuel King** — lexaureon@gmail.com · [lexaureon.com](https://lexaureon.com) · [@lexAureon](https://x.com/lexAureon)
