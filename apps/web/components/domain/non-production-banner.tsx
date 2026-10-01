import { env, getBuildInfo } from '@/lib/env'

/**
 * Build Phase 15 Wave 2 — small, unmissable-but-not-obnoxious banner shown
 * at the top of the app shell only when this build is explicitly marked as
 * staging (NEXT_PUBLIC_ENVIRONMENT_NAME === 'staging', lib/env.ts). Absent
 * for a local dev build (the var is unset) and absent for a production
 * build (the var is 'production') — it renders for exactly one value, never
 * by default and never by omission.
 *
 * Includes the build SHA / release tag from Wave 1's `getBuildInfo()`, kept
 * small and unobtrusive, so anyone looking at a staging deployment can
 * immediately tell which build they're on without opening the Vercel
 * dashboard (docs/rollback-runbook.md §1).
 *
 * Uses the existing design-system warning/alert tokens
 * (packages/config/src/tokens.ts warningText/warningBg/warningBorder, via
 * the `warning`/`warning-bg`/`warning-border` Tailwind classes already used
 * elsewhere for this exact visual treatment, e.g.
 * app/(app)/dashboard/page.tsx's "Quality alert" card and
 * components/domain/poc/poc-comparison-report.tsx's causation disclaimer)
 * rather than inventing new colors (docs/04-design-system.md).
 */
export function NonProductionBanner() {
  if (env.NEXT_PUBLIC_ENVIRONMENT_NAME !== 'staging') return null

  const { sha, releaseTag, isKnownBuild } = getBuildInfo()
  const buildLabel = isKnownBuild ? `${sha.slice(0, 7)} · ${releaseTag}` : 'build unknown'

  return (
    <div
      role="status"
      className="border-warning-border bg-warning-bg text-warning w-full border-b px-4 py-1.5 text-center text-xs font-medium"
    >
      Staging environment — not production data.{' '}
      <span className="font-normal opacity-80">{buildLabel}</span>
    </div>
  )
}
