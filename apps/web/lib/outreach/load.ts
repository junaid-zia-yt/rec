import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type {
  CommunicationChannel,
  OutreachMessageStatus,
  OutreachSequenceStatus,
} from '@rqi/types'

/**
 * Live data loaders for the outreach workspace list (Build Phase 9 Wave 3
 * Task B). Mirrors apps/web/lib/shortlists/load.ts exactly: plain Supabase
 * reads, joined/mapped into UI-shaped interfaces, no ORM.
 */

export interface OutreachSequenceSummary {
  sequenceId: string
  sequenceStatus: OutreachSequenceStatus
  candidateId: string
  candidateName: string
  jobId: string
  jobTitle: string
  candidateRoleMatchId: string
  latestMessageId: string | null
  latestMessageStatus: OutreachMessageStatus | null
  latestMessageChannel: CommunicationChannel | null
  hasUnclassifiedResponse: boolean
  startedAt: string
}

/** Priority order for the "needs attention first" sort — an awaiting-approval or failed message is the most actionable state a recruiter should see first. */
const STATUS_PRIORITY: Record<OutreachMessageStatus, number> = {
  awaiting_approval: 0,
  failed: 1,
  drafted: 2,
  approved: 3,
  scheduled: 4,
  responded: 5,
  sent: 6,
  delivered: 7,
  cancelled: 8,
}

function sortSequences(rows: OutreachSequenceSummary[]): OutreachSequenceSummary[] {
  return [...rows].sort((a, b) => {
    if (a.sequenceStatus !== b.sequenceStatus) {
      // Active sequences before completed/cancelled ones.
      if (a.sequenceStatus === 'active') return -1
      if (b.sequenceStatus === 'active') return 1
    }
    if (a.hasUnclassifiedResponse !== b.hasUnclassifiedResponse)
      return a.hasUnclassifiedResponse ? -1 : 1
    const aPriority = a.latestMessageStatus ? STATUS_PRIORITY[a.latestMessageStatus] : 99
    const bPriority = b.latestMessageStatus ? STATUS_PRIORITY[b.latestMessageStatus] : 99
    if (aPriority !== bPriority) return aPriority - bPriority
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  })
}

/** Every outreach sequence in the org, each summarized by its most recent message and whether it has a candidate response still awaiting human classification. */
export async function loadOutreachSequences(
  organizationId: string,
): Promise<OutreachSequenceSummary[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data: sequences } = await supabase
    .from('outreach_sequences')
    .select('id, status, candidate_id, job_id, candidate_role_match_id, started_at')
    .eq('organization_id', organizationId)
    .order('started_at', { ascending: false })

  if (!sequences || sequences.length === 0) return []

  const sequenceIds = sequences.map((s) => s.id)
  const candidateIds = [...new Set(sequences.map((s) => s.candidate_id))]
  const jobIds = [...new Set(sequences.map((s) => s.job_id))]

  const [{ data: candidates }, { data: jobs }, { data: messages }, { data: responses }] =
    await Promise.all([
      supabase.from('candidates').select('id, full_name').in('id', candidateIds),
      supabase.from('jobs').select('id, title').in('id', jobIds),
      supabase
        .from('outreach_messages')
        .select('id, outreach_sequence_id, status, channel, created_at')
        .in('outreach_sequence_id', sequenceIds),
      supabase
        .from('candidate_responses')
        .select('outreach_message_id, confirmed_classification')
        .in('candidate_id', candidateIds),
    ])

  const candidateNameById = new Map(
    (candidates ?? []).map((c) => [c.id as string, c.full_name as string]),
  )
  const jobTitleById = new Map((jobs ?? []).map((j) => [j.id as string, j.title as string]))

  const latestMessageBySequence = new Map<
    string,
    { id: string; status: OutreachMessageStatus; channel: CommunicationChannel; createdAt: string }
  >()
  for (const message of messages ?? []) {
    const current = latestMessageBySequence.get(message.outreach_sequence_id)
    if (
      !current ||
      new Date(message.created_at).getTime() > new Date(current.createdAt).getTime()
    ) {
      latestMessageBySequence.set(message.outreach_sequence_id, {
        id: message.id,
        status: message.status,
        channel: message.channel,
        createdAt: message.created_at,
      })
    }
  }

  const unclassifiedMessageIds = new Set(
    (responses ?? [])
      .filter((r) => r.confirmed_classification === null && r.outreach_message_id)
      .map((r) => r.outreach_message_id as string),
  )

  const rows: OutreachSequenceSummary[] = sequences.map((sequence) => {
    const latest = latestMessageBySequence.get(sequence.id) ?? null
    return {
      sequenceId: sequence.id,
      sequenceStatus: sequence.status,
      candidateId: sequence.candidate_id,
      candidateName: candidateNameById.get(sequence.candidate_id) ?? 'Unknown candidate',
      jobId: sequence.job_id,
      jobTitle: jobTitleById.get(sequence.job_id) ?? 'Unknown role',
      candidateRoleMatchId: sequence.candidate_role_match_id,
      latestMessageId: latest?.id ?? null,
      latestMessageStatus: latest?.status ?? null,
      latestMessageChannel: latest?.channel ?? null,
      hasUnclassifiedResponse: latest ? unclassifiedMessageIds.has(latest.id) : false,
      startedAt: sequence.started_at,
    }
  })

  return sortSequences(rows)
}

export interface OutreachReadyCandidate {
  candidateRoleMatchId: string
  candidateId: string
  candidateName: string
  jobId: string
  jobTitle: string
}

/** Candidates approved for outreach (candidate_role_matches.review_status = 'approved_for_outreach') that have no outreach_sequence yet — the "ready to start" prompt, mirroring loadShortlistableJobs's "no shortlist yet" pattern. */
export async function loadOutreachReadyCandidates(
  organizationId: string,
): Promise<OutreachReadyCandidate[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const [{ data: matches }, { data: sequences }] = await Promise.all([
    supabase
      .from('candidate_role_matches')
      .select('id, candidate_id, job_id')
      .eq('organization_id', organizationId)
      .eq('review_status', 'approved_for_outreach'),
    supabase
      .from('outreach_sequences')
      .select('candidate_role_match_id')
      .eq('organization_id', organizationId),
  ])

  const matchIdsWithSequence = new Set((sequences ?? []).map((s) => s.candidate_role_match_id))
  const ready = (matches ?? []).filter((m) => !matchIdsWithSequence.has(m.id))
  if (ready.length === 0) return []

  const candidateIds = [...new Set(ready.map((m) => m.candidate_id))]
  const jobIds = [...new Set(ready.map((m) => m.job_id))]
  const [{ data: candidates }, { data: jobs }] = await Promise.all([
    supabase.from('candidates').select('id, full_name').in('id', candidateIds),
    supabase.from('jobs').select('id, title').in('id', jobIds),
  ])
  const candidateNameById = new Map(
    (candidates ?? []).map((c) => [c.id as string, c.full_name as string]),
  )
  const jobTitleById = new Map((jobs ?? []).map((j) => [j.id as string, j.title as string]))

  return ready.map((match) => ({
    candidateRoleMatchId: match.id,
    candidateId: match.candidate_id,
    candidateName: candidateNameById.get(match.candidate_id) ?? 'Unknown candidate',
    jobId: match.job_id,
    jobTitle: jobTitleById.get(match.job_id) ?? 'Unknown role',
  }))
}
