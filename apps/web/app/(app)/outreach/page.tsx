import { PageHeader } from '@rqi/ui'
import { hasPermission } from '@rqi/types'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { loadOutreachReadyCandidates, loadOutreachSequences } from '@/lib/outreach/load'
import { OutreachQueuePanel } from '@/components/domain/outreach/outreach-queue-panel'
import { DemoOutreachWorkspace } from '@/components/domain/outreach/demo-outreach-workspace'
import { listDemoProjects, listDemoCandidatesForProject, listDemoOutreachTemplates, listDemoOutreachDrafts } from '@/lib/demo/engine'

export const metadata = { title: 'Outreach' }
// Build Phase 18 repair: force dynamic rendering — this was the direct
// cause of outreach appearing permanently empty in a production build:
// the page read the private demo's mutable in-memory engine but Next.js
// statically prerendered it once at build time (before any candidate had
// ever been evaluated), so no eligible candidate ever appeared regardless
// of later evaluations. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

/**
 * Outreach workspace. Build Phase 18 priority #7: the `!supabaseConfigured`
 * branch is now a real, interactive draft + human-approval workflow driven
 * by the private-demo engine — see
 * docs/client-feedback-reproduction-report.md §6 (this screen previously
 * rendered a fixed empty state no matter what happened elsewhere in the
 * demo). No provider is ever called; approving a draft only records a
 * human decision (lib/demo/engine.ts's decideDemoOutreachDraft).
 */
export default async function OutreachPage() {
  if (!supabaseConfigured) {
    const projects = listDemoProjects()
    const eligibleCandidates = projects.flatMap((project) =>
      listDemoCandidatesForProject(project.id)
        .filter((c) => c.evaluation?.eligibility === 'eligible')
        .map((c) => ({ id: c.id, projectId: project.id, fullName: c.fullName, roleTitle: project.roleTitle })),
    )
    const templates = listDemoOutreachTemplates().map((t) => ({
      id: t.id,
      channel: t.channel,
      name: t.name,
    }))
    const projectById = new Map(projects.map((p) => [p.id, p]))
    const candidateById = new Map(
      projects.flatMap((p) => listDemoCandidatesForProject(p.id).map((c) => [c.id, c] as const)),
    )
    const drafts = listDemoOutreachDrafts().map((d) => ({
      id: d.id,
      projectId: d.projectId,
      candidateId: d.candidateId,
      candidateName: candidateById.get(d.candidateId)?.fullName ?? 'Unknown candidate',
      roleTitle: projectById.get(d.projectId)?.roleTitle ?? 'Unknown role',
      channel: d.channel,
      subject: d.subject,
      body: d.body,
      status: d.status,
      createdAt: d.createdAt,
    }))
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Outreach"
          description="Draft and approve candidate outreach. Demo mode — messages are not sent."
        />
        <DemoOutreachWorkspace
          eligibleCandidates={eligibleCandidates}
          templates={templates}
          drafts={drafts}
        />
      </div>
    )
  }

  const user = await requireAuth('/outreach')
  const membership = await resolveActiveOrg(user.id)
  const canStartSequence = hasPermission(membership.role, 'outreach', 'create')

  const [readyCandidates, sequences] = await Promise.all([
    canStartSequence ? loadOutreachReadyCandidates(membership.organizationId) : Promise.resolve([]),
    loadOutreachSequences(membership.organizationId),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Outreach"
        description="Draft, review, approve and send candidate outreach — every send requires human approval first."
      />
      <OutreachQueuePanel
        organizationId={membership.organizationId}
        readyCandidates={readyCandidates}
        sequences={sequences}
        canStartSequence={canStartSequence}
      />
    </div>
  )
}
