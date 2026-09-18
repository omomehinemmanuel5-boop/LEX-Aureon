# Production discrete-transition stability boundary

## Current result

The deployed CRS transition has a deterministic replay boundary and enforces the committed-state invariant

\[
C + R + S = 1, \qquad C,R,S \geq \tau.
\]

The production receipt records the pre-projection state, committed state, projection metadata, adaptive theta, and the measured change in the deployed \(V_z\) certificate.

These records establish **finite-horizon engineering evidence**. They do not establish that the complete discrete production transition satisfies \(\Delta V_z \leq 0\) for every permitted input.

## Conditional theorem target

The next formal target is a conditional bounded-input result. Let \(F\) denote the ordered deployed transition, including measured deltas, law impact, adversarial gain, governor correction, semantic pressure, recentering, suspension, epsilon injection, threat pressure, and floor projection. Under explicit bounds on each input and with \(0 < \tau < 1/3\), derive a bound of the form

\[
V_z(F(x,u)) - V_z(x) \leq B(\|u\|,\tau,\theta,z).
\]

There are three acceptable outcomes:

1. prove \(B \leq 0\) under a stated operating envelope;
2. prove conditional descent after restricting the envelope; or
3. prove only a finite bounded-increase result and report descent as empirical evidence.

The implementation must not label outcome 2 or 3 as a global Lyapunov proof.

## Conditional result currently implemented

For two committed states on the floor-constrained simplex, the quadratic penalty is inactive and the log-barrier gradient satisfies

\[
\|\nabla V_z(x)\|_2 \leq \frac{\|z\|_2}{\tau}.
\]

Because the floor-constrained simplex is convex, the mean-value theorem gives the engineering bound

\[
|V_z(x')-V_z(x)| \leq \frac{\|z\|_2}{\tau}\,\|x'-x\|_2.
\]

The transition certificate computes and tests this bound for each committed transition. It bounds the magnitude of certificate movement; it does **not** determine the sign of the movement and therefore does not prove descent.

The deployed transition now applies a final convex-segment descent guard using the active session weights. If the candidate would increase \(V_z\), the guard retracts it toward the previous committed state by bisection until the measured change is non-positive within tolerance. This establishes a **conditional post-guard non-increase property** for valid floor-constrained input states and positive finite weights. It does not yet constitute a proof for malformed inputs, unsupported weight updates, or every future transition version.

## Evidence classification

| Property | Current status |
|---|---|
| Finite committed state | Machine-tested and receipt-verified |
| Simplex conservation | Machine-tested and receipt-verified |
| Hard floor | Enforced by projection and machine-tested |
| Deterministic replay | Receipt-verified |
| CBF control feasibility | Stress-tested for bounded cases |
| Per-turn Lyapunov change | Measured and persisted |
| Conditional certificate-change bound | Computed from floor and displacement assumptions |
| Post-guard non-increase on valid inputs | Enforced and regression-tested |
| Global discrete \(\Delta V_z \leq 0\) | Open |
| Continuous-flow descent argument | Applies only to the idealized flow |
