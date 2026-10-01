import { describe, expect, it } from 'vitest'
import type { BackgroundJobStatus } from '@rqi/types'
import {
  canTransitionJobStatus,
  isTerminalJobStatus,
  nextLegalJobStatuses,
} from './status-transitions'

const ALL_STATUSES: BackgroundJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead_lettered',
  'cancelled',
]

// The exact legal edges documented in status-transitions.ts's module
// comment — asserted exhaustively so a future edit to TRANSITIONS is
// caught by a failing test rather than silently changing behavior.
const LEGAL_EDGES: Array<[BackgroundJobStatus, BackgroundJobStatus]> = [
  ['queued', 'running'],
  ['queued', 'cancelled'],
  ['running', 'succeeded'],
  ['running', 'failed'],
  ['running', 'cancelled'],
  ['failed', 'queued'],
  ['failed', 'dead_lettered'],
  ['dead_lettered', 'queued'],
]

const legalEdgeSet = new Set(LEGAL_EDGES.map(([from, to]) => `${from}->${to}`))

describe('canTransitionJobStatus', () => {
  it('accepts every documented legal edge', () => {
    for (const [from, to] of LEGAL_EDGES) {
      expect(canTransitionJobStatus(from, to)).toBe(true)
    }
  })

  it('rejects every possible pair not in the documented legal-edge list, exhaustively over the full 6x6 matrix', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = legalEdgeSet.has(`${from}->${to}`)
        expect(canTransitionJobStatus(from, to)).toBe(expected)
      }
    }
  })

  it('treats from === to as always illegal (never a "transition"), even for a same-status pair that might look like a no-op', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionJobStatus(status, status)).toBe(false)
    }
  })

  it('rejects any outgoing edge from the two purely-terminal states (succeeded, cancelled)', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionJobStatus('succeeded', to)).toBe(false)
      expect(canTransitionJobStatus('cancelled', to)).toBe(false)
    }
  })

  it('never allows dead_lettered -> anything except queued (manual retry is the only way out)', () => {
    for (const to of ALL_STATUSES) {
      const expected = to === 'queued'
      expect(canTransitionJobStatus('dead_lettered', to)).toBe(expected)
    }
  })

  it('never allows skipping straight from queued to succeeded/failed/dead_lettered without going through running', () => {
    expect(canTransitionJobStatus('queued', 'succeeded')).toBe(false)
    expect(canTransitionJobStatus('queued', 'failed')).toBe(false)
    expect(canTransitionJobStatus('queued', 'dead_lettered')).toBe(false)
  })
})

describe('nextLegalJobStatuses', () => {
  it('returns exactly the documented next-state set for every status', () => {
    expect(nextLegalJobStatuses('queued')).toEqual(['running', 'cancelled'])
    expect(nextLegalJobStatuses('running')).toEqual(['succeeded', 'failed', 'cancelled'])
    expect(nextLegalJobStatuses('succeeded')).toEqual([])
    expect(nextLegalJobStatuses('failed')).toEqual(['queued', 'dead_lettered'])
    expect(nextLegalJobStatuses('dead_lettered')).toEqual(['queued'])
    expect(nextLegalJobStatuses('cancelled')).toEqual([])
  })
})

describe('isTerminalJobStatus', () => {
  it('is true only for succeeded and cancelled (dead_lettered is NOT terminal here — manual retry is a documented, legal way out)', () => {
    for (const status of ALL_STATUSES) {
      const expected = status === 'succeeded' || status === 'cancelled'
      expect(isTerminalJobStatus(status)).toBe(expected)
    }
  })
})
