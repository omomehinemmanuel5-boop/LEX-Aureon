import Link from 'next/link';

const base = 'https://www.lexaureon.com';

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-emerald-200">{children}</pre>;
}

export const metadata = {
  title: 'Quickstart | Lex Aureon',
  description: 'Make your first governed request and connect an MCP client to Lex Aureon.',
};

export default function QuickstartPage() {
  return (
    <main className="min-h-screen bg-[#07070d] px-4 py-10 text-slate-200 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="font-mono text-xs font-bold tracking-[.18em] text-white">LEX <span className="text-[#e8c96d]">AUREON</span></Link>
          <div className="flex gap-4 text-xs text-slate-400"><Link href="/api-docs" className="hover:text-white">API reference</Link><Link href="/keys" className="hover:text-white">Get an API key</Link></div>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[.2em] text-[#e8c96d]">Five-minute integration</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">Make your first governed request.</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">Start with text governance. Then use the same key to connect an MCP client when you need action and tool-call governance. Every successful request returns constitutional state and an audit receipt.</p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-bold text-white">1. Try the public demo</h2>
          <p className="text-sm leading-6 text-slate-400">No key is required for a small number of demo requests. Use a stable session ID for an application so its trajectory and receipts remain coherent.</p>
          <Code>{`curl -sS ${base}/api/lex/govern \\
  -H 'content-type: application/json' \\
  -d '{"prompt":"Summarize this text safely.","session_id":"quickstart-demo","turn":1}'`}</Code>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-bold text-white">2. Create a key for an integration</h2>
          <p className="text-sm leading-6 text-slate-400">Open <Link href="/keys" className="text-[#e8c96d] hover:text-white">API Keys</Link>, enter your email, and copy the key immediately. It is shown only once. Keep it server-side and never send it in a model-visible prompt or commit it to source control.</p>
          <Code>{`curl -sS ${base}/api/lex/govern \\
  -H 'content-type: application/json' \\
  -H 'x-lex-api-key: lex_sk_YOUR_KEY' \\
  -d '{"prompt":"Summarize this text safely.","session_id":"my-app","turn":1}'`}</Code>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-bold text-white">3. Inspect and verify the receipt</h2>
          <p className="text-sm leading-6 text-slate-400">Save the returned <code className="text-[#e8c96d]">receipt_id</code>. The public audit page exposes persisted evidence without exposing your prompt or response text.</p>
          <Code>{`# Replace RECEIPT_ID with the returned KRN-... value
curl -sS ${base}/api/audits/RECEIPT_ID

# Browse recent public receipts
curl -sS '${base}/api/audits/recent?limit=5'`}</Code>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-bold text-white">4. Connect an MCP client</h2>
          <p className="text-sm leading-6 text-slate-400">Use this server URL in an MCP-compatible client:</p>
          <Code>{`${base}/api/mcp`}</Code>
          <p className="text-sm leading-6 text-slate-400">For API-key clients, send <code className="text-[#e8c96d]">x-lex-api-key</code> or <code className="text-[#e8c96d]">Authorization: Bearer</code> at the transport layer. OAuth-capable clients can use the protected-resource metadata at <code className="text-[#e8c96d]">/.well-known/oauth-protected-resource</code>. Do not put operator secrets in an agent prompt.</p>
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100">MCP tools are governed before execution. Unknown tools, missing credentials, unavailable canonical state, and constitutionally denied actions fail closed.</div>
        </section>

        <section className="mt-10 flex flex-wrap gap-3 border-t border-white/10 pt-6 text-sm">
          <Link href="/api-docs" className="rounded-lg bg-[#c9a84c] px-4 py-3 font-bold text-[#07070d]">Open API reference</Link>
          <Link href="/observability" className="rounded-lg border border-white/15 px-4 py-3 font-bold text-slate-200">View observability</Link>
          <Link href="/audit" className="rounded-lg border border-white/15 px-4 py-3 font-bold text-slate-200">Browse receipts</Link>
        </section>
      </div>
    </main>
  );
}
