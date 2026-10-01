import { describe, expect, it } from 'vitest'
import type { OutreachMessageStatus } from '@rqi/types'
import { checkOutreachOptOutGate } from './opt-out'

const GATED_STATUSES: OutreachMessageStatus[] = ['approved', 'scheduled', 'sent']
const UNGATED_STATUSES: OutreachMessageStatus[] = [
  'drafted',
  'awaiting_approval',
  'delivered',
  'failed',
  'responded',
  'cancelled',
]

describe('checkOutreachOptOutGate', () => {
  it('blocks a transition into every gated status (approved, scheduled, sent) when the candidate is opted_out', () => {
    for (const toStatus of GATED_STATUSES) {
      const result = checkOutreachOptOutGate({
        channel: 'email',
        currentPreferenceStatus: 'opted_out',
        fromStatus: 'awaiting_approval',
        toStatus,
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toMatch(/opted out/i)
        expect(result.reason).toMatch(/email/)
      }
    }
  })

  it('allows a transition into every gated status when opted_in', () => {
    for (const toStatus of GATED_STATUSES) {
      const result = checkOutreachOptOutGate({
        channel: 'email',
        currentPreferenceStatus: 'opted_in',
        fromStatus: 'awaiting_approval',
        toStatus,
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('allows a transition into every gated status when unknown (not yet opted in or out)', () => {
    for (const toStatus of GATED_STATUSES) {
      const result = checkOutreachOptOutGate({
        channel: 'linkedin',
        currentPreferenceStatus: 'unknown',
        fromStatus: 'awaiting_approval',
        toStatus,
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('allows a transition into every gated status when no preference row exists at all (null), same as unknown/opted_in', () => {
    for (const toStatus of GATED_STATUSES) {
      const result = checkOutreachOptOutGate({
        channel: 'sms',
        currentPreferenceStatus: null,
        fromStatus: 'awaiting_approval',
        toStatus,
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('never gates a transition into a non-gated status, even while opted_out', () => {
    for (const toStatus of UNGATED_STATUSES) {
      const result = checkOutreachOptOutGate({
        channel: 'email',
        currentPreferenceStatus: 'opted_out',
        fromStatus: 'sent',
        toStatus,
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('exempts a same-status no-op update (fromStatus === toStatus) from the gate, even into a gated status while opted_out', () => {
    const result = checkOutreachOptOutGate({
      channel: 'email',
      currentPreferenceStatus: 'opted_out',
      fromStatus: 'sent',
      toStatus: 'sent',
    })
    expect(result.allowed).toBe(true)
  })

  it('does not apply the same-status exemption when fromStatus is null (an insert, not an update) even if it happened to equal toStatus conceptually', () => {
    // fromStatus is null for an insert (mirrors the DB trigger's TG_OP =
    // 'INSERT' branch) — the exemption only fires for a genuine
    // status-unchanged UPDATE (fromStatus !== null && fromStatus === toStatus).
    const result = checkOutreachOptOutGate({
      channel: 'email',
      currentPreferenceStatus: 'opted_out',
      fromStatus: null,
      toStatus: 'approved',
    })
    expect(result.allowed).toBe(false)
  })
})
