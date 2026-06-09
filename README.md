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

Lex Aureon is a production-deployed governance layer that sits above any LLM. Every output — whether from a chat model, a code agent, or a multi-step autonomous pipeline — passes through a constitutional pipeline before reaching the user. If the output violates the constitutional constraint, it is corrected. Every correction is cryptographically signed and permanently auditable.

The framework enforces a three-pillar constitutional balance in continuous time:

```
C (Continuity) + R (Reciprocity) + S (Sovereignty) = 1
M(x) = min(C, R, S) ≥ τ    [constitutional safety invariant]
```

When `M` approaches the constitutional floor, the SovereignKernel activates — measuring the constitutional state via real embeddings, applying replicator dynamics correction, firing the relevant law from the Vaulturex Sovereign Codex, and validating the governed output before release.

---

## For LLM builders

If you are building on top of any LLM — GPT-4, Claude, Gemini, Llama, Mistral — Lex Aureon is a drop-in governance layer. One API call. Every response constitutionally governed, cryptographically audited, and traceable to its generating state.

```bash
curl -X POST https://lexaureon.com/api/lex/govern \
  -H "Content-Type: application/json" \
  -d '{"prompt": "your user input", "session_id": "user-123", "turn": 1}'
```

**Response includes:**
- `governed_output` — the constitutionally validated response
- `raw_output` — the ungoverned LLM response (for comparison)
- `M` — constitutional health score (0–1)
- `C`, `R`, `S` — individual pillar scores
- `receipt_hash` — SHA-256 cryptographic audit receipt
- `governor_mode` — what intervention was applied

**No model lock-in.** The governance layer is model-agnostic. Swap the underlying LLM without changing anything else.

---

## For agentic systems

Multi-step agents are constitutionally more fragile than chat models. A single adversarial injection in a tool output can hijack an entire agent trajectory. Lex Aureon's z-trajectory memory tracks constitutional health across turns — detecting slow-drip manipulation, identity drift, and cross-turn sycophantic collapse before they complete.

The Lyapunov-weighted barrier function:

```
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ − xᵢ)²
```

`z` is the trajectory memory vector — concentrating weight on pillars under sustained pressure. As `z` concentrates, the system stabilises faster. Proven unconditionally stable: `V̇_z ≤ 0` across Monte Carlo trials with zero violations.

---

## Benchmark results

Evaluated across four independent published adversarial benchmarks. Zero harmful outputs across all — every attack that succeeded against the bare LLM was blocked by the constitutional governor.

| Benchmark | Year | Prompts | Bare ASR | Anchored ASR | Governed ASR | Attacks Blocked |
|---|---|---|---|---|---|---|
| HarmBench (run 1) | 2026-05 | 200 | 78.5% | — | **0.0%** | 157/157 |
| HarmBench (run 2) | 2026-06-09 | 200 | **90.0%** | **0.0%** | **0.0%** | 180/180 |
| JailbreakBench | NeurIPS 2024 | 200 | 4.0% | — | **0.0%** | 4/4 |
| AdvBench | Zou et al. 2023 | 520 | 6.7% | — | **0.0%** | 35/35 |

**1,120 total governed prompts. 0.0% governed ASR across all runs.**

Three scoring arms in HarmBench run 2:
- **Bare** (ungoverned Llama): 90.0% ASR — 180 of 200 attacks succeeded against the raw model
- **Anchored** (system-prompt only): 0.0% ASR — constitutional system prompt alone blocks attacks
- **Governed** (SovereignKernel): 0.0% ASR — full constitutional governance, scored by M + CBF + semantic signal

The anchored arm is notable: the constitutional system prompt alone achieves 0.0% ASR, and the full SovereignKernel confirms and enforces it mathematically. Governed arm scored by constitutional metrics (M, CBF, semantic_signal) — no external LLM judge required.

## Architecture

### The 10-agent PRAXIS pipeline

```
[01] Pre-Eval          → CLEAR/HIGH classifier, sigma_viol slow-drip detection
[02] Memory            → Jina jina-embeddings-v3, constitutional memory retrieval
[03] Generator         → dual-arm: raw (Groq 70b) + governed (constitutional context)
[04] RawForge          → baseline extraction
[05] CRS Extractor     → real embedding-based C, R, S measurement
[06] Governor          → Section 11 replicator dynamics, CBF projection
[07] Intervention      → Vaulturex law selection, LLM rewrite, constitutional judge
[08] Neithra           → constitutional synthesis
[09] ClauseBank        → international standard validation (OECD/UNESCO/EU AI Act/UDHR)
[10] Auditor           → SHA-256 cryptographic receipt, Turso persistence
```

### Constitutional mathematics

```
M(x) = min(C, R, S)
G_i = k(φ_i − φ̄),   Σ G_i = 0
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ − xᵢ)²   [V̇_z ≤ 0]
B(x_adv) = d / (1/3 − min(x_adv) + d)                 [brittleness — novel]
S = cosine_sim(output_embedding, constitutional_centroid)
```

---

## International standards alignment

| Pillar | Standards |
|---|---|
| C — Continuity | OECD 1.4 · UNESCO Art 4.1 · EU AI Act Art 9 · UDHR Art 12 · CETS 225 Art 9 |
| R — Reciprocity | OECD 1.2 · UNESCO Art 4.7 · Hiroshima P7 · UDHR Art 7 · ICCPR Art 26 |
| S — Sovereignty | OECD 1.5 · UNESCO Art 4.2 · EU AI Act Art 13 · UDHR Art 19 · CETS 225 Art 5 |

---

## Provider architecture

```
Raw arm:         Groq llama-3.3-70b → Groq llama-3.1-8b
Governed arm:    Gemini 3.1 Flash Lite → Gemini 2.5 Flash → Groq 70b → Groq 8b → Mistral
Intervention:    Mistral → Gemini 3.1 Flash Lite → Groq 8b
Judge:           Groq 8b → Gemini 3.1 Flash Lite → Mistral
```

---

## Database state

| Table | Records | Purpose |
|---|---|---|
| `praxis_receipts` | 5,300+ | SHA-256 constitutional audit receipts |
| `lex_memory` | 3,988+ | Constitutional session memory (STABLE: 2,917 · INTERVENED: 1,005 · REFUSED: 66) |
| `embedding_cache` | growing | Turso-backed embedding cache (30-day TTL) |
| `z_traj` | 1,311+ | Trajectory memory sessions |
| `sovereign_laws` | 50 | Vaulturex Sovereign Codex (immutable) |
| `clause_bank` | 20 | Layer 1 universal normative clauses |

---

## Benchmark scripts

```bash
npm run harmbench          # 200 prompts
npm run harmbench:score    # bare vs anchored vs governed ASR
npm run jbb                # JailbreakBench 200
npm run advbench           # AdvBench 520
npm run truthfulqa         # TruthfulQA 817
npm run tqa:judge          # LLM judge — Lin et al. 2022 T×I rubric
```

All runners support `--endpoint http://localhost:3000` and resume from partial runs.

---

## Citation

```bibtex
@misc{king2026aureonics,
  title   = {Aureonics: Constitutional Triadic Framework for Stable Adaptive Intelligence},
  author  = {Emmanuel King},
  year    = {2026},
  doi     = {10.5281/zenodo.18944242},
  url     = {https://doi.org/10.5281/zenodo.18944242},
  note    = {ORCID: 0009-0000-2986-4935}
}
```

---

## Contact

**Emmanuel King** — Principal Researcher, Lex Intelligence Systems  
**Email:** lexaureon@gmail.com  
**Live:** [lexaureon.com](https://lexaureon.com) · **Paper:** [doi.org/10.5281/zenodo.18944242](https://doi.org/10.5281/zenodo.18944242) · **X:** [@lexAureon](https://x.com/lexAureon)
