import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { error: 'Auth not implemented yet' },
    { status: 501 },
  );
}
