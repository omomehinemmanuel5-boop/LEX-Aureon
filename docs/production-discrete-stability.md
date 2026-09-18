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

## Evidence classification

| Property | Current status |
|---|---|
| Finite committed state | Machine-tested and receipt-verified |
| Simplex conservation | Machine-tested and receipt-verified |
| Hard floor | Enforced by projection and machine-tested |
| Deterministic replay | Receipt-verified |
| CBF control feasibility | Stress-tested for bounded cases |
| Per-turn Lyapunov change | Measured and persisted |
| Global discrete \(\Delta V_z \leq 0\) | Open |
| Continuous-flow descent argument | Applies only to the idealized flow |
