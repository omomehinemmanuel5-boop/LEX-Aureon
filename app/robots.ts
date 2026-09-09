import type { MetadataRoute } from 'next';
import { siteUrlForMetadata } from '@/lib/env';

const SITE_URL = siteUrlForMetadata();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // fix (2026-09-09): the blanket 'disallow: /api/' below was also
        // blocking /api/benchmarks — a route whose own code header
        // explicitly calls it "Public read endpoint — the single source
        // of truth for benchmark numbers." Any robots.txt-respecting
        // agent hitting it directly got refused before seeing the
        // response; the same agent visiting /benchmarks itself only ever
        // saw the page's default "No scored run published yet." state,
        // since that page's own client-side fetch of /api/benchmarks is
        // the exact same disallowed path. Real, already-published results
        // existed the whole time — robots.txt just prevented any
        // compliant crawler or agent from ever seeing them. Allow rules
        // take precedence over a shorter matching disallow (standard
        // robots.txt precedence: most specific path wins), so this opens
        // only the one confirmed-public endpoint rather than the rest of
        // /api/, which includes routes that should stay blocked
        // (admin, auth, billing, cron, keys, etc.).
        allow: ['/', '/api/benchmarks'],
        disallow: ['/admin', '/admin/*', '/api/', '/api/debug', '/keys'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
