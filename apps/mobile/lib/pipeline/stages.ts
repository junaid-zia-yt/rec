import type { StatusColorKey } from '@/theme/tokens'

/**
 * Mirrors apps/web/components/domain/candidates/candidate-pipeline-view.tsx's
 * `STAGE_LABELS`/`STAGE_BADGE` exactly (same 8 `candidate_project_entries.
 * current_stage` values, same tone mapping) so a candidate's stage reads
 * identically on web and mobile. `StatusChip` only has 4 tones (passed/
 * pending/failed/warning), one fewer than web's StatusBadge (which also has
 * `neutral`) — 'discovered' maps to 'pending' here rather than inventing a
 * 5th mobile-only tone.
 */
export const STAGE_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  eligibility_check: 'Eligibility Check',
  scored: 'Scored',
  quality_review: 'Quality Review',
  outreach: 'Outreach',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export const STAGE_BADGE: Record<string, StatusColorKey> = {
  discovered: 'pending',
  eligibility_check: 'pending',
  scored: 'pending',
  quality_review: 'pending',
  outreach: 'pending',
  shortlisted: 'passed',
  rejected: 'failed',
  withdrawn: 'failed',
}
