import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { EmptyState, PageHeader } from '@rqi/ui'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { loadCopilotConversationDetail, getSuggestedQuestions } from '@/lib/copilot/load'
import { CopilotConversationWorkspace } from '@/components/domain/copilot/copilot-conversation-workspace'

export const metadata = { title: 'Copilot conversation' }

/** One conversation's chat thread — Build Phase 11 Wave 4, Task C. See apps/web/app/(app)/copilot/page.tsx's header comment for why this is a new route, not a redesign of an existing Stitch screen. */
export default async function CopilotConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params

  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Copilot"
          description="This environment is not connected to a live database yet."
        />
        <EmptyState icon={Sparkles} title="Copilot is not available yet" />
      </div>
    )
  }

  const user = await requireAuth(`/copilot/${conversationId}`)
  const membership = await resolveActiveOrg(user.id)

  const detail = await loadCopilotConversationDetail(
    membership.organizationId,
    user.id,
    conversationId,
  )
  if (!detail) notFound()

  const suggestedQuestions = getSuggestedQuestions({
    role: membership.role,
    hasProjectScope: Boolean(detail.recruitmentProjectId),
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/copilot"
          className="text-muted hover:text-tertiary inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All conversations
        </Link>
      </div>
      <PageHeader
        title={detail.title ?? detail.recruitmentProjectTitle ?? 'Copilot conversation'}
        description={
          detail.recruitmentProjectTitle
            ? `Scoped to ${detail.recruitmentProjectTitle}.`
            : 'Org-wide conversation.'
        }
      />
      <CopilotConversationWorkspace
        organizationId={membership.organizationId}
        detail={detail}
        suggestedQuestions={suggestedQuestions}
      />
    </div>
  )
}
