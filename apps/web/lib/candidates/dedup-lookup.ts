import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DuplicateCandidateSuggestion } from '@rqi/types'
import { findDuplicateSuggestions, type DedupCandidateInput } from './dedup'

/**
 * I/O wrapper around the pure findDuplicateSuggestions (Build Phase 5 brief
 * §"Deduplication") — fetches the organization's other active candidates
 * and their document checksums, then hands the comparison to the
 * unit-tested pure function. Never called from a client component; a
 * server action or server-rendered page only.
 *
 * PERFORMANCE (Build Phase 14 Wave 4 fix): this used to issue three
 * sequential, per-candidate queries (candidate_profiles, candidate_documents,
 * then a document_uploads checksum lookup) inside a `for` loop over every
 * OTHER active candidate in the org — an N+1 that turned every single
 * candidate-detail page view into 1 + 3*N round trips with no upper bound,
 * the worst-case pattern this wave's brief calls out explicitly. It is now
 * four batched queries total regardless of org size: the "other candidates"
 * list, then one `.in(candidate_id, ...)` query each for their profiles and
 * documents, then one `.in(id, ...)` query for every referenced document's
 * checksum — same result set, same pure comparison function, O(1) round
 * trips instead of O(n).
 */
export async function loadDuplicateSuggestions(
  supabase: SupabaseClient,
  organizationId: string,
  candidateId: string,
): Promise<DuplicateCandidateSuggestion[]> {
  const { data: target } = await supabase
    .from('candidates')
    .select('id, full_name, normalized_email, normalized_phone')
    .eq('id', candidateId)
    .single()

  if (!target) return []

  const [{ data: profile }, { data: documents }, { data: others }] = await Promise.all([
    supabase
      .from('candidate_profiles')
      .select('current_company, location')
      .eq('candidate_id', candidateId)
      .maybeSingle(),
    supabase
      .from('candidate_documents')
      .select('document_upload_id')
      .eq('candidate_id', candidateId),
    supabase
      .from('candidates')
      .select('id, full_name, normalized_email, normalized_phone')
      .eq('organization_id', organizationId)
      .neq('id', candidateId)
      .neq('status', 'merged'),
  ])

  const targetChecksums = await checksumsFor(
    supabase,
    (documents ?? []).map((d) => d.document_upload_id as string),
  )

  const targetInput: DedupCandidateInput = {
    id: target.id,
    fullName: target.full_name,
    normalizedEmail: target.normalized_email,
    normalizedPhone: target.normalized_phone,
    currentCompany: profile?.current_company ?? null,
    location: profile?.location ?? null,
    documentChecksums: targetChecksums,
  }

  const otherIds = (others ?? []).map((o) => o.id as string)

  const [{ data: otherProfiles }, { data: otherDocuments }] =
    otherIds.length > 0
      ? await Promise.all([
          supabase
            .from('candidate_profiles')
            .select('candidate_id, current_company, location')
            .in('candidate_id', otherIds),
          supabase
            .from('candidate_documents')
            .select('candidate_id, document_upload_id')
            .in('candidate_id', otherIds),
        ])
      : [
          {
            data: [] as {
              candidate_id: string
              current_company: string | null
              location: string | null
            }[],
          },
          { data: [] as { candidate_id: string; document_upload_id: string }[] },
        ]

  const otherProfileByCandidateId = new Map(
    (otherProfiles ?? []).map((p) => [
      p.candidate_id as string,
      { currentCompany: p.current_company as string | null, location: p.location as string | null },
    ]),
  )

  const documentUploadIds = [
    ...new Set((otherDocuments ?? []).map((d) => d.document_upload_id as string)),
  ]
  const checksumByUploadId = await checksumsByUploadId(supabase, documentUploadIds)

  const checksumsByCandidateId = new Map<string, string[]>()
  for (const doc of otherDocuments ?? []) {
    const list = checksumsByCandidateId.get(doc.candidate_id as string) ?? []
    const checksum = checksumByUploadId.get(doc.document_upload_id as string)
    if (checksum) list.push(checksum)
    checksumsByCandidateId.set(doc.candidate_id as string, list)
  }

  const existingInputs: DedupCandidateInput[] = (others ?? []).map((other) => {
    const otherProfile = otherProfileByCandidateId.get(other.id as string)
    return {
      id: other.id as string,
      fullName: other.full_name as string,
      normalizedEmail: other.normalized_email as string | null,
      normalizedPhone: other.normalized_phone as string | null,
      currentCompany: otherProfile?.currentCompany ?? null,
      location: otherProfile?.location ?? null,
      documentChecksums: checksumsByCandidateId.get(other.id as string) ?? [],
    }
  })

  return findDuplicateSuggestions(targetInput, existingInputs)
}

async function checksumsFor(
  supabase: SupabaseClient,
  documentUploadIds: string[],
): Promise<string[]> {
  if (documentUploadIds.length === 0) return []
  const { data } = await supabase
    .from('document_uploads')
    .select('checksum_sha256')
    .in('id', documentUploadIds)
  return (data ?? []).map((row) => row.checksum_sha256 as string)
}

/** Batched checksum lookup keyed by document_upload_id, for the "other candidates" batch path above. */
async function checksumsByUploadId(
  supabase: SupabaseClient,
  documentUploadIds: string[],
): Promise<Map<string, string>> {
  if (documentUploadIds.length === 0) return new Map()
  const { data } = await supabase
    .from('document_uploads')
    .select('id, checksum_sha256')
    .in('id', documentUploadIds)
  return new Map((data ?? []).map((row) => [row.id as string, row.checksum_sha256 as string]))
}
