import { NextResponse } from 'next/server';
import { run_self_test } from '@/lib/lex_crs_agent/tools';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    const result = await run_self_test();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
