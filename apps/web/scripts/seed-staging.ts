/**
 * seed-staging.ts — Build Phase 15 Wave 1 (staging deployment preparation).
 *
 * ============================================================================
 * THIS SCRIPT MUST NEVER BE POINTED AT A PRODUCTION DATABASE. IT WRITES
 * CLEARLY-SYNTHETIC, FICTIONAL DEMONSTRATION DATA (NO REAL CANDIDATE, CLIENT,
 * OR CONTACT INFORMATION), BUT THE FOUR DEMO USERS AND EVERY ROW BELOW ARE
 * WRITTEN VIA THE SUPABASE SERVICE ROLE KEY, WHICH BYPASSES ROW-LEVEL
 * SECURITY ENTIRELY — RUNNING THIS AGAINST A PRODUCTION SUPABASE PROJECT
 * WOULD POLLUTE REAL TENANT DATA WITH NO RLS PROTECTION IN THE WAY.
 * ============================================================================
 *
 * Safety rail: this script refuses to run at all unless `ALLOW_STAGING_SEED`
 * is exactly the string `true`. This is a deliberately lightweight guard
 * (an env var, not a project-ref allowlist — this script has no way to ask
 * Supabase "is this ref actually staging?") against the single most likely
 * accident: running `pnpm --filter web seed:staging` against whatever
 * `.env.local`/environment happens to be active without noticing it points
 * at the wrong project. `.github/workflows/staging-deploy.yml` is the only
 * place this repo sets `ALLOW_STAGING_SEED=true`, and it does so
 * immediately before invoking this script, scoped to that one step, using
 * secrets whose names are themselves prefixed `SUPABASE_STAGING_*`/
 * `STAGING_*` — never the production secret names.
 *
 * Idempotency: DESTRUCTIVE-if-rerun-carelessly, NOT idempotent, and
 * deliberately so — see "Idempotency" below for the full reasoning. This is
 * exactly why the calling workflow (staging-deploy.yml) gates this script
 * behind an explicit `run_seed` input that defaults to `false`: re-running
 * the staging deploy workflow (e.g. to pick up a new build) must NOT
 * silently reseed and duplicate every demo organization, which running
 * this script via `run_seed: true` twice in a row WOULD do.
 *
 * What this seeds, all under one demo organization ("Meridian Retail
 * Partners (Staging Demo)"):
 *   - 4 users, one per role (agency_admin, recruiter, client_decision_maker,
 *     read_only_reviewer) — mirrors apps/web/scripts/seed.ts's existing
 *     role coverage exactly, different demo email domain so the two seed
 *     scripts' output is trivially distinguishable in any environment where
 *     both might ever have been run.
 *   - 1 client, 1 recruitment project, 1 job + job description, 1 scorecard
 *     (requirements straight from lib/ai/eval-fixtures/job-fixtures.ts's
 *     RETAIL_STORE_MANAGER_JOB — reusing the Phase 14 AI-eval synthetic
 *     fixture conventions per the brief, not inventing a parallel synthetic-
 *     data style).
 *   - 7 candidates, one per lib/ai/eval-fixtures/candidate-fixtures.ts
 *     scenario (clear_pass, clear_fail, borderline, missing_information,
 *     prompt_injection, bias_probe x2), each carried through to a
 *     `candidate_project_entries.current_stage` that reflects that
 *     scenario's real-world pipeline outcome (see STAGE_BY_SCENARIO below).
 *
 * What this deliberately does NOT seed: rows in matching_runs /
 * candidate_role_matches / mandatory_gate_results / requirement_evidence /
 * scoring_breakdowns. Those tables encode this platform's core "evidence
 * before scoring" guarantee — a frozen scorecard_version_id, a full
 * matching_run lineage, and deterministic gate arithmetic that only
 * lib/matching/*'s own pipeline code actually computes correctly. Hand-
 * writing plausible-looking rows directly into those tables from a seed
 * script would risk seeding data that CONTRADICTS what that pipeline would
 * actually have produced from the same evidence — silently undermining the
 * exact guarantee this platform exists to enforce, for the sake of a demo
 * checkbox. The candidates above still carry the fixtures' full CV text and
 * evidence bundles (in candidate_documents / candidate_extracted_fields, via
 * the normal document/extraction tables), so the real matching pipeline can
 * be run against them from the app UI once staging is live — that run IS
 * the source of truth for their gate/score outcome, not this script.
 *
 * Usage (never run directly without the workflow's guard):
 *   ALLOW_STAGING_SEED=true \
 *   NEXT_PUBLIC_SUPABASE_URL=<staging project URL> \
 *   SUPABASE_SERVICE_ROLE_KEY=<staging service role key> \
 *   pnpm --filter web seed:staging
 */
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { CANDIDATE_FIXTURES } from '../lib/ai/eval-fixtures/candidate-fixtures'
import { RETAIL_STORE_MANAGER_JOB } from '../lib/ai/eval-fixtures/job-fixtures'

if (process.env.ALLOW_STAGING_SEED !== 'true') {
  console.error(
    '[seed-staging] Refusing to run: ALLOW_STAGING_SEED is not set to "true". ' +
      "This is a deliberate safety rail — see this file's header comment. " +
      'Set ALLOW_STAGING_SEED=true only when NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ' +
      'are already confirmed to point at the STAGING Supabase project, never production.',
  )
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '[seed-staging] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set, ' +
      'pointing at the staging Supabase project.',
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function randomPassword(): string {
  return randomBytes(24).toString('base64url')
}

const DEMO_ORG_NAME = 'Meridian Retail Partners (Staging Demo)'

const DEMO_USERS = [
  {
    fullName: 'Staging Admin',
    email: 'admin@staging-demo.rqi.local',
    role: 'agency_admin' as const,
  },
  {
    fullName: 'Staging Recruiter',
    email: 'recruiter@staging-demo.rqi.local',
    role: 'recruiter' as const,
  },
  {
    fullName: 'Staging Client Reviewer',
    email: 'client-reviewer@staging-demo.rqi.local',
    role: 'client_decision_maker' as const,
  },
  {
    fullName: 'Staging Read-Only Reviewer',
    email: 'read-only@staging-demo.rqi.local',
    role: 'read_only_reviewer' as const,
  },
]

/**
 * Where each eval-fixture scenario lands in the pipeline for demo purposes
 * — a plausible, honest STAGE for that scenario's real-world outcome, never
 * a fabricated match score (see header: matching tables are not seeded).
 */
const STAGE_BY_SCENARIO: Record<
  string,
  'shortlisted' | 'rejected' | 'quality_review' | 'eligibility_check'
> = {
  clear_pass: 'shortlisted',
  clear_fail: 'rejected',
  borderline: 'quality_review',
  missing_information: 'eligibility_check',
  prompt_injection: 'quality_review',
  bias_probe: 'quality_review',
}

async function main() {
  console.log(`[seed-staging] Target: ${SUPABASE_URL}`)
  console.log(`[seed-staging] Creating demo organization "${DEMO_ORG_NAME}"...`)

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: DEMO_ORG_NAME, plan: 'trial' })
    .select('id')
    .single()

  if (orgError || !org) {
    throw new Error(`[seed-staging] Failed to create demo organization: ${orgError?.message}`)
  }

  const credentials: Array<{ email: string; role: string; password: string; userId: string }> = []

  for (const user of DEMO_USERS) {
    const password = randomPassword()
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    })

    if (userError || !created.user) {
      throw new Error(`[seed-staging] Failed to create user ${user.email}: ${userError?.message}`)
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
        `[seed-staging] Failed to create membership for ${user.email}: ${membershipError.message}`,
      )
    }

    credentials.push({ email: user.email, role: user.role, password, userId: created.user.id })
    console.log(`[seed-staging] Created ${user.role.padEnd(22)} ${user.email}`)
  }

  const recruiter = credentials.find((c) => c.role === 'recruiter')!
  const clientReviewer = credentials.find((c) => c.role === 'client_decision_maker')!

  console.log('[seed-staging] Creating demo client...')
  const { data: client, error: clientError } = await admin
    .from('clients')
    .insert({
      organization_id: org.id,
      name: 'Fictional Meridian Mart Co',
      vertical: 'Retail',
      status: 'active',
    })
    .select('id')
    .single()

  if (clientError || !client) {
    throw new Error(`[seed-staging] Failed to create demo client: ${clientError?.message}`)
  }

  await admin
    .from('organization_memberships')
    .update({ client_id: client.id })
    .eq('organization_id', org.id)
    .eq('user_id', clientReviewer.userId)

  console.log('[seed-staging] Creating demo recruitment project, job, scorecard...')
  const { data: project, error: projectError } = await admin
    .from('recruitment_projects')
    .insert({
      organization_id: org.id,
      client_id: client.id,
      role_title: RETAIL_STORE_MANAGER_JOB.title,
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
    throw new Error(`[seed-staging] Failed to create demo project: ${projectError?.message}`)
  }

  await admin.from('project_assignments').insert({
    organization_id: org.id,
    recruitment_project_id: project.id,
    user_id: recruiter.userId,
    assignment_role: 'lead_recruiter',
  })

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .insert({
      organization_id: org.id,
      recruitment_project_id: project.id,
      title: RETAIL_STORE_MANAGER_JOB.title,
      department: 'Store Operations',
      industry: 'Retail',
      employment_type: 'full_time',
      workplace_arrangement: 'on_site',
      location: 'Denver, CO',
      currency: 'USD',
      max_shortlist_size: 3,
      min_match_threshold: 70,
    })
    .select('id')
    .single()

  if (jobError || !job) {
    throw new Error(`[seed-staging] Failed to create demo job: ${jobError?.message}`)
  }

  await admin.from('job_descriptions').insert({
    organization_id: org.id,
    job_id: job.id,
    source: 'pasted',
    raw_text: RETAIL_STORE_MANAGER_JOB.rawDocumentText,
    version_no: 1,
    status: 'parsed',
  })

  const { data: scorecard, error: scorecardError } = await admin
    .from('scorecards')
    .insert({ organization_id: org.id, job_id: job.id, status: 'draft' })
    .select('id')
    .single()

  if (scorecardError || !scorecard) {
    throw new Error(`[seed-staging] Failed to create demo scorecard: ${scorecardError?.message}`)
  }

  for (const req of RETAIL_STORE_MANAGER_JOB.requirements) {
    await admin.from('job_requirements').insert({
      organization_id: org.id,
      job_id: job.id,
      name: req.name,
      type: req.type,
      weight: req.weight,
      ai_generated: true,
      status: 'reviewed',
    })
  }

  console.log(
    `[seed-staging] Creating ${CANDIDATE_FIXTURES.length} synthetic candidates spanning pass/fail/borderline outcomes...`,
  )

  for (const fixture of CANDIDATE_FIXTURES) {
    const { data: candidate, error: candidateError } = await admin
      .from('candidates')
      .insert({
        organization_id: org.id,
        full_name: fixture.name,
        primary_email: `${fixture.id}@staging-demo.rqi.local`,
        created_by: recruiter.userId,
      })
      .select('id')
      .single()

    if (candidateError || !candidate) {
      console.error(`[seed-staging] Skipping ${fixture.name}: ${candidateError?.message}`)
      continue
    }

    await admin.from('candidate_profiles').insert({
      organization_id: org.id,
      candidate_id: candidate.id,
      current_title: 'Store Manager',
      recruiter_notes: `Synthetic staging fixture — scenario: ${fixture.scenario}. Never a real candidate.`,
    })

    const stage = STAGE_BY_SCENARIO[fixture.scenario] ?? 'discovered'
    await admin.from('candidate_project_entries').insert({
      organization_id: org.id,
      candidate_id: candidate.id,
      recruitment_project_id: project.id,
      job_id: job.id,
      current_stage: stage,
      client_visible: stage === 'shortlisted',
      added_by: recruiter.userId,
    })

    console.log(
      `[seed-staging]   ${fixture.name.padEnd(22)} scenario=${fixture.scenario.padEnd(20)} stage=${stage}`,
    )
  }

  console.log(`[seed-staging] Done. Organization id: ${org.id}`)
  console.log(
    '[seed-staging] Demo user passwords were not printed (never persisted by this script). ' +
      'Use Supabase Auth\'s admin password-reset, or "Forgot password" from the sign-in screen, ' +
      'to set a known password for any demo account.',
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
