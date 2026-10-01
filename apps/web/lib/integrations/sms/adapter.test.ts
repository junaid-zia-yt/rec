import { describe, expect, it } from 'vitest'
import { getSmsChannelIntegrationAdapter, getSmsIntegrationStatus } from './adapter'

describe('SMS integration adapter', () => {
  it('reports not_connected with no provider chosen', () => {
    const status = getSmsIntegrationStatus()
    expect(status).toEqual({
      provider: 'sms',
      status: 'not_connected',
      reason: expect.stringContaining('No SMS provider is configured'),
    })
  })

  it('the underlying channel adapter always reports not_configured', async () => {
    const adapter = getSmsChannelIntegrationAdapter()
    const result = await adapter.send({
      id: 'msg-1',
      organizationId: 'org-1',
      channel: 'sms',
      subject: null,
      body: 'hi',
      idempotencyKey: null,
      senderUserId: null,
      senderAccountIdentifier: null,
      recipientAddress: '+15555550100',
      recipientDisplayName: null,
    })
    expect(result.status).toBe('not_configured')
  })
})
