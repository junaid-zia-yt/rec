import 'server-only'
import { apolloConfigured } from '@/lib/env'
import {
  ApolloAdapterError,
  type ApolloClient,
  type ApolloEnrichedContact,
  type ApolloEnrichmentQuery,
} from './types'
import { RealApolloClient } from './apollo-client'

/**
 * Not-configured stand-in — deliberately NOT a simulated-success adapter
 * like `lib/outreach/channels/email.ts`'s `DevelopmentEmailAdapter`.
 * Apollo enrichment produces candidate-facing data (a phone number, an
 * email, a verification status); fabricating a plausible-looking contact
 * here would directly violate the project's core rule "AI must never
 * invent candidate qualifications or evidence" — a third-party enrichment
 * source is exactly the same trust boundary. So when Apollo is not
 * configured, this adapter always throws a typed `not_configured` error
 * rather than returning anything that could be mistaken for real data.
 */
class NotConfiguredApolloClient implements ApolloClient {
  readonly provider = 'apollo' as const

  async enrichContact(_query: ApolloEnrichmentQuery): Promise<ApolloEnrichedContact> {
    throw new ApolloAdapterError(
      'Apollo is not configured for this organization: no APOLLO_API_KEY is set, and account ownership (client-owned vs. agency-owned, docs/18-blocking-questions.md Q-P1-01) is unresolved. Contact enrichment is unavailable.',
      'not_configured',
    )
  }
}

/**
 * Selector — the ONLY thing a later wave's server action or job handler
 * should call, never a concrete class directly. Constructed fresh per call
 * (cheap, stateless) so a runtime env change is picked up on the next
 * call, mirroring `getEmailChannelAdapter`'s convention exactly.
 */
export function getApolloClient(): ApolloClient {
  return apolloConfigured ? new RealApolloClient() : new NotConfiguredApolloClient()
}
