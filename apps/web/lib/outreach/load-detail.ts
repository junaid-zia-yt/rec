import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type {
  CandidateResponseClassification,
  CommunicationChannel,
  CommunicationEventType,
  CommunicationPreferenceStatus,
  OutreachApprovalDecision,
  OutreachMessageGeneratedBy,
  OutreachMessageStatus,
  OutreachSequenceStatus,
} from '@rqi/types'

/**
 * Live data loader for one outreach sequence's full workspace view (Build
 * Phase 9 Wave 3 Task B). Mirrors apps/web/lib/shortlists/load-detail.ts's
 * exact pattern: plain Supabase reads, mapped into the shape the detail
 * page/panel expects.
 */

export interface OutreachApprovalEntry {
  id: string
  approverId: string
  decision: OutreachApprovalDecision
  reason: string | null
  editedBeforeApproval: boolean
  createdAt: string
}

export interface OutreachEvidenceItem {
  sourceKind: string
  sourceId: string | null
  claimText: string
  evidenceExcerpt: string
}

export interface OutreachCommunicationEventEntry {
  id: string
  direction: 'outbound' | 'inbound'
  eventType: CommunicationEventType
  provider: string | null
  occurredAt: string
}

export interface OutreachResponseEntry {
  id: string
  channel: CommunicationChannel
  rawResponseText: string
  receivedAt: string
  aiSuggestedClassification: CandidateResponseClassification | null
  aiConfidence: number | null
  confirmedClassification: CandidateResponseClassification | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
}

export interface OutreachMessageEntry {
  id: string
  channel: CommunicationChannel
  status: OutreachMessageStatus
  subject: string | null
  draftBody: string
  personalizationEvidence: OutreachEvidenceItem[]
  generatedBy: OutreachMessageGeneratedBy
  editedByHuman: boolean
  senderAccountIdentifier: string | null
  sentAt: string | null
  failureReason: string | null
  createdAt: string
  approvals: OutreachApprovalEntry[]
  events: OutreachCommunicationEventEntry[]
  responses: OutreachResponseEntry[]
}

export interface OutreachContactPointEntry {
  id: string
  type: string
  value: string
  isPrimary: boolean
  verified: boolean
}

export interface OutreachSequenceDetail {
  id: string
  organizationId: string
  status: OutreachSequenceStatus
  candidateId: string
  candidateName: string
  candidateRoleMatchId: string
  recruitmentProjectId: string
  jobId: string
  jobTitle: string
  startedAt: string
  cancelledAt: string | null
  cancelReason: string | null
  messages: OutreachMessageEntry[]
  contactPoints: OutreachContactPointEntry[]
  communicationPreferences: Partial<Record<CommunicationChannel, CommunicationPreferenceStatus>>
}

export async function loadOutreachSequenceDetail(
  organizationId: string,
  sequenceId: string,
): Promise<OutreachSequenceDetail | null> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return null

  const { data: sequence } = await supabase
    .from('outreach_sequences')
    .select(
      'id, organization_id, status, candidate_id, job_id, candidate_role_match_id, recruitment_project_id, started_at, cancelled_at, cancel_reason',
    )
    .eq('id', sequenceId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!sequence) return null

  const [
    { data: candidate },
    { data: job },
    { data: messages },
    { data: contactPoints },
    { data: preferences },
  ] = await Promise.all([
    supabase.from('candidates').select('full_name').eq('id', sequence.candidate_id).maybeSingle(),
    supabase.from('jobs').select('title').eq('id', sequence.job_id).maybeSingle(),
    supabase
      .from('outreach_messages')
      .select(
        'id, channel, status, subject, draft_body, personalization_evidence, generated_by, edited_by_human, sender_account_identifier, sent_at, failure_reason, created_at',
      )
      .eq('outreach_sequence_id', sequenceId)
      .order('created_at', { ascending: false }),
    supabase
      .from('candidate_contact_points')
      .select('id, type, value, is_primary, verified')
      .eq('candidate_id', sequence.candidate_id)
      .eq('organization_id', organizationId),
    supabase
      .from('communication_preferences')
      .select('channel, status')
      .eq('candidate_id', sequence.candidate_id)
      .eq('organization_id', organizationId),
  ])

  const messageIds = (messages ?? []).map((m) => m.id)

  const [{ data: approvals }, { data: events }, { data: responses }] =
    messageIds.length > 0
      ? await Promise.all([
          supabase
            .from('outreach_approvals')
            .select(
              'id, outreach_message_id, approver_id, decision, reason, edited_before_approval, created_at',
            )
            .in('outreach_message_id', messageIds)
            .order('created_at', { ascending: false }),
          supabase
            .from('communication_events')
            .select('id, outreach_message_id, direction, event_type, provider, occurred_at')
            .in('outreach_message_id', messageIds)
            .order('occurred_at', { ascending: false }),
          supabase
            .from('candidate_responses')
            .select(
              'id, outreach_message_id, channel, raw_response_text, received_at, ai_suggested_classification, ai_confidence, confirmed_classification, reviewed_by, reviewed_at, review_note',
            )
            .in('outreach_message_id', messageIds)
            .order('received_at', { ascending: false }),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }]

  const approvalsByMessage = new Map<string, OutreachApprovalEntry[]>()
  for (const row of approvals ?? []) {
    const list = approvalsByMessage.get(row.outreach_message_id) ?? []
    list.push({
      id: row.id,
      approverId: row.approver_id,
      decision: row.decision,
      reason: row.reason,
      editedBeforeApproval: row.edited_before_approval,
      createdAt: row.created_at,
    })
    approvalsByMessage.set(row.outreach_message_id, list)
  }

  const eventsByMessage = new Map<string, OutreachCommunicationEventEntry[]>()
  for (const row of events ?? []) {
    const list = eventsByMessage.get(row.outreach_message_id) ?? []
    list.push({
      id: row.id,
      direction: row.direction,
      eventType: row.event_type,
      provider: row.provider,
      occurredAt: row.occurred_at,
    })
    eventsByMessage.set(row.outreach_message_id, list)
  }

  const responsesByMessage = new Map<string, OutreachResponseEntry[]>()
  for (const row of responses ?? []) {
    if (!row.outreach_message_id) continue
    const list = responsesByMessage.get(row.outreach_message_id) ?? []
    list.push({
      id: row.id,
      channel: row.channel,
      rawResponseText: row.raw_response_text,
      receivedAt: row.received_at,
      aiSuggestedClassification: row.ai_suggested_classification,
      aiConfidence: row.ai_confidence,
      confirmedClassification: row.confirmed_classification,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
    })
    responsesByMessage.set(row.outreach_message_id, list)
  }

  const messageEntries: OutreachMessageEntry[] = (messages ?? []).map((row) => ({
    id: row.id,
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    draftBody: row.draft_body,
    personalizationEvidence: (row.personalization_evidence as OutreachEvidenceItem[] | null) ?? [],
    generatedBy: row.generated_by,
    editedByHuman: row.edited_by_human,
    senderAccountIdentifier: row.sender_account_identifier,
    sentAt: row.sent_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    approvals: approvalsByMessage.get(row.id) ?? [],
    events: eventsByMessage.get(row.id) ?? [],
    responses: responsesByMessage.get(row.id) ?? [],
  }))

  const communicationPreferences: Partial<
    Record<CommunicationChannel, CommunicationPreferenceStatus>
  > = {}
  for (const row of preferences ?? []) {
    communicationPreferences[row.channel as CommunicationChannel] = row.status
  }

  return {
    id: sequence.id,
    organizationId: sequence.organization_id,
    status: sequence.status,
    candidateId: sequence.candidate_id,
    candidateName: candidate?.full_name ?? 'Unknown candidate',
    candidateRoleMatchId: sequence.candidate_role_match_id,
    recruitmentProjectId: sequence.recruitment_project_id,
    jobId: sequence.job_id,
    jobTitle: job?.title ?? 'Unknown role',
    startedAt: sequence.started_at,
    cancelledAt: sequence.cancelled_at,
    cancelReason: sequence.cancel_reason,
    messages: messageEntries,
    contactPoints: (contactPoints ?? []).map((cp) => ({
      id: cp.id,
      type: cp.type,
      value: cp.value,
      isPrimary: cp.is_primary,
      verified: cp.verified,
    })),
    communicationPreferences,
  }
}

export interface OutreachTemplateOption {
  id: string
  name: string
  channel: CommunicationChannel
}

/** Active org templates, for the draft composer's template picker. */
export async function loadOutreachTemplates(
  organizationId: string,
): Promise<OutreachTemplateOption[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data } = await supabase
    .from('outreach_templates')
    .select('id, name, channel')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, channel: row.channel }))
}
