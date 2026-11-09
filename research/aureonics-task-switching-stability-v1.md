# Aureonics Task-Weight Switching Stability — Research Note v1

**Status:** Offline mathematical analysis and deterministic reference experiments  
**Branch:** `research/aureonics-task-switching-stability`  
**Parent:** adaptive-basin equation audit; no production integration  
**Scope:** Piecewise-constant task weights, rapid switching, and bounded continuous drift

## Executive finding

The fixed-task descent result does **not** establish stability under task switching. For
[
V(x,w)=-\sum_{i=1}^3 w_i\log x_i,
]
the projected-gradient flow is descending only while (w) is fixed (with the floor
constraint handled by the tangent cone). When (w) changes, the derivative acquires
[
\dot V=-\eta\|P_{K_F(x)}(-\nabla_x V)\|^2
        -\sum_i\dot w_i\log x_i.
]
The second term has no fixed sign. At a discontinuous switch, (x) is continuous but
the value of the active potential can jump in either direction. Thus the present
fixed-task theorem cannot be promoted to an arbitrary-switching or moving-task theorem.

The correct current classification is **task-conditioned operating regions with
fixed-task convergence evidence**. Calling them proven attractor basins under
time-varying tasks would be premature.

## 1. Piecewise-constant task switching

Let (w(t)=w^{(q)}) on each interval ([t_q,t_{q+1})). Between switches, the
fixed-task projected flow gives
[
\dot V_q=-\eta\|P_{K_F(x)}(-\nabla_x V_q)\|^2\le 0.
]
At a switch (w^-	o w^+), the state is held fixed in the ideal hybrid model and
[
\Delta V=V(x,w^+)-V(x,w^-)
        =-\sum_i(w_i^+-w_i^-)\log x_i.
]
There is no sign guarantee. Since (x_i\in[\tau,1]), a conservative bound is
[
|\Delta V|\le \|w^+-w^-\|_1\log(1/\tau).
]
This bound is useful for budgeting switch-induced objective jumps, but it is not
a stability certificate: repeated positive jumps can outweigh the descent accrued
between switches.

**Implication:** A mode switch must be treated as a hybrid-system event, not as
ordinary motion along one Lyapunov function. The switched-task simulator records
the objective immediately before and after each switch, separately from the
within-mode descent trace.

## 2. Rapid switching

If switching is faster than the state can track each mode's constrained minimizer,
the state need not approach any individual task optimum. It may instead track an
average objective, exhibit persistent oscillation, or remain in a compromise region.
Which behavior occurs depends on the switching schedule, step size/gain, task
profiles, and any hysteresis or dwell-time rule.

For sufficiently fast periodic switching under suitable regularity and boundedness
assumptions, an averaged vector field can sometimes approximate the switched
system. That is a candidate analysis, not a result established here. The average
of projected vector fields is not automatically the projected vector field of the
average task potential at floor-active states; the projection and switching
operations need not commute.

**Required experiment:** compare slow, medium, and rapid cyclic schedules over
the same initial-state grid; report per-mode tracking error, total variation of
(x(t)), switch jump budget, floor activity, and distance to the instantaneous
KKT minimizer. Do not report only final-state error.

## 3. Bounded continuous task-weight drift

For differentiable (w(t)), with (w_i(t)\ge0), (sum_iw_i(t)=1), and
(x_i\ge\tau>0), the task-drift term obeys
[
\left|\sum_i\dot w_i\log x_i\right|
\le \|\dot w\|_1\log(1/\tau).
]
A sufficient *pointwise* condition for non-increase of the active potential is
[
\eta\|P_{K_F(x)}(-\nabla_x V)\|^2
\ge \|\dot w\|_1\log(1/\tau).
]
This condition is conservative and state-dependent. It necessarily becomes
uninformative near a stationary point, where the projected force tends to zero.
Therefore a nonzero task drift cannot be declared safe merely because its rate is
bounded by a fixed constant. A useful theorem needs either a positive tracking
margin away from equilibrium, a composite storage function, or an explicit bound
on tracking error relative to the moving minimizer.

A practical research variant is to rate-limit task weights and freeze them once the
state enters a certified convergence window. That is a protocol proposal, not a
proof for the current model.

## 4. Common Lyapunov versus multiple Lyapunov

A single task-specific potential (V(x,w)) is not a common Lyapunov function:
its definition changes with (w), and its switch jump is sign-indefinite.

A task-independent common strict Lyapunov function has not been identified. It
cannot be assumed from the fact that each frozen mode has its own descending
potential. In particular, the one-hot task modes have different constrained
minimizers, so no single function can be asserted to certify convergence to all
three distinct optima without a separate construction and proof.

A multiple-Lyapunov / dwell-time route is plausible but still conditional. For
each mode (q), define a nonnegative shifted storage
(W_q(x)=V(x,w^{(q)})-V(x_q^*,w^{(q)})). A valid dwell-time theorem would need:

1. a uniform within-mode decay estimate for (W_q) on the relevant invariant set;
2. a cross-mode comparison bound (W_r(x)\le\mu W_q(x)) at every permitted switch;
3. a lower bound on dwell time sufficient to offset the worst-case comparison factor;
4. explicit treatment of modes with zero task weights, where strict strong-convexity
   and uniform exponential-decay assumptions may fail;
5. floor-boundary invariance and switch-time continuity of the physical state.

Those constants have not been established for the present projected model. Do not
claim a dwell-time theorem yet. Because the task potential may be flat in directions
when weights are zero, proving a uniform exponential decay rate for one-hot modes
is especially nontrivial.

## 5. What can be said rigorously now

- **Established algebraically:** the moving-weight derivative includes
  (-\dot w\cdot\log x).
- **Established by the floor bound:** its magnitude is at most
  (\|\dot w\|_1\log(1/\tau)).
- **Established for the fixed-task projected model:** the active task potential is
  non-increasing between switches under the stated projected-gradient flow.
- **Not established:** arbitrary switching stability, a common Lyapunov function,
  a multiple-Lyapunov dwell-time bound, convergence to a moving target, or a
  theorem that the three task-conditioned regions are attractor basins.
- **Software evidence only:** deterministic finite-step tests validate that the
  reference simulator preserves the floor/simplex and records objective jumps.
  They do not prove stability of the continuous-time or production system.

## 6. Experiment protocol

The new research-only helper
`simulatePiecewiseConstantTaskSwitching()` runs deterministic fixed-task descent
segments and records each switch's pre/post potential. The tests verify that
within-mode accepted steps are non-increasing while allowing a switch jump to be
positive. This is intentionally not an automatic task scheduler.

The next offline experiment should preregister:

- task modes: C-, R-, and S-dominant plus at least two mixed profiles;
- schedules: single switch, C→R→S→C cycle, reverse cycle, and randomized-but-seeded schedules;
- dwell durations: long enough for near-convergence, intermediate, and shorter than
  the observed settling time;
- initial states: centroid, each basin profile, floor-adjacent states, and interior
  mixed states;
- step sizes/gains: fixed across compared schedules or varied in a declared grid;
- metrics: state tracking error, potential descent within modes, switch jumps,
  accumulated positive jump budget, floor contacts, and total variation;
- falsification criteria: persistent non-decaying oscillation, floor violation,
  or failure to track under a schedule claimed to be inside a derived sufficient
  condition.

Continuous-drift experiments should use smooth simplex-valued (w(t)), report
(|\dot w\|_1), and test the pointwise descent inequality rather than infer
stability from visual trajectory smoothness.

## 7. Decision for the Aureonics paper

Until a common certificate or a valid multiple-Lyapunov/dwell-time theorem is
derived and checked, describe the three regions as **task-conditioned operating
basins/modes under fixed task weights**, and state explicitly that switching
stability is open. If the term *basin of attraction* is retained, qualify it as a
hypothesis pending a specified switched vector field and convergence proof.

No production code, task router, PRAXIS policy, kernel, approval, quarantine,
recovery threshold, or runtime state is changed by this work.
