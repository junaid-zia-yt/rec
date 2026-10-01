/**
 * seed-demo.ts — Build Phase 17D Wave A ("Private Client Demo Readiness").
 *
 * ============================================================================
 * THIS SCRIPT MUST NEVER BE POINTED AT A PRODUCTION DATABASE. IT WRITES
 * CLEARLY-SYNTHETIC, FICTIONAL DEMONSTRATION DATA (NO REAL CANDIDATE, CLIENT,
 * OR CONTACT INFORMATION), BUT EVERY ROW BELOW IS WRITTEN VIA THE SUPABASE
 * SERVICE ROLE KEY, WHICH BYPASSES ROW-LEVEL SECURITY ENTIRELY.
 * ============================================================================
 *
 * WHAT THIS IS FOR: a private, client-facing demonstration (Dave has not
 * approved a paid implementation — no real cloud infrastructure exists or is
 * implied by this script). It is a DISTINCT script from `seed.ts` (a generic
 * local/dev seed) and `seed-staging.ts` (CI-only staging UAT fixtures,
 * derived from `lib/ai/eval-fixtures/`) — a different organization name, a
 * different demo email domain, and a different candidate/job dataset from
 * both, so the three seed scripts' output can never be confused with one
 * another in any environment where more than one has ever been run.
 *
 * Safety rail: refuses to run at all unless `ALLOW_DEMO_SEED` is exactly the
 * string `true` — same lightweight, deliberate guard as `seed-staging.ts`'s
 * `ALLOW_STAGING_SEED` (see that file's header for the full reasoning).
 *
 * THE CORE TECHNICAL PROPERTY OF THIS WAVE: every gate result, mandatory-gate
 * pass/fail, overall score, evidence-coverage/data-completeness percentage,
 * and evidence excerpt this demo displays is a REAL output of the REAL
 * deterministic matching pipeline (`lib/matching/matching-pipeline.ts` ->
 * `runMatchingPipeline` -> `lib/matching/evaluate.ts`'s
 * `computeDeterministicMatchResult`, via `lib/matching/gates.ts` /
 * `lib/matching/scoring.ts`) — never hand-typed numbers. The only thing
 * "sample" about this data is the AI SEMANTIC-RELEVANCE INPUT layer: instead
 * of a live Anthropic call, `lib/matching/demo-sample-assessment-provider.ts`
 * supplies a deterministic, offline, clearly-labelled
 * (`ai_runs.model = 'sample-assessment-v1'`) stand-in that matches each
 * frozen requirement's name against the candidate's real, structured
 * evidence rows (candidate_experiences/_education/_certifications/_skills,
 * same tables the real CV-parsing pipeline writes to — just fictional
 * content). Candidate CVs are never uploaded/parsed here (no document
 * pipeline is exercised) — this wave seeds already-structured, ALREADY-
 * VERIFIED candidate records directly, exactly the shape a human-reviewed
 * CV-parse would have produced.
 *
 * What this seeds, all under one demo organization:
 *   - 4 users, one per role (agency_admin, recruiter, client_decision_maker,
 *     read_only_reviewer), email domain @private-demo.rqi.local — distinct
 *     from seed.ts's @demo.rqi.local and seed-staging.ts's
 *     @staging-demo.rqi.local.
 *   - 1 fictional client, 2 fictional roles (a "standard" Shift Lead role and
 *     a "senior/difficult" District Manager role), each with a pasted JD, an
 *     approved+active scorecard, and mandatory+preferred requirements.
 *   - 5 fictional candidates per role (10 total): 2 clear passes, 1 clear
 *     mandatory-gate fail, 1 borderline (preferred-only ambiguity, mandatory
 *     gates clean), 1 missing-information case (zero evidence for one
 *     mandatory gate -> insufficient_evidence/pending_verification, never
 *     guessed) — demonstrating Core Rules #4 and #6 side by side.
 *   - For each candidate: real candidate_experiences/_certifications/_skills
 *     rows, run through the real deterministic pipeline via the sample
 *     assessment provider -> real matching_runs/ai_runs/
 *     candidate_role_matches/mandatory_gate_results/requirement_evidence/
 *     scoring_breakdowns rows.
 *   - A human review decision (requires_verification, with a reason) for
 *     each role's borderline candidate.
 *   - A 3-candidate shortlist per role, built only from gate-passing
 *     candidates via the real `canAddCandidateToShortlist` rule.
 *   - One drafted (never sent) outreach email per role for an eligible
 *     candidate, status 'drafted'.
 *
 * Idempotency: NOT idempotent, deliberately — a second run creates a second
 * demo organization (distinguishable by its created_at). Use
 * `reset-demo.ts` to wipe and reseed cleanly before/after a client meeting.
 *
 * Usage:
 *   ALLOW_DEMO_SEED=true \
 *   NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   pnpm --filter web seed:demo
 */
import { randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { FrozenRequirement } from '@rqi/types'
import type {
  CandidateEvidenceBundleItem,
  TrustedMatchingContext,
} from '../lib/ai/matching-provider'
import { buildCandidateEvidenceBundle } from '../lib/matching/evidence-bundle'
import { runMatchingPipeline } from '../lib/matching/matching-pipeline'
import { deriveGateState } from '../lib/matching/gates'
import { canAddCandidateToShortlist, nextShortlistRank } from '../lib/shortlists/rules'
import { SampleAssessmentMatchingProvider } from '../lib/matching/demo-sample-assessment-provider'

export const DEMO_ORG_NAME = 'Brightside Talent Partners (Private Demo)'
export const DEMO_EMAIL_DOMAIN = 'private-demo.rqi.local'

function requireEnv() {
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error(
      '[seed-demo] Refusing to run: ALLOW_DEMO_SEED is not set to "true". ' +
        "This is a deliberate safety rail — see this file's header comment. " +
        'Set ALLOW_DEMO_SEED=true only when NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ' +
        'point at a database that is safe to fill with fictional demo data, never production.',
    )
    process.exit(1)
  }
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '[seed-demo] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.',
    )
    process.exit(1)
  }
  return { SUPABASE_URL, SERVICE_ROLE_KEY }
}

function randomPassword(): string {
  return randomBytes(24).toString('base64url')
}

const DEMO_USERS = [
  {
    fullName: 'Demo Agency Admin',
    email: `admin@${DEMO_EMAIL_DOMAIN}`,
    role: 'agency_admin' as const,
  },
  {
    fullName: 'Demo Recruiter',
    email: `recruiter@${DEMO_EMAIL_DOMAIN}`,
    role: 'recruiter' as const,
  },
  {
    fullName: 'Demo Client Reviewer',
    email: `client-reviewer@${DEMO_EMAIL_DOMAIN}`,
    role: 'client_decision_maker' as const,
  },
  {
    fullName: 'Demo Read-Only Reviewer',
    email: `read-only@${DEMO_EMAIL_DOMAIN}`,
    role: 'read_only_reviewer' as const,
  },
]

interface DemoRequirementDef {
  name: string
  type: 'mandatory' | 'preferred'
  weight: number | null
}

export interface DemoRoleDef {
  title: string
  department: string
  location: string
  rawJobDescription: string
  requirements: DemoRequirementDef[]
}

export interface DemoCandidateDef {
  name: string
  scenario: 'clear_pass' | 'clear_fail' | 'borderline' | 'missing_information'
  currentTitle: string
  currentCompany: string
  experiences: Array<{
    company: string
    title: string
    startDate: string
    endDate: string | null
    isCurrent: boolean
    description: string
  }>
  certifications: Array<{
    name: string
    issuingBody: string
    issuedDate: string
    expiresDate: string
  }>
  skills: Array<{ skillName: string; proficiency?: string; yearsExperience?: number }>
}

export const SHIFT_LEAD_ROLE: DemoRoleDef = {
  title: 'Shift Lead, Quick Serve Restaurant',
  department: 'Store Operations',
  location: 'Tempe, AZ',
  rawJobDescription: `Shift Lead, Quick Serve Restaurant — Fictional Sunrise Quick Serve Co (private demo, fictional posting)

MUST: 1+ years shift-lead experience in food service
MUST: valid food handler certification
PREFERRED(60): weekend and evening availability
PREFERRED(40): cash handling and register reconciliation experience
`,
  requirements: [
    { name: '1+ years shift-lead experience in food service', type: 'mandatory', weight: null },
    { name: 'valid food handler certification', type: 'mandatory', weight: null },
    { name: 'weekend and evening availability', type: 'preferred', weight: 60 },
    {
      name: 'cash handling and register reconciliation experience',
      type: 'preferred',
      weight: 40,
    },
  ],
}

export const DISTRICT_MANAGER_ROLE: DemoRoleDef = {
  title: 'District Manager, Convenience Retail',
  department: 'Field Operations',
  location: 'Multi-site — Central Texas',
  rawJobDescription: `District Manager, Convenience Retail — Fictional Lone Star C-Store Group (private demo, fictional posting)

MUST: 5+ years multi-unit convenience retail management experience
MUST: valid driver's license
PREFERRED(70): P&L ownership across multiple locations
PREFERRED(30): loss prevention program experience
`,
  requirements: [
    {
      name: '5+ years multi-unit convenience retail management experience',
      type: 'mandatory',
      weight: null,
    },
    { name: "valid driver's license", type: 'mandatory', weight: null },
    { name: 'P&L ownership across multiple locations', type: 'preferred', weight: 70 },
    { name: 'loss prevention program experience', type: 'preferred', weight: 30 },
  ],
}

export const SHIFT_LEAD_CANDIDATES: DemoCandidateDef[] = [
  {
    name: 'Dana Prepwell',
    scenario: 'clear_pass',
    currentTitle: 'Shift Lead',
    currentCompany: 'Fictional Sunrise Quick Serve Co',
    experiences: [
      {
        company: 'Fictional Quick Bites Co',
        title: 'Shift Lead',
        startDate: '2022-03-01',
        endDate: null,
        isCurrent: true,
        description:
          'Directly states 1+ years shift-lead experience in food service, with opening/closing responsibility. Resume states weekend and evening availability for the current role.',
      },
    ],
    certifications: [
      {
        name: 'Food Handler Card — valid food handler certification on file',
        issuingBody: 'State Food Safety Authority',
        issuedDate: '2023-01-15',
        expiresDate: '2027-01-15',
      },
    ],
    skills: [
      {
        skillName:
          'cash handling and register reconciliation experience, balanced drawer nightly for 18 months',
        proficiency: 'advanced',
      },
    ],
  },
  {
    name: 'Imani Closeout',
    scenario: 'clear_pass',
    currentTitle: 'Shift Lead',
    currentCompany: 'Fictional Griddle & Go Co',
    experiences: [
      {
        company: 'Fictional Griddle & Go Co',
        title: 'Shift Lead',
        startDate: '2021-06-01',
        endDate: '2026-01-01',
        isCurrent: false,
        description:
          'Directly states 1+ years shift-lead experience in food service. Confirms weekend and evening availability for all scheduled shifts.',
      },
    ],
    certifications: [
      {
        name: 'ServSafe Food Handler — valid food handler certification',
        issuingBody: 'National Registry of Food Safety Professionals',
        issuedDate: '2022-05-01',
        expiresDate: '2027-05-01',
      },
    ],
    skills: [
      {
        skillName:
          'cash handling and register reconciliation experience across two register stations',
        proficiency: 'advanced',
      },
    ],
  },
  {
    name: 'Reggie Lapsecard',
    scenario: 'clear_fail',
    currentTitle: 'Shift Lead',
    currentCompany: 'Fictional Late Bite Co',
    experiences: [
      {
        company: 'Fictional Late Bite Co',
        title: 'Shift Lead',
        startDate: '2020-02-01',
        endDate: null,
        isCurrent: true,
        description: 'Directly states 1+ years shift-lead experience in food service.',
      },
    ],
    certifications: [
      {
        name: "FAIL: valid food handler certification requirement — candidate's food handler card expired in 2021 and was never renewed",
        issuingBody: 'State Food Safety Authority',
        issuedDate: '2018-01-01',
        expiresDate: '2021-01-01',
      },
    ],
    skills: [],
  },
  {
    name: 'Sasha Crossshift',
    scenario: 'borderline',
    currentTitle: 'Shift Lead',
    currentCompany: 'Fictional Corner Grill Co',
    experiences: [
      {
        company: 'Fictional Corner Grill Co',
        title: 'Shift Lead',
        startDate: '2022-09-01',
        endDate: null,
        isCurrent: true,
        description:
          'Directly states 1+ years shift-lead experience in food service. Resume states weekend and evening availability for the current role.',
      },
    ],
    certifications: [
      {
        name: 'Food Handler Card — valid food handler certification',
        issuingBody: 'State Food Safety Authority',
        issuedDate: '2023-04-01',
        expiresDate: '2027-04-01',
      },
    ],
    skills: [
      {
        skillName: 'cash handling and register reconciliation experience during peak-hour shifts',
      },
    ],
  },
  {
    name: 'Noor Unlisted',
    scenario: 'missing_information',
    currentTitle: 'Shift Lead',
    currentCompany: 'Fictional General Quick Serve Co',
    experiences: [
      {
        company: 'Fictional General Quick Serve Co',
        title: 'Shift Lead',
        startDate: '2023-01-01',
        endDate: null,
        isCurrent: true,
        description: 'Directly states 1+ years shift-lead experience in food service.',
      },
      // Deliberately no certification and no availability/cash-handling
      // evidence at all — the mandatory food-handler-certification gate has
      // zero matching evidence, which must resolve to insufficient_evidence,
      // never an assumed pass.
    ],
    certifications: [],
    skills: [],
  },
]

// A separate, unverified reference-letter-style note for Sasha Crossshift's
// borderline case — added directly to the evidence bundle below (not a
// structured candidate_* table row, mirroring candidate-fixtures.ts's own
// borderline pattern of one indirect, conflicting item).
export const SASHA_CONFLICTING_NOTE: CandidateEvidenceBundleItem = {
  sourceKind: 'extracted_field',
  sourceId: null,
  text: 'A manager reference call suggests actual weekend and evening availability may be more limited than the resume states — an indirect, inferred note that conflicts with the direct resume statement above.',
  isDirectStatement: false,
}

export const DISTRICT_MANAGER_CANDIDATES: DemoCandidateDef[] = [
  {
    name: 'Victor Multiunit',
    scenario: 'clear_pass',
    currentTitle: 'District Manager',
    currentCompany: 'Fictional Lone Star C-Store Group',
    experiences: [
      {
        company: 'Fictional Plains Fuel & Mart Co',
        title: 'District Manager',
        startDate: '2018-01-01',
        endDate: null,
        isCurrent: true,
        description:
          'Directly states 5+ years multi-unit convenience retail management experience, overseeing 9 locations. Held full P&L ownership across multiple locations for the district.',
      },
    ],
    certifications: [
      {
        name: "Driver's license on file — valid driver's license",
        issuingBody: 'Texas Department of Public Safety',
        issuedDate: '2015-01-01',
        expiresDate: '2029-01-01',
      },
    ],
    skills: [
      {
        skillName:
          'loss prevention program experience, ran district-wide shrink-reduction initiative',
      },
    ],
  },
  {
    name: 'Faye Districtworth',
    scenario: 'clear_pass',
    currentTitle: 'District Manager',
    currentCompany: 'Fictional Rangeview Retail Group',
    experiences: [
      {
        company: 'Fictional Rangeview Retail Group',
        title: 'District Manager',
        startDate: '2017-03-01',
        endDate: '2026-01-01',
        isCurrent: false,
        description:
          'Directly states 5+ years multi-unit convenience retail management experience across 12 stores. P&L ownership across multiple locations, full district budget authority.',
      },
    ],
    certifications: [
      {
        name: "Class C driver's license — valid driver's license",
        issuingBody: 'Texas Department of Public Safety',
        issuedDate: '2012-06-01',
        expiresDate: '2028-06-01',
      },
    ],
    skills: [{ skillName: 'loss prevention program experience across a 12-store district' }],
  },
  {
    name: 'Owen Norenewal',
    scenario: 'clear_fail',
    currentTitle: 'District Manager',
    currentCompany: 'Fictional Crossroads Fuel Co',
    experiences: [
      {
        company: 'Fictional Crossroads Fuel Co',
        title: 'District Manager',
        startDate: '2016-01-01',
        endDate: null,
        isCurrent: true,
        description:
          'Directly states 5+ years multi-unit convenience retail management experience.',
      },
    ],
    certifications: [
      {
        name: "FAIL: valid driver's license requirement — candidate's license was suspended in 2024 and has not been reinstated",
        issuingBody: 'Texas Department of Public Safety',
        issuedDate: '2010-01-01',
        expiresDate: '2024-01-01',
      },
    ],
    skills: [],
  },
  {
    name: 'Priti Scopeblur',
    scenario: 'borderline',
    currentTitle: 'District Manager',
    currentCompany: 'Fictional Trailhead Convenience Co',
    experiences: [
      {
        company: 'Fictional Trailhead Convenience Co',
        title: 'District Manager',
        startDate: '2019-05-01',
        endDate: null,
        isCurrent: true,
        description:
          'Directly states 5+ years multi-unit convenience retail management experience. Resume states P&L ownership across multiple locations for a 4-store cluster.',
      },
    ],
    certifications: [
      {
        name: "Valid driver's license, clean record",
        issuingBody: 'Texas Department of Public Safety',
        issuedDate: '2014-02-01',
        expiresDate: '2030-02-01',
      },
    ],
    skills: [{ skillName: 'loss prevention program experience in a prior assistant-manager role' }],
  },
  {
    name: 'Callum Noverify',
    scenario: 'missing_information',
    currentTitle: 'District Manager',
    currentCompany: 'Fictional Roadside Retail Co',
    experiences: [
      {
        company: 'Fictional Roadside Retail Co',
        title: 'District Manager',
        startDate: '2017-08-01',
        endDate: null,
        isCurrent: true,
        description:
          'Directly states 5+ years multi-unit convenience retail management experience.',
      },
      // Deliberately no driver's license evidence at all.
    ],
    certifications: [],
    skills: [],
  },
]

export const PRITI_CONFLICTING_NOTE: CandidateEvidenceBundleItem = {
  sourceKind: 'extracted_field',
  sourceId: null,
  text: 'A prior regional VP reference estimates P&L ownership across multiple locations may have been closer to 2 stores under informal oversight, not the full 4-store cluster the resume states — an indirect, inferred estimate that conflicts with the resume figure above.',
  isDirectStatement: false,
}

async function main() {
  const { SUPABASE_URL, SERVICE_ROLE_KEY } = requireEnv()
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`[seed-demo] Target: ${SUPABASE_URL}`)
  const result = await seedDemoData(admin)
  console.log(`[seed-demo] Done. Organization id: ${result.organizationId}`)
  console.log(
    '[seed-demo] Demo user passwords were not printed (never persisted by this script). ' +
      'Use "Forgot password" from the sign-in screen to set a known password for a demo account.',
  )
}

export interface SeedDemoResult {
  organizationId: string
  clientId: string
}

/** The full seeding routine, exported so reset-demo.ts can call it directly after a cleanup, without shelling out to a second process. */
export async function seedDemoData(admin: SupabaseClient): Promise<SeedDemoResult> {
  console.log(`[seed-demo] Creating demo organization "${DEMO_ORG_NAME}"...`)
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: DEMO_ORG_NAME, plan: 'trial' })
    .select('id')
    .single()
  if (orgError || !org) {
    throw new Error(`[seed-demo] Failed to create demo organization: ${orgError?.message}`)
  }
  const organizationId = org.id as string

  const userIdByRole: Record<string, string> = {}
  for (const user of DEMO_USERS) {
    const password = randomPassword()
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    })
    if (userError || !created.user) {
      throw new Error(`[seed-demo] Failed to create user ${user.email}: ${userError?.message}`)
    }
    const { error: membershipError } = await admin.from('organization_memberships').insert({
      organization_id: organizationId,
      user_id: created.user.id,
      role: user.role,
      status: 'active',
      is_default: true,
    })
    if (membershipError) {
      throw new Error(
        `[seed-demo] Failed to create membership for ${user.email}: ${membershipError.message}`,
      )
    }
    userIdByRole[user.role] = created.user.id
    console.log(`[seed-demo] Created ${user.role.padEnd(22)} ${user.email}`)
  }

  const recruiterId = userIdByRole.recruiter!
  const clientReviewerId = userIdByRole.client_decision_maker!

  console.log('[seed-demo] Creating demo client...')
  const { data: client, error: clientError } = await admin
    .from('clients')
    .insert({
      organization_id: organizationId,
      name: 'Fictional Sunbelt Retail Holdings',
      vertical: 'Retail / Food Service',
      status: 'active',
    })
    .select('id')
    .single()
  if (clientError || !client) {
    throw new Error(`[seed-demo] Failed to create demo client: ${clientError?.message}`)
  }
  const clientId = client.id as string

  await admin
    .from('organization_memberships')
    .update({ client_id: clientId })
    .eq('organization_id', organizationId)
    .eq('user_id', clientReviewerId)

  for (const [role, candidates] of [
    [SHIFT_LEAD_ROLE, SHIFT_LEAD_CANDIDATES],
    [DISTRICT_MANAGER_ROLE, DISTRICT_MANAGER_CANDIDATES],
  ] as const) {
    await seedRole({
      admin,
      organizationId,
      clientId,
      recruiterId,
      role,
      candidates,
      extraConflictingNote:
        role === SHIFT_LEAD_ROLE ? SASHA_CONFLICTING_NOTE : PRITI_CONFLICTING_NOTE,
    })
  }

  return { organizationId, clientId }
}

async function seedRole(params: {
  admin: SupabaseClient
  organizationId: string
  clientId: string
  recruiterId: string
  role: DemoRoleDef
  candidates: DemoCandidateDef[]
  extraConflictingNote: CandidateEvidenceBundleItem
}) {
  const { admin, organizationId, clientId, recruiterId, role, candidates, extraConflictingNote } =
    params

  console.log(`[seed-demo] Creating role "${role.title}"...`)

  const { data: project, error: projectError } = await admin
    .from('recruitment_projects')
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      role_title: role.title,
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
    throw new Error(
      `[seed-demo] Failed to create project for ${role.title}: ${projectError?.message}`,
    )
  }
  const recruitmentProjectId = project.id as string

  await admin.from('project_assignments').insert({
    organization_id: organizationId,
    recruitment_project_id: recruitmentProjectId,
    user_id: recruiterId,
    assignment_role: 'lead_recruiter',
  })

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .insert({
      organization_id: organizationId,
      recruitment_project_id: recruitmentProjectId,
      title: role.title,
      department: role.department,
      industry: 'Retail',
      employment_type: 'full_time',
      workplace_arrangement: 'on_site',
      location: role.location,
      currency: 'USD',
      max_shortlist_size: 3,
      min_match_threshold: 70,
    })
    .select('id')
    .single()
  if (jobError || !job) {
    throw new Error(`[seed-demo] Failed to create job for ${role.title}: ${jobError?.message}`)
  }
  const jobId = job.id as string

  await admin.from('job_descriptions').insert({
    organization_id: organizationId,
    job_id: jobId,
    source: 'pasted',
    raw_text: role.rawJobDescription,
    version_no: 1,
    status: 'parsed',
  })

  const { data: reqRows, error: reqError } = await admin
    .from('job_requirements')
    .insert(
      role.requirements.map((req) => ({
        organization_id: organizationId,
        job_id: jobId,
        name: req.name,
        type: req.type,
        weight: req.weight,
        ai_generated: false,
        status: 'reviewed',
      })),
    )
    .select('id, name, type, weight')
  if (reqError || !reqRows) {
    throw new Error(
      `[seed-demo] Failed to create requirements for ${role.title}: ${reqError?.message}`,
    )
  }

  const { data: scorecard, error: scorecardError } = await admin
    .from('scorecards')
    .insert({ organization_id: organizationId, job_id: jobId, status: 'approved' })
    .select('id')
    .single()
  if (scorecardError || !scorecard) {
    throw new Error(
      `[seed-demo] Failed to create scorecard for ${role.title}: ${scorecardError?.message}`,
    )
  }

  const requirementSnapshot = reqRows.map((r) => ({
    requirementId: r.id,
    type: r.type,
    weight: r.weight,
  }))

  const { data: scorecardVersion, error: versionError } = await admin
    .from('scorecard_versions')
    .insert({
      organization_id: organizationId,
      scorecard_id: scorecard.id,
      version_no: 1,
      status: 'active',
      requirement_snapshot: requirementSnapshot,
      approved_by: recruiterId,
      approved_at: new Date().toISOString(),
      created_by: recruiterId,
    })
    .select('id')
    .single()
  if (versionError || !scorecardVersion) {
    throw new Error(
      `[seed-demo] Failed to create active scorecard version for ${role.title}: ${versionError?.message}`,
    )
  }

  await admin
    .from('scorecards')
    .update({ current_version_id: scorecardVersion.id, status: 'approved' })
    .eq('id', scorecard.id)

  const frozenRequirements: FrozenRequirement[] = reqRows.map((r) => ({
    requirementId: r.id as string,
    name: r.name as string,
    type: r.type as 'mandatory' | 'preferred',
    weight: r.weight as number | null,
  }))

  const trustedContext: TrustedMatchingContext = {
    jobTitle: role.title,
    requirements: frozenRequirements.map((r) => ({
      requirementId: r.requirementId,
      name: r.name,
      description: '',
      evidenceExpected: '',
      type: r.type,
      weight: r.weight,
    })),
  }
  void trustedContext // shape reference only; runMatchingPipeline rebuilds its own trustedContext from frozenRequirements below.

  console.log(
    `[seed-demo] Creating ${candidates.length} fictional candidates for "${role.title}" and running the real deterministic pipeline against each...`,
  )

  const eligibleMatches: Array<{
    candidateId: string
    candidateName: string
    candidateRoleMatchId: string
    matchingRunId: string
  }> = []
  let borderlineMatch: { candidateRoleMatchId: string; matchingRunId: string } | null = null
  let firstEligibleForOutreach: {
    candidateId: string
    candidateName: string
    candidateRoleMatchId: string
    recruitmentProjectId: string
  } | null = null

  for (const candidateDef of candidates) {
    const { data: candidate, error: candidateError } = await admin
      .from('candidates')
      .insert({
        organization_id: organizationId,
        full_name: candidateDef.name,
        primary_email: `${slugify(candidateDef.name)}@example-candidate.private-demo.rqi.local`,
        created_by: recruiterId,
      })
      .select('id')
      .single()
    if (candidateError || !candidate) {
      console.error(`[seed-demo] Skipping ${candidateDef.name}: ${candidateError?.message}`)
      continue
    }
    const candidateId = candidate.id as string

    await admin.from('candidate_profiles').insert({
      organization_id: organizationId,
      candidate_id: candidateId,
      current_title: candidateDef.currentTitle,
      current_company: candidateDef.currentCompany,
      recruiter_notes: `Private-demo fixture — scenario: ${candidateDef.scenario}. Fictional candidate, never a real person.`,
    })

    const { data: expRows } = await admin
      .from('candidate_experiences')
      .insert(
        candidateDef.experiences.map((e) => ({
          organization_id: organizationId,
          candidate_id: candidateId,
          company: e.company,
          title: e.title,
          start_date: e.startDate,
          end_date: e.endDate,
          is_current: e.isCurrent,
          description: e.description,
        })),
      )
      .select('id, company, title, location, start_date, end_date, is_current, description')

    const { data: certRows } = candidateDef.certifications.length
      ? await admin
          .from('candidate_certifications')
          .insert(
            candidateDef.certifications.map((c) => ({
              organization_id: organizationId,
              candidate_id: candidateId,
              name: c.name,
              issuing_body: c.issuingBody,
              issued_date: c.issuedDate,
              expires_date: c.expiresDate,
            })),
          )
          .select('id, name, issuing_body, issued_date, expires_date')
      : { data: [] }

    const { data: skillRows } = candidateDef.skills.length
      ? await admin
          .from('candidate_skills')
          .insert(
            candidateDef.skills.map((s) => ({
              organization_id: organizationId,
              candidate_id: candidateId,
              skill_name: s.skillName,
              proficiency: s.proficiency ?? null,
              years_experience: s.yearsExperience ?? null,
            })),
          )
          .select('id, skill_name, proficiency, years_experience')
      : { data: [] }

    const evidence = buildCandidateEvidenceBundle({
      profile: null,
      experiences: (expRows ?? []).map((r) => ({
        id: r.id as string,
        company: r.company as string,
        title: r.title as string,
        location: r.location as string | null,
        startDate: r.start_date as string | null,
        endDate: r.end_date as string | null,
        isCurrent: r.is_current as boolean,
        description: r.description as string | null,
      })),
      education: [],
      certifications: (certRows ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        issuingBody: r.issuing_body as string | null,
        issuedDate: r.issued_date as string | null,
        expiresDate: r.expires_date as string | null,
      })),
      skills: (skillRows ?? []).map((r) => ({
        id: r.id as string,
        skillName: r.skill_name as string,
        proficiency: r.proficiency as string | null,
        yearsExperience: r.years_experience as number | null,
      })),
      extractedFields: [],
    })

    if (candidateDef.scenario === 'borderline') {
      evidence.push(extraConflictingNote)
    }

    const pipelineResult = await runMatchingPipeline({
      jobTitle: role.title,
      requirements: frozenRequirements,
      candidateEvidence: evidence,
      aiProvider: new SampleAssessmentMatchingProvider(),
    })

    if (pipelineResult.status !== 'completed' || !pipelineResult.deterministic) {
      console.error(
        `[seed-demo] Sample assessment pipeline failed for ${candidateDef.name}: ${pipelineResult.errorMessage}`,
      )
      continue
    }
    const det = pipelineResult.deterministic

    const idempotencyKey = `demo:${candidateId}:${jobId}:1`
    const { data: run, error: runError } = await admin
      .from('matching_runs')
      .insert({
        organization_id: organizationId,
        candidate_id: candidateId,
        job_id: jobId,
        recruitment_project_id: recruitmentProjectId,
        scorecard_id: scorecard.id,
        scorecard_version_id: scorecardVersion.id,
        status: 'completed',
        trigger_reason: 'initial_evaluation',
        trigger_note: 'Private demo seed — sample assessment provider, not a live AI call.',
        requested_by: recruiterId,
        idempotency_key: idempotencyKey,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (runError || !run) {
      console.error(
        `[seed-demo] Failed to write matching_runs for ${candidateDef.name}: ${runError?.message}`,
      )
      continue
    }
    const runId = run.id as string

    const { data: aiRun } = await admin
      .from('ai_runs')
      .insert({
        organization_id: organizationId,
        workflow_type: 'candidate_matching',
        model: pipelineResult.ai.model ?? 'sample-assessment-v1',
        prompt_version: pipelineResult.ai.promptVersion,
        status: pipelineResult.ai.status,
        input_ref: `demo:${candidateId}:${jobId}`,
        output_json: pipelineResult.ai.rawOutput,
        confidence: det.weighted.confidence,
        idempotency_key: idempotencyKey,
        created_by: recruiterId,
      })
      .select('id')
      .single()

    await admin
      .from('matching_runs')
      .update({ ai_run_id: aiRun?.id ?? null })
      .eq('id', runId)

    const { data: match, error: matchError } = await admin
      .from('candidate_role_matches')
      .upsert(
        {
          organization_id: organizationId,
          candidate_id: candidateId,
          job_id: jobId,
          recruitment_project_id: recruitmentProjectId,
          scorecard_version_id: scorecardVersion.id,
          latest_matching_run_id: runId,
          eligibility: det.eligibility,
          overall_score: det.weighted.overallScore,
          evidence_coverage_pct: det.weighted.evidenceCoveragePct,
          data_completeness_pct: det.weighted.dataCompletenessPct,
          confidence: det.weighted.confidence,
          review_status: 'pending',
        },
        { onConflict: 'candidate_id,job_id' },
      )
      .select('id')
      .single()
    if (matchError || !match) {
      console.error(
        `[seed-demo] Failed to write candidate_role_matches for ${candidateDef.name}: ${matchError?.message}`,
      )
      continue
    }
    const matchId = match.id as string

    const assessmentByRequirement = new Map(
      pipelineResult.ai.validated!.assessments.map((a) => [a.requirementId, a]),
    )

    const gateRows = det.gates.map((gate) => {
      const assessment = assessmentByRequirement.get(gate.requirementId)
      return {
        organization_id: organizationId,
        matching_run_id: runId,
        candidate_role_match_id: matchId,
        requirement_id: gate.requirementId,
        requirement_name: gate.requirementName,
        deterministic_result: gate.deterministicResult,
        ai_suggested_result: assessment?.gateSuggestion ?? null,
        ai_suggestion_note: assessment?.explanation ?? null,
        risk_notes: assessment?.riskNotes ?? [],
        state: deriveGateState(gate.deterministicResult),
      }
    })
    if (gateRows.length > 0) await admin.from('mandatory_gate_results').insert(gateRows)

    const evidenceRows = pipelineResult.ai.validated!.assessments.flatMap((assessment) =>
      assessment.evidenceRefs.map((ref) => ({
        organization_id: organizationId,
        matching_run_id: runId,
        candidate_role_match_id: matchId,
        requirement_id: assessment.requirementId,
        candidate_id: candidateId,
        source_kind: ref.sourceKind,
        source_experience_id: ref.sourceKind === 'experience' ? ref.sourceId : null,
        source_education_id: ref.sourceKind === 'education' ? ref.sourceId : null,
        source_certification_id: ref.sourceKind === 'certification' ? ref.sourceId : null,
        source_skill_id: ref.sourceKind === 'skill' ? ref.sourceId : null,
        source_extracted_field_id: ref.sourceKind === 'extracted_field' ? ref.sourceId : null,
        excerpt: ref.excerpt,
        location: ref.location,
        relevance_score: assessment.relevanceScore,
        confidence: assessment.confidence,
        is_direct_statement: ref.isDirectStatement,
      })),
    )
    if (evidenceRows.length > 0) await admin.from('requirement_evidence').insert(evidenceRows)

    const scoringRows = det.criteria.map((criterion) => {
      const assessment = assessmentByRequirement.get(criterion.requirementId)
      return {
        organization_id: organizationId,
        matching_run_id: runId,
        candidate_role_match_id: matchId,
        requirement_id: criterion.requirementId,
        requirement_name: criterion.requirementName,
        weight: criterion.weight,
        raw_score: criterion.rawScore,
        confidence_discount: criterion.confidenceDiscount,
        effective_score: criterion.effectiveScore,
        weighted_contribution: criterion.weightedContribution,
        has_evidence: criterion.hasEvidence,
        risk_notes: assessment?.riskNotes ?? [],
      }
    })
    if (scoringRows.length > 0) await admin.from('scoring_breakdowns').insert(scoringRows)

    let stage: string
    if (det.eligibility === 'ineligible') stage = 'rejected'
    else if (det.eligibility === 'pending_verification') stage = 'eligibility_check'
    else stage = 'quality_review'

    await admin.from('candidate_project_entries').insert({
      organization_id: organizationId,
      candidate_id: candidateId,
      recruitment_project_id: recruitmentProjectId,
      job_id: jobId,
      current_stage: stage,
      client_visible: false,
      added_by: recruiterId,
    })

    console.log(
      `[seed-demo]   ${candidateDef.name.padEnd(20)} scenario=${candidateDef.scenario.padEnd(20)} eligibility=${det.eligibility} score=${det.weighted.overallScore ?? 'n/a'}`,
    )

    if (det.eligibility === 'eligible') {
      eligibleMatches.push({
        candidateId,
        candidateName: candidateDef.name,
        candidateRoleMatchId: matchId,
        matchingRunId: runId,
      })
      if (!firstEligibleForOutreach) {
        firstEligibleForOutreach = {
          candidateId,
          candidateName: candidateDef.name,
          candidateRoleMatchId: matchId,
          recruitmentProjectId,
        }
      }
    }
    if (candidateDef.scenario === 'borderline') {
      borderlineMatch = { candidateRoleMatchId: matchId, matchingRunId: runId }
    }
  }

  // Human review decision on the borderline candidate, with a reason
  // (Core Principle #3/#7: a human makes the final call — the AI only
  // proposed a low-confidence, conflicting-evidence assessment above).
  if (borderlineMatch) {
    await admin
      .from('candidate_role_matches')
      .update({
        review_status: 'requires_verification',
        reviewed_by: recruiterId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', borderlineMatch.candidateRoleMatchId)

    await admin.from('human_reviews').insert({
      organization_id: organizationId,
      candidate_role_match_id: borderlineMatch.candidateRoleMatchId,
      matching_run_id: borderlineMatch.matchingRunId,
      reviewer_id: recruiterId,
      decision: 'requires_verification',
      reason:
        'Preferred-requirement evidence conflicts between the resume and a reference note — asking the candidate to confirm directly before this goes further, even though mandatory gates already pass cleanly.',
    })
  }

  // Drafted (never sent) outreach message for an eligible candidate.
  if (firstEligibleForOutreach) {
    const { data: sequence, error: sequenceError } = await admin
      .from('outreach_sequences')
      .insert({
        organization_id: organizationId,
        candidate_role_match_id: firstEligibleForOutreach.candidateRoleMatchId,
        candidate_id: firstEligibleForOutreach.candidateId,
        recruitment_project_id: firstEligibleForOutreach.recruitmentProjectId,
        job_id: jobId,
        name: `${role.title} outreach — ${firstEligibleForOutreach.candidateName}`,
        status: 'active',
        started_by: recruiterId,
      })
      .select('id')
      .single()

    if (!sequenceError && sequence) {
      await admin.from('outreach_messages').insert({
        organization_id: organizationId,
        outreach_sequence_id: sequence.id,
        candidate_id: firstEligibleForOutreach.candidateId,
        recruitment_project_id: firstEligibleForOutreach.recruitmentProjectId,
        candidate_role_match_id: firstEligibleForOutreach.candidateRoleMatchId,
        channel: 'email',
        status: 'drafted',
        subject: `Quick question about the ${role.title} role`,
        draft_body: `Hi ${firstEligibleForOutreach.candidateName.split(' ')[0]},\n\nYour background lines up well with the ${role.title} opening we're recruiting for. Would you be open to a short call this week to talk through the details?\n\nBest,\nThe recruiting team\n\n[Private demo draft — sample content, never sent.]`,
        personalization_evidence: [],
        generated_by: 'recruiter',
        edited_by_human: false,
        created_by: recruiterId,
      })
    } else if (sequenceError) {
      console.error(`[seed-demo] Failed to create outreach sequence: ${sequenceError.message}`)
    }
  }

  // Shortlist: up to 3 eligible candidates, built via the real shortlist rule.
  if (eligibleMatches.length > 0) {
    const { data: shortlist, error: shortlistError } = await admin
      .from('shortlists')
      .insert({
        organization_id: organizationId,
        recruitment_project_id: recruitmentProjectId,
        job_id: jobId,
        client_id: clientId,
        status: 'draft',
        max_candidates: 3,
        created_by: recruiterId,
      })
      .select('id')
      .single()
    if (shortlistError || !shortlist) {
      console.error(
        `[seed-demo] Failed to create shortlist for ${role.title}: ${shortlistError?.message}`,
      )
      return
    }

    const { data: version, error: versionErr } = await admin
      .from('shortlist_versions')
      .insert({
        organization_id: organizationId,
        shortlist_id: shortlist.id,
        version_number: 1,
        status: 'draft',
        created_by: recruiterId,
      })
      .select('id')
      .single()
    if (versionErr || !version) {
      console.error(
        `[seed-demo] Failed to create shortlist version for ${role.title}: ${versionErr?.message}`,
      )
      return
    }

    await admin.from('shortlists').update({ current_version_id: version.id }).eq('id', shortlist.id)

    const added: Array<{ candidateId: string; rank: number }> = []
    for (const em of eligibleMatches.slice(0, 3)) {
      const violation = canAddCandidateToShortlist({
        shortlist: { maxCandidates: 3, overrideMaxCandidates: false },
        existingCandidates: added.map((a) => ({ candidateId: a.candidateId })),
        candidate: { candidateId: em.candidateId, eligibility: 'eligible' },
      })
      if (violation) {
        console.log(
          `[seed-demo]   Shortlist rule skipped ${em.candidateName}: ${violation.message}`,
        )
        continue
      }
      const rank = nextShortlistRank(added.map((a) => ({ rank: a.rank })))
      const { error: scErr } = await admin.from('shortlist_candidates').insert({
        organization_id: organizationId,
        shortlist_version_id: version.id,
        candidate_role_match_id: em.candidateRoleMatchId,
        candidate_id: em.candidateId,
        matching_run_id: em.matchingRunId,
        scorecard_version_id: scorecardVersion.id,
        rank,
        added_by: recruiterId,
      })
      if (scErr) {
        console.error(
          `[seed-demo] Failed to add ${em.candidateName} to shortlist: ${scErr.message}`,
        )
        continue
      }
      added.push({ candidateId: em.candidateId, rank })

      await admin
        .from('candidate_project_entries')
        .update({ current_stage: 'shortlisted', client_visible: true })
        .eq('candidate_id', em.candidateId)
        .eq('job_id', jobId)
    }
    console.log(`[seed-demo] Built a ${added.length}-candidate shortlist for "${role.title}".`)
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
