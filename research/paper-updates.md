# Paper Update Suggestions — Aureonics v3 candidate

Generated from `lib/praxis.ts`, `lib/kv.ts`, and `research/open-problems.md`
since Paper v3 (DOI 10.5281/zenodo.18944242, May 2026).

Each suggestion cites the code that motivates it so reviewers can verify the
math against the implementation.

---

## 1. Effective τ — adaptive constitutional floor

**Implementation (lib/praxis.ts:237–239, runPRAXIS):**

```
pressureBoost = min(0.05, z.attack_pressure · 0.05)
labelBoost    = 0.05 if pre_eval = HIGH else 0
τ_eff(z, ℓ)   = min(τ_recovery − 0.01, τ_floor + pressureBoost + labelBoost)
```

The CBF floor is no longer the static constant `τ_floor = 0.05` from
Paper v2 §6. It is a function of the session trajectory `z` and the
pre-eval label `ℓ ∈ {CLEAR, HIGH}`, bounded above by `τ_recovery − 0.01`.

**Suggested additions:**

- §6 (Governor Pipeline): replace `τ_floor` with `τ_eff(z, ℓ)` throughout
  the CBF, Lyapunov penalty, and `applyGovernorCorrection` definitions.
- New §6.X "Adaptive CBF floor": state the closed form, prove the upper
  bound `τ_eff ≤ τ_recovery − 0.01` preserves `correction → recovery`
  ordering (no governor-mode oscillation).
- §8 (Stability): the existing single-pillar Lyapunov argument extends
  unchanged because `τ_eff` is bounded and piecewise-constant per turn.

**Falsifiable prediction (new P10):** repeated adversarial turns within
a single session collapse `M(x)` faster than the same prompts across
independent sessions — because attack_pressure raises τ_eff over time.
Testable on SSS50 with paired session/fresh-session arms.

---

## 2. CBF-safe Euclidean simplex projection

**Implementation (lib/praxis.ts:68–83, lib/kv.ts:164–179):**

The simplex projection is no longer the naive `x ↦ x / Σx`. It is the
exact Euclidean projection onto `{x : Σxᵢ = 1, xᵢ ≥ τ_floor}` using the
Duchi–Shalev-Shwartz–Singer algorithm with an offset.

**Suggested additions:**

- §5 (Simplex Geometry): replace the normalization formula with the
  projection theorem `Π_S(x) = argmin_{y ∈ S} ||y − x||₂` where
  `S = {y : Σyᵢ = 1, yᵢ ≥ τ_floor}`.
- Add Lemma 5.X: `Π_S` is non-expansive — `||Π_S(x) − Π_S(y)|| ≤ ||x − y||`.
  This **directly contributes to Open Problem 1** (global Lyapunov):
  non-expansivity gives a clean step-decrease bound on `V` under
  governor + projection composition, replacing the heuristic argument
  in Paper v2 §8.3.

---

## 3. Stress accumulation at τ_LYP rather than τ_floor

**Implementation (lib/kv.ts:241):**

```
σ_viol_t = σ_viol_{t-1} · (W−1)/W + viol_t / W
viol_t   = max(0, τ_LYP − M(x_t))     ← was max(0, τ_floor − M(x_t)) in v2
W        = 10
τ_LYP    = 0.08, τ_floor = 0.05
```

Slow-drip detection now accumulates **before** the CBF floor is crossed,
not after. This changes the operational definition of "drift."

**Suggested additions:**

- §7 (Slow-Drip Detection): rewrite the σ-violation EMA with τ_LYP as
  the accumulation threshold; explain the design choice — slow-drip is
  a *predictor* of CBF breach, so it must fire in the Lyapunov-penalty
  band (`τ_floor < M ≤ τ_LYP`), not after the CBF has already engaged.
- This refines **Open Problem 3** (z-update rule): `σ_viol` is now
  coupled to τ_LYP, so the hybrid-system formulation must distinguish
  three regions (M > τ_LYP, τ_floor < M ≤ τ_LYP, M ≤ τ_floor) rather
  than two.
- **Falsifiable prediction (new P11):** time-to-detection of slow-drip
  attacks is shorter under the τ_LYP rule than under the τ_floor rule —
  testable by replaying SSS50 with both σ_viol definitions.

---

## 4. Attack-pressure z-state variable

**Implementation (lib/kv.ts:137–149, 245–248):**

`ZTraj` gains a tenth component `attack_pressure ∈ [0, 1]` that persists
across turns and feeds `τ_eff` (Suggestion 1).

**Suggested additions:**

- §4 (State Space): formalize the trajectory state
  `z = (velocity, n_stable, drift_dir, σ_viol, M, C, R, S, p_attack)`
  and write its update map `z_{t+1} = h(x_t, z_t, ℓ_t)` explicitly.
- This is **the missing piece of Open Problem 3**. With `p_attack`
  added, the z-update rule is now complete modulo the law-event coupling.
  Suggest reframing Open Problem 3 as: "characterize the coupling
  `dp_attack / dt` to `law_events`."

---

## 5. Law-firing receipts

**Implementation (lib/praxis.ts:106, 289):**

`PRAXISReceipt` now includes `law_fired: string | null`, so each audit
record names the constitutional law (`bypass_attempt`, `identity_reframe`,
`sycophancy`, `multi_attack`, or `null`) that fired on that turn.

**Suggested additions:**

- §9 (Audit Receipts): add `law_fired` to the receipt schema; this is
  the cryptographic bridge between the attack taxonomy (§3) and the
  audit trail (§9), which Paper v2 left implicit.
- Enables a **new falsifiable prediction (P12):** the empirical
  distribution of `law_fired` on production traffic matches the
  taxonomy partition assumed in §3 (no "other" residual class needed).

---

## 6. Health band as a single source of truth

**Implementation (lib/kv.ts:122–127, `deriveHealthBand`):**

```
OPTIMAL    M ≥ 0.25
ALERT      0.15 ≤ M < 0.25
STRESSED   0.08 ≤ M < 0.15      (Lyapunov penalty active)
CRITICAL   M < 0.08              (governor correction imminent or active)
```

The band boundaries are now τ_LYP, τ_recovery, and the OPTIMAL ceiling
0.25 — not the ad-hoc thresholds in v2.

**Suggested additions:**

- §7 (Health States): replace Table 7.1 with the canonical four bands
  above. Each boundary is now a named constitutional constant with a
  control-theoretic meaning (penalty onset, recovery floor, suppression
  floor, optimal interior).

---

## 7. Updates to research/open-problems.md

Reflecting the above:

- **Open Problem 1 — Global Lyapunov:** non-expansive Π_S (Suggestion 2)
  gives the missing step-decrease bound. **Downgrade priority from
  HIGH to MEDIUM.**
- **Open Problem 3 — z-update rule:** `p_attack` closes the state-space
  side (Suggestion 4). The remaining open question is the law-event
  coupling. **Rephrase: "Characterize dp_attack/dt under law_events."**
- **Predictions:** add P10 (per-session adversarial collapse), P11
  (faster slow-drip detection under τ_LYP rule), P12 (taxonomy
  partition completeness).

---

## Out of scope for this revision

These are real but better tracked separately:

- KV → Turso storage migration (engineering, not theory).
- Pattern-list growth for `identity_reframe` (operational tuning).
- `getGovernorMode` τ-parameterization (already implied by Suggestion 1).
