import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

const SITE_URL = env.NEXT_PUBLIC_SITE_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`,            lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/console`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/constitution`,lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/research`,    lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/api-docs`,    lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/keys`,        lastModified: now, changeFrequency: 'yearly',  priority: 0.4 },
    { url: `${SITE_URL}/landing`,     lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
