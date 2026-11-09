# Aureonics Production Router Compatibility Audit — v1

**Status:** Source-trace audit; no production changes  
**Branch:** `research/aureonics-task-switching-stability`  
**Scope:** Determine whether the finite-variation task-tracking theorem in `aureonics-task-tracking-iss-v1.md` describes the current production task router or state dynamics.

## 1. Executive finding

The current production path inspected does **not** expose a task-preference weight vector \(w(t)\) that selects the Analytical, Collaborative, or Exploratory task profiles defined in the adaptive-basin research.

The production code has three different objects which must not be conflated:

1. **Constitutional state** \(x=(C,R,S)\): the live simplex state.
2. **Session Lyapunov weights** \(z=(z_C,z_R,z_S)\): memory/adaptation weights used in \(V_z(x,z)=-\sum_i z_i\log x_i+\text{floor penalty}\).
3. **Governor correction** \(G(x)\): a state-dependent correction, with a receipt field called `basin_shift`.

No source-traced production variable corresponds to the task-simplex weight schedule \(w(t)\) used by the task-tracking theorem. Therefore the finite-variation theorem cannot currently be presented as a theorem about production task switching.

## 2. Source trace

### 2.1 Live state and task signals

`lib/sovereign_kernel.ts` loads a session's \(z\) through the kernel bridge and passes it into `productionStateTransition` as `lyapunovWeights`. The production transition uses it for the z-weighted potential and the z-aware governor correction.

The transition's other live inputs are measured CRS deltas, post-response CRS deltas, active-law deltas, semantic-attack flag/severity, adversarial gain, effective theta, and threat signal. The inspected transition does not accept a task-profile vector or a task mode.

`task_context` appears in the agent/tool governance layer as semantic context for evaluating whether a proposed tool call matches its stated task. It is not a three-coordinate task-preference vector and is not passed into the adaptive-basin task-potential objective.

### 2.2 Session z-weight update

`lib/kv.ts` computes the session z-weights using the recurrence

\[
z_{t+1}=\operatorname{normalize}\left(
\operatorname{clamp}\left(
0.85z_t+0.15x_t-A_t,
0.025,0.95
\right)\right),
\]

where \(A_t\) is the law-event attack signal. The weights are persisted in `z_traj`, loaded by `lib/kernel_bridge.ts`, passed into `runCycle(sessionZ)`, and stamped into receipts.

This is a state/memory adaptation rule, not a task router. Its inputs are prior z, measured CRS, and law-event signals—not a task class selecting a C-, R-, or S-dominant operating objective.

A useful invariant follows from the actual clamp and normalization: before normalization each coordinate is at least 0.025 and at most 0.95, so the total is at most 2.85. Thus every normalized coordinate is at least

\[
z_i\ge\frac{0.025}{3(0.95)}=\frac1{114}\approx0.00877.
\]

This is a positive coordinate lower bound for the stored z update, assuming finite valid inputs and the described update path. It does **not** establish finite total variation of z, nor does it turn z into task weights \(w\).

### 2.3 Governor correction and basin label

`lib/governor_sensing.ts` calls `calculateGovernorG(x)`, scales the result by signal reliability and state-derived instability, and assigns `basin_shift` to the coordinate with the largest absolute correction component.

This label is therefore a **largest-correction-coordinate label**. It is not calculated by:
- comparing \(x\) with the three task-profile optima;
- evaluating a task weight vector;
- applying the research basin partition or its neutral/boundary rules; or
- proving entry into an invariant set or attraction region.

The separate `identifyBasin(x)` helper in `lib/aureonics_core.ts` uses a hard-coded maximum-coordinate threshold of 0.4 and otherwise returns `Balanced`. It is not a task router and does not establish basin attraction.

### 2.4 Actual production state dynamics

`lib/production_transition.ts` is the deterministic replay boundary. It combines several non-task-potential effects: measured and post-response deltas, law impact, adversarial gain, z-aware correction, semantic pressure, recentering, suspension, epsilon injection, threat pressure, and floor projection. It then applies a discrete z-potential descent guard by backtracking along the segment from the previous state to the candidate state.

This is not the projected-gradient flow \(\dot x=\eta P_{K_\tau(x)}(-\nabla_xV(x,w))\) assumed by the task-tracking theorem. The production guard enforces a discrete non-increase condition for its configured \(V_z\) on the certified transition, but that fact alone does not identify the production vector field with the task-potential reference dynamics.

## 3. Theorem compatibility matrix

| Theorem requirement | Production evidence | Finding |
|---|---|---|
| Explicit task weights \(w(t)\) on the task simplex | No such production vector found in the traced kernel/governor path | Not established |
| Task modes select the three basin optima | z is memory weighting; governor correction is state-dependent | Not implemented in traced path |
| Fixed task mode / fixed face or admissible one-hot/multi-support modes | No task-mode schedule exists in the traced path | Not applicable |
| Uniform lower bound on active task weights | z has a coordinate lower bound under its clamp/normalization, but z is not w | Wrong variable |
| Finite total variation of task schedule | No task schedule to measure; z can continue responding to ongoing state/law signals | Not established |
| Projected-gradient task-potential dynamics | Production uses a composite discrete transition with multiple forcing terms and a backtracking descent guard | Not equivalent |
| Convergence to instantaneous task optimum | No task optimum is computed in production | Not established |

## 4. What the current evidence does support

- The task-potential module is a research reference model with explicit assumptions.
- The production kernel uses session z-weights for a different role: weighting its constitutional Lyapunov potential and z-aware correction.
- The production transition has an explicit discrete descent guard for the configured z-weighted potential.
- The production basin label currently reports the dominant absolute correction coordinate, not a mathematically certified basin transition.
- The z update's coordinate clamp yields the lower bound \(z_i\ge1/114\) after normalization, but does not bound cumulative variation over an unbounded session.

These are source-trace findings, not a runtime traffic measurement. A separate production receipt analysis would be required to characterize observed z variation, correction labels, and transition frequencies under real workloads.

## 5. Recommended correction to research claims

Until an explicit task router is implemented and its schedule is measured, describe the three C/R/S profiles as **task-conditioned research operating profiles** and describe the finite-variation theorem as a theorem for the **offline task-potential reference dynamics**.

Do not say that production currently switches among, converges to, or has proven attraction basins for these profiles.

Do not substitute session z for task weights w in the theorem. A future theorem for the production z update would need a storage function that accounts for the moving z-dependent potential, the law-event input \(A_t\), the discrete production transition, and the descent guard. The derivative/jump terms from \(\dot z\) or \(\Delta z\) must be included explicitly.

## 6. Minimal next research steps

1. Define whether task-conditioned operating profiles are intended to affect only an explanatory/analysis layer or to become a real runtime control input.
2. If a real router is intended, specify a separate \(w(T)\) with an explicit mapping from task classification to the simplex, confidence handling, neutral mode, tie-breaking, hysteresis, and audit receipt fields.
3. Keep \(w\), \(z\), and \(x\) separately named and separately logged. Do not overload z as task preference.
4. Replay labeled task sequences offline. Measure support changes, minimum active task weight, total \(\ell_1\) variation, switch dwell times, and task-classification errors.
5. Compare the actual production transition against the task-potential reference flow. If they differ, derive a discrete/hybrid storage certificate for the actual map rather than importing the continuous-time theorem.
6. Only after independent validation should a router be considered for a production integration proposal. Any such proposal must preserve the existing floor, authorization, recovery, and audit invariants.

## 7. Scope and non-actions

This audit changes no production code, environment variable, threshold, route, task policy, z update, recovery path, approval flow, or deployment. It is documentation on the research branch only.
