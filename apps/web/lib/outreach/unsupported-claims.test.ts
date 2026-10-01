import { describe, expect, it } from 'vitest'
import type { CandidateEvidenceBundleItem } from '@/lib/ai/matching-provider'
import type { OutreachDraftEvidenceRef } from '@/lib/ai/outreach-draft-provider'
import { validateOutreachDraftEvidence } from './unsupported-claims'

function bundleItem(
  overrides: Partial<CandidateEvidenceBundleItem> = {},
): CandidateEvidenceBundleItem {
  return {
    sourceKind: 'experience',
    sourceId: 'exp-1',
    text: 'Managed 42 multi-unit convenience stores across three states from 2019 to 2024.',
    isDirectStatement: true,
    ...overrides,
  }
}

function ref(overrides: Partial<OutreachDraftEvidenceRef> = {}): OutreachDraftEvidenceRef {
  return {
    sourceKind: 'experience',
    sourceId: 'exp-1',
    claimText: 'Managed 42 multi-unit convenience stores',
    evidenceExcerpt:
      'Managed 42 multi-unit convenience stores across three states from 2019 to 2024.',
    ...overrides,
  }
}

describe('validateOutreachDraftEvidence', () => {
  it('passes when every reference exists in the bundle and its excerpt is a verbatim substring', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [ref()],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(true)
  })

  it('is valid, with nothing to check, for an empty personalizationEvidence array (a generic draft)', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(true)
  })

  it('rejects a reference citing a (sourceKind, sourceId) pair that does not exist in the bundle at all (a fabricated id)', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [ref({ sourceId: 'exp-does-not-exist' })],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues[0]).toMatch(/does not exist in the candidate's verified evidence bundle/)
    }
  })

  it('rejects a reference whose sourceKind is real but whose sourceId does not match any bundle item of that kind', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [ref({ sourceKind: 'certification', sourceId: 'cert-999' })],
      verifiedEvidenceBundle: [
        bundleItem({
          sourceKind: 'certification',
          sourceId: 'cert-1',
          text: 'ServSafe certified, issued 2023.',
        }),
      ],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects a paraphrased (non-verbatim) excerpt even when it cites a real evidence item', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [
        ref({ evidenceExcerpt: 'Led operations across dozens of stores for half a decade.' }),
      ],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues[0]).toMatch(/not found verbatim/)
    }
  })

  it('rejects a fabricated excerpt with no relationship at all to the real item text', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [
        ref({ evidenceExcerpt: 'Won Employee of the Year three times in a row.' }),
      ],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects an item that cites an identity present in the bundle but excluded because it is unverified — the caller is responsible for passing only a verified bundle, and this function treats "absent from the bundle passed in" as the failure signal', () => {
    // Simulates a caller correctly filtering an unverified bundle item out
    // before calling this function — the citation then has nothing to
    // match and must fail exactly like a fabricated id.
    const verifiedBundle: CandidateEvidenceBundleItem[] = [] // the one 'unverified' item was already excluded by the caller
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [ref({ sourceKind: 'skill', sourceId: 'skill-unverified' })],
      verifiedEvidenceBundle: verifiedBundle,
    })
    expect(result.valid).toBe(false)
  })

  it('matches a profile-sourceKind item by identity even though sourceId is always null for that kind', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [
        ref({
          sourceKind: 'profile',
          sourceId: null,
          evidenceExcerpt: 'Based in Manchester, open to relocation.',
        }),
      ],
      verifiedEvidenceBundle: [
        bundleItem({
          sourceKind: 'profile',
          sourceId: null,
          text: 'Based in Manchester, open to relocation.',
        }),
      ],
    })
    expect(result.valid).toBe(true)
  })

  it('reports every failing reference, not just the first, when multiple references are checked', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [ref({ sourceId: 'missing-1' }), ref({ sourceId: 'missing-2' })],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toHaveLength(2)
    }
  })

  it('an excerpt with only leading/trailing whitespace difference from a real substring is still accepted (excerpt is trimmed before matching)', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [
        ref({
          evidenceExcerpt:
            '  Managed 42 multi-unit convenience stores across three states from 2019 to 2024.  ',
        }),
      ],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(true)
  })

  it('rejects an empty-string excerpt even when the reference otherwise cites a real bundle item', () => {
    const result = validateOutreachDraftEvidence({
      personalizationEvidence: [ref({ evidenceExcerpt: '   ' })],
      verifiedEvidenceBundle: [bundleItem()],
    })
    expect(result.valid).toBe(false)
  })
})
