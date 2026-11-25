import { describe, expect, it } from 'vitest';
import { isTrustedApprovalOrigin } from './approval_origin';

describe('isTrustedApprovalOrigin', () => {
  it.each(['https://lexaureon.com', 'https://www.lexaureon.com'])(
    'accepts the exact official origin %s',
    origin => {
      const req = new Request('https://lexaureon.com/approvals/link/id/approved', { method: 'POST', headers: { origin } });
      expect(isTrustedApprovalOrigin(req)).toBe(true);
    },
  );

  it.each(['null', 'https://lexaureon.com.evil.test', 'http://lexaureon.com', 'https://lexaureon.com/'])(
    'rejects explicit untrusted or non-canonical origin %s',
    origin => {
      const req = new Request('https://lexaureon.com/approvals/link/id/approved', {
        method: 'POST',
        headers: {
          origin, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded',
        },
      });
      expect(isTrustedApprovalOrigin(req)).toBe(false);
    },
  );

  it('accepts WebKit-style form navigation when Origin is omitted but Fetch Metadata proves same-origin', () => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded',
      },
    });
    expect(isTrustedApprovalOrigin(req)).toBe(true);
  });

  it.each([
    {},
    { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded' },
    { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded' },
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'content-type': 'application/x-www-form-urlencoded' },
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'content-type': 'text/plain' },
  ])('rejects missing-Origin requests without complete same-origin form metadata: %o', headers => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', { method: 'POST', headers });
    expect(isTrustedApprovalOrigin(req)).toBe(false);
  });

  it('rejects non-POST requests when Origin is missing', () => {
    const req = new Request('https://lexaureon.com/approvals/link/id/approved', {
      method: 'GET',
      headers: {
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded',
      },
    });
    expect(isTrustedApprovalOrigin(req)).toBe(false);
  });
});
