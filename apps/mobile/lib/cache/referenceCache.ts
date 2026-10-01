/**
 * AsyncStorage-backed cache for NON-SENSITIVE, low-risk-to-go-stale
 * reference data only (Build Phase 13, Wave 5 — "safe offline behavior").
 *
 * *** DO NOT put anything else in here without re-reading the brief. ***
 * This module MUST NEVER cache: candidate PII, candidate evidence, scores,
 * gate results, outreach content, shortlist contents, or any
 * approval/decision data. All of that is exactly the data the brief calls
 * out as unsafe to let a reviewer act on from a stale, possibly-outdated
 * local copy — those screens always read live (or show the `offline`
 * state via useQueryState/QueryStateView) and never fall back to a cache.
 * What IS safe to cache here is data that is either (a) genuinely static
 * (event-type copy, pipeline stage labels — though the latter needs no
 * caching at all, see below) or (b) low-stakes to show briefly stale on a
 * cold start (the caller's own membership list: which orgs they belong to
 * and their role in each — not candidate data, and wrong for at most one
 * render before the live `useActiveOrganization` read resolves and
 * overwrites it).
 *
 * `lib/pipeline/stages.ts`'s `STAGE_LABELS`/`STAGE_BADGE` need NO caching
 * at all — they are already plain static TS constants bundled with the
 * app, not fetched from anywhere, so there is nothing to go stale.
 * `lib/notifications/eventLabels.ts` is the same shape (static constants)
 * for the same reason; it is NOT cached here either. The only thing this
 * module actually persists is the membership/org list below, which IS
 * fetched over the network and therefore has a genuine warm-start use
 * case.
 *
 * Every key this module writes is namespaced under
 * `CACHE_KEY_NAMESPACE` (lib/auth/AuthProvider.tsx) so `AuthProvider`'s
 * sign-out already clears it — see that file's `clearNamespacedCache`,
 * which this module does not need to duplicate or hook into separately.
 */
import { CACHE_KEY_NAMESPACE } from '@/lib/auth/AuthProvider'

const MEMBERSHIPS_KEY = `${CACHE_KEY_NAMESPACE}memberships`

export interface CachedMembership {
  organizationId: string
  organizationName: string | null
  role: string
}

interface CachedMembershipsPayload {
  memberships: CachedMembership[]
  cachedAt: string
}

async function getAsyncStorage() {
  try {
    return (await import('@react-native-async-storage/async-storage')).default
  } catch {
    return null
  }
}

/** Best-effort write — a cache failure (storage full, unavailable in this
 * environment) must never surface as a user-facing error, since this data
 * is purely a warm-start convenience, never load-bearing. */
export async function cacheMemberships(memberships: CachedMembership[]): Promise<void> {
  try {
    const AsyncStorage = await getAsyncStorage()
    if (!AsyncStorage) return
    const payload: CachedMembershipsPayload = { memberships, cachedAt: new Date().toISOString() }
    await AsyncStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(payload))
  } catch {
    // Best-effort — see header comment.
  }
}

/** Returns the last-cached membership list plus how long ago it was
 * cached, or null if nothing is cached yet (or reading failed) — the
 * caller (More/Settings screen, nav shell) is responsible for labeling
 * this "possibly stale" in the UI until the live read completes, per the
 * brief's requirement. */
export async function readCachedMemberships(): Promise<{
  memberships: CachedMembership[]
  cachedAt: string
} | null> {
  try {
    const AsyncStorage = await getAsyncStorage()
    if (!AsyncStorage) return null
    const raw = await AsyncStorage.getItem(MEMBERSHIPS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedMembershipsPayload
    if (!parsed || !Array.isArray(parsed.memberships)) return null
    return { memberships: parsed.memberships, cachedAt: parsed.cachedAt }
  } catch {
    return null
  }
}
