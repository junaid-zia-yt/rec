import { useEffect, useState } from 'react'

/**
 * Lightweight, dependency-free "are we online" signal (Build Phase 13,
 * Wave 5 — the brief's "safe offline behavior" requirement).
 *
 * DESIGN CHOICE: this app does NOT depend on
 * `@react-native-community/netinfo` (the brief explicitly allows either
 * "a small `useNetworkStatus` hook, or reuse netinfo if you add it as a
 * dependency"). A real device-level connectivity API is one more native
 * module to link, mock in Jest, and keep in sync with Expo's managed
 * workflow config — for what this app actually needs (a shared boolean the
 * UI can show a "you're offline" message from) that cost isn't justified.
 * Instead this module is a REACTIVE signal: every network-touching call in
 * the app (the `/api/mobile/*` fetch wrapper in lib/api/client.ts, and the
 * direct-Supabase read hook in lib/data/useSupabaseQuery.ts) reports its
 * own outcome here (`reportNetworkFailure`/`reportNetworkSuccess`), and
 * this module fans that out to every subscriber. That means the app only
 * *learns* it is offline after one real request has failed (there is no
 * proactive OS-level "radio state" check) — an acceptable tradeoff for a
 * best-effort UX signal, never a source of truth for a security or data
 * decision.
 */

type Listener = (online: boolean) => void

let online = true
const listeners = new Set<Listener>()

function setOnline(next: boolean) {
  if (online === next) return
  online = next
  for (const listener of listeners) listener(online)
}

/** Call from any network call site when a request fails with a
 * connectivity-shaped error (not a 4xx/5xx from a reachable server). */
export function reportNetworkFailure() {
  setOnline(false)
}

/** Call from any network call site when a request completes (success OR a
 * normal HTTP error response) — proof the network itself is reachable. */
export function reportNetworkSuccess() {
  setOnline(true)
}

export function getIsOnline(): boolean {
  return online
}

export function subscribeNetworkStatus(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook: the current online/offline signal, updated live. */
export function useNetworkStatus(): { online: boolean } {
  // Lazily seeded from the module singleton, so mount already reflects the
  // current signal — no separate synchronous resync call needed inside
  // the effect below (that would be a same-tick setState-in-effect, which
  // this codebase's lint config flags even though it's a no-op re-render
  // in practice). The effect below only SUBSCRIBES; it never calls
  // setState synchronously in its own body.
  const [isOnline, setIsOnline] = useState(getIsOnline)

  useEffect(() => subscribeNetworkStatus(setIsOnline), [])

  return { online: isOnline }
}

/** Test-only reset so one test's reported failure doesn't leak into the
 * next (module state is otherwise process-lifetime, not per-test). */
export function __resetNetworkStatusForTests() {
  online = true
}
