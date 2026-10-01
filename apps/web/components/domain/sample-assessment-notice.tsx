import { Alert } from '@rqi/ui'
import { supabaseConfigured } from '@/lib/env'

/**
 * Build Phase 17D Wave A — small, demo-mode-conditional notice shown
 * wherever gate results, scores or evidence assessments derived from
 * `scripts/seed-demo.ts`'s sample assessment layer are displayed (candidate
 * evaluation view, quality-review queue, shortlist workspace). Renders
 * nothing outside demo mode, so it is safe to drop into any of those three
 * screens unconditionally.
 *
 * Approach (a) from the brief: a standalone conditional label near the
 * AI-derived content, rather than extending the ai_runs-status surfacing
 * mechanism, because none of these three components currently reads or
 * displays ai_runs.status/model at all — inventing that plumbing purely to
 * hang a demo label off it would be a bigger, riskier change than this
 * wave's brief calls for.
 *
 * Build Phase 18: keyed on `supabaseConfigured` (not the stricter
 * `demoModeEnabled`, which also requires Anthropic/Resend to be absent) —
 * this is exactly the flag apps/web/lib/demo/engine.ts's
 * runDemoEvaluation() is gated behind, so the label appears precisely when
 * a result on screen actually came from the deterministic demo engine, no
 * more and no less. Wording matches the Build Phase 18 brief's required
 * label verbatim.
 */
export function SampleAssessmentNotice() {
  if (supabaseConfigured) return null

  return (
    <Alert tone="info" title="Demonstration evaluation — live AI is not connected." />
  )
}
