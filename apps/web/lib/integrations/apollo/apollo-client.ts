import 'server-only'
import { env, apolloConfigured } from '@/lib/env'
import {
  ApolloAdapterError,
  APOLLO_DATA_LICENSE_NOTE,
  type ApolloClient,
  type ApolloEnrichedContact,
  type ApolloEnrichmentQuery,
  type ApolloVerificationStatus,
} from './types'

/**
 * Real Apollo REST client (Build Phase 12 Wave 3, docs/11-integration-plan.md
 * §11.4). Talks to Apollo's documented public API over `fetch` — no SDK is
 * installed in this repo's dependency tree, and this task's brief scopes
 * new dependencies out, same reasoning as `lib/outreach/channels/email.ts`'s
 * Resend client.
 *
 * Nothing here has been exercised against a live Apollo account in this
 * environment (no `APOLLO_API_KEY` configured) — per project convention,
 * this integration is implemented-but-untested-against-a-live-call, never
 * claimed to work until configured and tested.
 *
 * RATE LIMITING — CONSERVATIVE PLACEHOLDER, NOT A CONFIRMED APOLLO LIMIT:
 * Apollo publishes per-endpoint rate limits that vary by plan and are not
 * confirmed for this account (none exists yet). Rather than invent a
 * specific number, this client enforces a conservative, clearly-labelled
 * minimum spacing between requests (`MIN_REQUEST_INTERVAL_MS`) and treats
 * a 429 response's `Retry-After` (or `x-ratelimit-*` headers, if present)
 * as authoritative over its own placeholder pacing. TUNE
 * `MIN_REQUEST_INTERVAL_MS` DOWN once real API access and a real published
 * limit for this account's plan are known — do not remove the pacing
 * mechanism itself.
 */
const APOLLO_API_BASE_URL = 'https://api.apollo.io/v1'
const REQUEST_TIMEOUT_MS = 15_000
/** Conservative placeholder — see this file's header note. Not a confirmed Apollo rate limit. */
const MIN_REQUEST_INTERVAL_MS = 1_000

/** Module-level pacing state. Apollo API calls in this process are effectively serialized to at most one every `MIN_REQUEST_INTERVAL_MS` — simple and conservative rather than a full token-bucket, since this wave has no real traffic pattern to size one against. */
let lastRequestAt = 0
let pacingChain: Promise<void> = Promise.resolve()

function waitForPacingSlot(): Promise<void> {
  const next = pacingChain.then(async () => {
    const now = Date.now()
    const elapsed = now - lastRequestAt
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed))
    }
    lastRequestAt = Date.now()
  })
  pacingChain = next.catch(() => undefined)
  return next
}

/** Resets the module-level pacing state — test-only, so each test starts unpaced rather than inheriting timing from a previous test. */
export function __resetApolloPacingForTests(): void {
  lastRequestAt = 0
  pacingChain = Promise.resolve()
}

function toVerificationStatus(raw: unknown): ApolloVerificationStatus {
  if (raw === true || raw === 'verified') return 'verified'
  if (raw === false || raw === 'unverified' || raw === 'invalid') return 'unverified'
  return 'unknown'
}

/** Shape this client actually reads off Apollo's documented People Match/Enrich response — deliberately narrow (only the fields this adapter surfaces), everything else in a real response is ignored rather than blindly passed through. */
interface ApolloRawPersonResponse {
  person?: {
    id?: string
    name?: string
    email?: string
    email_status?: string
    phone_numbers?: { raw_number?: string; status?: string }[]
    title?: string
    organization?: { name?: string }
    linkedin_url?: string
  }
}

function mapApolloResponse(raw: ApolloRawPersonResponse): ApolloEnrichedContact {
  const person = raw.person
  const phone = person?.phone_numbers?.[0]
  return {
    apolloPersonId: person?.id ?? null,
    fullName: person?.name ?? null,
    email: person?.email ?? null,
    emailVerificationStatus: toVerificationStatus(person?.email_status),
    phone: phone?.raw_number ?? null,
    phoneVerificationStatus: toVerificationStatus(phone?.status),
    title: person?.title ?? null,
    company: person?.organization?.name ?? null,
    linkedinUrl: person?.linkedin_url ?? null,
    source: 'apollo',
    fetchedAt: new Date().toISOString(),
    dataLicenseNote: APOLLO_DATA_LICENSE_NOTE,
  }
}

class RealApolloClient implements ApolloClient {
  readonly provider = 'apollo' as const

  async enrichContact(query: ApolloEnrichmentQuery): Promise<ApolloEnrichedContact> {
    if (!apolloConfigured) {
      // Defensive re-check — the selector below should never route here
      // when apolloConfigured is false, but this client must never attempt
      // a call with a missing key regardless of how it is reached.
      throw new ApolloAdapterError(
        'Apollo is not configured: no APOLLO_API_KEY is set.',
        'not_configured',
      )
    }

    if (!query.email && !query.fullName && !query.linkedinUrl) {
      throw new ApolloAdapterError(
        'At least one of email, fullName, or linkedinUrl is required to enrich a contact.',
        'invalid_request',
      )
    }

    await waitForPacingSlot()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${APOLLO_API_BASE_URL}/people/match`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': env.APOLLO_API_KEY ?? '',
        },
        body: JSON.stringify({
          email: query.email,
          name: query.fullName,
          organization_name: query.company,
          linkedin_url: query.linkedinUrl,
        }),
      })

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after')
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined
        throw new ApolloAdapterError('Apollo rate limit exceeded.', 'rate_limited', retryAfterMs)
      }

      if (response.status === 400 || response.status === 422) {
        throw new ApolloAdapterError(
          `Apollo rejected the enrichment request (HTTP ${response.status}).`,
          'invalid_request',
        )
      }

      if (!response.ok) {
        throw new ApolloAdapterError(
          `Apollo API returned HTTP ${response.status}.`,
          'provider_error',
        )
      }

      const body = (await response.json()) as ApolloRawPersonResponse
      return mapApolloResponse(body)
    } catch (error) {
      if (error instanceof ApolloAdapterError) throw error
      const isAbort = error instanceof Error && error.name === 'AbortError'
      throw new ApolloAdapterError(
        isAbort ? 'Apollo request timed out.' : 'Could not reach the Apollo API.',
        'network',
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}

export { RealApolloClient }
