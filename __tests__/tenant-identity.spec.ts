import { describe, expect, it } from 'vitest';
import { personalTenantIdForApiKey } from '../lib/tenants/identity';

describe('personal tenant identity', () => {
  it('derives a distinct tenant from each API-key ID', () => {
    expect(personalTenantIdForApiKey('credential-a')).toBe('tn_personal_credential-a');
    expect(personalTenantIdForApiKey('credential-b')).toBe('tn_personal_credential-b');
    expect(personalTenantIdForApiKey('credential-a')).not.toBe(personalTenantIdForApiKey('credential-b'));
  });

  it('does not accept an empty API-key ID', () => {
    expect(() => personalTenantIdForApiKey('')).toThrow(/apiKeyId is required/i);
    expect(() => personalTenantIdForApiKey('   ')).toThrow(/apiKeyId is required/i);
  });
});
