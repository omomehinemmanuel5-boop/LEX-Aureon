# Reserve-Aware Adaptive Basin Policy v1

**Status:** Research-only deterministic reference and shadow-policy candidate.

This document implements the policy decision that **task evidence selects the desired basin**, while **`z_traj` derives reserve requirements and protective risk**. The constitutional hard floor remains an independent final invariant.

## Policy objects

The measured reserve is:

```text
reserve_min = M(x) - τ_floor
```

The protected operating reserve is:

```text
τ_reserve = τ_floor + ε_reserve
```

where `ε_reserve` is bounded and derived from trajectory risk.

The current reference risk score uses:

- `attack_pressure`;
- normalized `sigma_viol`;
- normalized velocity;
- persistent away-drift;
- recovery-band membership;
- a stability credit from `n_stable`.

The score is deterministic and configurable. It is a policy candidate, not a claim that the published paper already specified these coefficients.

## Basin selection

A task posterior selects the basin:

```text
analytical      → C
collaborative   → R
exploratory     → S
```

If the posterior is below the confidence threshold or tied, the reference policy falls back to the neutral weights `(1/3,1/3,1/3)`.

`z_traj` does not silently become a task classifier. It changes reserve and protective requirements, not the meaning of the current task.

## Reserve-aware target

Given task weights and the derived reserve floor, the target is the KKT water-filling solution:

```text
x*_i = max(τ_reserve, w_i / λ)
```

For a one-hot task this becomes:

```text
(1 − 2τ_reserve, τ_reserve, τ_reserve)
```

or the corresponding permutation.

## Safety and scope

The reference plan produces a bounded simplex-tangent direction and projects the proposed state onto the reserve-aware simplex. It never lowers the floor below the constitutional hard floor.

The module is not imported by the production kernel, PRAXIS, recovery plane, approval/quarantine paths, or routes. The implementation is intended for offline evaluation and shadow mode first.

## Remaining work before runtime adoption

1. Compare the policy against the live controller on replayed trajectories.
2. Calibrate reserve coefficients and hysteresis from evidence.
3. Add task-posterior provenance and versioning.
4. Select and prove a corrected mass-conserving basin stiffness law.
5. Add complete receipts for task posterior, reserve policy, proposed direction, projection, and final state.
6. Evaluate task accuracy, reserve breaches, recovery time, and safety outcomes together.
