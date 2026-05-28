export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: 'GEMINI_API_KEY missing' }, { status: 400 });

  // Step 1: List all available models
  const modelsRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=50`,
    { signal: AbortSignal.timeout(10000) }
  );
  const modelsData = await modelsRes.json() as {
    models?: Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }>
  };
  const allModels = (modelsData.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => ({ id: m.name.replace('models/', ''), display: m.displayName }));

  // Step 2: Test gemini-3.1-flash-lite specifically
  const testModels = ['gemini-3.1-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-8b', 'gemini-1.5-flash'];
  const testResults: Record<string, string> = {};

  for (const model of testModels) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say OK' }] }],
            generationConfig: { maxOutputTokens: 5 }
          }),
          signal: AbortSignal.timeout(10000),
        }
      );
      if (r.ok) {
        const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        testResults[model] = `live ✓ — "${d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'ok'}"`;
      } else {
        const err = await r.json() as { error?: { code?: number; message?: string } };
        testResults[model] = `${r.status}: ${err.error?.message?.slice(0, 80) ?? 'error'}`;
      }
    } catch (e) { testResults[model] = `timeout/failed`; }
  }

  return Response.json({ available_models: allModels, test_results: testResults });
}
