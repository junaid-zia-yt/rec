import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { NonProductionBanner } from '@/components/domain/non-production-banner'
import { DemoModeBanner } from '@/components/domain/demo-mode-banner'

/**
 * Self-hosted via next/font/local rather than next/font/google — see
 * app/fonts/README.md for why (this build environment cannot reach
 * fonts.googleapis.com, and self-hosting is strictly better for production
 * reliability regardless).
 */
const bodyFont = localFont({
  src: './fonts/geist-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-body',
  display: 'swap',
})
const displayFont = localFont({
  src: './fonts/space-grotesk-latin-wght-normal.woff2',
  weight: '300 700',
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Recruitment Quality Intelligence',
    template: '%s · Recruitment Quality Intelligence',
  },
  description:
    'Evidence-based candidate scoring and quality review for specialist recruitment agencies.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <NonProductionBanner />
        <DemoModeBanner />
        {children}
      </body>
    </html>
  )
}
