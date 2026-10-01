'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from '@rqi/ui'
import type { MetricDefinition } from '@rqi/types'
import { DATA_POINT_KEYS } from '@/lib/poc/data-point-keys'
import {
  recordPocBaselineAction,
  recordPocExclusionAction,
  recordPocMetricDataPointAction,
} from '@/lib/poc/poc-actions'
import type { PocRoleDetail } from '@/lib/poc/load-detail'
import { stripEmptyFormFields } from './form-data-utils'

type Outcome = { success: boolean; message?: string } | null

/** Maps each DATA_POINT_KEYS value to the metric it feeds — see apps/web/lib/poc/data-point-keys.ts's own doc comment for why this mapping isn't co-located there (import-cycle avoidance). */
const DATA_POINT_METRIC_KEY: Record<string, string> = {
  [DATA_POINT_KEYS.TIME_TO_FIRST_QUALIFIED_HOURS]: 'time_to_first_qualified_candidate',
  [DATA_POINT_KEYS.TIME_TO_COMPLETED_SHORTLIST_HOURS]: 'time_to_completed_shortlist',
  [DATA_POINT_KEYS.RECRUITER_HOURS]: 'recruiter_hours',
  [DATA_POINT_KEYS.CLIENT_MANDATORY_GATE_PASS_RATE]: 'mandatory_gate_pass_rate',
  [DATA_POINT_KEYS.CLIENT_CANDIDATES_SCORING_90_OR_HIGHER]: 'candidates_scoring_90_or_higher',
  [DATA_POINT_KEYS.CLIENT_SHORTLIST_ACCEPTANCE_RATE]: 'shortlist_acceptance_rate',
  [DATA_POINT_KEYS.CLIENT_CANDIDATE_RESPONSE_RATE]: 'candidate_response_rate',
  [DATA_POINT_KEYS.CLIENT_CANDIDATE_INTEREST_RATE]: 'candidate_interest_rate',
  [DATA_POINT_KEYS.INTERVIEW_PROGRESSION_PCT]: 'interview_progression',
  [DATA_POINT_KEYS.CRITICAL_ERRORS_COUNT]: 'critical_errors',
  [DATA_POINT_KEYS.UNSUPPORTED_CLAIMS_COUNT]: 'unsupported_claims',
}

const DATA_POINT_LABEL: Record<string, string> = {
  [DATA_POINT_KEYS.TIME_TO_FIRST_QUALIFIED_HOURS]:
    'Vendor: time to first qualified candidate (hours)',
  [DATA_POINT_KEYS.TIME_TO_COMPLETED_SHORTLIST_HOURS]:
    'Vendor: time to completed shortlist (hours)',
  [DATA_POINT_KEYS.RECRUITER_HOURS]: 'Recruiter hours (this session)',
  [DATA_POINT_KEYS.CLIENT_MANDATORY_GATE_PASS_RATE]: 'Client: mandatory-gate pass rate (%)',
  [DATA_POINT_KEYS.CLIENT_CANDIDATES_SCORING_90_OR_HIGHER]:
    'Client: candidates scoring 90%+ (count)',
  [DATA_POINT_KEYS.CLIENT_SHORTLIST_ACCEPTANCE_RATE]: 'Client: shortlist acceptance rate (%)',
  [DATA_POINT_KEYS.CLIENT_CANDIDATE_RESPONSE_RATE]: 'Client: candidate response rate (%)',
  [DATA_POINT_KEYS.CLIENT_CANDIDATE_INTEREST_RATE]: 'Client: candidate interest rate (%)',
  [DATA_POINT_KEYS.INTERVIEW_PROGRESSION_PCT]: 'Interview progression (%)',
  [DATA_POINT_KEYS.CRITICAL_ERRORS_COUNT]: 'Critical errors (count)',
  [DATA_POINT_KEYS.UNSUPPORTED_CLAIMS_COUNT]: 'Unsupported claims (count)',
}

/**
 * Baseline Entry — Task C screen 3 of 9, plus the manual vendor-side data-
 * point entry and mandatory-reason exclusion recording the wave-2
 * calculators read as their fallback/override inputs (apps/web/lib/poc/
 * data-point-keys.ts, resolve-inputs.ts). These three writes are the ones
 * flagged in this wave's brief as RLS-permissive-beyond-the-resource-
 * default for an assigned recruiter — see poc-actions.ts's module comment.
 */
export function PocDataEntryPanel({
  organizationId,
  benchmarkId,
  roles,
  metricDefinitions,
  canEnter,
}: {
  organizationId: string
  benchmarkId: string
  roles: PocRoleDetail[]
  metricDefinitions: MetricDefinition[]
  canEnter: boolean
}) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<Outcome>(null)

  function handle(result: { success: boolean; message?: string }) {
    setOutcome(result)
    if (result.success) router.refresh()
  }

  if (!canEnter) {
    return (
      <p className="text-muted text-sm">
        You do not have permission to enter POC data for this benchmark.
      </p>
    )
  }

  const defByKey = new Map(metricDefinitions.map((d) => [d.metricKey, d]))

  return (
    <div className="flex flex-col gap-6">
      {outcome && (
        <Alert tone={outcome.success ? 'success' : 'danger'} title={outcome.message ?? ''} />
      )}
      {roles.map((roleDetail) => (
        <Card key={roleDetail.role.id}>
          <CardBody className="flex flex-col gap-4">
            <p className="text-tertiary text-sm font-semibold">
              {roleDetail.role.roleType === 'standard'
                ? 'Standard role'
                : 'Senior / difficult role'}{' '}
              — {roleDetail.jobTitle}
            </p>

            {roleDetail.clientBaselineParticipant && (
              <BaselineForm
                organizationId={organizationId}
                benchmarkId={benchmarkId}
                roleDetail={roleDetail}
                participantId={roleDetail.clientBaselineParticipant.id}
                onDone={handle}
              />
            )}

            <DataPointForm
              organizationId={organizationId}
              benchmarkId={benchmarkId}
              roleDetail={roleDetail}
              defByKey={defByKey}
              onDone={handle}
            />

            <ExclusionForm
              organizationId={organizationId}
              benchmarkId={benchmarkId}
              roleDetail={roleDetail}
              onDone={handle}
            />

            {roleDetail.exclusions.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
                  Recorded exclusions
                </p>
                {roleDetail.exclusions.map((ex) => (
                  <div key={ex.id} className="flex items-center gap-2 text-xs">
                    <StatusBadge status={ex.reversesExclusionId ? 'neutral' : 'pending'}>
                      {ex.reversesExclusionId ? 'Reversal' : ex.side}
                    </StatusBadge>
                    <span className="text-muted">
                      {ex.candidateReferenceLabel ?? ex.candidateId} — {ex.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}

function BaselineForm({
  organizationId,
  benchmarkId,
  roleDetail,
  participantId,
  onDone,
}: {
  organizationId: string
  benchmarkId: string
  roleDetail: PocRoleDetail
  participantId: string
  onDone: (r: { success: boolean; message?: string }) => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const latest = roleDetail.latestClientBaseline

  return (
    <form
      ref={formRef}
      className="border-outline-perimeter flex flex-col gap-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = stripEmptyFormFields(new FormData(formRef.current!))
        startTransition(async () => {
          const outcome = await recordPocBaselineAction(fd)
          onDone(outcome)
        })
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="pocBenchmarkId" value={benchmarkId} />
      <input type="hidden" name="pocRoleId" value={roleDetail.role.id} />
      <input type="hidden" name="pocParticipantId" value={participantId} />
      <input
        type="hidden"
        name="recruitmentProjectId"
        value={roleDetail.role.recruitmentProjectId}
      />
      {latest && <input type="hidden" name="correctionOfBaselineId" value={latest.id} />}

      <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
        Client self-reported baseline {latest ? '(recording a correction)' : ''}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Candidates sourced" htmlFor="baseline-sourced">
          <Input
            id="baseline-sourced"
            name="candidatesSourcedCount"
            type="number"
            min={0}
            defaultValue={latest?.candidatesSourcedCount ?? ''}
          />
        </FormField>
        <FormField label="Candidates reviewed" htmlFor="baseline-reviewed">
          <Input
            id="baseline-reviewed"
            name="candidatesReviewedCount"
            type="number"
            min={0}
            defaultValue={latest?.candidatesReviewedCount ?? ''}
          />
        </FormField>
        <FormField label="Shortlist candidate count" htmlFor="baseline-shortlist-count">
          <Input
            id="baseline-shortlist-count"
            name="shortlistCandidateCount"
            type="number"
            min={0}
            defaultValue={latest?.shortlistCandidateCount ?? ''}
          />
        </FormField>
        <FormField label="Time to first qualified (hours)" htmlFor="baseline-first-qualified">
          <Input
            id="baseline-first-qualified"
            name="timeToFirstQualifiedHours"
            type="number"
            min={0}
            step="0.1"
            defaultValue={latest?.timeToFirstQualifiedHours ?? ''}
          />
        </FormField>
        <FormField label="Time to shortlist (hours)" htmlFor="baseline-shortlist-hours">
          <Input
            id="baseline-shortlist-hours"
            name="timeToShortlistHours"
            type="number"
            min={0}
            step="0.1"
            defaultValue={latest?.timeToShortlistHours ?? ''}
          />
        </FormField>
        <FormField label="Recruiter hours spent" htmlFor="baseline-recruiter-hours">
          <Input
            id="baseline-recruiter-hours"
            name="recruiterHoursSpent"
            type="number"
            min={0}
            step="0.1"
            defaultValue={latest?.recruiterHoursSpent ?? ''}
          />
        </FormField>
      </div>
      <FormField label="Reported by (client contact name)" htmlFor="baseline-reported-by">
        <Input
          id="baseline-reported-by"
          name="reportedByLabel"
          maxLength={300}
          defaultValue={latest?.reportedByLabel ?? ''}
        />
      </FormField>
      <FormField label="Notes" htmlFor="baseline-notes">
        <Textarea id="baseline-notes" name="notes" maxLength={2000} rows={2} />
      </FormField>
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {latest ? 'Save correction' : 'Save baseline'}
        </Button>
      </div>
    </form>
  )
}

function DataPointForm({
  organizationId,
  benchmarkId,
  roleDetail,
  defByKey,
  onDone,
}: {
  organizationId: string
  benchmarkId: string
  roleDetail: PocRoleDetail
  defByKey: Map<string, MetricDefinition>
  onDone: (r: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [dataPointKey, setDataPointKey] = useState('')
  const [side, setSide] = useState<'vendor' | 'client'>('vendor')
  const [value, setValue] = useState('')
  const [notes, setNotes] = useState('')

  const participant =
    side === 'vendor' ? roleDetail.vendorAssistedParticipant : roleDetail.clientBaselineParticipant
  const metricDef = dataPointKey ? defByKey.get(DATA_POINT_METRIC_KEY[dataPointKey] ?? '') : null

  return (
    <div className="border-outline-perimeter flex flex-col gap-3 border-t pt-4">
      <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
        Manual metric data point
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Side" htmlFor="dp-side">
          <Select
            value={side}
            onValueChange={(v) => setSide(v as 'vendor' | 'client')}
            options={[
              { value: 'vendor', label: 'Vendor (this platform)' },
              { value: 'client', label: 'Client' },
            ]}
          />
        </FormField>
        <FormField label="Data point" htmlFor="dp-key">
          <Select
            value={dataPointKey}
            onValueChange={setDataPointKey}
            options={Object.values(DATA_POINT_KEYS)
              .filter((key) => (side === 'vendor' ? !key.startsWith('client_') : true))
              .map((key) => ({ value: key, label: DATA_POINT_LABEL[key] ?? key }))}
            placeholder="Select a metric"
          />
        </FormField>
        <FormField label="Value" htmlFor="dp-value">
          <Input
            id="dp-value"
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </FormField>
        <FormField label="Notes" htmlFor="dp-notes">
          <Input
            id="dp-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </FormField>
      </div>
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || !dataPointKey || !value || !metricDef || !participant}
          onClick={() =>
            startTransition(async () => {
              if (!metricDef || !participant) return
              const fd = new FormData()
              fd.set('organizationId', organizationId)
              fd.set('pocBenchmarkId', benchmarkId)
              fd.set('pocRoleId', roleDetail.role.id)
              fd.set('pocParticipantId', participant.id)
              fd.set('recruitmentProjectId', roleDetail.role.recruitmentProjectId)
              fd.set('metricDefinitionId', metricDef.id)
              fd.set('metricDefinitionVersion', String(metricDef.version))
              fd.set('dataPointKey', dataPointKey)
              fd.set('valueNumeric', value)
              fd.set('source', side === 'vendor' ? 'manual_recruiter_entry' : 'client_reported')
              if (notes) fd.set('notes', notes)
              const outcome = await recordPocMetricDataPointAction(fd)
              onDone(outcome)
              if (outcome.success) {
                setValue('')
                setNotes('')
              }
            })
          }
        >
          Record data point
        </Button>
      </div>
      {!participant && dataPointKey && (
        <p className="text-muted text-xs">
          Link the {side === 'vendor' ? 'vendor-assisted' : 'client-baseline'} process for this role
          first (Setup tab).
        </p>
      )}
    </div>
  )
}

function ExclusionForm({
  organizationId,
  benchmarkId,
  roleDetail,
  onDone,
}: {
  organizationId: string
  benchmarkId: string
  roleDetail: PocRoleDetail
  onDone: (r: { success: boolean; message?: string }) => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [side, setSide] = useState<'vendor' | 'client' | 'both'>('both')
  const [exclusionType, setExclusionType] = useState<
    'duplicate_across_sides' | 'out_of_search_boundary' | 'other'
  >('duplicate_across_sides')

  return (
    <form
      ref={formRef}
      className="border-outline-perimeter flex flex-col gap-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = stripEmptyFormFields(new FormData(formRef.current!))
        fd.set('side', side)
        fd.set('exclusionType', exclusionType)
        startTransition(async () => {
          const outcome = await recordPocExclusionAction(fd)
          onDone(outcome)
          if (outcome.success) formRef.current?.reset()
        })
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="pocBenchmarkId" value={benchmarkId} />
      <input type="hidden" name="pocRoleId" value={roleDetail.role.id} />
      <input
        type="hidden"
        name="recruitmentProjectId"
        value={roleDetail.role.recruitmentProjectId}
      />

      <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
        Record an exclusion
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Candidate id (if known)" htmlFor="ex-candidate-id">
          <Input id="ex-candidate-id" name="candidateId" placeholder="uuid" />
        </FormField>
        <FormField label="Candidate reference label" htmlFor="ex-label">
          <Input
            id="ex-label"
            name="candidateReferenceLabel"
            maxLength={300}
            placeholder="e.g. 'J. Smith (client list #4)'"
          />
        </FormField>
        <FormField label="Side" htmlFor="ex-side">
          <Select
            value={side}
            onValueChange={(v) => setSide(v as typeof side)}
            options={[
              { value: 'vendor', label: 'Vendor' },
              { value: 'client', label: 'Client' },
              { value: 'both', label: 'Both' },
            ]}
          />
        </FormField>
        <FormField label="Exclusion type" htmlFor="ex-type">
          <Select
            value={exclusionType}
            onValueChange={(v) => setExclusionType(v as typeof exclusionType)}
            options={[
              { value: 'duplicate_across_sides', label: 'Duplicate across sides' },
              { value: 'out_of_search_boundary', label: 'Out of agreed search boundary' },
              { value: 'other', label: 'Other' },
            ]}
          />
        </FormField>
      </div>
      <FormField
        label="Reason"
        htmlFor="ex-reason"
        required
        hint="Every exclusion must be explained — never silently dropped."
      >
        <Textarea id="ex-reason" name="reason" required maxLength={2000} rows={2} />
      </FormField>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="stillCountsTowardSpeed" value="true" defaultChecked />
        <span className="text-muted">
          Still counts toward this side&apos;s speed metric (docs/14-poc-specification.md §14.6)
        </span>
      </label>
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Record exclusion
        </Button>
      </div>
    </form>
  )
}
