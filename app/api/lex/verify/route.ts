/**
 * GET /api/lex/verify?receipt_id=...&signature=...
 * 
 * Public Verification Layer (PVL)
 * Validates that a given receipt signature matches the provided 
 * constitutional data, proving the response was governed by Lex Aureon.
 */

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { auditorSigningKey } from '@/lib/kernel_bridge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const receipt_id = searchParams.get('receipt_id');
  const signature = searchParams.get('signature');
  const data = searchParams.get('data'); // JSON string of receipt data

  if (!receipt_id || !signature || !data) {
    return NextResponse.json({
      verified: false,
      error: 'Missing receipt_id, signature, or data parameters.'
    }, { status: 400 });
  }

  try {
    // 2026-07-20: shared key resolution — production refuses the public
    // fallback key. If the key is unavailable, verification honestly
    // reports it cannot verify rather than verifying against a key
    // anyone could have signed with.
    let signingKey: string;
    try {
      signingKey = auditorSigningKey();
    } catch {
      return NextResponse.json({
        verified: false,
        error: 'Verification unavailable: signing key not configured on this deployment.'
      }, { status: 503 });
    }
    
    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', signingKey)
      .update(data)
      .digest('hex')
      .slice(0, 32);

    const isVerified = signature === expectedSignature;

    return NextResponse.json({
      verified: isVerified,
      receipt_id,
      timestamp: new Date().toISOString(),
      governance_guarantee: isVerified 
        ? 'SUCCESS: This response is cryptographically verified to have been governed by the Lex Aureon Constitution.'
        : 'FAILURE: Signature mismatch. This response cannot be verified as authentic Lex Aureon output.',
      details: isVerified ? JSON.parse(data) : null
    });

  } catch (e) {
    return NextResponse.json({
      verified: false,
      error: 'Verification failed due to malformed data.'
    }, { status: 400 });
  }
}
