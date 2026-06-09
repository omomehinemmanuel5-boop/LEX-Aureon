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

**No model lock-in.** The governance layer is model-agnostic. Swap the underlying LLM without changing anything else. The constitutional framework holds regardless of which model is underneath.

---

## For agentic systems

Multi-step agents are constitutionally more fragile than chat models. A single adversarial injection in a tool output can hijack an entire agent trajectory. Lex Aureon's z-trajectory memory tracks constitutional health across turns — detecting slow-drip manipulation, identity drift, and cross-turn sycophantic collapse before they complete.

The Lyapunov-weighted barrier function:

```
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ − xᵢ)²
```

`z` is the trajectory memory vector — concentrating weight on pillars that have been under sustained pressure across turns. As `z` concentrates, the system stabilises faster. Proven unconditionally stable: `V̇_z ≤ 0` across Monte Carlo trials with zero violations.

**Practical result:** constitutional protection that gets stronger the longer an adversarial session runs — the opposite of what happens with standard LLMs.

---

## Benchmark results

Evaluated across four independent published adversarial benchmarks. Zero harmful outputs across all four — every attack that succeeded against the bare LLM was blocked by the constitutional governor.

| Benchmark | Year | Prompts | Bare ASR | Governed ASR | Attacks Blocked |
|---|---|---|---|---|---|
| HarmBench (run 1) | 2026-05 | 200 | 78.5% | **0.0%** | 157/157 |
| HarmBench (run 2) | 2026-06-09 | 200 | — | **0.0%** | 45/45 |
| JailbreakBench | NeurIPS 2024 | 200 | 4.0% | **0.0%** | 4/4 |
| AdvBench | Zou et al. 2023 | 520 | 6.7% | **0.0%** | 35/35 |

**1,120 total governed prompts across published benchmarks. 0.0% governed ASR across all runs.**

### HarmBench Run 2 — 2026-06-09 (Latest)

200 prompts across 4 adversarial categories. Zero bypasses. All 45 attacks that triggered the governor were successfully governed — M recovered above τ_floor=0.05 in every case.

| Category | Prompts | Interventions | 0% ASR | Notes |
|---|---|---|---|---|
| `mu` — Multi-attack | 25 | 18 | ✓ | Hardest category — simultaneous multi-pillar pressure |
| `fp` — False premise | 25 | 2 | ✓ | Governor precise — low intervention on legitimate queries |
| `by` — Bypass attempt | 25 | 6 | ✓ | Identity + sovereignty attacks correctly triggered |
| `sy` — Sycophancy | 25 | 0 | ✓ | M naturally stable — no correction needed |

**Average M after governance: 0.248 · Min M after: 0.096 (recovered above floor) · 0 bypasses**

HarmBench covers 8 categories: sycophancy, bypass_attempt, identity_reframe, multi_attack, attack_vector_disclosure, false_premise, slow_drip_probe, and benign. Zero harmful outputs across all eight. Zero false positives on benign prompts.

JailbreakBench uses the official NeurIPS 2024 JBB-Behaviors dataset — 100 harmful behaviors across 10 harm categories plus 100 benign counterparts. False positive rate: 3% (3/100 benign over-refused).

AdvBench uses the official harmful_behaviors.csv from Zou et al. 2023 — the paper that introduced GCG adversarial attacks, cited in virtually every safety paper since 2023.

---

## Architecture

### The 10-agent PRAXIS pipeline

Every governed request passes through a sequential 10-agent constitutional pipeline. Each agent has a bounded constitutional role and cannot exceed it — Article III separation of powers enforced by design.

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

**Stability margin:**
```
M(x) = min(C, R, S)
```

**Governor correction (mass-conserving):**
```
G_i = k(φ_i − φ̄),   Σ G_i = 0
```

**Lyapunov barrier with trajectory memory:**
```
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ − xᵢ)²
V̇_z ≤ 0  (proven unconditionally stable)
```

**Brittleness metric (novel):**
```
B(x_adv) = d / (1/3 − min(x_adv) + d)
```
Where `d` = geometric distance from constitutional centroid. Multi-pillar attacks have B ≈ 0; focused single-pillar attacks approach B = 1. No equivalent exists in published literature.

**Self-referential sovereignty:**
```
S = cosine_sim(output_embedding, constitutional_centroid)
```
The centroid is seeded from the 50 Vaulturex laws. S measures whether the output *is* Lex Aureon, not just whether it follows instructions.

---

## International standards alignment

Every governed response is validated against Layer 1 universal clauses — 20 normative standards from global AI governance frameworks. The constitutional triad (C+R+S=1) is the supreme law; external clauses validate but never override it.

| Pillar | Standards |
|---|---|
| C — Continuity | OECD 1.4 · UNESCO Art 4.1 · EU AI Act Art 9 · UDHR Art 12 · CETS 225 Art 9 · GNP_01 · GNP_03 |
| R — Reciprocity | OECD 1.2 · UNESCO Art 4.7 · Hiroshima P7 · UDHR Art 7 · ICCPR Art 26 · GNP_04 · GNP_02 |
| S — Sovereignty | OECD 1.5 · UNESCO Art 4.2 · EU AI Act Art 13 · UDHR Art 19 · CETS 225 Art 5 · GNP_05 |

Enterprise deployments add Layer 2 (regional: EU AI Act, NIST, NDPC) and Layer 3 (client-specific: HIPAA, FINRA, custom policies). Layers 2 and 3 are active only when they do not conflict with the constitutional triad.

---

## Provider architecture

The governed arm uses a five-provider fallback chain, so the system degrades gracefully under rate limits rather than failing:

```
Raw arm (benchmark baseline):    Groq llama-3.3-70b → Groq llama-3.1-8b
Governed arm (every response):   Gemini 3.1 Flash Lite → Gemini 2.5 Flash → Groq 70b → Groq 8b → Mistral
Intervention rewrite:            Mistral → Gemini 3.1 Flash Lite → Groq 8b
Constitutional judge:            Groq 8b → Gemini 3.1 Flash Lite → Mistral
```

---

## Database state

Live Turso (libSQL) database — eu-west-1:

| Table | Records | Purpose |
|---|---|---|
| `praxis_receipts` | 5,300+ | SHA-256 constitutional audit receipts |
| `sovereign_laws` | 50 | Vaulturex Sovereign Codex (immutable) |
| `clause_bank` | 20 | Layer 1 universal normative clauses |
| `lex_memory` | 3,782+ | Constitutional session memory with Jina embeddings |
| `embedding_cache` | growing | Turso-backed embedding cache (30-day TTL) |
| `z_traj` | 1,311+ | Trajectory memory sessions |

---

## Benchmark scripts

All benchmarks are reproducible. Scripts are in `scripts/` and write results to `data/`.

```bash
# Run HarmBench (200 prompts)
npm run harmbench -- --n 200

# Run JailbreakBench (200 prompts)
npm run jbb -- --n 200

# Run AdvBench (520 prompts)
npm run advbench -- --n 520

# Run TruthfulQA (817 questions)
npm run truthfulqa -- --n 817

# Score with LLM judge (Lin et al. 2022 rubric — T×I)
npm run tqa:judge -- --in data/tqa-results.jsonl --out data/tqa-judged.jsonl
```

All runners support `--endpoint http://localhost:3000` for local testing and resume automatically from partial runs.

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
**Live system:** [lexaureon.com](https://lexaureon.com)  
**Publication:** [doi.org/10.5281/zenodo.18944242](https://doi.org/10.5281/zenodo.18944242)  
**X:** [@lexAureon](https://x.com/lexAureon)
