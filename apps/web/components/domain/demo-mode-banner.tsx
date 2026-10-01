import { demoModeEnabled, getBuildInfo } from '@/lib/env'

/**
 * Build Phase 17D Wave A ("Private Client Demo Readiness") — persistent
 * banner shown on every page only when `NEXT_PUBLIC_DEMO_MODE=true`
 * (lib/env.ts's `demoModeEnabled`). Modeled directly on
 * components/domain/non-production-banner.tsx (same structure, same
 * "renders for exactly one condition, never by default" discipline) but
 * distinctly labeled: this is not a staging/environment-identity banner,
 * it is a "this whole session is fictional demo data" disclosure for
 * whoever is in the room during a client meeting.
 *
 * The two banners can coexist (a demo could in principle also run under
 * NEXT_PUBLIC_ENVIRONMENT_NAME=staging) — this component does not check or
 * suppress NonProductionBanner, and app/layout.tsx renders both.
 *
 * The label text is exact and must not be paraphrased: "Private
 * Demonstration — Sample Data".
 */
export function DemoModeBanner() {
  if (!demoModeEnabled) return null

  const { sha, releaseTag, isKnownBuild } = getBuildInfo()
  const buildLabel = isKnownBuild ? `${sha.slice(0, 7)} · ${releaseTag}` : null

  return (
    <div
      role="status"
      className="border-warning-border bg-warning-bg text-warning w-full border-b px-4 py-1.5 text-center text-xs font-medium"
    >
      Private Demonstration — Sample Data
      <span className="font-normal opacity-80">
        {' '}
        · Fictional candidates and companies only. Outreach sending is disabled.
        {buildLabel ? ` ${buildLabel}` : ''}
      </span>
    </div>
  )
}
