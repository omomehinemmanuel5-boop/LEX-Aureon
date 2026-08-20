import Link from 'next/link';

const example = `curl -X POST https://www.lexaureon.com/api/lex/govern \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer lex_sk_..." \
  -d '{"prompt":"Summarize this policy with evidence.","session_id":"demo-001","turn":1}'`;

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 text-zinc-100">
      <p className="mb-3 text-sm uppercase tracking-[0.2em] text-amber-300">Lex Aureon API</p>
      <h1 className="mb-5 text-4xl font-semibold">Govern model output with a verifiable receipt.</h1>
      <p className="mb-10 max-w-2xl text-zinc-300">Send a prompt through the constitutional governance layer and receive the governed response, state, intervention, and audit receipt.</p>
      <section className="mb-10 rounded-xl border border-zinc-700 bg-zinc-900/60 p-6">
        <h2 className="mb-3 text-xl font-medium">Quick start</h2>
        <pre className="overflow-x-auto whitespace-pre-wrap text-sm text-amber-100"><code>{example}</code></pre>
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-zinc-700 p-6"><h2 className="mb-3 text-xl font-medium">Limits</h2><p className="text-zinc-300">Anonymous callers receive 20 requests per IP per minute. API-key callers receive 120 requests per IP per minute plus plan-level run accounting.</p></section>
        <section className="rounded-xl border border-zinc-700 p-6"><h2 className="mb-3 text-xl font-medium">Responses</h2><p className="text-zinc-300">Successful responses include the governed output and receipt metadata. Errors are sanitized and never expose provider or database internals.</p></section>
      </div>
      <p className="mt-10 text-sm text-zinc-400"><Link className="text-amber-300 underline" href="/research">Read the research boundary</Link> before interpreting numerical certificates as proofs.</p>
    </main>
  );
}
