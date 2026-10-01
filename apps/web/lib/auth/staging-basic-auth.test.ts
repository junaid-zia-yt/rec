import { describe, expect, it } from 'vitest'
import { isValidStagingBasicAuthHeader } from './staging-basic-auth'

function basicHeader(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`
}

describe('isValidStagingBasicAuthHeader', () => {
  it('accepts a correctly-encoded matching header', () => {
    expect(isValidStagingBasicAuthHeader(basicHeader('demo', 'letmein'), 'demo', 'letmein')).toBe(
      true,
    )
  })

  it('rejects a wrong password', () => {
    expect(isValidStagingBasicAuthHeader(basicHeader('demo', 'wrong'), 'demo', 'letmein')).toBe(
      false,
    )
  })

  it('rejects a wrong username', () => {
    expect(
      isValidStagingBasicAuthHeader(basicHeader('someone-else', 'letmein'), 'demo', 'letmein'),
    ).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isValidStagingBasicAuthHeader(null, 'demo', 'letmein')).toBe(false)
    expect(isValidStagingBasicAuthHeader(undefined, 'demo', 'letmein')).toBe(false)
  })

  it('rejects a non-Basic scheme', () => {
    expect(isValidStagingBasicAuthHeader('Bearer sometoken', 'demo', 'letmein')).toBe(false)
  })

  it('rejects unparseable base64', () => {
    expect(isValidStagingBasicAuthHeader('Basic not-valid-base64!!!', 'demo', 'letmein')).toBe(
      false,
    )
  })

  it('rejects a decoded value with no colon separator', () => {
    expect(isValidStagingBasicAuthHeader(`Basic ${btoa('nocolonhere')}`, 'demo', 'letmein')).toBe(
      false,
    )
  })

  it('allows a colon inside the password itself', () => {
    expect(
      isValidStagingBasicAuthHeader(basicHeader('demo', 'pass:word'), 'demo', 'pass:word'),
    ).toBe(true)
  })
})
