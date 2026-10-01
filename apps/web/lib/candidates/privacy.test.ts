import { describe, expect, it } from 'vitest'
import {
  CANDIDATE_ERASURE_DELETE_TABLES,
  CANDIDATE_ERASURE_REDACTED_NAME,
  buildCandidateCoreRedaction,
  buildCandidateExportPayload,
  buildCandidateProfileRedaction,
  buildDeletionFulfillmentUpdate,
  buildDocumentProcessingRedaction,
  buildExtractedFieldRedaction,
  type CandidateExportSource,
} from './privacy'

describe('buildCandidateCoreRedaction', () => {
  it('nulls contact fields and redacts the name, stamping deleted_at', () => {
    const result = buildCandidateCoreRedaction('2026-09-28T00:00:00.000Z')
    expect(result.full_name).toBe(CANDIDATE_ERASURE_REDACTED_NAME)
    expect(result.primary_email).toBeNull()
    expect(result.primary_phone).toBeNull()
    expect(result.deleted_at).toBe('2026-09-28T00:00:00.000Z')
  })
})

describe('buildCandidateProfileRedaction', () => {
  it('nulls every PII/free-text field, including internal-only notes', () => {
    const result = buildCandidateProfileRedaction()
    expect(result.recruiter_notes).toBeNull()
    expect(result.client_visible_notes).toBeNull()
    expect(result.compensation_notes).toBeNull()
    expect(result.location).toBeNull()
    expect(result.summary).toBeNull()
    expect(result.work_authorization).toBeNull()
    // Every value in the object must be null — no field silently kept.
    expect(Object.values(result).every((v) => v === null)).toBe(true)
  })
})

describe('CANDIDATE_ERASURE_DELETE_TABLES', () => {
  it('covers every PII-only child table with an ON DELETE SET NULL downstream FK', () => {
    expect(CANDIDATE_ERASURE_DELETE_TABLES).toEqual([
      'candidate_contact_points',
      'candidate_experiences',
      'candidate_education',
      'candidate_certifications',
      'candidate_skills',
      'candidate_sources',
    ])
  })
})

describe('buildDocumentProcessingRedaction / buildExtractedFieldRedaction', () => {
  it('nulls the raw extracted CV text', () => {
    expect(buildDocumentProcessingRedaction()).toEqual({ extracted_text: null })
  })

  it('nulls the AI-proposed value and source excerpt, never edited_value', () => {
    const result = buildExtractedFieldRedaction()
    expect(result.extracted_value).toBeNull()
    expect(result.source_excerpt).toBeNull()
    expect('edited_value' in result).toBe(false)
  })
})

describe('buildDeletionFulfillmentUpdate', () => {
  it('records who fulfilled the erasure and when', () => {
    expect(buildDeletionFulfillmentUpdate('2026-09-28T00:00:00.000Z', 'user-1')).toEqual({
      deletion_fulfilled_at: '2026-09-28T00:00:00.000Z',
      deletion_fulfilled_by: 'user-1',
    })
  })
})

describe('buildCandidateExportPayload', () => {
  const source: CandidateExportSource = {
    candidate: {
      id: 'cand-1',
      organization_id: 'org-1',
      full_name: 'Jamie Rivera',
      primary_email: 'jamie@example.com',
      primary_phone: '+15551234567',
      status: 'active',
    },
    profile: { current_title: 'Store Manager' },
    contactPoints: [{ type: 'email', value: 'jamie@example.com', verified: true }],
    experiences: [{ company: 'Acme Retail', title: 'Store Manager' }],
    education: [],
    certifications: [],
    skills: [{ skill_name: 'P&L management' }],
    documents: [{ id: 'doc-1', doc_type: 'cv', status: 'active', version_no: 1 }],
    consent: {
      consent_status: 'granted',
      consent_recorded_at: '2026-01-01T00:00:00.000Z',
      deletion_requested: false,
    },
    communicationPreferences: [{ channel: 'email', status: 'opted_in' }],
    outreachMessages: [
      {
        channel: 'email',
        status: 'sent',
        sent_at: '2026-02-01T00:00:00.000Z',
        subject: 'Role at Acme',
      },
    ],
    candidateResponses: [
      {
        channel: 'email',
        confirmed_classification: 'interested',
        ai_suggested_classification: 'interested',
      },
    ],
  }

  it('assembles a complete, structured export from fetched rows', () => {
    const payload = buildCandidateExportPayload(source, '2026-09-28T12:00:00.000Z')
    expect(payload.exportedAt).toBe('2026-09-28T12:00:00.000Z')
    expect(payload.candidateId).toBe('cand-1')
    expect(payload.core.fullName).toBe('Jamie Rivera')
    expect(payload.contactPoints).toEqual([
      { type: 'email', value: 'jamie@example.com', verified: true },
    ])
    expect(payload.documents).toEqual([
      { id: 'doc-1', docType: 'cv', status: 'active', versionNo: 1 },
    ])
    expect(payload.consent).toEqual({
      status: 'granted',
      recordedAt: '2026-01-01T00:00:00.000Z',
      deletionRequested: false,
    })
    expect(payload.outreachMessages).toEqual([
      {
        channel: 'email',
        status: 'sent',
        sentAt: '2026-02-01T00:00:00.000Z',
        subject: 'Role at Acme',
      },
    ])
    expect(payload.candidateResponses).toEqual([
      { channel: 'email', classification: 'interested', respondedVia: 'interested' },
    ])
  })

  it('handles a candidate with no profile/consent recorded yet', () => {
    const minimal: CandidateExportSource = {
      ...source,
      profile: null,
      consent: null,
      contactPoints: [],
      experiences: [],
      education: [],
      certifications: [],
      skills: [],
      documents: [],
      communicationPreferences: [],
      outreachMessages: [],
      candidateResponses: [],
    }
    const payload = buildCandidateExportPayload(minimal, '2026-09-28T12:00:00.000Z')
    expect(payload.profile).toBeNull()
    expect(payload.consent).toBeNull()
    expect(payload.contactPoints).toEqual([])
  })
})
