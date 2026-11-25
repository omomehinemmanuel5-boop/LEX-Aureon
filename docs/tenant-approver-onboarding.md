# Tenant and approver onboarding

## Current supported account flow

1. Open the Lex Aureon API Keys page at `/keys` and choose **Sign in or register**.
2. Register with an email address, company/workspace name, and password of at least 10 characters. Lex creates a personal account tenant and an active owner membership.
3. Verify the email using the single-use link sent to that address. Registration cannot be used for approvals until verification is complete.
4. Sign in to the verified account. From `/keys`, create an API key and store the returned secret securely; it is shown only once.
5. Open `/approvals` and sign in with the same verified account. The approval inbox and decision endpoint derive the tenant from the signed account session, not from a browser-supplied tenant ID or the API key's email field.
6. Review the exact action and arguments. Approve or deny from the authenticated inbox. A successful approval records consent only; the agent must retry the exact action and Lex re-evaluates governance before execution.

## Tenant binding: important current limitation

The account dashboard's key-creation endpoint passes the account's tenant ID into key provisioning. Therefore keys created by one account currently join that account's tenant; naming a key after an app does not create a separate tenant for that app.

Keys provisioned without an account tenant may instead receive a `tn_personal_<key-id>` tenant. A verified account currently receives a `tn_user_<account-id>` tenant, and the account session validator requires an active `user:<account-id>` owner membership in that tenant. These identifiers are not interchangeable. An account created through the normal registration flow is not automatically authorized to approve requests created by a separate `tn_personal_*` key.

For a genuinely isolated tenant per external app, use an explicitly provisioned tenant and membership mapping. The self-serve dashboard does not yet provide a secure tenant-claim or invitation flow for attaching an existing personal API-key tenant to a human approver account. Do not solve this by removing the tenant predicate, changing an approval row's tenant, or trusting an email match. Until that provisioning flow exists, keep each app's credentials isolated and do not assume its key can use an unrelated account's approval inbox.

## Operational checks

- Confirm the API key's persisted `tenant_id` and the approver account's persisted `tenant_id` are identical.
- Confirm the tenant has an active `tenant_members` row for `user:<account-id>` with the required owner role.
- Confirm the account email is verified and the browser has a valid signed `lex_account_session` cookie.
- If the tenant IDs differ, stop. A 409 decision response means no approval was recorded; do not retry by bypassing authentication.
- Never share approval links as credentials. They only direct the approver to the authenticated inbox.
