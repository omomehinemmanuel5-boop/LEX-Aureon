import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

const SITE_URL = env.NEXT_PUBLIC_SITE_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/admin/*', '/api/', '/api/debug', '/keys'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
