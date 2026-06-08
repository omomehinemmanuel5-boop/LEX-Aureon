/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.jina.ai https://api.groq.com https://api.lexaureon.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy',   value: csp },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig = {
  eslint:     { ignoreDuringBuilds: true },
  // TypeScript checked in dedicated tsc --noEmit CI step.
  // ignoreBuildErrors: true prevents the Next.js build from double-checking
  // and avoids lockfile-version mismatch false positives.
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [{
      source:      '/:path*',
      has:         [{ type: 'host', value: 'lexaureon.com' }],
      destination: 'https://www.lexaureon.com/:path*',
      permanent:   true,
    }];
  },
};

export default nextConfig;
