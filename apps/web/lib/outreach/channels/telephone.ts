import 'server-only'
import type { ChannelAdapter, ChannelSendResult, OutreachMessageForSend } from './types'

/**
 * Telephone is architecture-only in this build. No voice/telephony
 * provider is approved or configured in this environment — docs/11-
 * integration-plan.md §11.5 covers email/SMS/calendars but names no phone
 * provider at all, and no [CLIENT CONFIRM] decision exists for one either
 * (§11.5's SMS entry is the closest analogue: "needs a provider decision
 * [CLIENT CONFIRM] since none is currently in the approved technology
 * stack" — telephone is in the same unresolved state, one level further
 * back since it is not even named as a stack candidate). Per project
 * instructions ("Never claim an external integration works until it has
 * been configured and tested" / "Stop and report blockers when required
 * credentials, business decisions or source data are missing"), this
 * module implements only the typed shape consistent with the other
 * adapters and a `not_configured` result — it invents no provider name and
 * no fake configuration flag.
 *
 * The channel remains fully usable manually (brief §11.6: "the
 * corresponding workflow must still function manually" when an
 * integration is blocked) — a recruiter can still log a phone call's
 * outcome as a communication_events row via the same manual-record pattern
 * used for LinkedIn (lib/outreach/channels/linkedin.ts); this file only
 * covers the automated-adapter shape, which the next wave's UI should
 * simply not offer as a "send" action for this channel yet.
 */
class TelephoneNotConfiguredAdapter implements ChannelAdapter {
  readonly channel = 'phone' as const
  readonly provider = 'none'

  async send(_message: OutreachMessageForSend): Promise<ChannelSendResult> {
    return {
      status: 'not_configured',
      provider: this.provider,
      errorMessage:
        'No telephony provider is configured or approved for this environment (docs/11-integration-plan.md §11.5). Log phone outreach manually instead.',
    }
  }
}

export function getTelephoneChannelAdapter(): ChannelAdapter {
  return new TelephoneNotConfiguredAdapter()
}
