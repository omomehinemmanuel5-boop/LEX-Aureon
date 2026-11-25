# Tenant and approver onboarding

## Public approval flow

1. The agent creates a pending approval request under its authenticated API-key owner and tenant.
2. Lex generates a cryptographically random 128-bit request ID and sends a private approval URL.
3. Open the URL directly. No Lex account sign-in, email, or password is required to review or decide that one request.
4. Review the exact tool and arguments, then approve or deny.
5. The link expires after 15 minutes and the decision is single-use. Anyone possessing the link can decide that one request, so treat it as a secret.

## Security boundaries

- The public approval page shows only the request addressed by the private URL; it does not list a tenant's approval history or other requests.
- The stored request must have a non-null tenant binding.
- Decision writes are conditional on the request remaining pending and unexpired.
- Approval records consent only. The agent must retry the unchanged action and Lex rechecks owner, tenant, session, tool, argument hash, one-time consumption, and current governance before execution.
- Account sign-in remains required for account/key administration, not for approval review or decision.
- Never share approval URLs or include them in public logs, tickets, analytics, or screenshots.
