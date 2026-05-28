export const dynamic = 'force-dynamic';
export async function GET() {
  const results: Record<string, string> = {};
  if (process.env.GEMINI_API_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }], generationConfig: { maxOutputTokens: 5 } }),
          signal: AbortSignal.timeout(10000) }
      );
      if (r.ok) {
        const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        results.gemini = `live ✓ — ${d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'responded'}`;
      } else { results.gemini = `error ${r.status}`; }
    } catch (e) { results.gemini = `failed: ${String(e)}`; }
  } else { results.gemini = 'key missing'; }
  return Response.json({ results });
}
