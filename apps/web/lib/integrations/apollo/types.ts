/**
 * Apollo — shared types (Build Phase 12 Wave 3, docs/11-integration-plan.md
 * §11.4). Apollo has a real, documented public REST API (contact
 * enrichment) — unlike TA Tracker, this is legitimate to build for real.
 * No API key is configured in this environment (`apolloConfigured` is
 * `false` — see `lib/env.ts`), and account ownership (client-owned vs.
 * agency-owned, docs/18-blocking-questions.md Q-P1-01) is an unresolved
 * business question this module never assumes or defaults, mirroring Wave
 * 1's `account_owner_label` being honestly nullable.
 *
 * Only what a documented, publicly-known Apollo API capability actually
 * covers — contact/company enrichment lookup — is modeled here. No other
 * capability (sequences, dialer, bulk list building, etc.) is invented.
 */

export type ApolloVerificationStatus = 'verified' | 'unverified' | 'unknown'

/**
 * One enriched contact, as returned by this adapter. Every field that came
 * from Apollo is clearly attributed as such via `source`/`dataLicenseNote`
 * at the object level (this type is never merged into the platform's own
 * `candidates`/`candidate_extracted_fields` rows as if self-reported or
 * independently verified — the same evidence-provenance discipline as
 * Phase 5-7's AI-extracted fields). `emailVerified`/`phoneVerified` are
 * preserved AS APOLLO REPORTED THEM — this adapter never upgrades
 * 'unverified' or 'unknown' to look verified, per the project's core
 * "missing information must be marked as unverified" principle.
 */
export interface ApolloEnrichedContact {
  apolloPersonId: string | null
  fullName: string | null
  email: string | null
  emailVerificationStatus: ApolloVerificationStatus
  phone: string | null
  phoneVerificationStatus: ApolloVerificationStatus
  title: string | null
  company: string | null
  linkedinUrl: string | null
  /** Always 'apollo' — an explicit, non-optional provenance marker so a caller can never accidentally treat this as human-verified or AI-extracted data. */
  source: 'apollo'
  fetchedAt: string
  /**
   * Documents that Apollo's contact data comes with usage restrictions
   * (typically: licensed for the querying organization's own use, not for
   * resale/redistribution) — travels WITH the data, not just in a code
   * comment, so any downstream consumer (export, CSV, a future client-
   * facing view) can see and honor the constraint without re-deriving it.
   */
  dataLicenseNote: string
}

export interface ApolloEnrichmentQuery {
  email?: string
  fullName?: string
  company?: string
  linkedinUrl?: string
}

export type ApolloErrorKind =
  'not_configured' | 'rate_limited' | 'invalid_request' | 'provider_error' | 'network'

export class ApolloAdapterError extends Error {
  constructor(
    message: string,
    readonly kind: ApolloErrorKind,
    /** Present only for `rate_limited` — how long to wait before retrying, taken from Apollo's own rate-limit response headers when available. */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ApolloAdapterError'
  }
}

/**
 * Same typed-provider-interface pattern as `lib/ai/matching-provider.ts`'s
 * `MatchingAIProvider` — every implementation (real REST client,
 * not-configured stand-in) satisfies this one shape so callers never
 * branch on which is in use.
 */
export interface ApolloClient {
  readonly provider: 'apollo'
  enrichContact(query: ApolloEnrichmentQuery): Promise<ApolloEnrichedContact>
}

export const APOLLO_DATA_LICENSE_NOTE =
  "Sourced from Apollo.io contact enrichment. Licensed for this organization's own recruiting use only — not for resale, redistribution, or bulk export outside this platform (Apollo API Terms of Service, contact/company enrichment data)."
