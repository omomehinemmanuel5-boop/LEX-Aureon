# Scoped Drift-Envelope Theorem

## Status

**Closed as a sufficient conditional result.** This note does not close the unrestricted drift claim. It supplies the missing input contract needed for a valid continuous-time comparison.

## Definitions

Let `x` be a valid floor-constrained simplex state, `z` a positive finite session-weight vector, and

```text
V_z(x) = -Σ z_i log(x_i) + (μ/2)Σ max(0, τ-x_i)^2.
```

Let `g = ∇V_z(x)` and let `Πg = g - mean(g)` be its tangent-space projection. The deployed z-aware governor is

```text
G_z(x) = -K Πg,
```

with `K = 4.0`. Let `F` be an external drift vector satisfying the simplex tangent condition `ΣF_i = 0`.

## Theorem

If the drift contract declares the state-dependent envelope

```text
||F||₂ ≤ K ||Π∇V_z(x)||₂,
```

then the continuous-time directional derivative is non-positive:

```text
⟨∇V_z, G_z + F⟩ ≤ 0.
```

## Proof

Because `F` is tangent to the simplex, `⟨g,F⟩ = ⟨Πg,F⟩`. Therefore,

```text
⟨g, G_z + F⟩
  = -K ||Πg||₂² + ⟨Πg,F⟩
  ≤ -K ||Πg||₂² + ||Πg||₂ ||F||₂
  ≤ 0
```

by Cauchy–Schwarz and the declared envelope.

## Boundary and scope

At the symmetric state with uniform weights, `Π∇V_z = 0`. The envelope consequently requires `F = 0` there. This is not a defect in the derivation; it makes explicit why an unrestricted nonzero tangent drift cannot be dominated globally by the governor at every state.

The theorem is therefore a **conditional continuous-time result**, not a replacement for the deployed guarded discrete invariant. The production transition remains the authoritative safety mechanism for arbitrary finite inputs: it applies its post-guard and commits only a floor-constrained state with non-increasing `V_z`.

## Engineering implication

To use this theorem as a production claim, the transition input contract must either:

1. enforce the state-dependent bound above before integration, or
2. declare a smaller fixed envelope `B` and restrict operation to states where `K||Π∇V_z||₂ ≥ B`.

Without one of those contracts, the valid claim remains the guarded discrete invariant, not unrestricted continuous-time descent.

The accompanying regression test in `__tests__/drift-envelope.test.ts` checks the theorem over a deterministic grid of floor-simplex states, positive session weights, and tangent drifts at the envelope boundary.
