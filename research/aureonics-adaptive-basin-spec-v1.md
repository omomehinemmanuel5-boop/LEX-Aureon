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

The manuscript's regional conditions are dominance plus constitutional viability. The reference classifier therefore tests the neutral region first, then labels states on the `M=τ_floor` boundary separately, and only classifies the remaining strict interior by dominant coordinate. Exact ties are labeled `transition` (a separatrix) because the manuscript's basin inequalities are strict.

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

The reference module returns the literal raw Equation (13) correction and its measured mass drift. It also provides two explicitly modified candidates:

1. **Stiffness-weighted centering.** Replace the arithmetic mean with
   `φ̄_k = (Σ_i k_i φ_i)/(Σ_i k_i)`, then set `G_i^k = k_i(φ_i-φ̄_k)`. This guarantees `Σ_i G_i^k=0` whenever `Σ_i k_i>0`. For a unique violated coordinate `m`, it gives `G_m^k=k_m δ_m(1-k_m/Σ_j k_j)`; it restores that coordinate only when `k_m>0` and some other stiffness is also positive.
2. **Task-independent floor repair.** Because `k_i∝w_i`, task weights can make the weakest pillar's stiffness zero. A separate uniform term `H_i=κ(φ_i-φ̄)`, with `κ>0`, is zero-sum and gives `H_m=2κδ_m/3>0` for a unique violated minimum. The combined candidate `G^k+H` therefore retains a task-independent restorative component.

These are research candidates, not the literal manuscript equation. The original arithmetic-centred Eq. (13) and the weighted-centred candidate are not interchangeable. Neither candidate is automatically the gradient of Equation (20).

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

The reference model uses the negative gradient projected onto the tangent cone of the floor-constrained simplex. Define:

```text
K_F(x) = {d : Σ_i d_i=0 and d_i≥0 whenever x_i=τ_floor}
ẋ = η P_{K_F(x)}(-∇V),  η>0
V̇ = -η ||P_{K_F(x)}(-∇V)||² ≤ 0
```

At strict-interior states, this reduces to the ordinary simplex-tangent projection `Π(v)=v-mean(v)1`. At a floor-active coordinate, the tangent-cone projection prevents an outward (floor-violating) direction while preserving the zero-sum constraint. The non-increase result is for fixed task weights `w(T)`, positive state coordinates, and this isolated projected-gradient flow on the floor-constrained feasible set. It does not prove that the manuscript's separate stiffness law in Section 4 is the same vector field. The paper must not describe Equation (13) as `-∇V` unless their equivalence is derived.

On the feasible set `x_i≥τ_floor`, the quadratic penalty is identically zero. The constrained minimizer is therefore the KKT water-filling solution `x_i*=max(τ_floor,w_i/λ)`, where `λ>0` is chosen so the coordinates sum to one. The reference module implements this exact three-coordinate active-set solution as `taskPotentialMinimizer()`. For one-hot weights it returns the paper's three boundary profiles; for mixed weights it returns a principled intermediate profile. Because the penalty is inactive on the feasible set, `k_0` does not change this constrained minimizer.

There is also a measurement issue in Equation (19). The manuscript defines effort as the norm of `G=-∇V`, but the system state is constrained to the simplex. The component of the ambient gradient parallel to `(1,1,1)` cannot produce state motion. At the centroid with uniform task weights, the ambient gradient is `(-1,-1,-1)` (norm `√3`) while the tangent-projected gradient is exactly zero. The reference module therefore exposes `projectedTaskPotentialEffort()`; it measures the force that can actually move the state while preserving the simplex constraint. This is a proposed operational definition and should be distinguished from the manuscript's ambient-norm Equation (19).

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

The later session-adaptive z-weights used by the live `V_z` certificate are a separate implementation-level object; they must not be silently substituted for `w(T)`.

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
- zero-sum floor-tangent-cone direction, boundary non-outwardness, and fixed-task directional descent;
- the literal basin-sensitive stiffness formula;
- the nonzero mass drift of the raw stiffness equation for an unequal-stiffness example;
- zero-sum behavior of the separately named tangent-projected candidate;
- KKT task-potential minimizers for one-hot and mixed task weights;
- tangent-projected task effort, including zero effort at the uniform centroid;
- a mass-conserving floor-repair candidate that remains restorative when the weakest pillar has zero task weight;
- floor-simplex projection and fixed-task discrete descent backtracking.

These are algebraic/software checks. They do not establish that the three regions are true attractor basins, that the full governed dynamics converge, or that task-conditioned modes improve model performance.



## 9. Existing repository classification mismatch

The current repository has two different signals that should not be described as interchangeable basin membership:

- `identifyBasin(x)` in `lib/aureonics_core.ts` uses a hard-coded `max(x)>0.4` threshold and otherwise returns `Balanced`. It does not use the v4 neutral radius `δ`, the strict `M>τ` condition, or a separately represented `M=τ` boundary.
- `applyGovernorCorrection()` in `lib/governor_sensing.ts` labels `basin_shift` by the largest absolute correction component. That is the dominant correction axis, not a classification of the current state or a measured transition into a basin.

The isolated classifier in this branch formalizes the paper's geometry without changing either existing production/reporting path. A future integration should name these observables distinctly (for example, `current_region` versus `dominant_correction_axis`) and version any receipt schema change.

## 10. Required corrections before stronger paper claims

1. Decide whether `x*` is a boundary-limit optimum or whether a positive interior margin is part of the model. Use the same convention in Tables C/D, Section 11, plots, code, and benchmark labels.
2. Reconcile the Section 9.2 / 12.1 stiffness equation with the claimed mass conservation. The arithmetic-centred expression is not generally zero-sum for unequal `k_i`; also state the positive task-weight condition needed for restoration. Consider the separately specified weighted-centering plus task-independent floor-repair candidate.
3. Reconcile the statement `G=-∇V` with the distinct stiffness law. Section 9.3 also uses an unweighted logarithmic Lyapunov candidate, whereas Section 12.2 defines a task-weighted potential. Define distinct symbols for the Section 9.2 floor-restoration force and Section 12.2 task-potential force, then analyze their combination.
4. Revisit Equation (19): distinguish ambient gradient norm from tangent-projected effort on the simplex; the ambient norm can be nonzero at a constrained stationary point. Also state whether task weights are fixed per transition, piecewise constant, or continuously varying. Include the `-Σ ẇ_i log(x_i)` term for moving weights. Note that Section 12.2's `W(t)=||G||` reuses the same `G` symbol already assigned to the Section 9.2 stiffness correction.
5. Prove invariance and convergence for the complete closed-loop vector field before calling the three regions proven attractor basins.
6. Evaluate P1–P6 under a preregistered protocol; v4 itself labels them falsifiable predictions, not established empirical findings.

## 11. Safe future integration order

Any future shadow or production proposal must measure `x`, resolve and freeze `w(T)`, compute the research direction, combine it with separately defined constitutional-memory correction, and finally apply the task-independent CBF/hard-floor filter. It must verify simplex and floor invariants and emit a receipt containing state, task weights, stiffness, potential, step size, guard outcome, and final safety-filter outcome.

Task preference must never weaken the task-independent safety filter or bypass human authority, approval, quarantine, or capability controls.

## 12. Non-goals and protected files

This branch does not modify the production kernel, `lib/production_transition.ts`, `lib/sovereign_kernel.ts`, `lib/praxis.ts`, `lib/kv.ts`, or production routes. It makes no database, external API, LLM, or network calls. No production threshold, recovery behavior, approval rule, or quarantine behavior is changed.

A passing typecheck/test suite is not a theorem. A benchmark win is not a stability proof. A successful reference model does not authorize production integration.
