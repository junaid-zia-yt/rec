'use client'

import { useState, useTransition } from 'react'
import {
  Button,
  Card,
  CardBody,
  FormField,
  Select,
  StatusBadge,
  Switch,
  Textarea,
  WorkflowStepper,
} from '@rqi/ui'
import type { CandidatePipelineStage, CandidateProjectEntry } from '@rqi/types'
import {
  assignCandidateToProjectAction,
  setCandidateClientVisibilityAction,
  transitionCandidateStageAction,
} from '@/lib/candidates/pipeline-actions'
import {
  checkPipelineTransition,
  isTerminalStage,
  transitionRequiresReason,
} from '@/lib/candidates/pipeline'
import { STAGE_LABELS } from './candidate-pipeline-view'

const ACTIVE_STAGES: CandidatePipelineStage[] = [
  'discovered',
  'eligibility_check',
  'scored',
  'quality_review',
  'outreach',
  'shortlisted',
]

/**
 * Per-project pipeline entry — Build Phase 5 brief §"Pipeline stages" +
 * §"Every stage transition must ... be permission checked ... timestamped
 * ... record actor ... record reason when required ... produce an audit
 * event." All of that happens server-side
 * (lib/candidates/pipeline-actions.ts); this component only offers the
 * transitions checkPipelineTransition (the same pure function the server
 * re-checks) says are currently valid, so an invalid move is never even
 * offered, let alone silently rejected.
 */
function ProjectEntryCard({
  organizationId,
  candidateId,
  entry,
  canTransition,
  canShare,
}: {
  organizationId: string
  candidateId: string
  entry: CandidateProjectEntry & { projectName: string; projectClientId: string }
  canTransition: boolean
  canShare: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [nextStage, setNextStage] = useState<CandidatePipelineStage | ''>('')
  const [reason, setReason] = useState('')

  const terminal = isTerminalStage(entry.currentStage)
  const options = ACTIVE_STAGES.concat(['rejected', 'withdrawn'])
    .filter((s) => s !== entry.currentStage)
    .filter((s) => checkPipelineTransition(entry.currentStage, s).valid)

  const steps = ACTIVE_STAGES.map((stage) => ({
    label: STAGE_LABELS[stage],
    status:
      stage === entry.currentStage
        ? ('current' as const)
        : ACTIVE_STAGES.indexOf(stage) < ACTIVE_STAGES.indexOf(entry.currentStage) || terminal
          ? ('complete' as const)
          : ('upcoming' as const),
  }))

  function handleTransition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!nextStage) return
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('projectId', entry.recruitmentProjectId)
    formData.set('projectClientId', entry.projectClientId)
    formData.set('toStage', nextStage)
    if (reason) formData.set('reason', reason)

    startTransition(async () => {
      const result = await transitionCandidateStageAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) {
        setNextStage('')
        setReason('')
      }
    })
  }

  function handleShareToggle(checked: boolean) {
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('projectId', entry.recruitmentProjectId)
    formData.set('projectClientId', entry.projectClientId)
    formData.set('clientVisible', String(checked))
    startTransition(async () => {
      const result = await setCandidateClientVisibilityAction(formData)
      if (!result.success)
        setMessage({ tone: 'danger', text: result.message ?? 'Could not change visibility.' })
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-tertiary text-sm font-semibold">{entry.projectName}</p>
          <StatusBadge
            status={
              terminal ? (entry.currentStage === 'rejected' ? 'failed' : 'neutral') : 'pending'
            }
          >
            {STAGE_LABELS[entry.currentStage]}
          </StatusBadge>
        </div>

        {!terminal && <WorkflowStepper steps={steps} />}

        {message && (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={
              message.tone === 'danger'
                ? 'rounded-card bg-danger-bg text-danger px-3 py-2 text-sm font-medium'
                : 'rounded-card bg-primary-container text-primary px-3 py-2 text-sm font-medium'
            }
          >
            {message.text}
          </p>
        )}

        {canTransition && options.length > 0 && (
          <form onSubmit={handleTransition} className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={nextStage}
                onValueChange={(v) => setNextStage(v as CandidatePipelineStage)}
                options={[
                  { value: '', label: 'Move to…' },
                  ...options.map((s) => ({ value: s, label: STAGE_LABELS[s] })),
                ]}
              />
              <Button type="submit" loading={pending} disabled={!nextStage}>
                Apply
              </Button>
            </div>
            {nextStage && transitionRequiresReason(nextStage) && (
              <FormField
                label="Reason"
                htmlFor={`reason-${entry.id}`}
                required
                hint="Required to reject or withdraw a candidate."
              >
                <Textarea
                  id={`reason-${entry.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  required
                />
              </FormField>
            )}
          </form>
        )}

        {canShare && (
          <div className="border-outline-cell flex items-center justify-between gap-2 border-t pt-3">
            <div>
              <p className="text-tertiary text-sm font-medium">Shared with client</p>
              <p className="text-muted text-xs">
                Client reviewers only see shortlisted or explicitly shared candidates.
              </p>
            </div>
            <Switch
              checked={entry.clientVisible}
              onCheckedChange={handleShareToggle}
              disabled={pending}
            />
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function CandidateStagePanel({
  organizationId,
  candidateId,
  entries,
  availableProjects,
  canTransition,
  canShare,
  canAssign,
}: {
  organizationId: string
  candidateId: string
  entries: (CandidateProjectEntry & { projectName: string; projectClientId: string })[]
  availableProjects: { id: string; name: string; clientId: string }[]
  canTransition: boolean
  canShare: boolean
  canAssign: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [projectId, setProjectId] = useState('')

  const assignedProjectIds = new Set(entries.map((e) => e.recruitmentProjectId))
  const unassignedProjects = availableProjects.filter((p) => !assignedProjectIds.has(p.id))

  function handleAssign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const project = unassignedProjects.find((p) => p.id === projectId)
    if (!project) return
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('projectId', project.id)
    formData.set('projectClientId', project.clientId)

    startTransition(async () => {
      const result = await assignCandidateToProjectAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) setProjectId('')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 && (
        <p className="text-muted text-sm">Not yet assigned to a project pipeline.</p>
      )}
      {entries.map((entry) => (
        <ProjectEntryCard
          key={entry.id}
          organizationId={organizationId}
          candidateId={candidateId}
          entry={entry}
          canTransition={canTransition}
          canShare={canShare}
        />
      ))}

      {canAssign && unassignedProjects.length > 0 && (
        <form
          onSubmit={handleAssign}
          className="border-outline-cell flex flex-col gap-2 rounded-lg border p-3 sm:flex-row"
        >
          {message && <p className="text-muted text-sm sm:hidden">{message.text}</p>}
          <Select
            value={projectId}
            onValueChange={setProjectId}
            options={[
              { value: '', label: 'Assign to a project…' },
              ...unassignedProjects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Button type="submit" loading={pending} disabled={!projectId}>
            Assign
          </Button>
        </form>
      )}
    </div>
  )
}
