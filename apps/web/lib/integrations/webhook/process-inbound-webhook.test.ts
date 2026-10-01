import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { processInboundWebhook } from './process-inbound-webhook'
import {
  verifyApolloWebhookSignature,
  verifyGoogleCalendarChannelToken,
  verifyMicrosoftGraphClientState,
} from './signature-verification'

/**
 * Small, purpose-built fake Supabase client for this test file only —
 * the shared `createFakeSupabase` (Build Phase 11) has no concept of a
 * unique-constraint violation, and simulating that is the entire point of
 * these dedup tests, so a bespoke fake (mirroring that file's own
 * "in-memory fake of the subset actually called" convention) is more
 * honest than stretching the shared one to do something it was never
 * built for.
 */
function createFakeWebhookSupabase() {
  const rows: Record<string, unknown>[] = []
  let idCounter = 0

  const client = {
    from: (table: string) => {
      if (table !== 'webhook_events') throw new Error(`unexpected table: ${table}`)
      return {
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const duplicate =
                payload.external_event_id != null &&
                rows.some(
                  (r) =>
                    r.provider === payload.provider &&
                    r.external_event_id === payload.external_event_id,
                )
              if (duplicate) {
                return {
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint',
                  },
                }
              }
              idCounter += 1
              const row = { id: `webhook-event-${idCounter}`, ...payload }
              rows.push(row)
              return { data: row, error: null }
            },
          }),
        }),
      }
    },
  }

  return { client: client as unknown as SupabaseClient, rows }
}

describe('processInboundWebhook', () => {
  it('records a valid, non-duplicate webhook as received', async () => {
    const { client, rows } = createFakeWebhookSupabase()

    const result = await processInboundWebhook({
      provider: 'apollo',
      rawBody: JSON.stringify({ event: 'contact.updated' }),
      signatureHeader: 'sha256=abc',
      signatureValid: true,
      externalEventId: 'evt-1',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(result).toEqual({ status: 'received', webhookEventId: 'webhook-event-1' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.processing_status).toBe('received')
    expect(rows[0]!.signature_valid).toBe(true)
  })

  it('rejects a webhook with an invalid signature and records the row anyway', async () => {
    const { client, rows } = createFakeWebhookSupabase()

    const result = await processInboundWebhook({
      provider: 'apollo',
      rawBody: '{}',
      signatureHeader: 'sha256=bad',
      signatureValid: false,
      externalEventId: 'evt-2',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(result).toEqual({ status: 'rejected_invalid_signature' })
    expect(rows[0]!.processing_status).toBe('rejected_invalid_signature')
  })

  it('reports duplicate_ignored on a real (provider, external_event_id) unique-constraint violation', async () => {
    const { client } = createFakeWebhookSupabase()

    const first = await processInboundWebhook({
      provider: 'google_calendar',
      rawBody: '{}',
      signatureHeader: null,
      signatureValid: true,
      externalEventId: 'evt-dup',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })
    expect(first.status).toBe('received')

    const second = await processInboundWebhook({
      provider: 'google_calendar',
      rawBody: '{}',
      signatureHeader: null,
      signatureValid: true,
      externalEventId: 'evt-dup',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })
    expect(second).toEqual({ status: 'duplicate_ignored' })
  })

  it("the null-external_event_id case: two events with NO external_event_id are both recorded as received, never false-positively treated as duplicates of each other (mirrors pgverify TEST18b's SQL-level proof that nulls are excluded from the unique index)", async () => {
    const { client, rows } = createFakeWebhookSupabase()

    const first = await processInboundWebhook({
      provider: 'apollo',
      rawBody: '{"a":1}',
      signatureHeader: null,
      signatureValid: true,
      externalEventId: null,
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })
    const second = await processInboundWebhook({
      provider: 'apollo',
      rawBody: '{"a":2}',
      signatureHeader: null,
      signatureValid: true,
      externalEventId: null,
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(first.status).toBe('received')
    expect(second.status).toBe('received')
    expect(rows).toHaveLength(2)
  })

  it('stores an unparseable raw body as an inert wrapper rather than throwing', async () => {
    const { client, rows } = createFakeWebhookSupabase()

    const result = await processInboundWebhook({
      provider: 'microsoft_calendar',
      rawBody: 'not json at all {{{',
      signatureHeader: null,
      signatureValid: true,
      externalEventId: null,
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(result.status).toBe('received')
    expect(rows[0]!.raw_payload).toEqual({ _unparsed_raw_body: 'not json at all {{{' })
  })
})

/**
 * Build Phase 12, Wave 6 addition — end-to-end coverage combining the real
 * signature-verification functions (`signature-verification.ts`) with
 * `processInboundWebhook`, for each of the 3 documented schemes, with a
 * DELIBERATELY TAMPERED signature for each — the brief's item 3 explicitly
 * asks for this combination, not just each half tested in isolation
 * (`signature-verification.test.ts` covers the pure verification functions
 * alone; this covers the same tampered inputs flowing all the way through
 * to the stored `webhook_events` row).
 */
describe('processInboundWebhook — invalid signatures, driven through the real per-provider verification schemes', () => {
  it('generic HMAC (Apollo-style): a tampered body against the original signature is rejected, and the payload is still recorded for audit but never as processed', async () => {
    const secret = 'apollo-shared-secret'
    const originalBody = JSON.stringify({ event: 'contact.updated' })
    const validSignature = createHmac('sha256', secret).update(originalBody, 'utf8').digest('hex')
    const tamperedBody = originalBody.replace('contact.updated', 'contact.deleted')

    const signatureValid = verifyApolloWebhookSignature(tamperedBody, validSignature, secret)
    expect(signatureValid).toBe(false)

    const { client, rows } = createFakeWebhookSupabase()
    const result = await processInboundWebhook({
      provider: 'apollo',
      rawBody: tamperedBody,
      signatureHeader: validSignature,
      signatureValid,
      externalEventId: 'evt-tampered-1',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(result).toEqual({ status: 'rejected_invalid_signature' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.processing_status).toBe('rejected_invalid_signature')
    expect(rows[0]!.signature_valid).toBe(false)
    // The raw (tampered) payload is still stored for audit — never dropped.
    expect(rows[0]!.raw_payload).toEqual({ event: 'contact.deleted' })
  })

  it('Google Calendar channel-token: a wrong token is rejected, and the row is stored but never marked processed', async () => {
    const storedToken = 'watch-channel-token-abc123'
    const signatureValid = verifyGoogleCalendarChannelToken('attacker-guessed-token', storedToken)
    expect(signatureValid).toBe(false)

    const { client, rows } = createFakeWebhookSupabase()
    const result = await processInboundWebhook({
      provider: 'google_calendar',
      rawBody: '{"resourceState":"exists"}',
      signatureHeader: 'attacker-guessed-token',
      signatureValid,
      externalEventId: 'evt-google-1',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(result).toEqual({ status: 'rejected_invalid_signature' })
    expect(rows[0]!.processing_status).toBe('rejected_invalid_signature')
  })

  it('Microsoft Graph clientState: a wrong clientState is rejected, and the row is stored but never marked processed', async () => {
    const storedClientState = 'subscription-secret-xyz'
    const signatureValid = verifyMicrosoftGraphClientState('wrong-client-state', storedClientState)
    expect(signatureValid).toBe(false)

    const { client, rows } = createFakeWebhookSupabase()
    const result = await processInboundWebhook({
      provider: 'microsoft_calendar',
      rawBody: '{"changeType":"updated"}',
      signatureHeader: 'wrong-client-state',
      signatureValid,
      externalEventId: 'evt-msft-1',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(result).toEqual({ status: 'rejected_invalid_signature' })
    expect(rows[0]!.processing_status).toBe('rejected_invalid_signature')
  })

  it('a CORRECT signature for each scheme is accepted end-to-end (positive control, so the negative cases above are meaningful)', async () => {
    const secret = 'apollo-shared-secret'
    const body = JSON.stringify({ event: 'contact.updated' })
    const validSignature = createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    const { client, rows } = createFakeWebhookSupabase()
    const result = await processInboundWebhook({
      provider: 'apollo',
      rawBody: body,
      signatureHeader: validSignature,
      signatureValid: verifyApolloWebhookSignature(body, validSignature, secret),
      externalEventId: 'evt-valid-1',
      organizationId: null,
      relatedJobId: null,
      supabase: client,
    })

    expect(result.status).toBe('received')
    expect(rows[0]!.processing_status).toBe('received')
  })
})
