import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { MetricDefinition, PocBenchmarkStatus } from '@rqi/types'

/**
 * Build Phase 10, Wave 3 — POC workspace-level (list) data loaders. Mirrors
 * apps/web/lib/outreach/load.ts / apps/web/lib/shortlists/load.ts exactly:
 * plain Supabase reads, mapped into UI-shaped interfaces, no ORM. Per-
 * benchmark deep loads (including everything compare-benchmark.ts's
 * RoleBenchmarkData needs) live in ./load-detail.ts.
 */

export interface PocBenchmarkSummary {
  id: string
  name: string
  clientId: string
  clientName: string
  status: PocBenchmarkStatus
  startTime: string | null
  standardRoleLabel: string | null
  seniorRoleLabel: string | null
  roleCount: number
  hasCurrentDecision: boolean
  createdAt: string
}

/** The POC workspace list (Task C "POC setup" screen's landing table). */
export async function loadPocBenchmarks(organizationId: string): Promise<PocBenchmarkSummary[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data: benchmarks } = await supabase
    .from('poc_benchmarks')
    .select('id, name, client_id, status, start_time, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  if (!benchmarks || benchmarks.length === 0) return []

  const benchmarkIds = benchmarks.map((b) => b.id)
  const clientIds = [...new Set(benchmarks.map((b) => b.client_id))]

  const [{ data: clients }, { data: roles }, { data: decisions }] = await Promise.all([
    supabase.from('clients').select('id, name').in('id', clientIds),
    supabase
      .from('poc_roles')
      .select('poc_benchmark_id, role_type, label')
      .in('poc_benchmark_id', benchmarkIds),
    supabase
      .from('poc_decisions')
      .select('poc_benchmark_id')
      .in('poc_benchmark_id', benchmarkIds)
      .eq('is_current', true),
  ])

  const clientNameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]))
  const rolesByBenchmark = new Map<
    string,
    { standard: string | null; senior: string | null; count: number }
  >()
  for (const role of roles ?? []) {
    const bucket = rolesByBenchmark.get(role.poc_benchmark_id) ?? {
      standard: null,
      senior: null,
      count: 0,
    }
    bucket.count += 1
    if (role.role_type === 'standard') bucket.standard = role.label
    if (role.role_type === 'senior_or_difficult') bucket.senior = role.label
    rolesByBenchmark.set(role.poc_benchmark_id, bucket)
  }
  const benchmarksWithDecision = new Set((decisions ?? []).map((d) => d.poc_benchmark_id as string))

  return benchmarks.map((b) => {
    const roleBucket = rolesByBenchmark.get(b.id) ?? { standard: null, senior: null, count: 0 }
    return {
      id: b.id,
      name: b.name,
      clientId: b.client_id,
      clientName: clientNameById.get(b.client_id) ?? 'Unknown client',
      status: b.status as PocBenchmarkStatus,
      startTime: b.start_time,
      standardRoleLabel: roleBucket.standard,
      seniorRoleLabel: roleBucket.senior,
      roleCount: roleBucket.count,
      hasCurrentDecision: benchmarksWithDecision.has(b.id),
      createdAt: b.created_at,
    }
  })
}

export interface PocClientOption {
  id: string
  name: string
}

/** Clients in this org, for the "create benchmark" form's client picker. */
export async function loadPocClientOptions(organizationId: string): Promise<PocClientOption[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []
  const { data } = await supabase
    .from('clients')
    .select('id, name')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true })
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }))
}

export interface PocJobOption {
  jobId: string
  jobTitle: string
  recruitmentProjectId: string
  clientId: string
  clientName: string
}

/** Jobs in this org, for the "add role" form's job picker (a POC role points at one job — supabase/migrations/0030's poc_roles.job_id). */
export async function loadPocJobOptions(organizationId: string): Promise<PocJobOption[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, title, recruitment_project_id')
    .eq('organization_id', organizationId)
    .order('title', { ascending: true })
  if (!jobs || jobs.length === 0) return []

  const projectIds = [...new Set(jobs.map((j) => j.recruitment_project_id))]
  const { data: projects } = await supabase
    .from('recruitment_projects')
    .select('id, client_id')
    .in('id', projectIds)
  const clientIdByProject = new Map(
    (projects ?? []).map((p) => [p.id as string, p.client_id as string]),
  )

  const clientIds = [...new Set([...clientIdByProject.values()])]
  const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds)
  const clientNameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]))

  return jobs.map((job) => {
    const clientId = clientIdByProject.get(job.recruitment_project_id) ?? ''
    return {
      jobId: job.id,
      jobTitle: job.title,
      recruitmentProjectId: job.recruitment_project_id,
      clientId,
      clientName: clientNameById.get(clientId) ?? 'Unknown client',
    }
  })
}

export interface PocShortlistOption {
  shortlistId: string
  jobId: string
  status: string
}

/** Shortlists for a given job, to validate/pick the shortlist a vendor_assisted participant links to (Task B #3's "must reference an existing shortlist belonging to the same org/job" rule). */
export async function loadShortlistsForJob(
  organizationId: string,
  jobId: string,
): Promise<PocShortlistOption[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []
  const { data } = await supabase
    .from('shortlists')
    .select('id, job_id, status')
    .eq('organization_id', organizationId)
    .eq('job_id', jobId)
  return (data ?? []).map((s) => ({ shortlistId: s.id, jobId: s.job_id, status: s.status }))
}

/** The global, versioned metric_definitions catalog (Task C "metric-definition review" transparency screen). Read-only to every authenticated user at the RLS layer — no org scoping. */
export async function loadMetricDefinitions(): Promise<MetricDefinition[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []
  const { data } = await supabase
    .from('metric_definitions')
    .select(
      'id, metric_key, version, name, description, calculation_notes, category, unit, applies_to_side, status, published_by, published_at, created_at',
    )
    .eq('status', 'active')
    .order('category', { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    metricKey: row.metric_key,
    version: row.version,
    name: row.name,
    description: row.description,
    calculationNotes: row.calculation_notes,
    category: row.category,
    unit: row.unit,
    appliesToSide: row.applies_to_side,
    status: row.status,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  })) as MetricDefinition[]
}
