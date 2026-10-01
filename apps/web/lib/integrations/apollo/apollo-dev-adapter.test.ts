import { describe, expect, it } from 'vitest'
import { ApolloAdapterError } from './types'
import { getApolloClient } from './apollo-dev-adapter'

describe('getApolloClient (not configured in this environment)', () => {
  it('throws a typed not_configured error rather than returning fabricated contact data', async () => {
    const client = getApolloClient()
    await expect(client.enrichContact({ email: 'someone@example.com' })).rejects.toMatchObject({
      kind: 'not_configured',
    })
  })

  it('the rejection is an ApolloAdapterError instance', async () => {
    const client = getApolloClient()
    try {
      await client.enrichContact({ email: 'someone@example.com' })
      throw new Error('expected enrichContact to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ApolloAdapterError)
    }
  })
})
