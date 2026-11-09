# Aureonics Task-Sequence Experiment — Protocol v1

**Status:** Deterministic offline harness and 270-case parameter matrix implemented; latest-head CI evidence pending  
**Branch:** `research/aureonics-task-switching-stability`  
**Production integration:** None

## 1. Research question

Under the same synthetic task-label sequence and the same declared per-task disturbance, how do three distinct mechanisms behave?

1. **Production-z baseline:** call the actual deterministic `productionStateTransition()` at every step, supplying session z-weights; update z with the no-law-event recurrence mirrored from `lib/kv.ts`.
2. **Oracle task-potential reference:** use the true task label immediately as a one-hot task weight and take a projected-gradient reference step.
3. **Hysteretic task-router reference:** change the one-hot task weight only after the new label persists for a configured dwell count; then take the same projected-gradient reference step.

This is a controlled mechanism comparison, not a benchmark of real Lex workloads.

## 2. Workload and parameter matrix

The matrix executes 270 deterministic cases: six label schedules × five initial CRS states × three Euler gains × three disturbance magnitudes.

Schedules:
- repeated C/R/S blocks of lengths 2, 5, and 12;
- fixed-amplitude C→R→S cycling;
- a deterministic noisy-label sequence;
- abrupt one-hot blocks.

Initial states:
- simplex centroid;
- each of the three one-hot floor-boundary profiles;
- one asymmetric near-floor state.

Euler gains: 0.002, 0.004, and 0.008.  
Synthetic disturbance magnitudes: 0.0005, 0.001, and 0.005.  
Router dwell: three consecutive labels.

For each label, a zero-sum synthetic disturbance reduces the currently requested coordinate by the configured magnitude and distributes the same total equally across the other two coordinates. All three controllers receive exactly the same disturbance. These are experiment settings, not calibrated operational parameters or claims about real analytical, collaborative, or exploratory work.

**Not included in this matrix:** mixed task-weight vectors, learned task classification, randomized seeds, stochastic confidence intervals, and live production traffic. The current harness is one-hot task-label research only; mixed-support theorem results remain a separate analytical result and are not being passed off as tested matrix coverage.

## 3. What is called directly and what is mirrored

- The production state update is the repository's actual exported `productionStateTransition()` function.
- The production z recurrence is mirrored from `lib/kv.ts` for the no-law-event case: \(z^+=\operatorname{normalize}(\operatorname{clamp}(0.85z+0.15x,0.025,0.95))\).
- The oracle and routed task-potential controllers use research-only `taskConditionedDirection()` and `projectToFloorSimplex()`.
- The hysteretic router is research-only. It is not wired to PRAXIS, the kernel, or any production request path.

The z recurrence is reproduced locally because the production helper is private and coupled to persistence. This is a source-mirrored deterministic recurrence, not a live database-backed `updateZTraj()` call.

## 4. Recorded metrics

For each controller the harness records full CRS state history, mean and final Euclidean distance to the optimum for the true task label, mean and final task-relative tracking potential, task-weight total variation and switch count, minimum observed coordinate, and maximum simplex-sum residual. The production-z baseline additionally records z-weight history and total z variation.

Matrix aggregation reports mean tracking distances, mean weight variations, the minimum coordinate across all runs, and the maximum simplex residual. Raw trajectories remain available in each matrix row. Production z is **not** substituted for task weights; task-relative metrics are computed separately against known workload labels solely for descriptive comparison.

## 5. Interpretation limits

- A finite deterministic matrix cannot establish infinite-horizon stability or statistical generalization.
- The task-potential controllers use explicit discrete Euler steps plus projection; the continuous-time finite-variation theorem is not automatically a theorem about this discretization.
- The production transition has multiple forcing terms and a discrete z-potential descent guard. Calling it directly makes the state-map comparison more faithful, but the synthetic protocol omits persistence, law-event attack signals, external model scoring, concurrent requests, and real task classification.
- The hysteretic router receives ground-truth task labels. This isolates switching mechanics but does not test classifier accuracy, uncertainty, or adversarial misclassification.
- Fixed-amplitude cycling has unbounded total variation as the sequence is extended; the finite-variation hybrid theorem does not cover its infinite-horizon limit.
- Results are descriptive. No controller should be declared superior without workload validity, independent review, and separate analysis of task-label quality and production effects.

## 6. Acceptance checks

Tests verify deterministic matrix construction (270 cases), coverage of all six schedule families and parameter levels, common sequence lengths across controllers, floor/simplex invariants, finite aggregate metrics, and per-case trajectory availability. The original harness tests continue to cover dwell behavior, z/task-weight separation, transient switch suppression, and fail-closed option validation.

Passing these tests establishes implementation consistency only. It does not prove stability or empirical benefit. CI success is not a substitute for inspecting the numerical matrix output.

## 7. Follow-on work

After the matrix tests pass, inspect raw trajectories and aggregate metrics. Add mixed task-weight schedules only with explicit support-floor assumptions, and evaluate task-classifier uncertainty separately from the idealized ground-truth router. For the production baseline, verify the z-weighted discrete descent certificate at every step rather than inferring it from simplex invariants. Do not infer that task profiles belong in production merely because a synthetic reference controller tracks them.
