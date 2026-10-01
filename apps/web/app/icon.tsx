import { ImageResponse } from 'next/og'

// Build Phase 17D Wave B — minimal app icon/favicon. Its absence produced a
// real browser-level 404 (`GET /favicon.ico`) and a console error on every
// page load, including in demo mode; that is a genuine, if cosmetic,
// demo-blocking defect (see docs/build-phase-17a-staging-verification-report.md
// for the walkthrough that found it). Uses Next.js's file-convention icon
// route (App Router) rather than a static binary asset so no external image
// file is introduced — rendered as a simple monogram in the product's
// primary brand color (packages/config/src/tokens.ts `colors.primary`).

export const size = {
  width: 32,
  height: 32,
}
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#047857',
        borderRadius: 6,
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: 700,
        fontFamily: 'sans-serif',
      }}
    >
      R
    </div>,
    { ...size },
  )
}
