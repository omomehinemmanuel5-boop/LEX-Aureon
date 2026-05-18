import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

// Native checkout backend not implemented in this app.
// If a Stripe checkout link is configured, we redirect to it; otherwise 501.
export async function POST() {
  const stripeUrl = env.NEXT_PUBLIC_PRO_CHECKOUT_URL;
  if (stripeUrl) {
    return NextResponse.json({ checkout_url: stripeUrl });
  }
  return NextResponse.json(
    { error: 'Checkout not implemented yet' },
    { status: 501 },
  );
}
