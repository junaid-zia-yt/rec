import type { IntegrationConnectionStatus } from '@rqi/types'

/** SMS's `integration_connections` shape (Build Phase 12 Wave 3) — deliberately narrow, mirroring `lib/outreach/channels/sms.ts`'s own scope. `mode` has no meaning for SMS (0032's `integration_connections_mode_only_for_ta_tracker` CHECK — mode is null for every provider except ta_tracker), so this type carries no mode field at all. */
export interface SmsIntegrationStatus {
  provider: 'sms'
  status: IntegrationConnectionStatus
  reason: string
}
