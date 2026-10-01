import { z } from 'zod'

/**
 * Environment validation for the mobile app — the direct RN analogue of
 * apps/web/lib/env.ts, same contract: never crash on a missing optional
 * var, expose a `*Configured` boolean so calling code can render an honest
 * "not configured" state instead of assuming a live credential.
 *
 * Expo only exposes vars prefixed `EXPO_PUBLIC_` to app code (its
 * client-exposed-env-var convention, the RN/Metro analogue of Next.js's
 * `NEXT_PUBLIC_` prefix used in apps/web/lib/env.ts) — hence
 * `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` here instead
 * of the web app's `NEXT_PUBLIC_*` names. No live Supabase project is
 * configured in this build environment, so `supabaseConfigured` is `false`
 * here — every screen that depends on it must render the "not configured"
 * state rather than assume auth/data is reachable.
 */
const EnvSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().optional().or(z.literal('')),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().or(z.literal('')),
  // Base URL for the web app's `/api/mobile/*` Route Handlers (see
  // lib/api/client.ts). No live web deployment is configured in this build
  // environment either, so this always falls back to the local-dev default
  // below rather than pointing at a real host.
  EXPO_PUBLIC_API_BASE_URL: z.string().optional().or(z.literal('')),
})

const parsed = EnvSchema.safeParse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
})

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration:\n${parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`,
  )
}

export const env = parsed.data

/**
 * True only when a Supabase project is actually configured. Mirrors
 * apps/web/lib/env.ts's `supabaseConfigured` exactly — same name, same
 * gating rule — so the two apps' code reads the same way even though they
 * read different underlying env var names.
 */
export const supabaseConfigured = Boolean(
  env.EXPO_PUBLIC_SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
)

/**
 * Local-dev default matches the web app's own local port (see apps/web's
 * `next dev` default and NEXT_PUBLIC_APP_URL default in apps/web/lib/env.ts).
 * A real deployment must set EXPO_PUBLIC_API_BASE_URL explicitly.
 */
export const apiBaseUrl = env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000'
