import { describe, expect, it } from 'vitest'
import type { OutreachMessageStatus } from '@rqi/types'
import {
  canTransitionOutreachMessageStatus,
  isTerminalOutreachMessageStatus,
  nextLegalOutreachMessageStatuses,
} from './status-transitions'

const ALL_STATUSES: OutreachMessageStatus[] = [
  'drafted',
  'awaiting_approval',
  'approved',
  'scheduled',
  'sent',
  'delivered',
  'failed',
  'responded',
  'cancelled',
]

// The exact legal edges documented in status-transitions.ts's module
// comment — asserted exhaustively so a future edit to TRANSITIONS is
// caught by a failing test rather than silently changing behavior.
const LEGAL_EDGES: Array<[OutreachMessageStatus, OutreachMessageStatus]> = [
  ['drafted', 'awaiting_approval'],
  ['drafted', 'cancelled'],
  ['awaiting_approval', 'approved'],
  ['awaiting_approval', 'drafted'],
  ['awaiting_approval', 'cancelled'],
  ['approved', 'scheduled'],
  ['approved', 'sent'],
  ['approved', 'cancelled'],
  ['scheduled', 'sent'],
  ['scheduled', 'cancelled'],
  ['sent', 'delivered'],
  ['sent', 'failed'],
  ['sent', 'responded'],
  ['delivered', 'responded'],
  ['failed', 'awaiting_approval'],
]

const legalEdgeSet = new Set(LEGAL_EDGES.map(([from, to]) => `${from}->${to}`))

describe('canTransitionOutreachMessageStatus', () => {
  it('accepts every documented legal edge', () => {
    for (const [from, to] of LEGAL_EDGES) {
      expect(canTransitionOutreachMessageStatus(from, to)).toBe(true)
    }
  })

  it('rejects every possible pair not in the documented legal-edge list, exhaustively over the full 9x9 matrix', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = legalEdgeSet.has(`${from}->${to}`)
        expect(canTransitionOutreachMessageStatus(from, to)).toBe(expected)
      }
    }
  })

  it('treats from === to as always illegal (never a "transition"), even for a same-status pair that might look like a no-op', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionOutreachMessageStatus(status, status)).toBe(false)
    }
  })

  it('rejects moving backwards from a later state to an earlier one outside the documented exceptions (failed->awaiting_approval and rejected/changes_requested->drafted are the only backwards edges)', () => {
    expect(canTransitionOutreachMessageStatus('sent', 'drafted')).toBe(false)
    expect(canTransitionOutreachMessageStatus('approved', 'drafted')).toBe(false)
    expect(canTransitionOutreachMessageStatus('delivered', 'sent')).toBe(false)
  })

  it('rejects skipping straight to a terminal state from an unrelated non-adjacent state', () => {
    expect(canTransitionOutreachMessageStatus('drafted', 'sent')).toBe(false)
    expect(canTransitionOutreachMessageStatus('drafted', 'responded')).toBe(false)
    expect(canTransitionOutreachMessageStatus('scheduled', 'responded')).toBe(false)
  })

  it('rejects any outgoing edge from the two terminal states', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionOutreachMessageStatus('responded', to)).toBe(false)
      expect(canTransitionOutreachMessageStatus('cancelled', to)).toBe(false)
    }
  })
})

describe('nextLegalOutreachMessageStatuses', () => {
  it('returns exactly the documented next-state set for every status', () => {
    expect(nextLegalOutreachMessageStatuses('drafted')).toEqual(['awaiting_approval', 'cancelled'])
    expect(nextLegalOutreachMessageStatuses('awaiting_approval')).toEqual([
      'approved',
      'drafted',
      'cancelled',
    ])
    expect(nextLegalOutreachMessageStatuses('approved')).toEqual(['scheduled', 'sent', 'cancelled'])
    expect(nextLegalOutreachMessageStatuses('scheduled')).toEqual(['sent', 'cancelled'])
    expect(nextLegalOutreachMessageStatuses('sent')).toEqual(['delivered', 'failed', 'responded'])
    expect(nextLegalOutreachMessageStatuses('delivered')).toEqual(['responded'])
    expect(nextLegalOutreachMessageStatuses('failed')).toEqual(['awaiting_approval'])
    expect(nextLegalOutreachMessageStatuses('responded')).toEqual([])
    expect(nextLegalOutreachMessageStatuses('cancelled')).toEqual([])
  })
})

describe('isTerminalOutreachMessageStatus', () => {
  it('is true only for responded and cancelled', () => {
    for (const status of ALL_STATUSES) {
      const expected = status === 'responded' || status === 'cancelled'
      expect(isTerminalOutreachMessageStatus(status)).toBe(expected)
    }
  })
})
