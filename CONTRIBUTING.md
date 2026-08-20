# Contributing to Lex Aureon

Lex Aureon combines a production governance service with an evolving research program. Changes should preserve both operational safety and research honesty.

## Before opening a pull request

1. Run npm run typecheck.
2. Run npm run lint.
3. Run npm test.
4. For governance changes, run focused governor and benchmark tests.
5. Describe whether the change affects a deployed claim, a numerical result, or an analytical claim.

## Safety rules

- Preserve the simplex invariant C + R + S = 1.
- Do not weaken authentication, rate limits, receipt immutability, or input bounds without a security rationale.
- Never commit secrets, generated private keys, provider credentials, or database exports.
- Do not describe numerical validation as an analytical proof.
- Include regression fixtures for changes to refusal, sovereignty, tool-governance, or receipt behavior.

## Pull request checklist

- [ ] Typecheck, lint, and tests pass.
- [ ] Public API changes are documented.
- [ ] Security-sensitive changes include a threat or abuse case.
- [ ] Benchmark results identify dataset, model, and commit.
- [ ] No secrets or private artifacts are included.
