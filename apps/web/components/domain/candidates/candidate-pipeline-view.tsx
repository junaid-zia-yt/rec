'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Card,
  CardBody,
  EmptyState,
  SearchField,
  Select,
  StatusBadge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@rqi/ui'
import type { CandidatePipelineStage, CandidateStatus } from '@rqi/types'

export interface CandidateListItem {
  id: string
  fullName: string
  status: CandidateStatus
  currentTitle: string | null
  currentCompany: string | null
  entries: {
    projectId: string
    projectName: string
    stage: CandidatePipelineStage
    clientVisible: boolean
  }[]
}

const STAGE_ORDER: CandidatePipelineStage[] = [
  'discovered',
  'eligibility_check',
  'scored',
  'quality_review',
  'outreach',
  'shortlisted',
  'rejected',
  'withdrawn',
]

const STAGE_LABELS: Record<CandidatePipelineStage, string> = {
  discovered: 'Discovered',
  eligibility_check: 'Eligibility Check',
  scored: 'Scored',
  quality_review: 'Quality Review',
  outreach: 'Outreach',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

const STAGE_BADGE: Record<CandidatePipelineStage, 'passed' | 'pending' | 'failed' | 'neutral'> = {
  discovered: 'neutral',
  eligibility_check: 'pending',
  scored: 'pending',
  quality_review: 'pending',
  outreach: 'pending',
  shortlisted: 'passed',
  rejected: 'failed',
  withdrawn: 'failed',
}

/**
 * Candidate Pipeline screen — a "List" view (search/filter, works across
 * every project) and a "Board" view (one project at a time, grouped into
 * columns by stage) — Build Phase 5 brief §UI: "Candidate pipeline",
 * "Candidate list", "Filters and search". Mobile: the same responsive
 * layout collapses the board's columns into a stacked list and the list's
 * rows into cards, matching the convention every other screen in this app
 * uses (Tailwind breakpoints, not a separate route).
 */
export function CandidatePipelineView({
  candidates,
  projects,
}: {
  candidates: CandidateListItem[]
  projects: { id: string; name: string }[]
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | CandidateStatus>('all')
  const [projectFilter, setProjectFilter] = useState<string>(projects[0]?.id ?? '')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter((c) => {
      const matchesQuery =
        q.length === 0 ||
        c.fullName.toLowerCase().includes(q) ||
        (c.currentTitle ?? '').toLowerCase().includes(q) ||
        (c.currentCompany ?? '').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [candidates, query, statusFilter])

  const boardCandidates = useMemo(
    () => candidates.filter((c) => c.entries.some((e) => e.projectId === projectFilter)),
    [candidates, projectFilter],
  )

  return (
    <Tabs defaultValue="list">
      <TabsList>
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="board">Pipeline board</TabsTrigger>
      </TabsList>

      <TabsContent value="list" className="flex flex-col gap-4 pt-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField
            placeholder="Search by name, title, or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search candidates"
            className="sm:max-w-xs"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'deletion_requested', label: 'Deletion requested' },
            ]}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={
              candidates.length === 0 ? 'No candidates yet' : 'No candidates match your search'
            }
            description={
              candidates.length === 0
                ? 'Add your first candidate manually, via CSV import, or by uploading a CV.'
                : 'Try a different name, title, company, or status filter.'
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((candidate) => (
              <Link key={candidate.id} href={`/candidates/${candidate.id}`}>
                <Card className="hover:border-secondary transition-colors">
                  <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-tertiary truncate text-sm font-semibold">
                        {candidate.fullName}
                      </p>
                      <p className="text-muted truncate text-xs">
                        {candidate.currentTitle ?? 'Title unverified'}
                        {candidate.currentCompany ? ` · ${candidate.currentCompany}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {candidate.status !== 'active' && (
                        <StatusBadge status="neutral">
                          {candidate.status.replace('_', ' ')}
                        </StatusBadge>
                      )}
                      {candidate.entries.length === 0 ? (
                        <StatusBadge status="neutral">Not assigned</StatusBadge>
                      ) : (
                        candidate.entries.map((entry) => (
                          <StatusBadge key={entry.projectId} status={STAGE_BADGE[entry.stage]}>
                            {STAGE_LABELS[entry.stage]}
                          </StatusBadge>
                        ))
                      )}
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="board" className="flex flex-col gap-4 pt-4">
        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create a recruitment project to see its pipeline board."
          />
        ) : (
          <>
            <Select
              value={projectFilter}
              onValueChange={setProjectFilter}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
            <div className="grid gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-4">
              {STAGE_ORDER.map((stage) => {
                const stageCandidates = boardCandidates.filter((c) =>
                  c.entries.some((e) => e.projectId === projectFilter && e.stage === stage),
                )
                return (
                  <div
                    key={stage}
                    className="border-outline-cell rounded-card flex min-w-[220px] flex-col gap-2 border bg-white p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
                        {STAGE_LABELS[stage]}
                      </p>
                      <span className="text-muted text-xs">{stageCandidates.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {stageCandidates.map((candidate) => (
                        <Link
                          key={candidate.id}
                          href={`/candidates/${candidate.id}`}
                          className="border-outline-cell hover:border-secondary rounded-card border p-2 text-xs"
                        >
                          <p className="text-tertiary font-medium">{candidate.fullName}</p>
                          <p className="text-muted">
                            {candidate.currentTitle ?? 'Title unverified'}
                          </p>
                        </Link>
                      ))}
                      {stageCandidates.length === 0 && (
                        <p className="text-muted text-xs">No candidates.</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </TabsContent>
    </Tabs>
  )
}

export { STAGE_LABELS, STAGE_BADGE, STAGE_ORDER }
