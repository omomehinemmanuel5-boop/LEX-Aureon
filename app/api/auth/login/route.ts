import { NextResponse } from 'next/server';

// Native auth not implemented in this app yet.
// The previous proxy target (api.lexaureon.com) is offline.
export async function POST() {
  return NextResponse.json(
    { error: 'Auth not implemented yet' },
    { status: 501 },
  );
}
