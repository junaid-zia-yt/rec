/**
 * Build Phase 15 Wave 2 — pure credential-check logic for proxy.ts's
 * staging Basic Auth gate. Kept separate from proxy.ts's Next.js-specific
 * NextRequest/NextResponse handling, exactly like lib/auth/routing.ts, so it
 * is directly unit-testable without spinning up a request/response pair.
 *
 * This is a coarse "keep search engines and randos out" gate for a shared
 * staging deployment — NOT a substitute for the app's real Supabase-Auth-
 * based authentication/authorization (lib/supabase/middleware.ts), which
 * still fully applies underneath it once a request gets past this gate.
 * Anyone who has the shared staging Basic Auth credentials still has to
 * sign in for real (a Supabase Auth session) to reach any account or
 * candidate data.
 */

/**
 * Validates a raw `Authorization` request header against the expected
 * staging username/password. Returns false for anything malformed
 * (missing header, wrong scheme, unparseable base64, no `:` separator) —
 * never throws, so proxy.ts can call this unconditionally.
 */
export function isValidStagingBasicAuthHeader(
  headerValue: string | null | undefined,
  expectedUser: string,
  expectedPassword: string,
): boolean {
  if (!headerValue) return false

  const spaceIndex = headerValue.indexOf(' ')
  if (spaceIndex === -1) return false

  const scheme = headerValue.slice(0, spaceIndex)
  const encoded = headerValue.slice(spaceIndex + 1).trim()
  if (scheme !== 'Basic' || !encoded) return false

  let decoded: string
  try {
    decoded = atob(encoded)
  } catch {
    return false
  }

  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex === -1) return false

  const user = decoded.slice(0, separatorIndex)
  const password = decoded.slice(separatorIndex + 1)
  return user === expectedUser && password === expectedPassword
}

/** Standard header proxy.ts sends on a 401 so browsers show a native credential prompt. */
export const STAGING_BASIC_AUTH_WWW_AUTHENTICATE_HEADER =
  'Basic realm="Staging - restricted access", charset="UTF-8"'
