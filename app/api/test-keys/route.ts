/**
 * GET /api/test-keys — one-shot key validation. Remove after use.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, string> = {};

  // Test Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }], generationConfig: { maxOutputTokens: 5 } }),
          signal: AbortSignal.timeout(10000),
        }
      );
      if (r.ok) {
        const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        results.gemini = `live ✓ — ${d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'responded'}`;
      } else {
        results.gemini = `error ${r.status}: ${await r.text()}`;
      }
    } catch (e) { results.gemini = `failed: ${String(e)}`; }
  } else { results.gemini = 'key missing'; }

  // Test Mistral
  if (process.env.MISTRAL_API_KEY) {
    try {
      const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'open-mistral-7b', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
        results.mistral = `live ✓ — ${d.choices?.[0]?.message?.content?.trim() ?? 'responded'}`;
      } else {
        results.mistral = `error ${r.status}: ${await r.text()}`;
      }
    } catch (e) { results.mistral = `failed: ${String(e)}`; }
  } else { results.mistral = 'key missing'; }

  return Response.json({ results, timestamp: new Date().toISOString() });
}
