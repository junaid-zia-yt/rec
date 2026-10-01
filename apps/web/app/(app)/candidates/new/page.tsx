import { PageHeader, Tabs, TabsList, TabsTrigger, TabsContent } from '@rqi/ui'
import { CandidateCreateForm } from '@/components/domain/candidates/candidate-create-form'
import { CsvImportReview } from '@/components/domain/candidates/csv-import-review'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { listDemoProjects, DEMO_ORG } from '@/lib/demo/engine'

export const metadata = { title: 'Add candidate' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

async function loadProjectOptions(): Promise<{ id: string; name: string; clientId: string }[]> {
  if (!supabaseConfigured) {
    // Build Phase 18: this used to be a dead end (no form rendered at all
    // when no live database is connected — see
    // docs/client-feedback-reproduction-report.md §5). Candidate creation
    // and CSV import now work fully in the private demo, against the
    // in-memory demo engine, using the same two real fictional projects
    // shown everywhere else in the demo.
    return listDemoProjects().map((p) => ({ id: p.id, name: p.roleTitle, clientId: p.id }))
  }

  const user = await requireAuth('/candidates/new')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase!
    .from('recruitment_projects')
    .select('id, role_title, client_id')
    .eq('organization_id', membership.organizationId)
    .is('archived_at', null)

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.role_title as string,
    clientId: p.client_id as string,
  }))
}

/** Candidate creation — Build Phase 5 brief §"Candidate creation": manual entry or CSV import (CV upload happens from the candidate's own detail page once it exists, per §"CV document management"). Build Phase 18: works in both live and private-demo mode — see loadProjectOptions() above. */
export default async function NewCandidatePage() {
  const activeOrgId = supabaseConfigured
    ? (await resolveActiveOrg((await requireAuth('/candidates/new')).id)).organizationId
    : DEMO_ORG
  const projects = await loadProjectOptions()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add candidate"
        description="Create a candidate manually or import a CSV file."
      />
      <Tabs defaultValue="manual">
        <TabsList>
          <TabsTrigger value="manual">Manual entry</TabsTrigger>
          <TabsTrigger value="csv">CSV import</TabsTrigger>
        </TabsList>
        <TabsContent value="manual" className="pt-4">
          <div className="max-w-2xl">
            <CandidateCreateForm
              organizationId={activeOrgId}
              projects={projects}
              requireProject={!supabaseConfigured}
            />
          </div>
        </TabsContent>
        <TabsContent value="csv" className="pt-4">
          <CsvImportReview organizationId={activeOrgId} projects={projects} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
