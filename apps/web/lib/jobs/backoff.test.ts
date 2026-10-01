import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  calculateNextAttemptAt,
  calculateNextAttemptDelay,
} from './backoff'

describe('calculateNextAttemptDelay', () => {
  it('with jitter disabled (random pinned at 0.5, the midpoint), produces exactly base * 2^attemptCount for small attempt counts', () => {
    const random = () => 0.5 // jitterFactor = 1 + (0.5*2-1)*ratio = 1 + 0*ratio = 1, i.e. no jitter
    expect(calculateNextAttemptDelay(1, { random })).toBe(DEFAULT_BASE_DELAY_MS * 2)
    expect(calculateNextAttemptDelay(2, { random })).toBe(DEFAULT_BASE_DELAY_MS * 4)
    expect(calculateNextAttemptDelay(3, { random })).toBe(DEFAULT_BASE_DELAY_MS * 8)
  })

  it('grows exponentially with attemptCount (each step roughly doubles, jitter aside) up to the cap', () => {
    const random = () => 0.5
    const delays = [1, 2, 3, 4].map((n) => calculateNextAttemptDelay(n, { random }))
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBe(delays[i - 1]! * 2)
    }
  })

  it('is capped at maxDelayMs regardless of how large attemptCount gets', () => {
    const random = () => 0.5
    expect(calculateNextAttemptDelay(30, { random })).toBe(DEFAULT_MAX_DELAY_MS)
    expect(calculateNextAttemptDelay(100, { random })).toBe(DEFAULT_MAX_DELAY_MS)
  })

  it('applies jitter as a fraction of the raw (pre-cap) delay: random()=0 gives the minimum of the jitter range, random()=1 gives the maximum', () => {
    const base = 1000
    const jitterRatio = 0.2
    // attemptCount=1 -> raw = base * 2 = 2000. jitterFactor range: [1-ratio, 1+ratio] = [0.8, 1.2]
    const min = calculateNextAttemptDelay(1, { baseDelayMs: base, jitterRatio, random: () => 0 })
    const max = calculateNextAttemptDelay(1, { baseDelayMs: base, jitterRatio, random: () => 1 })
    expect(min).toBe(Math.round(2000 * 0.8))
    expect(max).toBe(Math.round(2000 * 1.2))
  })

  it('never returns a negative delay even for pathological jitter inputs', () => {
    const delay = calculateNextAttemptDelay(1, { baseDelayMs: 10, jitterRatio: 5, random: () => 0 })
    expect(delay).toBeGreaterThanOrEqual(0)
  })

  it('respects an overridden baseDelayMs/maxDelayMs', () => {
    const random = () => 0.5
    expect(calculateNextAttemptDelay(1, { baseDelayMs: 100, maxDelayMs: 150, random })).toBe(150) // 100*2=200, capped at 150
    expect(calculateNextAttemptDelay(1, { baseDelayMs: 100, maxDelayMs: 1000, random })).toBe(200)
  })

  it('throws for a non-positive-integer attemptCount', () => {
    expect(() => calculateNextAttemptDelay(0)).toThrow()
    expect(() => calculateNextAttemptDelay(-1)).toThrow()
    expect(() => calculateNextAttemptDelay(1.5)).toThrow()
  })
})

describe('calculateNextAttemptAt', () => {
  it('adds the computed delay to the provided "now"', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const random = () => 0.5
    const result = calculateNextAttemptAt(1, { now, random, baseDelayMs: 1000 })
    expect(result.getTime()).toBe(now.getTime() + 2000)
  })

  it('defaults "now" to the current time when not provided', () => {
    const before = Date.now()
    const result = calculateNextAttemptAt(1, { random: () => 0.5, baseDelayMs: 1000 })
    const after = Date.now()
    // result should be "now" (somewhere between before/after) + 2000ms
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 2000)
    expect(result.getTime()).toBeLessThanOrEqual(after + 2000)
  })
})
