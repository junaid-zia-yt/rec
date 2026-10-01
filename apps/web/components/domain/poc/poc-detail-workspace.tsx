'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  PageHeader,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@rqi/ui'
import { hasPermission } from '@rqi/types'
import type { MetricDefinition, PocBenchmarkStatus, Role } from '@rqi/types'
import { computePocResultsAction } from '@/lib/poc/poc-actions'
import type { PocJobOption, PocShortlistOption } from '@/lib/poc/load'
import type { PocBenchmarkDetail } from '@/lib/poc/load-detail'
import { PocSetupPanel } from './poc-setup-panel'
import { PocDataEntryPanel } from './poc-data-entry-panel'
import { PocComparisonReport, type PocRoleComparisonSection } from './poc-comparison-report'
import { PocMetricDefinitionsPanel } from './poc-metric-definitions-panel'
import { PocDecisionPanel } from './poc-decision-panel'

const STATUS_BADGE: Record<PocBenchmarkStatus, 'passed' | 'pending' | 'failed' | 'neutral'> = {
  setup: 'neutral',
  in_progress: 'pending',
  completed: 'passed',
  decided: 'passed',
}

/**
 * POC benchmark detail workspace (Build Phase 10 Wave 3, Task C). One
 * Tabs-based page covering setup, metric definitions, baseline/data entry,
 * the comparison report (with its quality/speed/evidence drill-downs and
 * mobile executive summary — see poc-comparison-report.tsx), and the
 * commercial decision. Mirrors outreach-sequence-workspace.tsx's
 * useTransition + FormData-action-call client-component template.
 */
export function PocDetailWorkspace({
  organizationId,
  role,
  detail,
  jobOptions,
  shortlistsByJob,
  metricDefinitions,
}: {
  organizationId: string
  role: Role
  detail: PocBenchmarkDetail
  jobOptions: PocJobOption[]
  shortlistsByJob: Record<string, PocShortlistOption[]>
  metricDefinitions: MetricDefinition[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<{ success: boolean; message?: string } | null>(null)

  const canManage = hasPermission(role, 'poc_reports', 'create')
  const canEnterData = role === 'platform_admin' || role === 'agency_admin' || role === 'recruiter'
  const canDecide = hasPermission(role, 'poc_reports', 'create')

  const sections: PocRoleComparisonSection[] = detail.roles.map((r) => ({
    roleId: r.role.id,
    roleType: r.role.roleType,
    roleLabel: r.role.label ?? r.jobTitle,
    jobTitle: r.jobTitle,
    metrics: r.comparison.metrics,
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={detail.benchmark.name}
        description={`${detail.clientName} — proof-of-concept comparison of the current process against this platform's, under agreed, shared conditions.`}
        actions={
          <StatusBadge status={STATUS_BADGE[detail.benchmark.status]}>
            {detail.benchmark.status.replace(/_/g, ' ')}
          </StatusBadge>
        }
      />

      {outcome && (
        <Alert tone={outcome.success ? 'success' : 'danger'} title={outcome.message ?? ''} />
      )}

      <Tabs defaultValue="comparison">
        <TabsList className="flex-wrap">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="definitions">Metric definitions</TabsTrigger>
          <TabsTrigger value="data-entry">Data entry</TabsTrigger>
          <TabsTrigger value="comparison">Comparison report</TabsTrigger>
          <TabsTrigger value="decision">Decision</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="pt-4">
          <PocSetupPanel
            organizationId={organizationId}
            benchmarkId={detail.benchmark.id}
            benchmarkStatus={detail.benchmark.status}
            startTime={detail.benchmark.startTime}
            roles={detail.roles}
            jobOptions={jobOptions}
            shortlistsByJob={shortlistsByJob}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="definitions" className="pt-4">
          <PocMetricDefinitionsPanel definitions={metricDefinitions} />
        </TabsContent>

        <TabsContent value="data-entry" className="pt-4">
          <PocDataEntryPanel
            organizationId={organizationId}
            benchmarkId={detail.benchmark.id}
            roles={detail.roles}
            metricDefinitions={metricDefinitions}
            canEnter={canEnterData}
          />
        </TabsContent>

        <TabsContent value="comparison" className="flex flex-col gap-4 pt-4">
          {canManage && detail.roles.length > 0 && (
            <div className="flex flex-wrap gap-2 print:hidden">
              {detail.roles.map((r) => (
                <Button
                  key={r.role.id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const fd = new FormData()
                      fd.set('organizationId', organizationId)
                      fd.set('pocBenchmarkId', detail.benchmark.id)
                      fd.set('pocRoleId', r.role.id)
                      const result = await computePocResultsAction(fd)
                      setOutcome(result)
                      if (result.success) router.refresh()
                    })
                  }
                >
                  Compute &amp; save results —{' '}
                  {r.role.roleType === 'standard' ? 'Standard' : 'Senior/difficult'}
                </Button>
              ))}
            </div>
          )}
          {sections.length === 0 ? (
            <p className="text-muted text-sm">
              Add and link both roles in the Setup tab before results can be computed.
            </p>
          ) : (
            <PocComparisonReport sections={sections} />
          )}
        </TabsContent>

        <TabsContent value="decision" className="pt-4">
          <PocDecisionPanel
            organizationId={organizationId}
            benchmarkId={detail.benchmark.id}
            currentDecision={detail.currentDecision}
            decisionHistory={detail.decisionHistory}
            canDecide={canDecide}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
