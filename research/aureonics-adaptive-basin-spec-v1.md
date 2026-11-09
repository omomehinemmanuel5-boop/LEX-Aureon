# Aureonics Adaptive Basin Alignment — v4 Equation Audit and Reference Model

**Status:** Research-only reference model; not a production controller change  
**Implementation branch:** `fix/adaptive-basin-alignment`  
**Manuscript basis:** *Aureonics — Constitutional Triadic Framework v4*, Sections 3.5, 6, 9, 11, and 12.

## 1. The hypothesis and the three operating basins

Aureonics' central hypothesis is that Continuity (C), Reciprocity (R), and Sovereignty (S) are three necessary expressions of one deeper property of viable adaptive systems. They are not three independent substances. The state is a single vector:

```text
x = (C,R,S),  C+R+S=1
M(x) = min(C,R,S)
```

The three task-conditioned operating basins in v4 are:

- **Analytical:** C-dominant; legal reasoning, long-horizon planning, memory tasks.
- **Collaborative:** R-dominant; instruction following, alignment, calibration tasks.
- **Exploratory:** S-dominant; creative generation, adversarial search, novel domains.

The manuscript also identifies a neutral region around the centroid. Neutral is not a fourth directional basin; it is the general-purpose, approximately balanced regime.

The manuscript's regional conditions are dominance plus constitutional viability. The reference classifier therefore tests the neutral region first, then labels states on the `M=τ_floor` boundary separately, and only classifies the remaining strict interior by dominant coordinate. Ties resolve C, then R, then S.

## 2. Important target-geometry inconsistency

Section 3.5 and Table 3 give the one-hot task-optimal profiles:

```text
Analytical:    (1-2τ, τ, τ)
Collaborative: (τ, 1-2τ, τ)
Exploratory:   (τ, τ, 1-2τ)
```

With `τ=τ_floor=0.05`, each profile has `M(x)=0.05`. But Section 3.5 defines the directional basins with `M>τ`, and Section 3.4 calls `M≤τ` the violation zone. Consequently, the table's `x*` is a boundary-limit optimum, not a point in the strict stable interior. The distinction matters:

- The linear utility optimum under the closed constraint `x_i≥τ` can be attained at the boundary.
- Under the strict condition `x_i>τ`, the same optimum is only a supremum/limit; it is not attained.
- A practical strictly interior target needs an explicit positive margin `ε_B`, replacing `τ` with `τ_B=τ+ε_B<1/3`. This is a regularized extension, not a value specified by v4.

The reference module exposes both the literal manuscript profile (`ε_B=0`) and the explicit interior extension (`ε_B>0`). It does not silently change the paper's target.

## 3. Task utility — Equation (18)

V4 defines task weights `w(T)=(w_C,w_R,w_S)`, non-negative and summing to one:

```text
U(x,T) = w_C C + w_R R + w_S S
         - λ max(0, τ_floor - M(x))²
```

The penalty is zero throughout the feasible interior `M≥τ_floor`. For a one-hot task weight, maximizing the linear component under `x_i≥τ_floor` yields the corresponding boundary profile in Section 2. The maximum coordinate is `1-2τ_floor=0.90` at `τ_floor=0.05`.

This utility is a task-ranking objective. It is not itself the governor's gradient potential and does not prove dynamical convergence.

## 4. Basin-sensitive stiffness — Section 12.1

V4 specifies:

```text
k_i(x,T) = k_0 w_i(T) / (M(x)+ε_k)
φ_i(x) = max(0, τ_floor-x_i)
G_i(x,T) = k_i(x,T) (φ_i-φ̄)
φ̄ = (1/3) Σ_j φ_j
```

The regularizer `ε_k>0` bounds stiffness as the margin approaches zero. However, the stated mass-conservation claim does not follow when the `k_i` differ:

```text
Σ_i G_i = Σ_i k_i(φ_i-φ̄)
```

This is not generally zero unless the stiffness coordinates satisfy an additional condition (for example, all `k_i` are equal, or a special state/weight relation holds). Centering `φ` before multiplying by unequal `k_i` is not equivalent to projecting the weighted vector afterward.

The reference module returns both:
- the literal raw Equation (13) correction and its measured mass drift; and
- a separately named candidate `Π(G_raw)`, where `Π(v)=v-mean(v)1`.

The projected candidate restores zero-sum mass conservation, but it is a modified equation and is not automatically the gradient of Equation (20). It is not silently substituted for the manuscript formula.

## 5. Constitutional task potential — Equation (20)

V4 defines:

```text
V(x,T) = -Σ_i w_i(T) log(x_i)
         + (k_0/2) Σ_i max(0, τ_floor-x_i)²
```

Its exact ambient gradient is:

```text
∂V/∂x_i = -w_i(T)/x_i - k_0 max(0, τ_floor-x_i)
```

The reference model uses the tangent-projected negative gradient:

```text
Π(v)=v-mean(v)1
ẋ = -η Π(∇V),  η>0
V̇ = -η ||Π(∇V)||² ≤ 0
```

This result holds for fixed task weights `w(T)`, positive state coordinates, and the isolated projected-gradient flow. It does not prove that the manuscript's separate stiffness law in Section 4 is the same vector field. The paper must not describe Equation (13) as `-∇V` unless their equivalence is derived.

When task weights vary with time, the derivative contains an additional term:

```text
∂V/∂t = -Σ_i ẇ_i(T) log(x_i)
```

Thus the fixed-task descent result does not imply unconditional descent under arbitrary task switching. Freeze task weights over a certified evaluation window, or bound and account for task-weight drift.

## 6. State, task weights, and trajectory context are distinct

| Symbol | Meaning | Role |
|---|---|---|
| `x=(C,R,S)` | Measured constitutional state | The point being governed |
| `w(T)` | Task weights | Select task utility / task-conditioned potential |
| `k_i(x,T)` | Basin-sensitive stiffness | Modulates the Section 12.1 correction |
| `z_env(t)` | Environmental context | `δ,ρ,U,T,pre_eval` in v4 Section 6.3 |
| `z_traj(t)` | Trajectory context | Velocity, dwell count, drift direction, cumulative violations |
| `z(t)` | Combined context | Must not be conflated with task weights |

The later session-adaptive z-weights used by the live `V_z) certificate are a separate implementation-level object; they must not be silently substituted for `w(T)`.

## 7. Hard-floor and recovery invariants

This work preserves:

- `τ_floor = 0.05`;
- `τ_recovery = 0.15`;
- existing z-trajectory update semantics;
- approval, quarantine, human authority, and capability boundaries.

The interior-margin extension is an explicit research parameter only. It does not alter the production floor or recovery threshold.

## 8. Verification scope

The isolated reference tests cover:

- exact one-hot v4 profiles and the distinction between boundary and strict-interior targets;
- neutral-first region partition and deterministic tie-breaking;
- Equation (18) task utility;
- Equation (20) potential and exact gradient;
- zero-sum tangent-projected direction and fixed-task directional descent;
- the literal basin-sensitive stiffness formula;
- the nonzero mass drift of the raw stiffness equation for an unequal-stiffness example;
- zero-sum behavior of the separately named tangent-projected candidate;
- floor-simplex projection and fixed-task discrete descent backtracking.

These are algebraic/software checks. They do not establish that the three regions are true attractor basins, that the full governed dynamics converge, or that task-conditioned modes improve model performance.

## 9. Required corrections before stronger paper claims

1. Decide whether `x*` is a boundary-limit optimum or whether a positive interior margin is part of the model. Use the same convention in Tables C/D, Section 11, plots, code, and benchmark labels.
2. Reconcile the Section 12.1 stiffness equation with the claimed mass conservation. Either constrain `k_i), project the weighted correction, or derive a different mass-conserving law.
3. Reconcile the statement `G=-∇V` with the distinct stiffness law. If they are different control components, define their combination and analyze it.
4. State whether task weights are fixed per transition, piecewise constant, or continuously varying. Include the `-Σ ẇ_i log(x_i)` term for moving weights.
5. Prove invariance and convergence for the complete closed-loop vector field before calling the three regions proven attractor basins.
6. Evaluate P1–P6 under a preregistered protocol; v4 itself labels them falsifiable predictions, not established empirical findings.

## 10. Safe future integration order

Any future shadow or production proposal must measure `x`, resolve and freeze `w(T)`, compute the research direction, combine it with separately defined constitutional-memory correction, and finally apply the task-independent CBF/hard-floor filter. It must verify simplex and floor invariants and emit a receipt containing state, task weights, stiffness, potential, step size, guard outcome, and final safety-filter outcome.

Task preference must never weaken the task-independent safety filter or bypass human authority, approval, quarantine, or capability controls.

## 11. Non-goals and protected files

This branch does not modify the production kernel, `lib/production_transition.ts`, `lib/sovereign_kernel.ts`, `lib/praxis.ts`, `lib/kv.ts`, or production routes. It makes no database, external API, LLM, or network calls. No production threshold, recovery behavior, approval rule, or quarantine behavior is changed.

A passing typecheck/test suite is not a theorem. A benchmark win is not a stability proof. A successful reference model does not authorize production integration.
