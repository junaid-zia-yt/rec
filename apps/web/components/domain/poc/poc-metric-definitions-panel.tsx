import { Card, CardBody, SectionHeader } from '@rqi/ui'
import type { MetricDefinition } from '@rqi/types'

const CATEGORY_LABEL: Record<string, string> = {
  speed: 'Speed',
  quality: 'Quality',
  evidence: 'Evidence',
  human_acceptance: 'Human acceptance',
  candidate_response: 'Candidate response',
  progression: 'Progression',
  effort: 'Effort',
  errors: 'Errors',
}

const UNIT_SUFFIX: Record<string, string> = {
  percent: '%',
  hours: ' hrs',
  count: '',
  ratio: '',
  boolean: '',
}

/**
 * Metric-definition review — Task C screen 2 of 9 ("Metric-definition
 * review"), a transparency/trust read view of the global, versioned
 * metric_definitions catalog (supabase/migrations/0030). Purely a display
 * of what each metric means and how it's calculated — never editable here
 * (publishing a revision is a platform_admin, migration-time action, out
 * of this wave's scope — see apps/web/lib/poc/metric-definitions.ts's own
 * versioning-discipline comment).
 */
export function PocMetricDefinitionsPanel({ definitions }: { definitions: MetricDefinition[] }) {
  const byCategory = new Map<string, MetricDefinition[]>()
  for (const def of definitions) {
    const bucket = byCategory.get(def.category) ?? []
    bucket.push(def)
    byCategory.set(def.category, bucket)
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted text-sm">
        Every metric below is defined centrally and versioned — a result computed against a given
        version always cites that exact definition, even after a later revision is published. This
        is the full, unedited list this benchmark&apos;s results are computed against.
      </p>
      {[...byCategory.entries()].map(([category, defs]) => (
        <section key={category} className="flex flex-col gap-3">
          <SectionHeader title={CATEGORY_LABEL[category] ?? category} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {defs.map((def) => (
              <Card key={def.id}>
                <CardBody className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-tertiary text-sm font-semibold">{def.name}</p>
                    <span className="text-muted text-xs">
                      v{def.version} · {def.unit}
                      {UNIT_SUFFIX[def.unit] ?? ''}
                    </span>
                  </div>
                  <p className="text-muted text-xs">{def.description}</p>
                  <p className="text-muted text-xs italic">{def.calculationNotes}</p>
                  <p className="text-muted text-[11px] uppercase tracking-wide">
                    Applies to:{' '}
                    {def.appliesToSide === 'both' ? 'vendor and client' : def.appliesToSide}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
