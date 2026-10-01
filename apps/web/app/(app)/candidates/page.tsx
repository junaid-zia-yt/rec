import Link from 'next/link'
import { Button, PageHeader } from '@rqi/ui'
import type { CandidatePipelineStage } from '@rqi/types'
import {
  CandidatePipelineView,
  type CandidateListItem,
} from '@/components/domain/candidates/candidate-pipeline-view'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { listDemoProjects, listDemoCandidatesForProject } from '@/lib/demo/engine'

export const metadata = { title: 'Candidates' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

/**
 * Build Phase 18: sourced from the demo engine instead of static,
 * score-less fixtures, so a candidate who has been evaluated actually
 * shows real pipeline progress here (see
 * docs/client-feedback-reproduction-report.md §1 — this list used to show
 * every demo candidate with no score at all, since scores never existed
 * anywhere in the old static fixtures).
 */
function buildDemoListItems(): CandidateListItem[] {
  const projects = listDemoProjects()
  const items: CandidateListItem[] = []
  for (const project of projects) {
    for (const candidate of listDemoCandidatesForProject(project.id)) {
      let stage: CandidatePipelineStage = 'discovered'
      if (candidate.isShortlisted) stage = 'shortlisted'
      else if (candidate.evaluation?.status === 'completed') {
        if (candidate.evaluation.eligibility === 'ineligible') stage = 'rejected'
        else if (candidate.evaluation.eligibility === 'pending_verification') stage = 'eligibility_check'
        else if (candidate.reviewStatus === 'reviewed') stage = 'quality_review'
        else stage = 'scored'
      }
      items.push({
        id: candidate.id,
        fullName: candidate.fullName,
        status: 'active',
        currentTitle: candidate.currentTitle,
        currentCompany: candidate.currentCompany,
        entries: [
          {
            projectId: project.id,
            projectName: project.roleTitle,
            stage,
            clientVisible: candidate.isShortlisted,
          },
        ],
      })
    }
  }
  return items
}

// Build Phase 14 Wave 4 (performance review): the candidate-pipeline board
// below does full client-side search/filter/Kanban grouping across
// whatever this loader returns (apps/web/components/domain/candidates/
// candidate-pipeline-view.tsx) — that UX genuinely needs the full working
// set in the browser, so a server-paginated rewrite here would either
// break "search across every candidate" or require a much larger
// architecture change (server-side search + cursor pagination) that is
// its own scope decision, not a targeted perf fix (see
// docs/performance-report.md, "Candidate list" finding — tracked as
// Medium, not fixed this wave). What IS fixed here: an explicit safety
// cap so a pathologically large organization can never turn this into a
// truly unbounded fetch, and O(1) Map lookups in place of the previous
// O(n*m) `.find()`/`.filter()` scans per candidate.
const CANDIDATE_LIST_SAFETY_LIMIT = 1000

async function loadCandidates(): Promise<{
  items: CandidateListItem[]
  projects: { id: string; name: string }[]
}> {
  if (!supabaseConfigured) {
    return {
      items: buildDemoListItems(),
      projects: listDemoProjects().map((p) => ({ id: p.id, name: p.roleTitle })),
    }
  }

  const user = await requireAuth('/candidates')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const [{ data: candidates }, { data: projects }] = await Promise.all([
    supabase!
      .from('candidates')
      .select('id, full_name, status')
      .eq('organization_id', membership.organizationId)
      .neq('status', 'merged')
      .order('created_at', { ascending: false })
      .limit(CANDIDATE_LIST_SAFETY_LIMIT),
    supabase!
      .from('recruitment_projects')
      .select('id, role_title')
      .eq('organization_id', membership.organizationId),
  ])

  if (!candidates) return { items: [], projects: [] }

  const candidateIds = candidates.map((c) => c.id)
  const [{ data: profiles }, { data: entries }] = await Promise.all([
    candidateIds.length > 0
      ? supabase!
          .from('candidate_profiles')
          .select('candidate_id, current_title, current_company')
          .in('candidate_id', candidateIds)
      : Promise.resolve({
          data: [] as {
            candidate_id: string
            current_title: string | null
            current_company: string | null
          }[],
        }),
    candidateIds.length > 0
      ? supabase!
          .from('candidate_project_entries')
          .select('candidate_id, recruitment_project_id, current_stage, client_visible')
          .in('candidate_id', candidateIds)
      : Promise.resolve({
          data: [] as {
            candidate_id: string
            recruitment_project_id: string
            current_stage: string
            client_visible: boolean
          }[],
        }),
  ])

  type EntryRow = {
    candidate_id: string
    recruitment_project_id: string
    current_stage: string
    client_visible: boolean
  }

  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.role_title as string]))
  const profileByCandidateId = new Map((profiles ?? []).map((p) => [p.candidate_id, p]))
  const entriesByCandidateId = new Map<string, EntryRow[]>()
  for (const entry of (entries ?? []) as EntryRow[]) {
    const list = entriesByCandidateId.get(entry.candidate_id) ?? []
    list.push(entry)
    entriesByCandidateId.set(entry.candidate_id, list)
  }

  const items: CandidateListItem[] = candidates.map((candidate) => {
    const profile = profileByCandidateId.get(candidate.id)
    const candidateEntries = (entriesByCandidateId.get(candidate.id) ?? []).map((e) => ({
      projectId: e.recruitment_project_id,
      projectName: projectNameById.get(e.recruitment_project_id) ?? 'Unknown project',
      stage: e.current_stage as CandidateListItem['entries'][number]['stage'],
      clientVisible: e.client_visible,
    }))

    return {
      id: candidate.id,
      fullName: candidate.full_name,
      status: candidate.status,
      currentTitle: profile?.current_title ?? null,
      currentCompany: profile?.current_company ?? null,
      entries: candidateEntries,
    }
  })

  return {
    items,
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.role_title as string })),
  }
}

/**
 * Candidate Pipeline — Build Phase 5 brief §UI: "Candidate pipeline",
 * "Candidate list", "Filters and search", "Mobile candidate cards". Renders
 * real, RLS-scoped candidates once Supabase is configured; falls back to
 * demo fixtures otherwise (the convention every screen in this app follows).
 */
export default async function CandidatesPage() {
  const { items, projects } = await loadCandidates()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Candidates"
        description="Search, filter, and track candidates through the pipeline."
        actions={
          <Button asChild>
            <Link href="/candidates/new">Add candidate</Link>
          </Button>
        }
      />
      <CandidatePipelineView candidates={items} projects={projects} />
    </div>
  )
}
