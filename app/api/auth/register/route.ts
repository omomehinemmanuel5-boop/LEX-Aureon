import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Registration not implemented yet' },
    { status: 501 },
  );
}
