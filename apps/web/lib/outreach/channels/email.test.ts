import { describe, expect, it } from 'vitest'

/**
 * Build Phase 17D Wave A. Confirms `getEmailChannelAdapter()`'s belt-and-
 * suspenders demo-mode lockdown: even with a (mock) configured
 * RESEND_API_KEY, demo mode must unconditionally select the development/
 * no-op adapter, never the real Resend adapter. Each test re-imports the
 * module fresh (vi.resetModules) since both `resendConfigured` and
 * `demoModeEnabled` (lib/env.ts) are read at import time, same convention
 * as lib/env.test.ts / non-production-banner.test.tsx.
 */
async function getAdapterWithEnv(opts: { resendKey?: string; demoMode?: string }) {
  vi.resetModules()
  const original = { ...process.env }
  if (opts.resendKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = opts.resendKey
  if (opts.demoMode === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE
  else process.env.NEXT_PUBLIC_DEMO_MODE = opts.demoMode

  const { getEmailChannelAdapter } = await import('./email')
  const adapter = getEmailChannelAdapter()
  process.env = original
  return adapter
}

const MESSAGE = {
  id: 'msg-1',
  organizationId: 'org-1',
  channel: 'email' as const,
  subject: 'Hello',
  body: 'Test message body',
  idempotencyKey: null,
  senderUserId: 'user-1',
  senderAccountIdentifier: 'recruiter@example.com',
  recipientAddress: 'candidate@example.com',
  recipientDisplayName: 'Test Candidate',
}

describe('getEmailChannelAdapter', () => {
  it('selects the development adapter when no RESEND_API_KEY is configured and demo mode is off', async () => {
    const adapter = await getAdapterWithEnv({})
    expect(adapter.provider).toBe('development-noop')
  })

  it('selects the real Resend adapter when a key is configured and demo mode is off', async () => {
    const adapter = await getAdapterWithEnv({ resendKey: 'test-key' })
    expect(adapter.provider).toBe('resend')
  })

  it('unconditionally selects the development adapter in demo mode, even with a configured key', async () => {
    const adapter = await getAdapterWithEnv({ resendKey: 'test-key', demoMode: 'true' })
    expect(adapter.provider).toBe('development-noop')
  })

  it('a send() through the demo-mode-selected adapter never reports a real send', async () => {
    const adapter = await getAdapterWithEnv({ resendKey: 'test-key', demoMode: 'true' })
    const result = await adapter.send(MESSAGE)
    expect(result.status).toBe('sent')
    expect(result.status === 'sent' && result.simulated).toBe(true)
  })
})
