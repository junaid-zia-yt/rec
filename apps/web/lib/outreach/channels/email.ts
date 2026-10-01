import 'server-only'
import { demoModeEnabled, env, resendConfigured } from '@/lib/env'
import type { ChannelAdapter, ChannelSendResult, OutreachMessageForSend } from './types'

/**
 * Real Resend-backed email adapter. Talks to Resend's REST API directly
 * over `fetch` rather than the `resend` npm SDK, because that package is
 * not installed in this repo's dependency tree (grep node_modules — it
 * isn't there) and this task's brief forbids adding new dependencies
 * outside the vertical slice it describes; Resend's REST API is documented
 * and stable, so this is a correct, real implementation, not a
 * workaround. Nothing here has been exercised against a live Resend
 * account in this environment (no `RESEND_API_KEY` configured) — per
 * project convention, this integration is implemented-but-untested-
 * against-a-live-call, never claimed to work until configured and tested
 * (docs/11-integration-plan.md §11.5/§11.6).
 *
 * The client/API key is read and any network call is made lazily, inside
 * send() — never at module load — so importing this file never assumes a
 * valid key exists.
 */
const RESEND_API_URL = 'https://api.resend.com/emails'
const REQUEST_TIMEOUT_MS = 20_000

class ResendEmailAdapter implements ChannelAdapter {
  readonly channel = 'email' as const
  readonly provider = 'resend'

  async send(message: OutreachMessageForSend): Promise<ChannelSendResult> {
    if (!resendConfigured || demoModeEnabled) {
      // Defensive re-check — the selector below should never route here
      // when resendConfigured is false or demo mode is on, but this
      // adapter must never attempt a call with a missing key or during a
      // demo regardless of how it is reached.
      return {
        status: 'not_configured',
        provider: this.provider,
        errorMessage: demoModeEnabled
          ? 'Outreach sending is disabled in this demo — no message was sent.'
          : 'Resend is not configured: no RESEND_API_KEY is set.',
      }
    }

    if (message.channel !== 'email') {
      return {
        status: 'failed',
        provider: this.provider,
        retryable: false,
        errorMessage: `ResendEmailAdapter received a non-email message (channel=${message.channel}).`,
      }
    }

    // Sender identity must be validated against sender_account_identifier
    // (Build Phase 9 brief functional requirement #7: "Record sender
    // account ownership") — this adapter refuses to send with no sender
    // identity recorded rather than silently falling back to some default
    // "from" address the recruiter never chose.
    if (!message.senderAccountIdentifier) {
      return {
        status: 'failed',
        provider: this.provider,
        retryable: false,
        errorMessage:
          'No sender_account_identifier recorded on this message — refusing to send without a verified sender identity.',
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      }
      // Resend's REST API supports an Idempotency-Key header on POST
      // /emails (deduplicates a retried request with the same key for a
      // short window). Passed through only when this message already has
      // one — an adapter never invents its own key (lib/outreach/
      // idempotency.ts is the sole generator).
      if (message.idempotencyKey) {
        headers['Idempotency-Key'] = message.idempotencyKey
      }

      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          from: message.senderAccountIdentifier,
          to: [message.recipientAddress],
          subject: message.subject ?? '(no subject)',
          text: message.body,
        }),
      })

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        let errorMessage = `Resend API returned HTTP ${response.status}`
        try {
          const body = (await response.json()) as { message?: string }
          if (body?.message) errorMessage = body.message
        } catch {
          // Response body wasn't JSON — keep the status-code message.
        }
        return { status: 'failed', provider: this.provider, retryable, errorMessage }
      }

      const body = (await response.json()) as { id?: string }
      return {
        status: 'sent',
        simulated: false,
        providerMessageId: body.id ?? null,
        provider: this.provider,
        sentAt: new Date().toISOString(),
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      return {
        status: 'failed',
        provider: this.provider,
        retryable: true,
        errorMessage: isAbort ? 'Resend request timed out.' : 'Could not reach the Resend API.',
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * Clearly-labelled development/no-op adapter used whenever `resendConfigured`
 * is false. Never silently indistinguishable from a real send — its result
 * always carries `simulated: true`, and it logs (server-side only) what it
 * would have sent, without any network call.
 */
class DevelopmentEmailAdapter implements ChannelAdapter {
  readonly channel = 'email' as const
  readonly provider = 'development-noop'

  async send(message: OutreachMessageForSend): Promise<ChannelSendResult> {
    console.log(
      `[outreach:email:simulated] to=${message.recipientAddress} subject=${message.subject ?? '(none)'} body.length=${message.body.length}`,
    )
    return {
      status: 'sent',
      simulated: true,
      providerMessageId: null,
      provider: this.provider,
      sentAt: new Date().toISOString(),
    }
  }
}

/**
 * Selector — the ONLY thing next-wave server actions should call, never a
 * concrete adapter class directly. Picks the real Resend adapter when
 * configured, otherwise the development adapter; either instance is
 * constructed fresh per call (cheap, stateless), never memoized at module
 * load, so a runtime env change (e.g. a key added without a redeploy in
 * some environments) is picked up on the next call.
 *
 * Build Phase 17D Wave A: `demoModeEnabled` is checked FIRST and
 * unconditionally routes to the development adapter, regardless of
 * `resendConfigured` — a deliberate belt-and-suspenders control distinct
 * from the presence-of-key-driven fallback above. A real RESEND_API_KEY
 * happening to be set must never cause a real send while a demo is
 * running.
 */
export function getEmailChannelAdapter(): ChannelAdapter {
  if (demoModeEnabled) return new DevelopmentEmailAdapter()
  return resendConfigured ? new ResendEmailAdapter() : new DevelopmentEmailAdapter()
}
