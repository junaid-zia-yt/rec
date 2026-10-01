import { describe, expect, it } from 'vitest'
import type {
  CandidateResponse,
  ClientDecisionRecord,
  OutreachMessage,
  PocMetricDataPoint,
} from '@rqi/types'
import {
  calculateCandidateInterestRate,
  calculateCandidateResponseRate,
  calculateShortlistAcceptanceRate,
} from './calculate-engagement-metrics'

function decision(overrides: Partial<ClientDecisionRecord> = {}): ClientDecisionRecord {
  return {
    id: 'dec-1',
    shortlistId: 'sl-1',
    shortlistVersionId: 'slv-1',
    clientId: 'client-1',
    decidedBy: 'user-1',
    decision: 'accept',
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function message(overrides: Partial<OutreachMessage> = {}): OutreachMessage {
  return {
    id: 'msg-1',
    organizationId: 'org-1',
    outreachSequenceId: 'seq-1',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    candidateRoleMatchId: 'match-1',
    templateId: null,
    contactPointId: null,
    channel: 'email',
    status: 'sent',
    subject: 'Hello',
    draftBody: 'Hi there',
    personalizationEvidence: [],
    generatedBy: 'ai',
    aiRunId: null,
    editedByHuman: false,
    senderUserId: null,
    senderAccountIdentifier: null,
    scheduledAt: null,
    sentAt: '2026-01-01T00:00:00.000Z',
    deliveredAt: null,
    failedAt: null,
    failureReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    idempotencyKey: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function response(overrides: Partial<CandidateResponse> = {}): CandidateResponse {
  return {
    id: 'resp-1',
    organizationId: 'org-1',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    outreachMessageId: 'msg-1',
    channel: 'email',
    rawResponseText: 'Sounds interesting!',
    receivedAt: '2026-01-01T01:00:00.000Z',
    aiSuggestedClassification: 'interested',
    aiConfidence: 0.8,
    aiRunId: null,
    reviewedBy: 'user-1',
    reviewedAt: '2026-01-01T02:00:00.000Z',
    confirmedClassification: 'interested',
    reviewNote: null,
    createdAt: '2026-01-01T01:00:00.000Z',
    ...overrides,
  }
}

function dataPoint(overrides: Partial<PocMetricDataPoint> = {}): PocMetricDataPoint {
  return {
    id: 'm-1',
    organizationId: 'org-1',
    pocBenchmarkId: 'bench-1',
    pocRoleId: 'role-1',
    pocParticipantId: 'p-client',
    metricDefinitionId: 'def-1',
    metricDefinitionVersion: 1,
    dataPointKey: 'client_shortlist_acceptance_rate',
    valueNumeric: 50,
    valueText: null,
    valueJsonb: null,
    unit: 'percent',
    source: 'client_reported',
    supersedesMetricId: null,
    notes: null,
    recordedBy: null,
    recordedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('calculateShortlistAcceptanceRate', () => {
  it('computes accept-share over every recorded decision on the vendor side', () => {
    const result = calculateShortlistAcceptanceRate({
      side: 'vendor',
      vendorClientDecisions: [
        decision({ decision: 'accept' }),
        decision({ decision: 'reject' }),
        decision({ decision: 'discuss' }),
      ],
      clientReportedDataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 33.33 })
  })

  it('is pending on the vendor side when the client has recorded no decision yet', () => {
    const result = calculateShortlistAcceptanceRate({
      side: 'vendor',
      vendorClientDecisions: [],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('pending')
  })

  it('is not_measured (not not_available) on the client side absent a manual data point', () => {
    const result = calculateShortlistAcceptanceRate({
      side: 'client',
      vendorClientDecisions: [],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('not_measured')
  })

  it('reads the manual client-reported figure when present', () => {
    const result = calculateShortlistAcceptanceRate({
      side: 'client',
      vendorClientDecisions: [],
      clientReportedDataPoints: [dataPoint({ valueNumeric: 66.666 })],
    })
    expect(result).toMatchObject({ status: 'computed', value: 66.67 })
  })
})

describe('calculateCandidateResponseRate', () => {
  it('divides distinct responding candidates by distinct CONTACTED candidates, ignoring drafted/failed messages', () => {
    const result = calculateCandidateResponseRate({
      side: 'vendor',
      vendorOutreachMessages: [
        message({ candidateId: 'cand-1', status: 'sent' }),
        message({ id: 'msg-2', candidateId: 'cand-2', status: 'delivered' }),
        message({ id: 'msg-3', candidateId: 'cand-3', status: 'drafted' }), // not contacted, excluded from denominator
      ],
      vendorCandidateResponses: [response({ candidateId: 'cand-1' })],
      clientReportedDataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 50 })
  })

  it('is pending on the vendor side when nothing has been sent yet', () => {
    const result = calculateCandidateResponseRate({
      side: 'vendor',
      vendorOutreachMessages: [],
      vendorCandidateResponses: [],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('pending')
  })

  it("is not_available on the client side absent a manual data point (outreach on the client's own channels is unobserved)", () => {
    const result = calculateCandidateResponseRate({
      side: 'client',
      vendorOutreachMessages: [],
      vendorCandidateResponses: [],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('not_available')
  })
})

describe('calculateCandidateInterestRate', () => {
  it('only counts human-CONFIRMED classifications, never the AI suggestion alone', () => {
    const result = calculateCandidateInterestRate({
      side: 'vendor',
      vendorCandidateResponses: [
        response({ id: 'r-1', confirmedClassification: 'interested' }),
        response({ id: 'r-2', confirmedClassification: 'not_interested' }),
        response({
          id: 'r-3',
          confirmedClassification: null,
          aiSuggestedClassification: 'interested',
        }), // unreviewed — excluded
      ],
      clientReportedDataPoints: [],
    })
    expect(result).toMatchObject({
      status: 'computed',
      value: 50,
      inputsUsed: expect.arrayContaining(['r-1', 'r-2']),
    })
    expect(result.status === 'computed' && result.inputsUsed).not.toContain('r-3')
  })

  it('treats needs_more_info as counting toward interest, alongside interested', () => {
    const result = calculateCandidateInterestRate({
      side: 'vendor',
      vendorCandidateResponses: [
        response({ id: 'r-1', confirmedClassification: 'interested' }),
        response({ id: 'r-2', confirmedClassification: 'needs_more_info' }),
        response({ id: 'r-3', confirmedClassification: 'opt_out' }),
      ],
      clientReportedDataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 66.67 })
  })

  it('is pending on the vendor side when no response has been reviewed and confirmed yet', () => {
    const result = calculateCandidateInterestRate({
      side: 'vendor',
      vendorCandidateResponses: [response({ confirmedClassification: null })],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('pending')
  })

  it('is not_available on the client side absent a manual data point', () => {
    const result = calculateCandidateInterestRate({
      side: 'client',
      vendorCandidateResponses: [],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('not_available')
  })
})
