# Composite Tracking Storage for Aureonics Task Variation — Research Note v1

**Status:** Conditional mathematical results plus offline reference implementation  
**Branch:** `research/aureonics-task-switching-stability`  
**Production integration:** None

## 1. Candidate storage

For feasible constitutional state (x\in\mathcal X_\tau) and task weights
(w\in\Delta_2), define

\[
V(x,w)=-\sum_i w_i\log x_i,\qquad
F(w)=\min_{y\in\mathcal X_\tau}V(y,w),
\]
\[
\boxed{W(x,w)=V(x,w)-F(w)\ge0.}
\]

The constrained minimizer (x^*(w)) is the water-filling solution already
implemented in the fixed-task reference module. Whenever at least two task
weights are positive, the objective is strictly convex on the simplex tangent
plane and the constrained minimizer is unique. The value function has the
envelope derivative (\nabla_wF(w)=-\log x^*(w)) wherever differentiated
along a feasible task-weight path.

This storage measures objective gap from the optimum selected by the current
task, rather than distance from one fixed global target.

## 2. Continuous task drift with at least two active task weights

Assume:

1. (x(t)\in\mathcal X_\tau=\{x:\sum_i x_i=1,\ x_i\ge\tau\});
2. (w(t)\in\Delta_2) is absolutely continuous and has at least two positive
   coordinates on a fixed face of the task simplex;
3. every positive task weight is bounded below by
   (m_0>0) along the trajectory;
4. the reference dynamics are the Euclidean projected-gradient flow
   \(\dot x=\eta P_{K_\tau(x)}(-\nabla_xV(x,w))\), with \(\eta>0\);
5. (w(t)) has no discontinuous jumps in this continuous-time statement.

Let (m=\min_{i:w_i>0}w_i). For any tangent vector (d) with
\(\sum_i d_i=0\), the Hessian satisfies
\[
d^T\nabla_x^2Vd
=\sum_{i:w_i>0}\frac{w_i}{x_i^2}d_i^2
\ge m\sum_{i:w_i>0}d_i^2
\ge\frac{m}{3}\|d\|_2^2.
\]
The final inequality follows directly when all three weights are positive;
when exactly two are positive, the zero-weight coordinate is the negative
sum of the other two tangent coordinates, so
\(\|d\|_2^2\le3\sum_{i:w_i>0}d_i^2\).

Set \(\mu=m/3\). The task potential is therefore \(\mu\)-strongly convex
on the simplex tangent plane. For
\(p=P_{K_\tau(x)}(-\nabla_xV)\), the constrained projected-gradient
inequality gives
\[
\|p\|_2^2\ge2\mu W.
\]

By the envelope theorem, almost everywhere,
\[
\dot W
=-\eta\|p\|_2^2
-\dot w\cdot\log(x/x^*(w)).
\]
Since every coordinate of (x,x^*\) is at least \(\tau\), logarithm is
\(1/\tau\)-Lipschitz on this interval. Strong convexity also gives
\(\|x-x^*\|_2\le\sqrt{2W/\mu}\). Therefore
\[
\boxed{
\dot W\le-2\eta\mu W+
\frac{\|\dot w\|_2}{\tau}\sqrt{\frac{2W}{\mu}}.
}
\]

Writing \(y=\sqrt W\), the comparison inequality is
\[
\dot y\le-\eta\mu y+
\frac{\|\dot w\|_2}{\tau\sqrt{2\mu}}.
\]
If \(m(t)\ge m_0>0\) and \(\|\dot w(t)\|_2\le\delta\), then
\[
y(t)\le e^{-\eta m_0t/3}y(0)+
\frac{3\delta}{\eta m_0\tau\sqrt{2m_0/3}}
(1-e^{-\eta m_0t/3}).
\]
Consequently, the tracking error is input-to-state bounded. The bound improves
as task drift slows, but it does not claim exact convergence to a moving target
under nonzero persistent drift.

### Scope restriction

This result applies on a fixed task-simplex face with at least two active
weights bounded away from zero. If a positive weight approaches zero, the
uniform modulus (\mu\) degenerates; the theorem cannot be continued across
that limit with the same constants. A one-hot task vector has only one positive
weight and requires a different argument.

## 3. One-hot task modes: a separate fixed-mode result

For a one-hot task vector (w=e_j), the constrained optimizer is the simplex
vertex
\[
x_j^*=1-2\tau,\qquad x_i^*=\tau\quad(i\ne j).
\]
The tracking storage is
\[
W(x,e_j)=\log\frac{1-2\tau}{x_j},\qquad
0\le W\le W_{\max}:=\log\frac{1-2\tau}{\tau}.
\]

Let (s=x_j^*-x_j=(x_k-\tau)+(x_l-\tau)\). Then
\[
\|x-x^*\|_2^2
=s^2+(x_k-\tau)^2+(x_l-\tau)^2\le2s^2.
\]
Also \(-\log(1-s/x_j^*)\ge s/x_j^*\), so
\[
\boxed{\|x-x^*\|_2\le\sqrt2(1-2\tau)W.}
\]

For any non-optimal state, at least one non-dominant coordinate is above the
floor. The Euclidean projection of \(-\nabla V\) onto the floor-simplex
tangent cone then has squared norm at least \(1/(2x_j^2)\ge1/2\). Since
\(W\le W_{\max}\),
\[
\boxed{
\|P_{K_\tau(x)}(-\nabla V)\|_2^2
\ge\frac{W}{2W_{\max}}.
}
\]
Thus, for the fixed one-hot projected flow,
\[
\dot W\le-\frac{\eta}{2W_{\max}}W.
\]
This establishes exponential decay of the task-relative objective gap for each
fixed one-hot mode in the specified reference dynamics. It does **not** establish
stability while switching between the one-hot modes or while task weights drift
away from a vertex.

## 4. Discontinuous task switches: additive jump bound

For a switch (w^-\to w^+), the physical state (x) is continuous but the
tracking storage changes. Let \(\Delta w=w^+-w^-\), so
\(\sum_i\Delta w_i=0\). Since \(\log x_i\in[\log\tau,0]\),
\[
|V(x,w^+)-V(x,w^-)|
\le\frac12\log(1/\tau)\|\Delta w\|_1.
\]
The minimized value (F(w)=\min_xV(x,w)\) has the same Lipschitz bound, as
it is the pointwise minimum of functions with that common Lipschitz constant.
Therefore
\[
\boxed{
|W(x,w^+)-W(x,w^-)|
\le\log(1/\tau)\|\Delta w\|_1.
}
\]
For a finite sequence of switches, the cumulative absolute storage jump is
bounded by \(\log(1/\tau)\) times the total variation of the task weights.
This is an additive jump budget, not an asymptotic stability theorem. If total
variation grows without bound, this estimate alone gives no uniform long-run
bound.

## 5. Hybrid switching with finite total task variation

The fixed-mode estimates can be combined with the additive switch-jump bound.
Restrict the admissible piecewise-constant task modes to:

- one-hot vertices (e_1,e_2,e_3); or
- modes with at least two positive coordinates, each at least (m_0>0).

For every fixed mode, the tracking storage satisfies
\[
\dot W\le-\lambda W,\qquad
\lambda=\min\left\{
\frac{\eta}{2\log((1-2\tau)/\tau)},
\frac{2\eta m_0}{3}
\right\}.
\]
The first term is the one-hot fixed-mode rate; the second is the rate on
multi-support modes. If a switch occurs at time (t_k), then
\[
W(t_k^+)\le W(t_k^-)+J_k,\qquad
J_k=\log(1/\tau)\|w_k^+-w_k^-\|_1.
\]
Consequently, for any finite horizon (t\),
\[
\boxed{
W(t)\le e^{-\lambda t}W(0)+
\sum_{t_k\le t}e^{-\lambda(t-t_k)}J_k.
}
\]

For an infinite, non-Zeno switching schedule with finite total task-weight
variation
\(\sum_k\|w_k^+-w_k^-\|_1<\infty\), the jump sequence is summable. The
comparison bound then implies \(W(t)\to0\). The same mode restrictions give
a uniform state-error bound: for multi-support modes,
\(\|x-x^*(w)\|_2\le\sqrt{6W/m_0}\); for one-hot modes,
\(\|x-x^*(w)\|_2\le\sqrt2(1-2\tau)W\). Thus the state tracks the
instantaneous constrained optimum with error tending to zero. Finite total
variation also makes (w(t)) converge, and the unique constrained minimizer
map (x^*(w)) is continuous, so the state converges to the constrained
optimum of the limiting task weights.

This is a genuine **finite-variation hybrid tracking result**, but its
conditions are restrictive and explicit. It does not cover endless C→R→S
cycling with fixed-amplitude jumps, because that schedule has infinite total
variation. It also does not cover task modes with two or more positive weights
approaching zero without a uniform lower bound (m_0). Such schedules remain
open; the theorem must not be advertised as arbitrary-switching stability.

The research-only helper
`finiteVariationHybridTrackingBound()` evaluates the finite-horizon
comparison bound for a supplied switch schedule. It assumes the caller has
verified that every intervening mode belongs to the admissible set above.

## 6. Interpretation and proof boundary

The composite storage improves on the raw active potential in three ways:

- It subtracts the current task's optimum value, so zero means the state is at
  the current task optimum.
- It gives a conditional input-to-state tracking inequality on any fixed face
  with at least two active task weights bounded away from zero.
- It separately gives a fixed-mode exponential objective-gap bound for each
  one-hot task mode, using the floor-constrained geometry rather than false
  full-space strong convexity.

It does **not** establish arbitrary switching stability. The continuous ISS
result does not cross task-simplex faces with vanishing active weights; the
one-hot result is fixed-mode only; and the additive jump estimate does not
offset infinitely many switches with unbounded total variation. No common
strict Lyapunov function for convergence to all distinct mode-specific
equilibria has been asserted.

## 7. Software evidence

The research-only module implements:
- (W(x,w)), the constrained task-tracking objective gap;
- a continuous-drift ISS certificate for task-weight support size at least two;
- a one-hot fixed-mode sharp-error/decay certificate;
- an additive switch-jump bound;
- a finite-horizon hybrid comparison bound for finite-variation switching.

Tests check nonnegativity, zero at the optimizer, the projected-gradient
inequalities, the two-positive-coordinate edge case, one-hot sharp bounds,
rejection of unsupported one-hot continuous drift and invalid simplex
derivatives, and the numerical switch-jump bound. These are implementation
checks; they are not independent proof of the theorem.

Next mathematical step: relax the finite-variation and fixed-support restrictions,
then determine whether the actual Aureonics task router enforces a schedule
inside the proved admissible class. Do not integrate this storage into
production governance until that analysis and independent review are complete.
