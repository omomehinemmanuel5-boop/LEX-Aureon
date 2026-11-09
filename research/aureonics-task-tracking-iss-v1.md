# Composite Tracking Storage for Aureonics Task Variation — Research Note v1

**Status:** Conditional mathematical result plus offline reference implementation  
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
implemented in the fixed-task reference module. The value function (F) is
differentiable by the envelope theorem wherever the minimizer is unique; for
strictly positive weights it is unique. Its gradient is
\(\nabla_wF(w)=-\log x^*(w)\).

This storage measures distance in objective value from the optimum selected by
the current task, rather than distance from one fixed global target.

## 2. Continuous task drift: conditional ISS result

Assume:

1. (x(t)\in\mathcal X_\tau=\{x:\sum_i x_i=1,\ x_i\ge\tau\});
2. (w(t)\in\Delta_2) is absolutely continuous and
   (w_i(t)\ge\underline w>0) for all coordinates;
3. the reference dynamics are the Euclidean projected-gradient flow
   \(\dot x=\eta P_{K_\tau(x)}(-\nabla_xV(x,w))\), with \(\eta>0\);
4. (w(t)) is not changed by a discontinuous jump in this continuous-time
   statement.

Let \(\mu=\min_iw_i\). The Hessian is
\[
\nabla_x^2V=\operatorname{diag}(w_i/x_i^2)\succeq\mu I,
\]
because (x_i\le1). Thus (V(\cdot,w)) is (mu)-strongly convex on the
feasible simplex. For the projected gradient (p=P_{K_\tau(x)}(-\nabla V)),
the constrained strong-convexity inequality gives
\[
\|p\|^2\ge2\mu W.
\]

By the envelope theorem, almost everywhere,
\[
\dot W
=-\eta\|p\|^2
-\dot w\cdot\log(x/x^*(w)).
\]
Since every coordinate of (x,x^*\) is at least (	au), logarithm is
(1/\tau)-Lipschitz on this interval. Strong convexity also gives
\(\|x-x^*\|\le\sqrt{2W/\mu}\). Therefore
\[
\boxed{
\dot W\le-2\eta\mu W+
\frac{\|\dot w\|_2}{\tau}\sqrt{\frac{2W}{\mu}}.
}
\]

Writing (y=\sqrt W), the comparison inequality is
\[
\dot y\le-\eta\mu y+
\frac{\|\dot w\|_2}{\tau\sqrt{2\mu}}.
\]
If (\mu\ge\underline w>0) and
\(\|\dot w(t)\|_2\le\delta\), then
\[
y(t)\le e^{-\eta\underline w t}y(0)+
\frac{\delta}{\eta\underline w\,\tau\sqrt{2\underline w}}
(1-e^{-\eta\underline w t}).
\]
Consequently, the tracking error is input-to-state bounded. The bound becomes
small as the task-weight drift rate (\delta\) becomes small, but it does not
claim exact convergence to a moving target under nonzero persistent drift.

### Scope restriction

This theorem **does not cover one-hot task weights**. If any (w_i=0), then
\(\mu=0\), the uniform strong-convexity estimate degenerates, and this ISS
certificate says nothing. We must not silently add a positive weight floor to
the Aureonics task definition just to make the theorem apply. Boundary-weight
modes need a separate sharp-error-bound or nonsmooth analysis.

## 3. Discontinuous task switches: additive jump bound

For a switch (w^-\to w^+), the physical state (x) is continuous but the
tracking storage changes. Let \(\Delta w=w^+-w^-\), so
\(\sum_i\Delta w_i=0\). Since \(\log x_i\in[\log\tau,0]\),
\[
|V(x,w^+)-V(x,w^-)|
\le\frac12\log(1/\tau)\|\Delta w\|_1.
\]
The minimized value (F(w)=\min_xV(x,w)) has the same Lipschitz bound, as
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

## 4. Interpretation

The composite storage improves on the raw active potential in two ways:

- It subtracts the current task's optimum value, so zero means the state is at
  the current task optimum.
- It yields an explicit conditional input-to-state tracking inequality for
  continuously drifting, strictly positive task weights.

It does **not** establish arbitrary switching stability. The continuous ISS
result excludes one-hot weights; the jump estimate allows finite task variation
but does not offset arbitrarily many switches with unbounded total variation.
The existing common-strict-Lyapunov obstruction remains.

## 5. Software evidence and next theorem

The research-only module implements:
- (W(x,w)), the constrained task-tracking objective gap;
- the continuous-drift upper-bound certificate under its strict-positive-weight
  assumptions;
- the additive switch-jump bound.

Tests check nonnegativity, zero at the optimizer, the projected-gradient
inequality, rejection of boundary weights and invalid simplex derivatives, and
a numerical switch-jump bound. These are implementation checks; they are not
independent proof of the theorem.

Next mathematical step: characterize one-hot modes using a sharp or
stratified error bound, then determine whether the continuous ISS estimate can
be extended to task weights approaching the simplex boundary. Do not integrate
this storage into production governance until that analysis and independent
review are complete.
