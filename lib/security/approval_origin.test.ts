import { describe, expect, it } from 'vitest';
import { isTrustedApprovalDecisionOrigin, isTrustedApprovalOrigin } from './approval_origin';

describe('approval origin validation', () => {
  it.each(['https://lexaureon.com', 'https://www.lexaureon.com'])('accepts official Origin %s', origin => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', { method: 'POST', headers: { origin } });
    expect(isTrustedApprovalDecisionOrigin(req)).toBe(true);
    expect(isTrustedApprovalOrigin(req)).toBe(true);
  });

  it.each(['null', 'https://lexaureon.com.evil.test', 'http://lexaureon.com', 'https://lexaureon.com/'])('rejects explicit invalid Origin %s even with same-origin metadata', origin => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', {
      method: 'POST',
      headers: {
        origin, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded',
      },
    });
    expect(isTrustedApprovalDecisionOrigin(req)).toBe(false);
  });

  it('accepts WebKit form navigation when Origin is omitted but Fetch Metadata proves same-origin', () => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded',
      },
    });
    expect(isTrustedApprovalDecisionOrigin(req)).toBe(true);
    expect(isTrustedApprovalOrigin(req)).toBe(false);
  });

  it.each([
    {},
    { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded' },
    { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded' },
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'content-type': 'application/x-www-form-urlencoded' },
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'content-type': 'text/plain' },
  ])('rejects missing-Origin request without complete same-origin form metadata: %o', headers => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', { method: 'POST', headers });
    expect(isTrustedApprovalDecisionOrigin(req)).toBe(false);
  });

  it('rejects non-POST requests when Origin is missing', () => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', {
      method: 'GET',
      headers: {
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded',
      },
    });
    expect(isTrustedApprovalDecisionOrigin(req)).toBe(false);
  });
});
