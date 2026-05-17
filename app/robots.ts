import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.lexaureon.com';

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
