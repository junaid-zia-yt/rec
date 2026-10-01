import { describe, expect, it } from 'vitest'
import {
  checkPipelineTransition,
  isValidPipelineTransition,
  isTerminalStage,
  nextClientVisible,
  transitionRequiresReason,
} from './pipeline'

describe('checkPipelineTransition / isValidPipelineTransition', () => {
  it('allows the next sequential forward stage', () => {
    expect(isValidPipelineTransition('discovered', 'eligibility_check')).toBe(true)
    expect(isValidPipelineTransition('eligibility_check', 'scored')).toBe(true)
    expect(isValidPipelineTransition('scored', 'quality_review')).toBe(true)
    expect(isValidPipelineTransition('quality_review', 'outreach')).toBe(true)
    expect(isValidPipelineTransition('outreach', 'shortlisted')).toBe(true)
  })

  it('allows moving one step back as a correction', () => {
    expect(isValidPipelineTransition('quality_review', 'scored')).toBe(true)
  })

  it('rejects skipping stages', () => {
    const result = checkPipelineTransition('discovered', 'shortlisted')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/skipped/i)
  })

  it('rejects a same-stage "transition"', () => {
    const result = checkPipelineTransition('scored', 'scored')
    expect(result.valid).toBe(false)
  })

  it('allows rejecting or withdrawing from any active stage', () => {
    expect(isValidPipelineTransition('discovered', 'rejected')).toBe(true)
    expect(isValidPipelineTransition('outreach', 'withdrawn')).toBe(true)
    expect(isValidPipelineTransition('shortlisted', 'rejected')).toBe(true)
  })

  it('rejects any transition out of a terminal stage', () => {
    expect(isValidPipelineTransition('rejected', 'discovered')).toBe(false)
    expect(isValidPipelineTransition('withdrawn', 'eligibility_check')).toBe(false)
    expect(checkPipelineTransition('rejected', 'discovered').reason).toMatch(/terminal/i)
  })

  it('rejects jumping backward more than one step', () => {
    expect(isValidPipelineTransition('outreach', 'discovered')).toBe(false)
  })
})

describe('isTerminalStage', () => {
  it('is true only for rejected/withdrawn', () => {
    expect(isTerminalStage('rejected')).toBe(true)
    expect(isTerminalStage('withdrawn')).toBe(true)
    expect(isTerminalStage('shortlisted')).toBe(false)
    expect(isTerminalStage('discovered')).toBe(false)
  })
})

describe('nextClientVisible', () => {
  it('turns client_visible on once the candidate reaches shortlisted', () => {
    expect(nextClientVisible('shortlisted', false)).toBe(true)
  })

  it('leaves client_visible unchanged for every other transition', () => {
    expect(nextClientVisible('scored', false)).toBe(false)
    expect(nextClientVisible('rejected', true)).toBe(true)
  })
})

describe('transitionRequiresReason', () => {
  it('requires a reason for a terminal transition', () => {
    expect(transitionRequiresReason('rejected')).toBe(true)
    expect(transitionRequiresReason('withdrawn')).toBe(true)
  })

  it('does not require a reason for an active-stage transition', () => {
    expect(transitionRequiresReason('eligibility_check')).toBe(false)
  })
})
