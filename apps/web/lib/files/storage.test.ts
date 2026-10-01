import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteStorageObjects } from './storage'

/**
 * Build Phase 17A Wave 2 — deleteStorageObjects is the fix for the gap
 * docs/privacy-review.md §3c tracked High since Build Phase 14: no
 * Storage-delete function existed anywhere in this codebase, so a
 * candidate erasure request never removed the actual uploaded CV/document
 * file bytes. Tests the function directly, against a minimal fake of the
 * one Supabase Storage call it makes (`.storage.from(bucket).remove()`).
 */

/** A fake `.storage.from(bucket).remove(paths)` that resolves per-path according to `behavior`, so a test can assert deleteStorageObjects' per-path sequencing and error surfacing precisely. */
function fakeStorageSupabase(behavior: (path: string) => { error: { message: string } | null }): {
  client: SupabaseClient
  remove: ReturnType<typeof vi.fn>
} {
  const remove = vi.fn(async (paths: string[]) => {
    // deleteStorageObjects always calls remove() with exactly one path.
    return behavior(paths[0]!)
  })
  const from = vi.fn().mockReturnValue({ remove })
  const client = { storage: { from } } as unknown as SupabaseClient
  return { client, remove }
}

describe('deleteStorageObjects', () => {
  it('returns an empty result and makes no Storage call for an empty path list', async () => {
    const { client, remove } = fakeStorageSupabase(() => ({ error: null }))
    const result = await deleteStorageObjects(client, [])
    expect(result).toEqual({ deletedPaths: [], failedPaths: [], error: null })
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes every path and reports full success when every call succeeds', async () => {
    const { client, remove } = fakeStorageSupabase(() => ({ error: null }))
    const paths = ['org-1/candidate_document/cand-1/a.pdf', 'org-1/candidate_document/cand-1/b.pdf']

    const result = await deleteStorageObjects(client, paths)

    expect(result).toEqual({ deletedPaths: paths, failedPaths: [], error: null })
    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith([paths[0]])
    expect(remove).toHaveBeenCalledWith([paths[1]])
  })

  it('treats an already-absent object as success — idempotent retry semantics', async () => {
    // Supabase Storage's real .remove() does not error on a missing key
    // (S3-compatible semantics); this fake models that by simply never
    // erroring, same as the "every call succeeds" case, but documents the
    // specific contract deleteStorageObjects' retry-safety depends on.
    const { client } = fakeStorageSupabase(() => ({ error: null }))
    const result = await deleteStorageObjects(client, ['org-1/candidate_document/cand-1/gone.pdf'])
    expect(result.deletedPaths).toEqual(['org-1/candidate_document/cand-1/gone.pdf'])
    expect(result.failedPaths).toEqual([])
  })

  it('reports exactly which paths failed on a partial failure, and the first error message', async () => {
    const paths = [
      'org-1/candidate_document/cand-1/a.pdf',
      'org-1/candidate_document/cand-1/b.pdf',
      'org-1/candidate_document/cand-1/c.pdf',
    ]
    const { client } = fakeStorageSupabase((path) =>
      path.endsWith('b.pdf') ? { error: { message: 'network error' } } : { error: null },
    )

    const result = await deleteStorageObjects(client, paths)

    expect(result.deletedPaths).toEqual([paths[0], paths[2]])
    expect(result.failedPaths).toEqual([paths[1]])
    expect(result.error).toBe('network error')
  })

  it('reports total failure when every path errors', async () => {
    const paths = ['org-1/candidate_document/cand-1/a.pdf', 'org-1/candidate_document/cand-1/b.pdf']
    const { client } = fakeStorageSupabase(() => ({ error: { message: 'bucket unreachable' } }))

    const result = await deleteStorageObjects(client, paths)

    expect(result.deletedPaths).toEqual([])
    expect(result.failedPaths).toEqual(paths)
    expect(result.error).toBe('bucket unreachable')
  })
})
