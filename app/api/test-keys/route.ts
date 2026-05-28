export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: 'GEMINI_API_KEY missing' });

  // Test the candidates with 20s timeout
  const testModels = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite-preview',
  ];

  const results: Record<string, string> = {};

  // Run tests in parallel for speed
  await Promise.all(testModels.map(async model => {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say OK in 2 words max' }] }],
            generationConfig: { maxOutputTokens: 10 }
          }),
          signal: AbortSignal.timeout(20000),
        }
      );
      if (r.ok) {
        const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        results[model] = `✓ live — "${d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'ok'}"`;
      } else {
        const err = await r.json() as { error?: { code?: number; message?: string } };
        results[model] = `${r.status}: ${err.error?.message?.slice(0, 60) ?? 'error'}`;
      }
    } catch (e) {
      results[model] = `failed: ${String(e).slice(0, 60)}`;
    }
  }));

  return Response.json({ results });
}
