/**
 * reset-demo.ts — Build Phase 17D Wave A ("Private Client Demo Readiness").
 *
 * Wipes ONLY the demo organization `seed-demo.ts` creates
 * (`DEMO_ORG_NAME` = "Brightside Talent Partners (Private Demo)") and its
 * four `@private-demo.rqi.local` demo users, then reseeds fresh — so a
 * recruiter can reliably reset the demo to its original state before or
 * after a client meeting, without touching any other organization
 * (especially never the staging seed org from `seed-staging.ts`, and never
 * anything a real user created).
 *
 * SAFETY: this script only ever looks up rows by the exact demo
 * organization name and the exact `@private-demo.rqi.local` email domain —
 * it never does a broad delete. If no demo organization exists yet
 * (first run, or already reset), the delete step is a no-op and the script
 * just seeds fresh — idempotent-safe by design, never errors on a clean
 * database.
 *
 * Deleting the `organizations` row cascades (via `on delete cascade` on
 * every `organization_id` foreign key in this schema — true for every
 * table this platform defines) to every child row: clients, recruitment
 * projects, jobs, scorecards, candidates, matching_runs,
 * candidate_role_matches, mandatory_gate_results, requirement_evidence,
 * scoring_breakdowns, human_reviews, shortlists, outreach_sequences,
 * outreach_messages, ai_runs — everything `seed-demo.ts` writes. The one
 * thing cascade does NOT reach is the `auth.users` rows themselves
 * (`organization_memberships.user_id` references `auth.users`, not the
 * other way around), so this script explicitly deletes those four demo
 * auth users first, via the Supabase Auth admin API, before deleting the
 * organization.
 *
 * Same `ALLOW_DEMO_SEED=true` guard as `seed-demo.ts` — this script both
 * deletes and reseeds, so it needs the exact same safety rail.
 *
 * Usage:
 *   ALLOW_DEMO_SEED=true \
 *   NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   pnpm --filter web reset:demo
 */
import { createClient } from '@supabase/supabase-js'
import { DEMO_EMAIL_DOMAIN, DEMO_ORG_NAME, seedDemoData } from './seed-demo'

function requireEnv() {
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error(
      '[reset-demo] Refusing to run: ALLOW_DEMO_SEED is not set to "true". ' +
        "This is a deliberate safety rail — see seed-demo.ts's header comment. " +
        'Set ALLOW_DEMO_SEED=true only when NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ' +
        'point at a database that is safe to wipe-and-reseed with fictional demo data, never production.',
    )
    process.exit(1)
  }
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '[reset-demo] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.',
    )
    process.exit(1)
  }
  return { SUPABASE_URL, SERVICE_ROLE_KEY }
}

async function main() {
  const { SUPABASE_URL, SERVICE_ROLE_KEY } = requireEnv()
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`[reset-demo] Target: ${SUPABASE_URL}`)
  console.log(`[reset-demo] Looking for an existing demo organization "${DEMO_ORG_NAME}"...`)

  const { data: existingOrg, error: findError } = await admin
    .from('organizations')
    .select('id')
    .eq('name', DEMO_ORG_NAME)
    .maybeSingle()

  if (findError) {
    throw new Error(`[reset-demo] Failed to look up the demo organization: ${findError.message}`)
  }

  if (!existingOrg) {
    console.log(
      '[reset-demo] No existing demo organization found — nothing to wipe. Seeding fresh.',
    )
  } else {
    console.log(
      `[reset-demo] Found demo organization ${existingOrg.id}. Deleting its demo users...`,
    )

    // Delete only the exact four @private-demo.rqi.local auth users this
    // org's own memberships reference — never a broader user search.
    const { data: memberships } = await admin
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', existingOrg.id)

    for (const membership of memberships ?? []) {
      const userId = membership.user_id as string
      const { data: userRecord } = await admin.auth.admin.getUserById(userId)
      const email = userRecord?.user?.email ?? ''
      if (!email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) {
        // Defensive: never delete an auth user this script did not itself
        // create the email pattern for, even if somehow linked to this org.
        console.log(
          `[reset-demo]   Skipping non-demo-domain user ${email || userId} (not deleted).`,
        )
        continue
      }
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId)
      if (deleteUserError) {
        console.error(
          `[reset-demo]   Failed to delete demo user ${email}: ${deleteUserError.message}`,
        )
      } else {
        console.log(`[reset-demo]   Deleted demo user ${email}.`)
      }
    }

    console.log('[reset-demo] Deleting the demo organization (cascades every child row)...')
    const { error: deleteOrgError } = await admin
      .from('organizations')
      .delete()
      .eq('id', existingOrg.id)
    if (deleteOrgError) {
      throw new Error(
        `[reset-demo] Failed to delete the demo organization: ${deleteOrgError.message}`,
      )
    }
    console.log('[reset-demo] Demo organization and all its data deleted.')
  }

  console.log('[reset-demo] Reseeding fresh demo data...')
  const result = await seedDemoData(admin)
  console.log(`[reset-demo] Done. New demo organization id: ${result.organizationId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
