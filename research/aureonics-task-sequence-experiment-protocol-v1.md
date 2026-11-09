# Aureonics Task-Sequence Experiment — Protocol v1

**Status:** Deterministic offline harness added; execution/CI evidence pending  
**Branch:** `research/aureonics-task-switching-stability`  
**Production integration:** None

## 1. Research question

Under the same synthetic task-label sequence and the same declared per-task disturbance, how do three distinct mechanisms behave?

1. **Production-z baseline:** call the actual deterministic `productionStateTransition()` at every step, supplying session z-weights; update z with the no-law-event recurrence mirrored from `lib/kv.ts`.
2. **Oracle task-potential reference:** use the true task label immediately as a one-hot task weight and take a projected-gradient reference step.
3. **Hysteretic task-router reference:** use a separate research-only router that changes the one-hot task weight only after the new label persists for a configured dwell count; then take the same projected-gradient reference step.

This is a controlled mechanism comparison, not a benchmark of real Lex workloads.

## 2. Workload protocol

The harness accepts a deterministic sequence of task labels from `C`, `R`, and `S`. For each label, a zero-sum synthetic disturbance reduces the currently requested coordinate by `challengeMagnitude` and distributes the same total equally across the other two coordinates. All controllers receive exactly the same disturbance.

Default settings:
- initial CRS: centroid `(1/3,1/3,1/3)`;
- initial z: centroid;
- hard floor: `0.05`;
- task-potential Euler gain: `0.004`;
- disturbance magnitude: `0.001`;
- hysteretic router dwell: 3 consecutive labels;
- no law events, semantic attack, adversarial gain, or threat signal in the production transition.

These are experiment settings, not calibrated operational parameters. The synthetic disturbance is a declared stressor, not a claim about the causal effect of real analytical, collaborative, or exploratory work.

## 3. What is called directly and what is mirrored

- The production state update is the repository's actual exported `productionStateTransition()` function.
- The production z recurrence is mirrored from `lib/kv.ts` for the no-law-event case: \(z^+=\operatorname{normalize}(\operatorname{clamp}(0.85z+0.15x,0.025,0.95))\).
- The oracle and routed task-potential controllers use the research-only `taskConditionedDirection()` and `projectToFloorSimplex()` functions.
- The hysteretic router is new research code. It is not wired to PRAXIS, the kernel, or any production request path.

The z recurrence is reproduced locally because the production helper is private and coupled to persistence. This is a source-mirrored deterministic recurrence, not a live database-backed `updateZTraj()` call.

## 4. Recorded metrics

For each controller the harness records:
- full CRS state history;
- mean and final Euclidean distance to the optimum for the true task label;
- mean and final task-relative tracking potential;
- task-weight total variation and switch count;
- minimum observed coordinate and maximum simplex-sum residual.

For the production-z baseline it additionally records the z-weight history and total z variation. Production z is **not** substituted for task weights in the controller; the task-relative metrics are computed separately against the known workload labels solely to make comparison possible.

## 5. Interpretation limits

- A finite deterministic sequence cannot establish infinite-horizon stability.
- The task-potential controllers use explicit discrete Euler steps plus projection; the continuous-time finite-variation theorem is not automatically a theorem about this discretization.
- The production transition has multiple forcing terms and a discrete z-potential descent guard. Calling it directly makes the state-map comparison more faithful, but this synthetic protocol still omits persistence, law-event attack signals, external model scoring, concurrent requests, and real task classification.
- The hysteretic router receives ground-truth task labels. This isolates switching mechanics but does not test classifier accuracy, uncertainty, or adversarial misclassification.
- Results should be interpreted descriptively. Do not declare one controller superior without pre-registered workloads, parameter sweeps, multiple initial states, uncertainty analysis, and independent review.

## 6. Acceptance checks

The test suite verifies:
1. all three paths replay the same sequence length;
2. all states remain on the floor-constrained simplex;
3. the router respects the configured dwell delay;
4. production z-weights remain normalized and distinct from task weights;
5. hysteresis reduces switches on the test sequence;
6. invalid schedules/options fail closed.

Passing these tests establishes implementation consistency only. It does not prove stability or empirical benefit.

## 7. Next experiment stage

After CI passes, run a pre-registered matrix:
- C/R/S block sequences with varied block lengths;
- repeated C→R→S cycles with fixed-amplitude switches;
- mixed task weights with controlled minimum active weight;
- abrupt one-hot changes and noisy task labels;
- multiple initial states, including near-floor and centroid states;
- disturbance magnitudes and controller gains swept independently.

Report both raw trajectories and aggregate metrics. In particular, check whether the production baseline preserves its own z-weighted discrete descent certificate on every step, and whether the task-potential models track their current task optima without violating the floor. Do not infer that the task profiles belong in production merely because a synthetic reference controller tracks them.
