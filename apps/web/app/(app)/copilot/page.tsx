import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Card, CardBody, EmptyState, PageHeader, SectionHeader, StatusBadge } from '@rqi/ui'
import { hasPermission } from '@rqi/types'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { loadCopilotConversations, loadCopilotProjectOptions } from '@/lib/copilot/load'
import { CopilotStartForm } from '@/components/domain/copilot/copilot-start-form'

export const metadata = { title: 'Copilot' }

const STATUS_BADGE = {
  active: 'passed',
  archived: 'neutral',
  ended: 'neutral',
} as const

/**
 * Copilot workspace — Build Phase 11 Wave 4, Task C. New top-level route
 * (apps/web/app/(app)/copilot/), added because NO "Copilot"/"AI Assistant"
 * screen is mapped in docs/03-screen-inventory.md or any supplied Google
 * Stitch screenshot (checked docs/02-asset-inventory.md and
 * docs/03-screen-inventory.md before building this — see this wave's
 * report for the full check). This is therefore a genuinely new
 * composition, not a redesign of an existing Stitch screen: a conversation
 * list + a chat-panel detail view, built consistent with
 * docs/04-design-system.md's existing card/badge/button/form-field
 * language and @rqi/ui primitives (Card, StatusBadge, FormField, Textarea,
 * ConfirmationDialog, Alert) rather than introducing new ones, per the "no
 * redesign without explaining why" rule (there is nothing to redesign
 * here — only a place to extend the existing system).
 */
export default async function CopilotPage() {
  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Copilot"
          description="Ask the AI copilot about a project, candidate, scorecard, shortlist or outreach sequence — grounded only in data already in this platform. Requires a live database connection."
        />
        <EmptyState
          icon={Sparkles}
          title="Copilot is not available yet"
          description="This environment is not connected to a live database, so no copilot conversations can be started."
        />
      </div>
    )
  }

  const user = await requireAuth('/copilot')
  const membership = await resolveActiveOrg(user.id)
  const canUseCopilot = hasPermission(membership.role, 'copilot', 'create')

  const conversations = await loadCopilotConversations(membership.organizationId, user.id)
  const projectOptions = canUseCopilot
    ? await loadCopilotProjectOptions(
        membership.organizationId,
        user.id,
        membership.role,
        membership.clientId,
      )
    : []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Copilot"
        description="Ask questions about a project, candidate, scorecard, shortlist or outreach sequence. Every answer cites the platform records it is grounded in — the copilot never invents evidence and never makes the final decision for you."
      />

      {canUseCopilot ? (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <SectionHeader title="Start a new conversation" />
            <CopilotStartForm
              organizationId={membership.organizationId}
              role={membership.role}
              projectOptions={projectOptions}
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <p className="text-muted text-sm">
              Your role has read-only oversight access to other users&apos; copilot conversations
              for audit purposes, but cannot start a conversation of its own.
            </p>
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="copilot-list-heading" className="flex flex-col gap-3">
        <SectionHeader title="Your conversations" />
        {conversations.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No copilot conversations yet"
            description={
              canUseCopilot
                ? 'Start one above to get going.'
                : 'You have no copilot conversations of your own.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {conversations.map((c) => (
              <Link key={c.id} href={`/copilot/${c.id}`} className="block">
                <Card className="hover:shadow-level-2 transition-shadow">
                  <CardBody className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-tertiary text-sm font-semibold">
                        {c.title ?? c.recruitmentProjectTitle ?? 'Untitled conversation'}
                      </p>
                      <StatusBadge status={STATUS_BADGE[c.status]}>{c.status}</StatusBadge>
                    </div>
                    {c.recruitmentProjectTitle && (
                      <p className="text-muted text-xs">{c.recruitmentProjectTitle}</p>
                    )}
                    <p className="text-muted text-xs">
                      {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                      {c.lastMessageAt
                        ? ` · last activity ${new Date(c.lastMessageAt).toLocaleString()}`
                        : ''}
                    </p>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
