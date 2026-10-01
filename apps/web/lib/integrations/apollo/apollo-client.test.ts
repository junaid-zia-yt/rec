import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApolloAdapterError } from './types'
import { RealApolloClient, __resetApolloPacingForTests } from './apollo-client'

/**
 * Build Phase 12, Wave 6 — `apollo-client.ts` (the REAL Apollo REST client)
 * had no dedicated test file before this wave; only the not-configured dev
 * adapter (`apollo-dev-adapter.test.ts`) was covered. This file drives the
 * real client's `fetch`-based error paths directly, confirming each of the
 * brief's four "provider failure" kinds — rate_limited, invalid_request,
 * provider_error, network — is distinguishable and never silently
 * swallowed, per the brief's Task A item 1.
 *
 * `apolloConfigured` (`lib/env.ts`) is `false` in this environment (no
 * `APOLLO_API_KEY` set) — `RealApolloClient` itself defensively refuses to
 * even attempt a call in that case (see that file's own `not_configured`
 * re-check). To exercise the real fetch-driven paths at all, this file
 * mocks `@/lib/env` to report Apollo as configured with a fake key, and
 * mocks `global.fetch` for each scenario — never a real network call.
 */

vi.mock('@/lib/env', () => ({
  env: { APOLLO_API_KEY: 'test-apollo-key' },
  apolloConfigured: true,
}))

describe('RealApolloClient — provider failure paths (mocked fetch, Apollo reported as configured)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function getClient() {
    __resetApolloPacingForTests()
    return new RealApolloClient()
  }

  it('rate_limited: a 429 response is mapped to kind "rate_limited" with retryAfterMs from the Retry-After header', async () => {
    fetchMock.mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({ 'retry-after': '30' }),
      json: async () => ({}),
    })

    const client = await getClient()
    await expect(client.enrichContact({ email: 'a@example.com' })).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 30_000,
    })
  })

  it('invalid_request: a 400 response is mapped to kind "invalid_request"', async () => {
    fetchMock.mockResolvedValue({
      status: 400,
      ok: false,
      headers: new Headers(),
      json: async () => ({}),
    })
    const client = await getClient()
    await expect(client.enrichContact({ email: 'a@example.com' })).rejects.toMatchObject({
      kind: 'invalid_request',
    })
  })

  it('invalid_request: a 422 response is also mapped to kind "invalid_request"', async () => {
    fetchMock.mockResolvedValue({
      status: 422,
      ok: false,
      headers: new Headers(),
      json: async () => ({}),
    })
    const client = await getClient()
    await expect(client.enrichContact({ email: 'a@example.com' })).rejects.toMatchObject({
      kind: 'invalid_request',
    })
  })

  it('provider_error: any other non-ok status (e.g. 500) is mapped to kind "provider_error", distinct from invalid_request/rate_limited', async () => {
    fetchMock.mockResolvedValue({
      status: 500,
      ok: false,
      headers: new Headers(),
      json: async () => ({}),
    })
    const client = await getClient()
    await expect(client.enrichContact({ email: 'a@example.com' })).rejects.toMatchObject({
      kind: 'provider_error',
    })
  })

  it('network: fetch itself rejecting (DNS failure, connection refused, etc.) is mapped to kind "network", never left as a raw/opaque error', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.apollo.io'))
    const client = await getClient()
    await expect(client.enrichContact({ email: 'a@example.com' })).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('network: an AbortError (request timeout) is ALSO mapped to kind "network", with a distinguishing message, never confused with a generic network failure', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    fetchMock.mockRejectedValue(abortError)
    const client = await getClient()
    try {
      await client.enrichContact({ email: 'a@example.com' })
      throw new Error('expected enrichContact to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ApolloAdapterError)
      expect((error as InstanceType<typeof ApolloAdapterError>).kind).toBe('network')
      expect((error as Error).message).toContain('timed out')
    }
  })

  it('every one of the four failure kinds is a genuine ApolloAdapterError instance, never a bare/untyped throw', async () => {
    fetchMock.mockResolvedValue({
      status: 500,
      ok: false,
      headers: new Headers(),
      json: async () => ({}),
    })
    const client = await getClient()
    try {
      await client.enrichContact({ email: 'a@example.com' })
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ApolloAdapterError)
    }
  })

  it('a successful (200 ok) response is mapped to a real enriched contact, never left as a raw/untyped payload', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: async () => ({
        person: {
          id: 'apollo-1',
          name: 'Jamie Rivera',
          email: 'jamie@example.com',
          email_status: 'verified',
          title: 'Store Manager',
          organization: { name: 'Acme Retail' },
        },
      }),
    })
    const client = await getClient()
    const result = await client.enrichContact({ email: 'jamie@example.com' })
    expect(result.source).toBe('apollo')
    expect(result.email).toBe('jamie@example.com')
    expect(result.emailVerificationStatus).toBe('verified')
    expect(result.dataLicenseNote.length).toBeGreaterThan(0)
  })

  it('rejects an empty query (no email/fullName/linkedinUrl) with invalid_request BEFORE ever calling fetch', async () => {
    const client = await getClient()
    await expect(client.enrichContact({})).rejects.toMatchObject({ kind: 'invalid_request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
