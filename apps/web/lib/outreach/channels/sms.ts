import 'server-only'
import type { ChannelAdapter, ChannelSendResult, OutreachMessageForSend } from './types'

/**
 * SMS is architecture-only in this build. docs/11-integration-plan.md
 * §11.5: "SMS needs a provider decision [CLIENT CONFIRM] since none is
 * currently in the approved technology stack." Per project instructions
 * ("Never claim an external integration works until it has been
 * configured and tested" / "Stop and report blockers when required
 * credentials, business decisions or source data are missing"), this
 * module implements only the typed shape consistent with the other
 * adapters and a `not_configured` result — it invents no provider name
 * (e.g. it does not assume Twilio or any other vendor) and no fake
 * configuration flag; env.ts has no SMS-provider key at all, deliberately.
 *
 * The channel remains fully usable manually (brief §11.6: "the
 * corresponding workflow must still function manually" when an
 * integration is blocked) — a recruiter can still copy a drafted SMS body
 * and send it from their own phone, then log it via the same manual-record
 * pattern used for LinkedIn (lib/outreach/channels/linkedin.ts); this file
 * only covers the automated-adapter shape, which the next wave's UI should
 * simply not offer as a "send" action for this channel yet.
 */
class SmsNotConfiguredAdapter implements ChannelAdapter {
  readonly channel = 'sms' as const
  readonly provider = 'none'

  async send(_message: OutreachMessageForSend): Promise<ChannelSendResult> {
    return {
      status: 'not_configured',
      provider: this.provider,
      errorMessage:
        'No SMS provider is configured or approved for this environment — a provider decision is pending client confirmation (docs/11-integration-plan.md §11.5). Send SMS outreach manually instead.',
    }
  }
}

export function getSmsChannelAdapter(): ChannelAdapter {
  return new SmsNotConfiguredAdapter()
}
