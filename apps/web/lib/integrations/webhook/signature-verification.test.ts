import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  verifyApolloWebhookSignature,
  verifyGoogleCalendarChannelToken,
  verifyHmacSha256Signature,
  verifyMicrosoftGraphClientState,
} from './signature-verification'

describe('verifyHmacSha256Signature', () => {
  const secret = 'test-secret'
  const body = JSON.stringify({ hello: 'world' })
  const validSignature = createHmac('sha256', secret).update(body, 'utf8').digest('hex')

  it('accepts a correctly computed signature', () => {
    expect(verifyHmacSha256Signature(body, validSignature, secret)).toBe(true)
  })

  it('accepts a correctly computed signature with a provider-style prefix', () => {
    expect(verifyHmacSha256Signature(body, `sha256=${validSignature}`, secret)).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verifyHmacSha256Signature(body + 'x', validSignature, secret)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyHmacSha256Signature(body, null, secret)).toBe(false)
  })

  it('rejects when no secret is configured', () => {
    expect(verifyHmacSha256Signature(body, validSignature, '')).toBe(false)
  })

  it('verifyApolloWebhookSignature delegates to the same HMAC check', () => {
    expect(verifyApolloWebhookSignature(body, validSignature, secret)).toBe(true)
    expect(verifyApolloWebhookSignature(body, 'wrong', secret)).toBe(false)
  })
})

describe('verifyGoogleCalendarChannelToken', () => {
  it('accepts a matching token and rejects a mismatched or missing one', () => {
    expect(verifyGoogleCalendarChannelToken('stored-token', 'stored-token')).toBe(true)
    expect(verifyGoogleCalendarChannelToken('wrong-token', 'stored-token')).toBe(false)
    expect(verifyGoogleCalendarChannelToken(null, 'stored-token')).toBe(false)
  })
})

describe('verifyMicrosoftGraphClientState', () => {
  it('accepts a matching clientState and rejects a mismatched or missing one', () => {
    expect(verifyMicrosoftGraphClientState('state-1', 'state-1')).toBe(true)
    expect(verifyMicrosoftGraphClientState('state-2', 'state-1')).toBe(false)
    expect(verifyMicrosoftGraphClientState(null, 'state-1')).toBe(false)
  })
})
