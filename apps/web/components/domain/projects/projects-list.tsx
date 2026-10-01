'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody, EmptyState, SearchField, Select, StatusBadge } from '@rqi/ui'
import type { RecruitmentProject } from '@rqi/types'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'intake', label: 'Intake' },
  { value: 'sourcing', label: 'Sourcing' },
  { value: 'shortlisting', label: 'Shortlisting' },
  { value: 'client_review', label: 'Client review' },
  { value: 'closed', label: 'Closed' },
]

export function ProjectsList({ projects }: { projects: RecruitmentProject[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [showArchived, setShowArchived] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter((project) => {
      if (!showArchived && project.archivedAt) return false
      const matchesQuery =
        q.length === 0 ||
        project.roleTitle.toLowerCase().includes(q) ||
        project.clientName.toLowerCase().includes(q)
      const matchesStatus = status === 'all' || project.status === status
      return matchesQuery && matchesStatus
    })
  }, [projects, query, status, showArchived])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          placeholder="Search projects by role or client"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search recruitment projects"
          className="sm:max-w-xs"
        />
        <Select value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />
        <label className="text-muted flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4"
          />
          Show archived
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            projects.length === 0 ? 'No recruitment projects yet' : 'No projects match your search'
          }
          description={
            projects.length === 0
              ? 'Create your first project to upload a job description and start sourcing.'
              : 'Try a different search term, status, or include archived projects.'
          }
          action={
            <Link
              href="/projects/new"
              className="text-secondary text-sm font-medium hover:underline"
            >
              New project
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((project) => (
            <Card key={project.id}>
              <CardBody className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-tertiary text-base font-semibold">
                    {project.roleTitle}
                  </p>
                  <StatusBadge
                    status={project.archivedAt ? 'neutral' : project.isPoc ? 'pending' : 'neutral'}
                  >
                    {project.archivedAt
                      ? 'Archived'
                      : project.isPoc
                        ? 'POC'
                        : project.status.replace('_', ' ')}
                  </StatusBadge>
                </div>
                <p className="text-muted text-sm">
                  {project.clientName} · {project.vertical}
                </p>
                <Link
                  href={`/projects/${project.id}`}
                  className="text-secondary mt-1 text-sm font-medium hover:underline"
                >
                  Open project
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
