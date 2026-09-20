/**
 * Public pricing and entitlement constants.
 *
 * Keep these values aligned with the enforcement paths:
 * - FREE_API_RUN_LIMIT is enforced by lib/api_keys.ts.
 * - ANONYMOUS_GOVERN_REQUESTS_PER_MINUTE is enforced by
 *   app/api/lex/govern/route.ts for unauthenticated console/API calls.
 */

export const FREE_API_RUN_LIMIT = 1_000;
export const ANONYMOUS_GOVERN_REQUESTS_PER_MINUTE = 20;
export const SOVEREIGN_PRICE_USD = 29;

export const FREE_TOOL_GOVERNANCE_FEATURES = [
  'Prompt-injection and adversarial instruction detection',
  'Constitutional approval or denial before tool execution',
  'CRS measurement and health-band decision context',
  'SHA-256 governance receipt for every governed turn',
] as const;

export const FREE_PLAN_LABEL = 'Explorer';
export const FREE_API_PLAN_LABEL = 'Free API key';
