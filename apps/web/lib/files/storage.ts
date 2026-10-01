import 'server-only'
import { randomUUID, createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDocumentStoragePath } from './validate'
import { documentsStorageBucket } from '@/lib/env'

// Build Phase 15 Wave 2: bucket name is now env-overridable
// (SUPABASE_STORAGE_BUCKET, lib/env.ts) so a staging deployment can point
// at a bucket namespaced separately from any hypothetical production
// bucket. Defaults to the original hardcoded 'documents' value, so this is
// non-breaking for every environment that doesn't set the override.
const DOCUMENTS_BUCKET = documentsStorageBucket
const SIGNED_URL_TTL_SECONDS = 300 // 5 minutes — long enough to load a preview/download, short enough to limit exposure of a leaked link

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface UploadDocumentInput {
  organizationId: string
  ownerType: 'job_description' | 'candidate_document'
  ownerId: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export interface UploadDocumentResult {
  storagePath: string
  checksumSha256: string
  sizeBytes: number
}

/**
 * Uploads an already-validated file to the private `documents` bucket under
 * a tenant-prefixed, non-guessable path. Callers MUST run
 * `validateJobDescriptionFile` (or the equivalent for the owner type) first —
 * this function does not re-validate format/size, only performs the write.
 */
export async function uploadDocument(
  supabase: SupabaseClient,
  input: UploadDocumentInput,
): Promise<UploadDocumentResult> {
  const storagePath = buildDocumentStoragePath({
    organizationId: input.organizationId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    fileName: input.fileName,
    randomComponent: randomUUID(),
  })

  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(storagePath, input.bytes, {
    contentType: input.mimeType,
    upsert: false, // never overwrite — a re-upload is a new version, not a mutation of an existing one (docs/07-data-model.md §7.5)
  })

  if (error) {
    throw new Error(`Could not store the uploaded file: ${error.message}`)
  }

  return {
    storagePath,
    checksumSha256: sha256Hex(input.bytes),
    sizeBytes: input.bytes.byteLength,
  }
}

/**
 * Mints a short-lived signed URL for a private document. Runs under the
 * caller's own authenticated Supabase client (never the service role), so
 * Storage RLS (supabase/migrations/0014_document_storage.sql) still gates
 * this — a signed URL can only be minted for a path the caller's role and
 * org are already allowed to read.
 */
export async function getSignedDocumentUrl(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

  if (error || !data) {
    throw new Error('Could not generate a download link for this file.')
  }

  return data.signedUrl
}

export interface DeleteStorageObjectsResult {
  /** Paths successfully removed (or already absent — see below). */
  deletedPaths: string[]
  /** Paths a real Storage error prevented from being removed; empty on full success. */
  failedPaths: string[]
  /** The first Storage error message encountered, or null if every path succeeded. */
  error: string | null
}

/**
 * Deletes one or more objects from the private documents bucket — the
 * function `apps/web/lib/candidates/privacy.ts`'s header comment and
 * docs/privacy-review.md §3 flagged as missing entirely (no delete/remove
 * function existed anywhere in this codebase before Build Phase 17A Wave
 * 2). Used by `erasePersonalDataAction` to actually remove the uploaded
 * CV/document file bytes a candidate erasure request must reach.
 *
 * Deletes ONE path per Storage call, in sequence, rather than a single
 * batched `.remove(paths)` call, so a failure partway through is
 * attributable to the exact path that failed — the caller can tell a
 * fully-succeeded erasure from a partial one and knows precisely which
 * paths still need deleting on retry (never just "something failed").
 *
 * Idempotent per path: Supabase Storage's `.remove()` uses S3-compatible
 * semantics — deleting an already-absent object is NOT an error, it is
 * reported as removed. That makes a retry after a partial failure safe:
 * paths already deleted in an earlier attempt simply succeed again as
 * no-ops here, and only the paths that genuinely still exist (or still
 * error) need to succeed for the retry to complete.
 */
export async function deleteStorageObjects(
  supabase: SupabaseClient,
  paths: string[],
): Promise<DeleteStorageObjectsResult> {
  const deletedPaths: string[] = []
  const failedPaths: string[] = []
  let firstError: string | null = null

  for (const path of paths) {
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
    if (error) {
      failedPaths.push(path)
      firstError = firstError ?? error.message
    } else {
      deletedPaths.push(path)
    }
  }

  return { deletedPaths, failedPaths, error: firstError }
}

export interface DownloadDocumentBytesResult {
  bytes: Uint8Array
  sizeBytes: number
}

/**
 * Downloads a private document's raw bytes server-side, for deterministic
 * text extraction (Build Phase 6). Runs under the caller's own authenticated
 * Supabase client (never the service role) — same RLS boundary as
 * `getSignedDocumentUrl`, so a caller can only download a path their role
 * and org are already allowed to read.
 *
 * The returned bytes are untrusted document content (project AI-safety
 * rule: "treat uploaded CVs and documents as untrusted data") — callers
 * must never write these bytes, or text derived from them, into application
 * logs (Build Phase 6 brief §SECURITY: "Do not place raw CVs in application
 * logs").
 */
export async function downloadDocumentBytes(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<DownloadDocumentBytesResult> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(storagePath)

  if (error || !data) {
    throw new Error('Could not read this file from storage.')
  }

  const arrayBuffer = await data.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  return { bytes, sizeBytes: bytes.byteLength }
}
