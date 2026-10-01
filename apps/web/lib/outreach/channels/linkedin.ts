import 'server-only'

/**
 * LinkedIn is explicitly NOT an automated-sending channel (docs/11-
 * integration-plan.md §11.3, docs/09-ai-architecture.md, and the
 * CommunicationChannel comment in @rqi/types: "LinkedIn is always a manual
 * recruiter workflow — never automated sending, regardless of this type
 * existing as a channel value"). Project instructions are explicit: "Do
 * not automate LinkedIn in a way that violates its platform rules."
 *
 * This module is therefore structurally different from lib/outreach/
 * channels/email.ts: it exports NO `send()` method and NO `ChannelAdapter`
 * implementation of any kind, so nothing in this codebase can accidentally
 * wire a LinkedIn message into a real "send" path the way it could for
 * email. What it does provide is support for the parts of the LinkedIn
 * workflow that genuinely are this platform's job:
 *
 *   1. Draft generation — reuses Task A's channel-agnostic AI draft
 *      provider (lib/ai/outreach-draft-provider.ts /
 *      run-outreach-draft-generation.ts) with channel: 'linkedin'; no
 *      separate LinkedIn-specific drafting code is needed or provided here.
 *   2. A trivial "copy this text" helper — this is really a UI concern
 *      (a copy-to-clipboard button), stubbed here only as a small pure
 *      type/function so the next wave's UI has one canonical place to get
 *      the exact string a recruiter should paste into LinkedIn.
 *   3. Typed helpers for recording what a human did MANUALLY, OUTSIDE this
 *      platform, after they used the copied draft — next wave's server
 *      actions call these to build the communication_events / candidate_
 *      responses rows; this module does no DB I/O itself.
 */

export interface LinkedInCopyableMessage {
  /** The exact text to copy — no subject line concept for LinkedIn (draftBody.subject is always null for this channel per outreach-draft-prompt.ts rule 5). */
  text: string
}

/** Pure formatting — trims the draft body to what a recruiter should paste. No network/DB I/O, no "send" of any kind. */
export function getLinkedInCopyableMessage(draftBody: string): LinkedInCopyableMessage {
  return { text: draftBody.trim() }
}

/**
 * What the next wave's "mark manually sent" server action needs to record
 * a communication_events row (direction: 'outbound', event_type: 'sent',
 * provider: 'linkedin_manual') reflecting a human's manual LinkedIn action
 * taken outside the platform. This module only shapes the input; the
 * server action performs the actual insert.
 */
export interface LinkedInManualSendRecord {
  outreachMessageId: string
  candidateId: string
  recruitmentProjectId: string
  organizationId: string
  /** The recruiter who performed the manual send, for audit attribution (outreach.sent audit action). */
  recordedByUserId: string
  /** When the recruiter says they actually sent it — may differ from when this was recorded in the platform. */
  occurredAt: string
  note: string | null
}

export function buildLinkedInManualSendRecord(params: {
  outreachMessageId: string
  candidateId: string
  recruitmentProjectId: string
  organizationId: string
  recordedByUserId: string
  occurredAt?: string
  note?: string | null
}): LinkedInManualSendRecord {
  return {
    outreachMessageId: params.outreachMessageId,
    candidateId: params.candidateId,
    recruitmentProjectId: params.recruitmentProjectId,
    organizationId: params.organizationId,
    recordedByUserId: params.recordedByUserId,
    occurredAt: params.occurredAt ?? new Date().toISOString(),
    note: params.note ?? null,
  }
}

/**
 * What the next wave's "record response manually" server action needs to
 * build a candidate_responses row for a reply a recruiter read on LinkedIn
 * and is transcribing into the platform. rawResponseText, once transcribed
 * here, is UNTRUSTED candidate-authored text exactly like any other
 * candidate_responses row (docs/10-ai-evaluation-guardrails.md) — the fact
 * a human typed it in on the candidate's behalf does not change that; it
 * still must never be treated as instructions by any AI call that later
 * reads it (e.g. lib/ai/run-response-classification.ts).
 */
export interface LinkedInManualResponseRecord {
  outreachMessageId: string | null
  candidateId: string
  recruitmentProjectId: string
  organizationId: string
  recordedByUserId: string
  rawResponseText: string
  receivedAt: string
}

export function buildLinkedInManualResponseRecord(params: {
  outreachMessageId: string | null
  candidateId: string
  recruitmentProjectId: string
  organizationId: string
  recordedByUserId: string
  rawResponseText: string
  receivedAt?: string
}): LinkedInManualResponseRecord {
  return {
    outreachMessageId: params.outreachMessageId,
    candidateId: params.candidateId,
    recruitmentProjectId: params.recruitmentProjectId,
    organizationId: params.organizationId,
    recordedByUserId: params.recordedByUserId,
    rawResponseText: params.rawResponseText,
    receivedAt: params.receivedAt ?? new Date().toISOString(),
  }
}
