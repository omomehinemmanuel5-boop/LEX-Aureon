/**
 * Stable personal-tenant identity for API credentials.
 *
 * The API-key ID is deliberately the only input: email equality is not
 * evidence that two credentials belong to the same person or organization.
 */
export function personalTenantIdForApiKey(apiKeyId: string): string {
  if (!apiKeyId.trim()) throw new Error('apiKeyId is required to derive a personal tenant ID.');
  return `tn_personal_${apiKeyId}`;
}
