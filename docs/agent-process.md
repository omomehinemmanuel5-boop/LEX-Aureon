# Agent Process and Pull Request Rules

## Branch and ownership model

- Each agent works on its own branch and opens its own pull request. Do not share a working branch between agents.
- Use the repository's branch naming convention: `govern/` for governance work, `fix/` for fixes, and `docs/` for documentation.
- No agent commits directly to `main`; every change is proposed through a PR.
- Each agent uses its own GitHub access and identity. Do not share another agent's credentials, governance session, recovery observations, approval request, or canary evidence. Canary evidence is session- and snapshot-bound (`lib/agents/recovery_canary_evidence.ts`); approval requests are owner-, session-, tool-, and argument-bound (`lib/approval_requests.ts`).
- The repository owner performs reviews and merges. Agents may prepare PRs and report evidence but do not merge.

## Important current implementation constraint

The branch validator in `lib/lex_crs_agent/tools/github_branch_validation.ts` currently accepts only `govern/` and `fix/` as target-branch prefixes. It rejects `docs/` in Lex's governed `create_branch` and `write_file` paths. Therefore `docs/` is the documentation naming convention, but an agent using those specific Lex tools cannot currently create that prefix; use its own GitHub access to create a docs branch, or propose a separately reviewed validator change. Do not work around the restriction by writing to `main`, and do not change governance logic as part of a documentation-only PR.

## Required PR description

Every PR description must state:

1. **Finding** — what is wrong or missing.
2. **Evidence** — exact file paths, constants, logs, or failing checks.
3. **Change** — the smallest scoped change proposed.
4. **Test** — commands run and their actual results; identify checks still pending in CI.
5. **Risk** — behavior or surface area that could be affected.
6. **Rollback** — how to revert the PR or safely disable the change without weakening a control.

For documentation-only changes, say so explicitly and distinguish factual claims from proposals. Cite the repository file and constant or function for operational facts. Never report a test as passing unless it actually ran and its result was observed.

## Recovery and approvals are not shared

- A canary proves the exact canonical snapshot for its bound session; it is not a reusable authorization for another agent or a later changed snapshot.
- A per-action approval is single-use and bound to the authenticated owner, session, tool, and canonical arguments. The 15-minute request lifetime is defined by `REQUEST_TTL_MS` in `lib/approval_requests.ts`.
- A stable session ID may reduce daily session churn for a stateless client, but the owner must configure it per agent. Never copy another agent's session or canary.
- Lex's governance decision, GitHub branch protection/review, and live runtime recovery gate are separate checks. Passing one does not satisfy the others.
