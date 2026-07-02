import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/lib/theme';
import ConfigBanner from '@/components/ConfigBanner';
import { env } from '@/lib/env';

const SITE_URL = env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Lex Aureon | Constitutional AI Governance',
  description: 'State-space control system for language generation. Constitutional AI governance powered by the Aureonics framework.',
  openGraph: {
    title: 'Lex Aureon — Govern AI. Ensure Trust. Defend Truth.',
    description: 'Constitutional AI governance. Real-time CBF control, Lyapunov stability, cryptographic audit receipts.',
    images: [{ url: '/logo.png', width: 1080, height: 1080 }],
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lex Aureon — Constitutional AI Governance',
    description: 'C+R+S=1. Every AI output governed, audited, proven.',
    images: ['/logo.png'],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom is allowed (up to 5x) for readability — important on mobile,
  // and required for accessibility. Do not disable user scaling.
  maximumScale: 5,
  userScalable: true,
  // Match the mobile browser chrome to the near-black theme.
  themeColor: '#07070d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <body className="antialiased min-h-screen flex flex-col overflow-x-hidden">
        <ThemeProvider>
          <ToastProvider>
            <ConfigBanner />
            {children}
          </ToastProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
