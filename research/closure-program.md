# Aureonics Closure Program

## Purpose

This program defines what it means to close every remaining item without converting an untested prediction into a false success claim. A mathematical or deployment item is closed only when its scope, implementation, test evidence, and public wording agree. A falsifiable prediction is closed only after a pre-specified test produces a recorded result, including a null or inconclusive result.

## Current conclusion

The required deployment guarantees are already closed as scoped. The remaining work falls into three different categories: empirical predictions that need measurements, agent-action evidence that needs broader evaluation, and optional extensions that are not part of the current deployment contract.

The unrestricted arbitrary-drift theorem is not a missing deployment proof. It is intentionally excluded because the general transition input contract does not provide the drift envelope required to prove it.

## Closure ledger

| Area | Current status | Closure condition | Next action |
|---|---|---|---|
| Guarded discrete Lyapunov invariant | Closed | Keep implementation, receipt replay, and theorem scope aligned | Regression protection |
| Scoped continuous-time drift theorem | Closed as scoped | Preserve the explicit drift envelope and test | Regression protection |
| Nonlinear Pareto frontier | Closed | Preserve derivation and citation boundary | Documentation audit |
| Dynamic z-update rule | Closed | Preserve contraction test and receipt stamping | Documentation audit |
| FPL-1 simulator | Closed numerically | Keep finite-horizon and numerical labels visible | Research-page audit |
| P1–P9 paper predictions | Untested or not fully reported | Run the pre-specified experiment, or formally retire the prediction with a reason | Build an experiment manifest |
| P10 per-session adversarial collapse | Proposed | Compare repeated within-session attacks with independent sessions under a fixed protocol | Implement benchmark |
| P11 slow-drip detection speed | Proposed | Compare time-to-detection at the two specified accumulation thresholds | Implement benchmark |
| P12 taxonomy partition completeness | Proposed | Measure production or evaluation traffic and report residual classes | Implement instrumentation and benchmark |
| Agent tool-governance corpus | Evidence-limited | Expand beyond four hand-built tasks and report paired utility/security results | Add independent task families |
| Governance Passport and policy provenance | Planned product work | Implement, test, and document the runtime contract, or explicitly remove from the deployment promise | Product decision |
| Unrestricted arbitrary-drift theorem | Not claimed by design | Requires a new input contract with an explicit drift envelope | Do not label as a current gap |

## Work sequence

### Phase 1: Make the evidence contract executable

Create one evaluation manifest for each prediction and agent-action experiment. Each manifest must define the hypothesis, population, treatment and control arms, sample size, metrics, exclusion rules, randomization or seed, and stopping rule before the run begins. Raw events, scored output, failures, and exclusions must be retained with the result.

### Phase 2: Close P10–P12

Implement the three proposed v3 experiments as deterministic benchmark commands. They should run against synthetic fixtures first and against state-backed evaluation traffic second. The benchmark output must distinguish a supported prediction, a falsified prediction, and an inconclusive run. A falsified prediction is a valid scientific closure; it must not be rewritten as a success.

### Phase 3: Expand agent-action evidence

The current four-task harness establishes a narrow result: all four security breaches were blocked, while utility was preserved on one task. It does not establish general agent safety. The next evaluation should add independent workspace, banking, and devops tasks with multiple injection styles, benign controls, and paired bare/governed traces. The report must include confidence intervals where the sample permits and must retain utility loss as a first-class metric.

### Phase 4: Decide optional extensions

The Governance Passport and policy-provenance features are product decisions, not mathematical proof obligations. They should either be implemented with an explicit runtime contract and tests or removed from public near-term promises. A design document alone cannot close a deployment item.

### Phase 5: Final consistency audit

After each run, synchronize the open-problem ledger, research page, landing page, benchmark dashboard, README, and paper update notes. Search for stale status phrases such as “open,” “proven,” “certified,” and “production” and review each occurrence against the evidence record.

## Definition of done

The project may describe the closure program as complete only when every item has one of these explicit statuses:

1. **Proven:** an analytical result with stated assumptions and a regression test.
2. **Implemented and verified:** a runtime behavior covered by integration tests and an evidence artifact.
3. **Measured:** a falsifiable prediction with a reproducible result, including a null result where applicable.
4. **Retired or out of scope:** a documented decision that removes the item from the deployment contract.

“Open” must remain reserved for work that has no result and no retirement decision. “Closed as scoped” must continue to identify claims that are valid only under an explicit assumption.

## References

[1]: research/open-problems.md "Aureonics open mathematical problems ledger"
[2]: research/empirical-results.md "Aureonics empirical results and evaluation history"
[3]: docs/agent-task-evaluation-plan.md "Agent task evaluation plan"
[4]: docs/action-governance-spec.md "Action governance design specification"
[5]: research/drift-envelope.md "Scoped drift-envelope theorem"
