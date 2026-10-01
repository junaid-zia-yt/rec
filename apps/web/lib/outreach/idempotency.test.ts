import { describe, expect, it } from 'vitest'
import {
  generateOutreachIdempotencyKey,
  isRetryOfSameAttempt,
  parseOutreachIdempotencyKey,
} from './idempotency'

describe('generateOutreachIdempotencyKey', () => {
  it('produces the documented "<outreachMessageId>:<attemptNumber>" format', () => {
    expect(
      generateOutreachIdempotencyKey({ outreachMessageId: 'msg-abc-123', attemptNumber: 1 }),
    ).toBe('msg-abc-123:1')
    expect(
      generateOutreachIdempotencyKey({ outreachMessageId: 'msg-abc-123', attemptNumber: 3 }),
    ).toBe('msg-abc-123:3')
  })

  it('throws when outreachMessageId is empty', () => {
    expect(() =>
      generateOutreachIdempotencyKey({ outreachMessageId: '', attemptNumber: 1 }),
    ).toThrow()
  })

  it('throws when attemptNumber is not a positive integer', () => {
    expect(() =>
      generateOutreachIdempotencyKey({ outreachMessageId: 'msg-1', attemptNumber: 0 }),
    ).toThrow()
    expect(() =>
      generateOutreachIdempotencyKey({ outreachMessageId: 'msg-1', attemptNumber: -1 }),
    ).toThrow()
    expect(() =>
      generateOutreachIdempotencyKey({ outreachMessageId: 'msg-1', attemptNumber: 1.5 }),
    ).toThrow()
  })
})

describe('parseOutreachIdempotencyKey', () => {
  it('parses a well-formed key back into its parts', () => {
    expect(parseOutreachIdempotencyKey('msg-abc-123:1')).toEqual({
      outreachMessageId: 'msg-abc-123',
      attemptNumber: 1,
    })
  })

  it('uses the LAST colon as the separator, so a uuid-shaped id (no colons) and a compound id containing colons both parse correctly', () => {
    expect(parseOutreachIdempotencyKey('org:msg-abc-123:2')).toEqual({
      outreachMessageId: 'org:msg-abc-123',
      attemptNumber: 2,
    })
  })

  it('returns null for a key with no colon at all', () => {
    expect(parseOutreachIdempotencyKey('msg-abc-123')).toBeNull()
  })

  it('returns null for a key with an empty attempt-number segment (trailing colon)', () => {
    expect(parseOutreachIdempotencyKey('msg-abc-123:')).toBeNull()
  })

  it('returns null for a key with an empty id segment (leading colon)', () => {
    expect(parseOutreachIdempotencyKey(':1')).toBeNull()
  })

  it('returns null when the attempt-number segment is not a positive integer', () => {
    expect(parseOutreachIdempotencyKey('msg-abc-123:0')).toBeNull()
    expect(parseOutreachIdempotencyKey('msg-abc-123:-1')).toBeNull()
    expect(parseOutreachIdempotencyKey('msg-abc-123:abc')).toBeNull()
    expect(parseOutreachIdempotencyKey('msg-abc-123:1.5')).toBeNull()
  })

  it('round-trips generate -> parse for a range of attempt numbers', () => {
    for (const attemptNumber of [1, 2, 5, 100]) {
      const key = generateOutreachIdempotencyKey({ outreachMessageId: 'msg-xyz', attemptNumber })
      expect(parseOutreachIdempotencyKey(key)).toEqual({
        outreachMessageId: 'msg-xyz',
        attemptNumber,
      })
    }
  })
})

describe('isRetryOfSameAttempt', () => {
  it('is true when the candidate key exactly matches the existing recorded key (a network-level retry of the same attempt)', () => {
    expect(
      isRetryOfSameAttempt({
        existingIdempotencyKey: 'msg-1:1',
        candidateKey: 'msg-1:1',
      }),
    ).toBe(true)
  })

  it('is false when the existing key is null (no attempt has been made yet)', () => {
    expect(
      isRetryOfSameAttempt({
        existingIdempotencyKey: null,
        candidateKey: 'msg-1:1',
      }),
    ).toBe(false)
  })

  it('is false for a genuinely new attempt (incremented attempt number after a prior failure)', () => {
    expect(
      isRetryOfSameAttempt({
        existingIdempotencyKey: 'msg-1:1',
        candidateKey: 'msg-1:2',
      }),
    ).toBe(false)
  })

  it('is false when the message id differs even if the attempt number matches', () => {
    expect(
      isRetryOfSameAttempt({
        existingIdempotencyKey: 'msg-1:1',
        candidateKey: 'msg-2:1',
      }),
    ).toBe(false)
  })
})
