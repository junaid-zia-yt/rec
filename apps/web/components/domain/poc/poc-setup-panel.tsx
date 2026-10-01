'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card, CardBody, FormField, Select, StatusBadge } from '@rqi/ui'
import type { PocBenchmarkStatus, PocRoleType } from '@rqi/types'
import {
  activatePocBenchmarkAction,
  addPocRoleAction,
  completePocBenchmarkAction,
  linkPocParticipantAction,
  removePocRoleAction,
  updatePocBenchmarkAction,
} from '@/lib/poc/poc-actions'
import type { PocJobOption, PocShortlistOption } from '@/lib/poc/load'
import type { PocRoleDetail } from '@/lib/poc/load-detail'

type Outcome = { success: boolean; message?: string } | null

/**
 * POC setup — Task C screen 1 of 9: create benchmark (see
 * create-benchmark-form.tsx for that step), add the two roles, link each
 * role's client_baseline/vendor_assisted participant, then activate.
 */
export function PocSetupPanel({
  organizationId,
  benchmarkId,
  benchmarkStatus,
  startTime,
  roles,
  jobOptions,
  shortlistsByJob,
  canManage,
}: {
  organizationId: string
  benchmarkId: string
  benchmarkStatus: PocBenchmarkStatus
  startTime: string | null
  roles: PocRoleDetail[]
  jobOptions: PocJobOption[]
  shortlistsByJob: Record<string, PocShortlistOption[]>
  canManage: boolean
}) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<Outcome>(null)

  function handle(result: { success: boolean; message?: string }) {
    setOutcome(result)
    if (result.success) router.refresh()
  }

  const hasStandard = roles.some((r) => r.role.roleType === 'standard')
  const hasSenior = roles.some((r) => r.role.roleType === 'senior_or_difficult')
  const isSetup = benchmarkStatus === 'setup'

  return (
    <div className="flex flex-col gap-4">
      {outcome && (
        <Alert tone={outcome.success ? 'success' : 'danger'} title={outcome.message ?? ''} />
      )}

      {canManage && isSetup && (
        <StartTimeForm
          organizationId={organizationId}
          benchmarkId={benchmarkId}
          startTime={startTime}
          onDone={handle}
        />
      )}

      {roles.map((roleDetail) => (
        <RoleCard
          key={roleDetail.role.id}
          organizationId={organizationId}
          benchmarkId={benchmarkId}
          roleDetail={roleDetail}
          shortlists={shortlistsByJob[roleDetail.role.jobId] ?? []}
          canManage={canManage}
          isSetup={isSetup}
          onDone={handle}
        />
      ))}

      {canManage && isSetup && (!hasStandard || !hasSenior) && (
        <AddRoleForm
          organizationId={organizationId}
          benchmarkId={benchmarkId}
          jobOptions={jobOptions}
          missingRoleType={!hasStandard ? 'standard' : 'senior_or_difficult'}
          onDone={handle}
        />
      )}

      {canManage && (
        <Card>
          <CardBody className="flex items-center justify-between gap-3">
            <div>
              <p className="text-tertiary text-sm font-semibold">Benchmark lifecycle</p>
              <p className="text-muted text-xs">
                {isSetup
                  ? 'Requires exactly one standard and one senior/difficult role, plus a shared start time.'
                  : benchmarkStatus === 'in_progress'
                    ? 'Compute results (Comparison Report tab) at least once before marking this benchmark completed.'
                    : 'This benchmark has finished its data-collection phase.'}
              </p>
            </div>
            <LifecycleButton
              organizationId={organizationId}
              benchmarkId={benchmarkId}
              status={benchmarkStatus}
              disabled={isSetup && (!hasStandard || !hasSenior)}
              onDone={handle}
            />
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function StartTimeForm({
  organizationId,
  benchmarkId,
  startTime,
  onDone,
}: {
  organizationId: string
  benchmarkId: string
  startTime: string | null
  onDone: (r: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <FormField
          label="Shared start time"
          htmlFor="poc-start-time"
          hint="Both processes source from this same moment (docs/14-poc-specification.md §14.5) — required before activation."
        >
          <input
            ref={inputRef}
            id="poc-start-time"
            type="datetime-local"
            defaultValue={startTime ? startTime.slice(0, 16) : ''}
            className="rounded-control border-outline-perimeter text-tertiary h-11 w-full border bg-white px-3 text-sm"
          />
        </FormField>
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('pocBenchmarkId', benchmarkId)
                const value = inputRef.current?.value
                if (value) fd.set('startTime', new Date(value).toISOString())
                const outcome = await updatePocBenchmarkAction(fd)
                onDone(outcome)
              })
            }
          >
            Save start time
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function AddRoleForm({
  organizationId,
  benchmarkId,
  jobOptions,
  missingRoleType,
  onDone,
}: {
  organizationId: string
  benchmarkId: string
  jobOptions: PocJobOption[]
  missingRoleType: PocRoleType
  onDone: (r: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [jobId, setJobId] = useState('')

  const job = jobOptions.find((j) => j.jobId === jobId)

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p className="text-tertiary text-sm font-semibold">
          Add {missingRoleType === 'standard' ? 'standard' : 'senior / difficult'} role
        </p>
        <FormField label="Job" htmlFor="poc-role-job">
          <Select
            value={jobId}
            onValueChange={setJobId}
            options={jobOptions.map((j) => ({
              value: j.jobId,
              label: `${j.jobTitle} — ${j.clientName}`,
            }))}
            placeholder="Select a job"
          />
        </FormField>
        <div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending || !job}
            onClick={() =>
              startTransition(async () => {
                if (!job) return
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('pocBenchmarkId', benchmarkId)
                fd.set('jobId', job.jobId)
                fd.set('recruitmentProjectId', job.recruitmentProjectId)
                fd.set('roleType', missingRoleType)
                const outcome = await addPocRoleAction(fd)
                onDone(outcome)
                if (outcome.success) setJobId('')
              })
            }
          >
            Add role
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function RoleCard({
  organizationId,
  benchmarkId,
  roleDetail,
  shortlists,
  canManage,
  isSetup,
  onDone,
}: {
  organizationId: string
  benchmarkId: string
  roleDetail: PocRoleDetail
  shortlists: PocShortlistOption[]
  canManage: boolean
  isSetup: boolean
  onDone: (r: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [shortlistId, setShortlistId] = useState('')

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-tertiary text-sm font-semibold">
              {roleDetail.role.roleType === 'standard'
                ? 'Standard role'
                : 'Senior / difficult role'}
            </p>
            <p className="text-muted text-xs">{roleDetail.jobTitle}</p>
          </div>
          {canManage && isSetup && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const fd = new FormData()
                  fd.set('organizationId', organizationId)
                  fd.set('pocBenchmarkId', benchmarkId)
                  fd.set('pocRoleId', roleDetail.role.id)
                  const outcome = await removePocRoleAction(fd)
                  onDone(outcome)
                })
              }
            >
              Remove
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusBadge status={roleDetail.clientBaselineParticipant ? 'passed' : 'pending'}>
            Client baseline:{' '}
            {roleDetail.clientBaselineParticipant?.status.replace(/_/g, ' ') ?? 'not linked'}
          </StatusBadge>
          <StatusBadge status={roleDetail.vendorAssistedParticipant ? 'passed' : 'pending'}>
            Vendor-assisted:{' '}
            {roleDetail.vendorAssistedParticipant?.status.replace(/_/g, ' ') ?? 'not linked'}
          </StatusBadge>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            {!roleDetail.clientBaselineParticipant && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const fd = new FormData()
                    fd.set('organizationId', organizationId)
                    fd.set('pocBenchmarkId', benchmarkId)
                    fd.set('pocRoleId', roleDetail.role.id)
                    fd.set('processType', 'client_baseline')
                    const outcome = await linkPocParticipantAction(fd)
                    onDone(outcome)
                  })
                }
              >
                Link client-baseline process
              </Button>
            )}
            {!roleDetail.vendorAssistedParticipant && (
              <>
                <div className="w-56">
                  <Select
                    value={shortlistId}
                    onValueChange={setShortlistId}
                    options={shortlists.map((s) => ({
                      value: s.shortlistId,
                      label: `Shortlist ${s.shortlistId.slice(0, 8)} (${s.status})`,
                    }))}
                    placeholder="Shortlist (optional)"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const fd = new FormData()
                      fd.set('organizationId', organizationId)
                      fd.set('pocBenchmarkId', benchmarkId)
                      fd.set('pocRoleId', roleDetail.role.id)
                      fd.set('processType', 'vendor_assisted')
                      if (shortlistId) fd.set('shortlistId', shortlistId)
                      const outcome = await linkPocParticipantAction(fd)
                      onDone(outcome)
                    })
                  }
                >
                  Link vendor-assisted process
                </Button>
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function LifecycleButton({
  organizationId,
  benchmarkId,
  status,
  disabled,
  onDone,
}: {
  organizationId: string
  benchmarkId: string
  status: PocBenchmarkStatus
  disabled: boolean
  onDone: (r: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()

  if (status === 'completed' || status === 'decided') {
    return (
      <StatusBadge status="passed">{status === 'decided' ? 'Decided' : 'Completed'}</StatusBadge>
    )
  }

  const isSetup = status === 'setup'

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      disabled={pending || disabled}
      onClick={() =>
        startTransition(async () => {
          const fd = new FormData()
          fd.set('organizationId', organizationId)
          fd.set('pocBenchmarkId', benchmarkId)
          const outcome = isSetup
            ? await activatePocBenchmarkAction(fd)
            : await completePocBenchmarkAction(fd)
          onDone(outcome)
        })
      }
    >
      {isSetup ? 'Activate benchmark' : 'Mark completed'}
    </Button>
  )
}
