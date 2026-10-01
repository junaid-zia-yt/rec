import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Best-effort resource_type/resource_id -> mobile-screen resolver.
 *
 * The web app has a much heavier version of this (`apps/web/lib/
 * notifications/resource-link.ts`'s `buildPermissionSafeDeepLink`): it
 * re-validates the CURRENT viewer's access to the target resource via
 * `assertResourceOwnership` before ever returning a path, specifically so
 * a stale or forwarded notification can never become a working link to
 * something the viewer's access has since changed. This module
 * deliberately does NOT reimplement that ownership re-validation — doing
 * so would mean duplicating a server-only, permission-sensitive module
 * (`lib/copilot/resource-ownership.ts`) into the mobile client, which is
 * both a much bigger lift than this wave's task brief calls for and a
 * worse place for that logic to live (a client-side "am I still allowed"
 * check is advisory at best; RLS is the only real backstop). Instead:
 * this module resolves a `(resourceType, resourceId)` pair to the mobile
 * screen + params that would show it, via the SAME RLS-scoped Supabase
 * client every other read in this app already uses — if the viewer's
 * access has changed, the destination screen's own RLS-scoped query
 * simply comes back `empty`/inaccessible, exactly as if they had
 * navigated there any other way. This is graceful, not silent: it never
 * crashes and never shows the caller a broken link, it just relies on the
 * destination screen's own already-required empty/error state instead of
 * a bespoke precomputed one.
 *
 * Returns `null` for a resource_type this app has no mapped screen for
 * yet (`integration_connection` — no mobile Integrations screen exists),
 * for a null/unrecognized resource_type, or if a lookup query needed to
 * resolve a multi-hop reference (e.g. verification_request -> candidate)
 * comes back empty — callers must treat `null` as "show this notification
 * as plain, unlinked text" per the task brief's "fall back gracefully"
 * requirement, never as an error.
 */
export type DeepLinkTarget =
  | { tab: 'PipelineTab'; screen: 'CandidateEvaluation'; params: { candidateId: string } }
  | { tab: 'ProjectsTab'; screen: 'OutreachApproval'; params: { candidateId: string } }
  | { tab: 'ProjectsTab'; screen: 'EvidenceReview'; params: { candidateId: string } }
  | {
      tab: 'ProjectsTab'
      screen: 'JobScorecard'
      params: { projectId: string; scorecardId: string }
    }
  | { tab: 'ShortlistsTab'; screen: 'FinalShortlist'; params: { shortlistId: string } }
  | { tab: 'ShortlistsTab'; screen: 'PocComparison'; params: { pocId: string } }

async function resolveCandidateRoleMatch(
  supabase: SupabaseClient,
  resourceId: string,
): Promise<DeepLinkTarget | null> {
  const { data } = await supabase
    .from('candidate_role_matches')
    .select('candidate_id')
    .eq('id', resourceId)
    .maybeSingle()
  const candidateId = data?.candidate_id as string | undefined
  return candidateId
    ? { tab: 'PipelineTab', screen: 'CandidateEvaluation', params: { candidateId } }
    : null
}

async function resolveOutreachMessage(
  supabase: SupabaseClient,
  resourceId: string,
): Promise<DeepLinkTarget | null> {
  const { data } = await supabase
    .from('outreach_messages')
    .select('candidate_id')
    .eq('id', resourceId)
    .maybeSingle()
  const candidateId = data?.candidate_id as string | undefined
  return candidateId
    ? { tab: 'ProjectsTab', screen: 'OutreachApproval', params: { candidateId } }
    : null
}

async function resolveVerificationRequest(
  supabase: SupabaseClient,
  resourceId: string,
): Promise<DeepLinkTarget | null> {
  const { data: request } = await supabase
    .from('verification_requests')
    .select('candidate_role_match_id')
    .eq('id', resourceId)
    .maybeSingle()
  const matchId = request?.candidate_role_match_id as string | undefined
  if (!matchId) return null
  const { data: match } = await supabase
    .from('candidate_role_matches')
    .select('candidate_id')
    .eq('id', matchId)
    .maybeSingle()
  const candidateId = match?.candidate_id as string | undefined
  return candidateId
    ? { tab: 'ProjectsTab', screen: 'EvidenceReview', params: { candidateId } }
    : null
}

async function resolveScorecardVersion(
  supabase: SupabaseClient,
  resourceId: string,
): Promise<DeepLinkTarget | null> {
  const { data: version } = await supabase
    .from('scorecard_versions')
    .select('scorecard_id')
    .eq('id', resourceId)
    .maybeSingle()
  const scorecardId = version?.scorecard_id as string | undefined
  if (!scorecardId) return null
  const { data: scorecard } = await supabase
    .from('scorecards')
    .select('job_id')
    .eq('id', scorecardId)
    .maybeSingle()
  const jobId = scorecard?.job_id as string | undefined
  if (!jobId) return null
  const { data: job } = await supabase
    .from('jobs')
    .select('recruitment_project_id')
    .eq('id', jobId)
    .maybeSingle()
  const projectId = job?.recruitment_project_id as string | undefined
  return projectId
    ? { tab: 'ProjectsTab', screen: 'JobScorecard', params: { projectId, scorecardId } }
    : null
}

export async function resolveNotificationDeepLink(
  supabase: SupabaseClient,
  resourceType: string | null,
  resourceId: string | null,
): Promise<DeepLinkTarget | null> {
  if (!resourceType || !resourceId) return null

  try {
    switch (resourceType) {
      case 'candidate_role_match':
        return await resolveCandidateRoleMatch(supabase, resourceId)
      case 'outreach_message':
        return await resolveOutreachMessage(supabase, resourceId)
      case 'verification_request':
        return await resolveVerificationRequest(supabase, resourceId)
      case 'scorecard_version':
        return await resolveScorecardVersion(supabase, resourceId)
      case 'shortlist':
        return {
          tab: 'ShortlistsTab',
          screen: 'FinalShortlist',
          params: { shortlistId: resourceId },
        }
      case 'poc_benchmark':
        return { tab: 'ShortlistsTab', screen: 'PocComparison', params: { pocId: resourceId } }
      // 'integration_connection' and anything unrecognized: no mobile
      // screen exists yet — fall through to the graceful `null` below.
      default:
        return null
    }
  } catch {
    // A lookup query failing (network blip, RLS denial) is exactly the
    // "no longer accessible / can't resolve" case — never crash the
    // notification list over it.
    return null
  }
}
