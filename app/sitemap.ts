import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

const SITE_URL = env.NEXT_PUBLIC_SITE_URL;

// fix (2026-07-10) — SEO PASS:
//   - Removed /keys: robots.ts explicitly disallows crawling it (correctly —
//     it's an API key management page, not public content), but it was ALSO
//     listed here for indexing. Submitting a URL you tell crawlers not to
//     crawl is a direct contradiction; Google generally still indexes it
//     with no description ("URL blocked by robots.txt"), which helps no one.
//   - Removed /landing: confirmed via curl that it 307-redirects to `/` —
//     submitting a redirecting URL for indexing is pointless (Google indexes
//     the target, not the redirect source) and wastes crawl budget.
//   - Added /benchmarks: a real, distinct, well-metadata'd page (live
//     adversarial-eval results) that was simply missing — confirmed live at
//     /benchmarks with its own title/description, linked from the homepage
//     footer, just never submitted.
//   - Did NOT add /agent or /observability despite being real 200 pages:
//     /agent is a 'use client' internal dev tool (an interactive codebase/
//     Turso/build-status query agent) — not content a search visitor would
//     want to land on, and client components can't export page-specific
//     metadata in the App Router anyway (confirmed: it inherits the generic
//     root layout title, same as /observability — both read as duplicate-
//     title pages to Google as-is). Submitting internal tooling dilutes
//     topical relevance and wastes crawl budget on pages with no unique,
//     search-worthy content. If either becomes a real public-facing feature
//     later, give it its own metadata first, then add it here.
//   - Added /audit and /privacy (same pass, added right after this file's
//     first edit): both went from returning nothing indexable (a raw
//     directory listing and a 404, respectively) to real pages with their
//     own metadata — see app/audit/page.tsx and app/privacy/page.tsx.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`,            lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/console`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/benchmarks`,  lastModified: now, changeFrequency: 'daily',   priority: 0.85 },
    { url: `${SITE_URL}/constitution`,lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/research`,    lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/api-docs`,    lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/audit`,       lastModified: now, changeFrequency: 'daily',   priority: 0.55 },
    { url: `${SITE_URL}/privacy`,     lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ];
}
