// lib/env.ts — single source of truth for all env vars.
// Required vars throw at first access if missing. Optional vars return undefined.
// Lazy via Proxy so module import never throws — only the first call site that
// actually needs the value sees the error.

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `[Lexaureon] Missing required env var: ${key}\n` +
      `Set it in Vercel → lexaureonfrontendx → Settings → Environment Variables`
    );
  }
  return val;
}

const optional = (key: string): string | undefined => process.env[key] || undefined;

type EnvShape = {
  GROQ_API_KEY:                 string;
  JINA_API_KEY:                 string;
  TURSO_DATABASE_URL:           string;
  TURSO_AUTH_TOKEN:             string;
  ADMIN_PASSWORD:               string;
  GEMINI_API_KEY:               string | undefined;
  MISTRAL_API_KEY:              string | undefined;
  CEREBRAS_API_KEY:             string | undefined;
  AUDITOR_SECRET:               string | undefined;
  RESEND_API_KEY:               string | undefined;
  OPS_ALERT_EMAIL:              string | undefined;
  SERPER_API_KEY:               string | undefined;
  GITHUB_TOKEN:                 string | undefined;
  VERCEL_TOKEN:                 string | undefined;
  CRON_SECRET:                  string;
  NEXT_PUBLIC_SITE_URL:         string;
  ANTHROPIC_API_KEY:            string | undefined;
  NEXT_PUBLIC_PRO_CHECKOUT_URL: string | undefined;
  LOG_DRAIN_URL:                string | undefined;
  LOG_DRAIN_TOKEN:              string | undefined;
  GRAFANA_LOKI_URL:             string | undefined;
  GRAFANA_LOKI_USER:            string | undefined;
  GRAFANA_LOKI_TOKEN:           string | undefined;
  BENCH_SECRET:                 string | undefined;
};

const REQUIRED = new Set<keyof EnvShape>([
  'GROQ_API_KEY',
  'JINA_API_KEY',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'ADMIN_PASSWORD',
  'CRON_SECRET',
  'NEXT_PUBLIC_SITE_URL',
]);

// Optional vars whose process.env key differs from the canonical field name.
const ALIASES: Partial<Record<keyof EnvShape, string>> = {
  ANTHROPIC_API_KEY: 'Claude_api_key',
};

export const env = new Proxy({} as EnvShape, {
  get(_, prop: string) {
    const key = prop as keyof EnvShape;
    if (REQUIRED.has(key)) return required(prop);
    const sourceKey = ALIASES[key] ?? prop;
    return optional(sourceKey);
  },
}) as EnvShape;
