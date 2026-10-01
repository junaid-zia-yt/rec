import { notFound } from 'next/navigation'
import { hasPermission } from '@rqi/types'
import { Breadcrumbs, PageHeader } from '@rqi/ui'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { loadOutreachSequenceDetail, loadOutreachTemplates } from '@/lib/outreach/load-detail'
import { OutreachSequenceWorkspace } from '@/components/domain/outreach/outreach-sequence-workspace'

/**
 * Outreach sequence workspace (Build Phase 9 Wave 3). No client_decision_maker
 * access exists for the 'outreach' resource at all (packages/types/src/
 * permissions.ts: `client_decision_maker: 'none'`), so unlike the shortlist
 * detail page this route has no separate client-facing branch — every
 * viewer who reaches here already has at least read access via RLS +
 * requireAuth/resolveActiveOrg.
 */
export default async function OutreachSequenceDetailPage({
  params,
}: {
  params: Promise<{ sequenceId: string }>
}) {
  const { sequenceId } = await params

  if (!supabaseConfigured) notFound()

  const user = await requireAuth(`/outreach/${sequenceId}`)
  const membership = await resolveActiveOrg(user.id)

  const [detail, templates] = await Promise.all([
    loadOutreachSequenceDetail(membership.organizationId, sequenceId),
    loadOutreachTemplates(membership.organizationId),
  ])
  if (!detail) notFound()

  const canManage = hasPermission(membership.role, 'outreach', 'update')

  return (
    <div className="flex flex-col gap-6 pb-10">
      <Breadcrumbs
        items={[{ label: 'Outreach', href: '/outreach' }, { label: detail.candidateName }]}
      />
      <PageHeader title={detail.candidateName} description={`Outreach for ${detail.jobTitle}`} />
      <OutreachSequenceWorkspace
        organizationId={membership.organizationId}
        detail={detail}
        templates={templates}
        canManage={canManage}
      />
    </div>
  )
}
