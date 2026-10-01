/**
 * Shared typed contract every outreach channel adapter implements (Task C).
 * Mirrors the *ProviderError-style typed-error convention used by the AI
 * provider layer (lib/ai/matching-provider.ts's MatchingAIProviderError) —
 * a channel adapter never throws for an expected failure mode; it returns
 * a discriminated ChannelSendResult instead, so callers never need a
 * try/catch around a send() call to handle "not configured" or "provider
 * rejected it" as ordinary control flow.
 */

import type { CommunicationChannel } from '@rqi/types'

/** The minimal set of fields any channel adapter's send() needs from an outreach_messages row — never the full row, so an adapter cannot accidentally depend on fields outside its concern. */
export interface OutreachMessageForSend {
  id: string
  organizationId: string
  channel: CommunicationChannel
  subject: string | null
  body: string
  /** The message's outreach_messages.idempotency_key, set by the caller BEFORE calling send() (lib/outreach/idempotency.ts) — an adapter that supports provider-level idempotency uses this value as-is, never generating its own. */
  idempotencyKey: string | null
  senderUserId: string | null
  senderAccountIdentifier: string | null
  recipientAddress: string
  recipientDisplayName: string | null
}

export interface ChannelSendSuccess {
  status: 'sent'
  /** True only for the clearly-labelled development/no-op adapter path — never true for a real provider call, so a caller can never mistake a simulated send for a real one (see lib/outreach/channels/email.ts). */
  simulated: boolean
  providerMessageId: string | null
  provider: string
  sentAt: string
}

export interface ChannelSendFailure {
  status: 'failed'
  provider: string
  /** Whether retrying the exact same attempt (same idempotency key) is expected to help — e.g. false for a permanently invalid recipient address, true for a transient network error. */
  retryable: boolean
  errorMessage: string
}

export interface ChannelSendNotConfigured {
  status: 'not_configured'
  provider: string
  errorMessage: string
}

export type ChannelSendResult = ChannelSendSuccess | ChannelSendFailure | ChannelSendNotConfigured

/** One channel adapter. Deliberately does NOT include anything about drafting, approval or opt-out — those are enforced upstream (AI drafting layer, DB triggers, lib/outreach/opt-out.ts) before a message ever reaches an adapter's send(). */
export interface ChannelAdapter {
  readonly channel: CommunicationChannel
  readonly provider: string
  send(message: OutreachMessageForSend): Promise<ChannelSendResult>
}
