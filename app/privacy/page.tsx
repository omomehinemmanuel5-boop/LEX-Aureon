import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Privacy Policy — Lex Aureon',
  description: 'What Lex Aureon collects, why, and who processes it — prompts, audit receipts, and email signups, and the third-party providers involved.',
  alternates: { canonical: 'https://www.lexaureon.com/privacy' },
  robots: { index: true, follow: true },
};

const LAST_UPDATED = '2026-07-10';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-white mb-3">{title}</h2>
      <div className="text-sm text-slate-400 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main style={{ background: '#07070d', minHeight: '100vh' }}>
      <nav className="sticky top-0 z-40 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(7,7,13,0.9)' }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Lex Aureon" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-bold text-white text-sm">Lex Aureon</span>
          </Link>
          <span className="text-xs text-slate-600 font-mono">PRIVACY</span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-10">
          <div className="text-xs font-mono uppercase tracking-widest mb-2 font-bold" style={{ color: '#c9a84c' }}>
            Legal
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white mb-2">Privacy Policy</h1>
          <p className="text-xs text-slate-500 font-mono">Last updated {LAST_UPDATED}</p>
          <p className="text-sm text-slate-400 mt-4 leading-relaxed">
            Lex Aureon is built and operated by Emmanuel King (Aureonics Systems), an independent,
            unfunded researcher — not a company with a dedicated legal or privacy team. This policy
            describes what data the site actually collects and what happens to it, in plain language.
            It is not a substitute for professional legal advice, and if you need a formal compliance
            assessment for your own use of the site (e.g. under GDPR or CCPA), consult your own counsel.
          </p>
        </div>

        <Section title="1. What we collect">
          <p><b className="text-slate-200">Prompts and governance data.</b> When you use the console, chat, or public API, your prompt text and the model's response are sent to Lex Aureon's servers to be governed and, where you've asked to keep a session, stored so the constitutional state (C, R, S) can persist across turns. This is stored in our database (Turso/libSQL).</p>
          <p><b className="text-slate-200">Audit receipts.</b> Every governed turn generates a cryptographic receipt — a SHA-256 hash of the input, a hash of the output, and the resulting constitutional state and health band. Receipts are retained permanently by design (the system is append-only, for auditability) and a subset are publicly viewable at <Link href="/audit" className="text-amber-500 hover:underline">/audit</Link>. <b className="text-slate-200">Receipts do not display your prompt or response text</b> — only hashes, scores, and metadata (session ID, turn number, timestamp, intervention flag).</p>
          <p><b className="text-slate-200">Email address.</b> If you submit your email (e.g. via the homepage signup), it's sent to our server and stored, and also saved in your browser's local storage. We use it to notify you about things you signed up for (like benchmark result publication) — nothing else, unless you're on a paid plan (next paragraph).</p>
          <p><b className="text-slate-200">Payment verification, for paid plans only.</b> If you upgrade to a paid tier via cryptocurrency payment, we also store the transaction ID, payment amount, and coin type against your email, to verify the on-chain payment and issue an API key. We do not process or store card numbers or other traditional payment credentials — verification is done by checking the public blockchain transaction you provide, not by collecting financial account details from you directly.</p>
          <p><b className="text-slate-200">Usage analytics.</b> The site uses Vercel Analytics and Vercel Speed Insights for aggregate traffic and performance monitoring. These are privacy-oriented by design (no cross-site tracking cookies) and we don't layer any additional tracking on top.</p>
          <p><b className="text-slate-200">Local storage.</b> Your browser may store small preference values locally (e.g. theme choice, whether you've already signed up) — this stays on your device and isn't something we can read server-side.</p>
        </Section>

        <Section title="2. Who processes it">
          <p>Generating a governed response requires sending your prompt to an underlying language model. Depending on availability, this is one of: Groq, Google (Gemini), or Mistral AI. Each operates under its own privacy policy and terms for API usage; we don't control how they log or retain requests on their end beyond what their own policies state.</p>
          <p>Our database is hosted by Turso. Our application is hosted by Vercel. Neither has access to your data beyond what's necessary to run the service.</p>
        </Section>

        <Section title="3. Why we collect it">
          <p>To generate and govern responses (the core function of the product), to let you resume a session with constitutional memory intact, to maintain the audit trail the whole project is built around, to verify payment and issue access for paid plans, and — for email signups — to send you the specific update you asked for.</p>
        </Section>

        <Section title="4. Retention">
          <p>Audit receipts and constitutional-state records are retained indefinitely — this is a deliberate design choice (see the <Link href="/constitution" className="text-amber-500 hover:underline">Constitution</Link>, Article IV: Audit and Continuity), not an oversight. If you want a specific session's data reviewed or removed, contact us (below) and we'll do what's reasonably possible, though receipts already written to the append-only audit log may not be fully erasable without breaking the audit chain for other sessions.</p>
        </Section>

        <Section title="5. Your rights">
          <p>Depending on where you're located, you may have rights to access, correct, or request deletion of your personal data. Since this is a solo-operated project, the practical way to exercise any of these is to email us directly (below) and we'll respond as promptly as we can.</p>
        </Section>

        <Section title="6. Children">
          <p>Lex Aureon isn't directed at children, and we don't knowingly collect data from anyone under 13 (or the relevant minimum age in your jurisdiction).</p>
        </Section>

        <Section title="7. Changes to this policy">
          <p>If what we collect or how we use it changes materially, we'll update this page and the "Last updated" date above. We don't currently have a mailing list for policy changes specifically.</p>
        </Section>

        <Section title="8. Contact">
          <p>Questions, requests, or concerns about any of the above: <a href="mailto:lexaureon@gmail.com" className="text-amber-500 hover:underline">lexaureon@gmail.com</a>.</p>
        </Section>

        <p className="text-center text-[11px] font-mono text-slate-600 mt-10 pt-6 border-t border-white/5">
          © 2026 Aureonics Systems · Built in Lagos
        </p>
      </div>
    </main>
  );
}
