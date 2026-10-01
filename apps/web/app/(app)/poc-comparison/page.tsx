import { Card, CardBody, PageHeader, ProgressIndicator, SectionHeader, StatusBadge } from '@rqi/ui'
import { DEMO_POC_METRICS, DEMO_PROJECTS } from '@/lib/mock-data'

export const metadata = { title: 'POC Comparison' }

/**
 * POC Comparison — vendor-vs-client benchmark view referenced in
 * docs/14-poc-specification.md §14.14 (POC default: "shared benchmark
 * start"). Client-side comparison values are frequently null until the
 * client records their own baseline, so each metric renders an explicit
 * "Awaiting client baseline" state rather than a fabricated number.
 *
 * LEGACY (Build Phase 10 Wave 3): the "POC Comparison" nav entry
 * (apps/web/lib/nav.ts) now points at /poc, the real DB-backed POC
 * workspace built in that wave. This page is left in place, unlinked,
 * rather than deleted — it still renders the Build Phase 1 demo fixture
 * for anyone with the old URL, but is no longer reachable from navigation.
 */
export default function POCComparisonPage() {
  const project = DEMO_PROJECTS.find((p) => p.isPoc)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="POC Comparison"
        description="Vendor and client benchmark results for the active proof-of-concept role. Every value shown is evidence-backed or explicitly marked unverified — see docs/14-poc-specification.md."
      />

      <Card>
        <CardBody className="flex flex-col gap-1">
          <p className="text-muted text-xs font-semibold uppercase tracking-wide">POC role</p>
          <p className="text-tertiary text-sm font-semibold">
            {project?.roleTitle} · {project?.clientName}
          </p>
        </CardBody>
      </Card>

      <section aria-labelledby="poc-metrics-heading" className="flex flex-col gap-3">
        <SectionHeader title="Benchmark metrics" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DEMO_POC_METRICS.map((metric) => (
            <Card key={metric.id}>
              <CardBody className="flex flex-col gap-3">
                <p className="text-tertiary text-sm font-semibold">{metric.label}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Vendor (this platform)</span>
                  <span className="font-display text-primary font-bold">
                    {metric.vendorValue}
                    {metric.unit === 'percent' ? '%' : metric.unit === 'hours' ? ' hrs' : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Client baseline</span>
                  {metric.clientValue === null ? (
                    <StatusBadge status="pending">Awaiting client baseline</StatusBadge>
                  ) : (
                    <span className="font-display text-tertiary font-bold">
                      {metric.clientValue}
                      {metric.unit === 'percent' ? '%' : metric.unit === 'hours' ? ' hrs' : ''}
                    </span>
                  )}
                </div>
                {metric.unit === 'percent' && (
                  <ProgressIndicator value={metric.vendorValue} label="Vendor result" />
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
