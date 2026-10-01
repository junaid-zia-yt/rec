'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card, CardBody, FormField, Select, StatusBadge, Textarea } from '@rqi/ui'
import type { PocDecision, PocDecisionValue } from '@rqi/types'
import { recordPocDecisionAction } from '@/lib/poc/poc-actions'

const DECISION_LABEL: Record<PocDecisionValue, string> = {
  proceed_to_paid_pilot: 'Proceed to paid pilot',
  extend_poc: 'Extend the POC',
  do_not_proceed: 'Do not proceed',
}

const DECISION_TONE: Record<PocDecisionValue, 'passed' | 'pending' | 'failed'> = {
  proceed_to_paid_pilot: 'passed',
  extend_poc: 'pending',
  do_not_proceed: 'failed',
}

/**
 * Commercial decision — Task C screen 8 of 9. Only the approval-authority
 * role (agency_admin/platform_admin — packages/types/src/permissions.ts's
 * poc_reports matrix) can act here; a `client_decision_maker` or recruiter
 * viewing this benchmark sees the current decision (if any) read-only,
 * never the recording form, per `canDecide`.
 */
export function PocDecisionPanel({
  organizationId,
  benchmarkId,
  currentDecision,
  decisionHistory,
  canDecide,
}: {
  organizationId: string
  benchmarkId: string
  currentDecision: PocDecision | null
  decisionHistory: PocDecision[]
  canDecide: boolean
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<{ success: boolean; message?: string } | null>(null)
  const [decision, setDecision] = useState<PocDecisionValue | ''>('')

  return (
    <div className="flex flex-col gap-4">
      {outcome && (
        <Alert tone={outcome.success ? 'success' : 'danger'} title={outcome.message ?? ''} />
      )}

      {currentDecision && (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={DECISION_TONE[currentDecision.decision]}>
                {DECISION_LABEL[currentDecision.decision]}
              </StatusBadge>
              <span className="text-muted text-xs">
                Approved {new Date(currentDecision.approvedAt).toLocaleString()}
              </span>
            </div>
            <p className="text-tertiary text-sm">{currentDecision.notes}</p>
          </CardBody>
        </Card>
      )}

      {canDecide && (
        <Card>
          <CardBody>
            <form
              ref={formRef}
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!decision) return
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('pocBenchmarkId', benchmarkId)
                fd.set('decision', decision)
                fd.set('notes', String(new FormData(formRef.current!).get('notes') ?? ''))
                startTransition(async () => {
                  const result = await recordPocDecisionAction(fd)
                  setOutcome(result)
                  if (result.success) {
                    formRef.current?.reset()
                    setDecision('')
                    router.refresh()
                  }
                })
              }}
            >
              <p className="text-tertiary text-sm font-semibold">
                {currentDecision ? 'Record a new decision' : 'Record the commercial decision'}
              </p>
              <FormField label="Decision" htmlFor="poc-decision">
                <Select
                  value={decision}
                  onValueChange={(v) => setDecision(v as PocDecisionValue)}
                  options={(Object.keys(DECISION_LABEL) as PocDecisionValue[]).map((v) => ({
                    value: v,
                    label: DECISION_LABEL[v],
                  }))}
                  placeholder="Select a decision"
                />
              </FormField>
              <FormField
                label="Notes"
                htmlFor="poc-decision-notes"
                required
                hint="Required — this is the recorded, authorized rationale for the decision."
              >
                <Textarea id="poc-decision-notes" name="notes" required maxLength={4000} rows={4} />
              </FormField>
              <div>
                <Button type="submit" variant="primary" disabled={pending || !decision}>
                  Record decision
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {decisionHistory.length > 1 && (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
              Decision history
            </p>
            {decisionHistory.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-xs">
                <StatusBadge status={d.isCurrent ? DECISION_TONE[d.decision] : 'neutral'}>
                  {DECISION_LABEL[d.decision]}
                </StatusBadge>
                <span className="text-muted">{new Date(d.approvedAt).toLocaleString()}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
