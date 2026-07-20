import { publicError } from '@/lib/safe_error';
import { NextResponse } from 'next/server';
import { getTopInvokedLaws } from '@/lib/db';
import { SOVEREIGN_LAWS } from '@/lib/sovereign_laws';

export async function GET() {
  try {
    const topLaws = await getTopInvokedLaws(10);
    return NextResponse.json({
      total: SOVEREIGN_LAWS.length,
      top_invoked: topLaws,
      laws: SOVEREIGN_LAWS.map(l => ({
        id: l.id,
        book: l.book,
        book_name: l.book_name,
        name: l.name,
        pillar: l.pillar,
        text: l.text,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: publicError('laws.route', e) }, { status: 500 });
  }
}
