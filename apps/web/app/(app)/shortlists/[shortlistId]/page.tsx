import { notFound } from 'next/navigation'
import { hasPermission } from '@rqi/types'
import { Breadcrumbs, Card, CardBody, PageHeader, SectionHeader, StatusBadge } from '@rqi/ui'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import {
  loadEligibleCandidatesForShortlist,
  loadShortlistDetail,
} from '@/lib/shortlists/load-detail'
import { ShortlistBuilderPanel } from '@/components/domain/shortlists/shortlist-builder-panel'
import { ShortlistWorkspacePanel } from '@/components/domain/shortlists/shortlist-workspace-panel'
import { ShortlistDemoView, type DemoShortlistCandidateRow } from './demo-view'
import { getDemoProject, sortDemoCandidates, getDemoShortlistEntries } from '@/lib/demo/engine'

// Build Phase 18 repair: force dynamic rendering explicitly — this page
// reads the private demo's mutable in-memory engine. See
// docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

/**
 * Shortlist workspace (Build Phase 8 brief §"Shortlist"/§"Candidate
 * comparison"/§UI). When this environment is not connected to a live
 * database, or the id does not match a real shortlist row, falls back to
 * the Build Phase 1 Verification Matrix demo view (./demo-view.tsx,
 * unchanged) that reproduces the confirmed Stitch mobile screenshot — the
 * visual source of truth stays the reference for that screen even after
 * this phase's live builder ships, per the project instructions ("Do not
 * redesign the interface without explaining why"; the live view below is
 * additive functionality, not a redesign of the observed screen).
 */
export default async function ShortlistDetailPage({
  params,
}: {
  params: Promise<{ shortlistId: string }>
}) {
  const { shortlistId } = await params

  if (!supabaseConfigured) {
    // `shortlistId` doubles as the demo project id in the private demo —
    // there is exactly one shortlist workspace per demo project (see
    // lib/demo/scenarios.ts). Build Phase 18: replaced the Build Phase 1
    // static Verification-Matrix fixture with the demo engine's real,
    // live-computed candidates for this project.
    const project = getDemoProject(shortlistId)
    if (!project) {
      return <ShortlistDemoView shortlistId={shortlistId} roleTitle={null} clientName={null} maxCandidates={3} eligible={[]} notEligible={[]} shortlisted={[]} shortlistStatus="not_started" />
    }
    const { eligible, notEligible } = sortDemoCandidates(shortlistId, 'score_desc')
    const shortlistEntries = getDemoShortlistEntries(shortlistId)
    const rankByCandidateId = new Map(shortlistEntries.map((e) => [e.candidateId, e.rank]))
    function toRow(c: (typeof eligible)[number]): DemoShortlistCandidateRow {
      const gatesPassed = c.evaluation?.gates.filter((g) => g.result === 'passed').length ?? 0
      const gatesTotal = c.evaluation?.gates.length ?? 0
      return {
        id: c.id,
        fullName: c.fullName,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        reviewStatus: c.reviewStatus,
        isShortlisted: c.isShortlisted,
        shortlistRank: rankByCandidateId.get(c.id) ?? null,
        evaluation: c.evaluation
          ? {
              status: c.evaluation.status,
              eligibility: c.evaluation.eligibility,
              overallScore: c.evaluation.overallScore,
              evidenceCoveragePct: c.evaluation.evidenceCoveragePct,
              gatesPassed,
              gatesTotal,
            }
          : null,
      }
    }
    const eligibleRows = eligible.map(toRow)
    const notEligibleRows = notEligible.map(toRow)
    const shortlistedRows = eligibleRows.filter((r) => r.isShortlisted)
    return (
      <ShortlistDemoView
        shortlistId={shortlistId}
        roleTitle={project.roleTitle}
        clientName={project.clientName}
        maxCandidates={3}
        eligible={eligibleRows}
        notEligible={notEligibleRows}
        shortlisted={shortlistedRows}
        shortlistStatus={project.shortlistStatus}
      />
    )
  }

  const user = await requireAuth(`/shortlists/${shortlistId}`)
  const membership = await resolveActiveOrg(user.id)
  const detail = await loadShortlistDetail(membership.organizationId, shortlistId)
  if (!detail) notFound()

  const canManageInternally = hasPermission(membership.role, 'shortlists', 'update')
  const canDecideAsClient =
    membership.role === 'client_decision_maker' && membership.clientId === detail.clientId

  const isDraft = detail.currentVersionStatus === 'draft'
  const excludeIds = detail.candidates.map((c) => c.candidateId)
  const eligible =
    isDraft && canManageInternally
      ? await loadEligibleCandidatesForShortlist(
          membership.organizationId,
          detail.jobId,
          excludeIds,
        )
      : []

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: 'Shortlists', href: '/shortlists' }, { label: detail.jobTitle }]}
      />

      <PageHeader title={detail.jobTitle} description={`Shortlist for ${detail.clientName}`} />

      {detail.currentVersionId && (
        <ShortlistWorkspacePanel
          organizationId={membership.organizationId}
          shortlistId={detail.id}
          shortlistVersionId={detail.currentVersionId}
          clientId={detail.clientId}
          status={detail.status as never}
          candidateCount={detail.candidates.length}
          canManageInternally={canManageInternally}
          canDecideAsClient={canDecideAsClient}
        />
      )}

      {isDraft && canManageInternally && detail.currentVersionId ? (
        <ShortlistBuilderPanel
          organizationId={membership.organizationId}
          shortlistId={detail.id}
          shortlistVersionId={detail.currentVersionId}
          maxCandidates={detail.maxCandidates}
          current={detail.candidates}
          eligible={eligible}
        />
      ) : (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <SectionHeader title={`Candidates (${detail.candidates.length})`} />
            {detail.candidates.length === 0 ? (
              <p className="text-muted text-sm">No candidates on this version.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.candidates.map((row) => (
                  <div
                    key={row.shortlistCandidateId}
                    className="border-outline-cell flex items-center justify-between gap-3 border-b py-2 last:border-0"
                  >
                    <div>
                      <p className="text-tertiary text-sm font-medium">
                        #{row.rank} {row.candidateName}
                      </p>
                      <p className="text-muted text-xs">
                        {row.evidenceCoveragePct}% evidence · {row.dataCompletenessPct}% complete
                      </p>
                      {row.recruiterNote && canManageInternally && (
                        <p className="text-muted mt-1 text-xs italic">Note: {row.recruiterNote}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-display text-tertiary text-lg font-bold">
                        {row.overallScore !== null ? `${row.overallScore}%` : '—'}
                      </p>
                      <StatusBadge
                        status={row.gatesPassed === row.gatesTotal ? 'passed' : 'pending'}
                      >
                        {row.gatesPassed}/{row.gatesTotal} gates
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
