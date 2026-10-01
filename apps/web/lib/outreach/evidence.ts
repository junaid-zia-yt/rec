import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildCandidateEvidenceBundle,
  type CandidateExtractedFieldForEvidence,
} from '@/lib/matching/evidence-bundle'
import type { CandidateEvidenceBundleItem } from '@/lib/ai/matching-provider'

/**
 * Loads the exact same verified-only candidate evidence bundle the
 * candidate-matching workflow uses (apps/web/lib/matching/matching-actions.ts
 * runMatchingEvaluationAction, step 2 "load normalized candidate data" +
 * lib/matching/evidence-bundle.ts's own contract: only already-verified
 * candidate data — a `candidate_extracted_fields` row only when
 * `verification_status` is 'verified'/'edited', never 'pending'/'rejected').
 *
 * Task brief: "reuse this exact loader for building the input to
 * runOutreachDraftGeneration(), do not re-derive evidence separately."
 * matching-actions.ts does not itself export a reusable loader function
 * (the six queries + buildCandidateEvidenceBundle call are inlined in that
 * server action) — this module factors that exact query/shape sequence out
 * into one function so both the matching and outreach-drafting workflows
 * are provably fed from the identical, deterministic, already-verified
 * evidence assembly (JUDGMENT CALL, documented here since matching-actions.ts
 * was not itself refactored to call this — out of scope for this wave,
 * which may only import from wave-2 files and must not touch
 * matching-actions.ts's already-shipped Build Phase 7 code).
 *
 * This function is ALSO used, unmodified, by the response-classification
 * flow's evidence-adjacent context needs are NOT applicable there (response
 * classification only reads the outbound message body it is trusted
 * context, never the candidate's evidence bundle) — so this loader is
 * outreach-draft-generation-specific in practice, despite living in this
 * shared module for reuse by any future workflow that needs the same
 * verified bundle.
 */
export async function loadCandidateVerifiedEvidenceBundle(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<CandidateEvidenceBundleItem[]> {
  const [
    { data: profile },
    { data: experiences },
    { data: education },
    { data: certifications },
    { data: skills },
    { data: extractedFields },
  ] = await Promise.all([
    supabase
      .from('candidate_profiles')
      .select(
        'current_title, current_company, location, summary, leadership_scope, pnl_responsibility, work_authorization, compensation_notes, availability_notes, years_experience, notice_period_days, workplace_preference',
      )
      .eq('candidate_id', candidateId)
      .maybeSingle(),
    supabase
      .from('candidate_experiences')
      .select('id, company, title, location, start_date, end_date, is_current, description')
      .eq('candidate_id', candidateId),
    supabase
      .from('candidate_education')
      .select('id, institution, degree, field_of_study')
      .eq('candidate_id', candidateId),
    supabase
      .from('candidate_certifications')
      .select('id, name, issuing_body, issued_date, expires_date')
      .eq('candidate_id', candidateId),
    supabase
      .from('candidate_skills')
      .select('id, skill_name, proficiency, years_experience')
      .eq('candidate_id', candidateId),
    supabase
      .from('candidate_extracted_fields')
      .select(
        'id, field_group, field_key, verification_status, source_excerpt, extracted_value, edited_value',
      )
      .eq('candidate_id', candidateId)
      .in('verification_status', ['verified', 'edited']),
  ])

  return buildCandidateEvidenceBundle({
    profile: profile
      ? {
          currentTitle: profile.current_title,
          currentCompany: profile.current_company,
          location: profile.location,
          summary: profile.summary,
          leadershipScope: profile.leadership_scope,
          pnlResponsibility: profile.pnl_responsibility,
          workAuthorization: profile.work_authorization,
          compensationNotes: profile.compensation_notes,
          availabilityNotes: profile.availability_notes,
          yearsExperience: profile.years_experience,
          noticePeriodDays: profile.notice_period_days,
          workplacePreference: profile.workplace_preference,
        }
      : null,
    experiences: (experiences ?? []).map((row) => ({
      id: row.id,
      company: row.company,
      title: row.title,
      location: row.location,
      startDate: row.start_date,
      endDate: row.end_date,
      isCurrent: row.is_current,
      description: row.description,
    })),
    education: (education ?? []).map((row) => ({
      id: row.id,
      institution: row.institution,
      degree: row.degree,
      fieldOfStudy: row.field_of_study,
    })),
    certifications: (certifications ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      issuingBody: row.issuing_body,
      issuedDate: row.issued_date,
      expiresDate: row.expires_date,
    })),
    skills: (skills ?? []).map((row) => ({
      id: row.id,
      skillName: row.skill_name,
      proficiency: row.proficiency,
      yearsExperience: row.years_experience,
    })),
    extractedFields: (extractedFields ?? []).map((row): CandidateExtractedFieldForEvidence => ({
      id: row.id,
      fieldGroup: row.field_group,
      fieldKey: row.field_key,
      verificationStatus: row.verification_status,
      sourceExcerpt: row.source_excerpt,
      extractedValue: row.extracted_value,
      editedValue: row.edited_value,
    })),
  })
}
