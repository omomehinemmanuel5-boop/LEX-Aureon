*** Begin Patch
*** Update File: lib/env.ts
@@
 type EnvShape = {
   GROQ_API_KEY:                 string;
   JINA_API_KEY:                 string;
   TURSO_DATABASE_URL:           string;
   TURSO_AUTH_TOKEN:             string;
   ADMIN_PASSWORD:               string;
+  GOVERN_API_KEY:               string;
   GEMINI_API_KEY:               string | undefined;
   GITHUB_TOKEN:                 string | undefined;
   VERCEL_TOKEN:                 string | undefined;
   CRON_SECRET:                  string;
   NEXT_PUBLIC_SITE_URL:         string;
@@
 const REQUIRED = new Set<keyof EnvShape>([
   'GROQ_API_KEY',
   'JINA_API_KEY',
   'TURSO_DATABASE_URL',
   'TURSO_AUTH_TOKEN',
   'ADMIN_PASSWORD',
+  'GOVERN_API_KEY',
   'CRON_SECRET',
   'NEXT_PUBLIC_SITE_URL',
 ]);
*** End Patch