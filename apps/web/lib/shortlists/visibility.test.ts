import { describe, expect, it } from 'vitest'
import type { ShortlistActivityEntry, ShortlistCandidate } from '@rqi/types'
import {
  filterShortlistActivityForClient,
  serializeShortlistCandidateForClient,
  serializeShortlistCandidatesForClient,
} from './visibility'

function candidate(overrides: Partial<ShortlistCandidate> = {}): ShortlistCandidate {
  return {
    id: 'sc-1',
    organizationId: 'org-1',
    shortlistVersionId: 'sv-1',
    candidateRoleMatchId: 'crm-1',
    candidateId: 'cand-1',
    matchingRunId: 'run-1',
    scorecardVersionId: 'scv-1',
    rank: 1,
    recruiterNote: 'Strong culture fit but slow to respond to outreach.',
    addedBy: 'user-1',
    addedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function activity(overrides: Partial<ShortlistActivityEntry> = {}): ShortlistActivityEntry {
  return {
    id: 'act-1',
    organizationId: 'org-1',
    shortlistId: 'sl-1',
    actorId: 'user-1',
    action: 'candidate_added',
    summary: 'Added a candidate',
    metadata: {},
    clientVisible: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('serializeShortlistCandidateForClient', () => {
  it('omits recruiterNote entirely rather than nulling it', () => {
    const result = serializeShortlistCandidateForClient(candidate())
    expect('recruiterNote' in result).toBe(false)
    expect(result.candidateId).toBe('cand-1')
  })

  it('serializes a list the same way', () => {
    const results = serializeShortlistCandidatesForClient([
      candidate({ id: 'a' }),
      candidate({ id: 'b' }),
    ])
    for (const result of results) {
      expect('recruiterNote' in result).toBe(false)
    }
  })
})

describe('filterShortlistActivityForClient', () => {
  it('keeps only clientVisible entries', () => {
    const entries = [
      activity({ id: 'internal', clientVisible: false }),
      activity({ id: 'public', clientVisible: true }),
    ]
    const result = filterShortlistActivityForClient(entries)
    expect(result.map((e) => e.id)).toEqual(['public'])
  })
})
