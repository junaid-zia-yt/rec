import 'server-only'
import { getSmsChannelAdapter } from '@/lib/outreach/channels/sms'
import type { ChannelAdapter } from '@/lib/outreach/channels/types'
import type { SmsIntegrationStatus } from './types'

/**
 * SMS — architecture-only, mirroring `apps/web/lib/outreach/channels/
 * sms.ts` EXACTLY (Build Phase 12 Wave 3 brief: "This phase's job for SMS
 * is just making sure the new integration_connections/job-engine plumbing
 * can represent 'SMS: not configured, no provider chosen' consistently
 * with the other adapters, not adding new capability."). This file is a
 * thin wrapper, not a rebuild: it re-exports the same not-configured
 * channel adapter Phase 9 already built, and adds only the one small
 * `integration_connections`-shaped view that the `integration_sync` job
 * handler and a future Integrations screen need.
 *
 * No provider is chosen (docs/18-blocking-questions.md Q-P1-03,
 * "Recommended default: defer SMS past the POC") — this module invents no
 * vendor name (e.g. it never assumes Twilio) and no fake configuration
 * flag, exactly like `sms.ts` itself.
 */

/** Re-exported unchanged — the SAME not-configured `ChannelAdapter` Phase 9 built; this module does not wrap or alter its behavior. */
export function getSmsChannelIntegrationAdapter(): ChannelAdapter {
  return getSmsChannelAdapter()
}

/** The `integration_connections` (0032)-shaped view of SMS's status — always the same, honest, unconfigured result; no branch here could ever report otherwise until a real provider decision is made (docs/18-blocking-questions.md Q-P1-03). */
export function getSmsIntegrationStatus(): SmsIntegrationStatus {
  return {
    provider: 'sms',
    status: 'not_connected',
    reason:
      'No SMS provider is configured or approved for this environment — a provider decision is pending client confirmation (docs/11-integration-plan.md §11.5, docs/18-blocking-questions.md Q-P1-03).',
  }
}
