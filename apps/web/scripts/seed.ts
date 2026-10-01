/**
 * Demo seed script — Build Phase 2 brief §11.
 *
 * Creates one demo agency organization and five demo users, one per role,
 * with active memberships. Requires a real, configured Supabase project
 * (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — this script has
 * never been run against a live project in this environment, since none is
 * connected here; it is written to spec and ready to run once one exists.
 *
 * No password is ever written to the repository, to a log file, or to
 * stdout by default. Each user gets a strong random password; run with
 * `--print-passwords` to have them printed once to your own terminal (never
 * persisted by this script) so you can hand them to the person who owns
 * each demo account, or use "forgot password" from the sign-in screen
 * instead of retrieving them at all.
 *
 * Usage:
 *   pnpm --filter web seed
 *   pnpm --filter web seed -- --print-passwords
 */
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '[seed] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set ' +
      '(apps/web/.env.local). No live Supabase project is connected in this environment, ' +
      'so this script cannot be run here — see supabase/README.md.',
  )
  process.exit(1)
}

const printPasswords = process.argv.includes('--print-passwords')

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function randomPassword(): string {
  // 24 random bytes, base64url — well above any reasonable minimum length,
  // never derived from anything guessable.
  return randomBytes(24).toString('base64url')
}

const DEMO_ORG_NAME = 'Northfield Retail Group (Demo Agency)'

const DEMO_USERS = [
  { fullName: 'Dana Reyes', email: 'admin@demo.rqi.local', role: 'agency_admin' as const },
  { fullName: 'Priya Nandakumar', email: 'recruiter@demo.rqi.local', role: 'recruiter' as const },
  {
    fullName: 'Marcus Webb',
    email: 'client-reviewer@demo.rqi.local',
    role: 'client_decision_maker' as const,
  },
  {
    fullName: 'Alicia Torres',
    email: 'read-only@demo.rqi.local',
    role: 'read_only_reviewer' as const,
  },
]

async function main() {
  console.log(`[seed] Creating demo organization "${DEMO_ORG_NAME}"...`)
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: DEMO_ORG_NAME, plan: 'trial' })
    .select('id')
    .single()

  if (orgError || !org) {
    throw new Error(`[seed] Failed to create demo organization: ${orgError?.message}`)
  }

  const credentials: Array<{ email: string; role: string; password: string }> = []

  for (const user of DEMO_USERS) {
    const password = randomPassword()
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    })

    if (userError || !created.user) {
      throw new Error(`[seed] Failed to create user ${user.email}: ${userError?.message}`)
    }

    const { error: membershipError } = await admin.from('organization_memberships').insert({
      organization_id: org.id,
      user_id: created.user.id,
      role: user.role,
      status: 'active',
      is_default: true,
    })

    if (membershipError) {
      throw new Error(
        `[seed] Failed to create membership for ${user.email}: ${membershipError.message}`,
      )
    }

    credentials.push({ email: user.email, role: user.role, password })
    console.log(`[seed] Created ${user.role.padEnd(22)} ${user.email}`)
  }

  // --- Build Phase 3: demo clients, a project, a job, and a pasted JD ---
  // so the RLS test matrix (docs/build-phase-3-report.md) has real rows to
  // exercise, not just empty tables.
  console.log('[seed] Creating demo clients...')
  const { data: clients, error: clientsError } = await admin
    .from('clients')
    .insert([
      { organization_id: org.id, name: 'Northfield Retail Group', vertical: 'Retail' },
      { organization_id: org.id, name: 'Harborline Food Service Group', vertical: 'Food Service' },
    ])
    .select('id, name')

  if (clientsError || !clients || clients.length < 2) {
    throw new Error(`[seed] Failed to create demo clients: ${clientsError?.message}`)
  }
  // Harborline is seeded so more than one client exists (needed to test
  // that a Client Decision-Maker linked to Northfield cannot see it), but
  // no project is seeded against it in this phase.
  const [northfield] = clients

  // Link the demo client_decision_maker's membership to Northfield — this
  // is what makes their access narrow (their own client only), not the org.
  const clientReviewer = credentials.find((c) => c.role === 'client_decision_maker')
  if (clientReviewer) {
    const { data: reviewerMembership } = await admin
      .from('organization_memberships')
      .select('id')
      .eq('organization_id', org.id)
      .eq('role', 'client_decision_maker')
      .maybeSingle()
    if (reviewerMembership) {
      await admin
        .from('organization_memberships')
        .update({ client_id: northfield!.id })
        .eq('id', reviewerMembership.id)
    }
  }

  console.log('[seed] Creating a demo recruitment project, job, and assignment...')
  const { data: project, error: projectError } = await admin
    .from('recruitment_projects')
    .insert({
      organization_id: org.id,
      client_id: northfield!.id,
      role_title: 'Regional Operations Manager',
      vertical: 'Retail',
      status: 'sourcing',
      is_poc: true,
      target_shortlist_size: 3,
      match_threshold: 70,
      is_draft: false,
    })
    .select('id')
    .single()

  if (projectError || !project) {
    throw new Error(`[seed] Failed to create demo project: ${projectError?.message}`)
  }

  const recruiterMembership = credentials.find((c) => c.role === 'recruiter')
  if (recruiterMembership) {
    const { data: recruiterAuthUser } = await admin
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', org.id)
      .eq('role', 'recruiter')
      .maybeSingle()
    if (recruiterAuthUser) {
      await admin.from('project_assignments').insert({
        organization_id: org.id,
        recruitment_project_id: project.id,
        user_id: recruiterAuthUser.user_id,
        assignment_role: 'lead_recruiter',
      })
    }
  }

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .insert({
      organization_id: org.id,
      recruitment_project_id: project.id,
      title: 'Regional Operations Manager',
      department: 'Store Operations',
      industry: 'Retail',
      employment_type: 'full_time',
      workplace_arrangement: 'on_site',
      location: 'Columbus, OH',
      currency: 'USD',
      max_shortlist_size: 3,
      min_match_threshold: 70,
    })
    .select('id')
    .single()

  if (jobError || !job) {
    throw new Error(`[seed] Failed to create demo job: ${jobError?.message}`)
  }

  await admin.from('job_descriptions').insert({
    organization_id: org.id,
    job_id: job.id,
    source: 'pasted',
    raw_text:
      'Regional Operations Manager — oversee P&L and day-to-day operations for 40+ retail locations across a multi-state territory. Requires 8+ years of multi-unit retail operations experience.',
    version_no: 1,
    status: 'parsed',
  })

  console.log(`[seed] Done. Organization id: ${org.id}`)

  if (printPasswords) {
    console.log('\n[seed] Demo credentials (shown once, not persisted anywhere by this script):')
    for (const c of credentials) {
      console.log(`  ${c.email.padEnd(30)} role=${c.role.padEnd(22)} password=${c.password}`)
    }
  } else {
    console.log(
      '[seed] Passwords were not printed. Re-run with --print-passwords, or use "Forgot password" ' +
        'from the sign-in screen to set a known password for a demo account.',
    )
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
