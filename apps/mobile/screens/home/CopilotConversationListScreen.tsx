import { useEffect } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { hasPermission } from '@rqi/types'
import { QueryStateView, ScreenContainer } from '@/components/ui'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import type { HomeStackParamList } from '@/navigation/types'

type Props = NativeStackScreenProps<HomeStackParamList, 'CopilotConversationList'>

/**
 * Copilot entry point (Build Phase 13, Wave 5). This is NOT a real
 * conversation list — it resolves the caller's single most recent
 * `copilot_conversations` row and immediately hands off to the chat
 * workspace screen for it.
 *
 * KNOWN MOBILE GAP (documented, not silently worked around): there is no
 * `POST /api/mobile/copilot/conversations` route, so mobile cannot start a
 * brand-new conversation — only continue the most recent one a role
 * already has. `startCopilotConversationAction`
 * (apps/web/lib/copilot/copilot-actions.ts) is genuinely non-trivial to
 * mirror: it branches on the caller's live role (recruiter/
 * client_decision_maker MUST pick a recruitment project and pass an
 * `assertResourceOwnership` check against it; agency_admin may optionally
 * scope to one; client_decision_maker additionally forces
 * `data_classification: 'restricted_notes_excluded'` and cross-checks the
 * project's client against the caller's own represented client) and
 * mobile has no project-picker UI for the copilot surface to drive that
 * selection from. Building this well would mean either adding that
 * picker UI (out of scope for this wave) or silently guessing a project,
 * which risks scoping a conversation to the wrong recruitment project —
 * worse than the honest gap this screen documents instead. A future wave
 * should add both the route and a lightweight project picker together.
 */
export function CopilotConversationListScreen({ navigation }: Props) {
  const { organization, loading: orgLoading } = useActiveOrganization()
  const canUseCopilot = organization ? hasPermission(organization.role, 'copilot', 'create') : false

  const query = useQueryState<{ id: string } | null>(
    async (supabase) => {
      if (!organization) throw new Error('Resolving your organization…')
      // Not permitted at all: never even issue the read — this role has
      // nothing of its own to see here regardless of what RLS would allow.
      if (!canUseCopilot) return null
      const { data, error } = await supabase
        .from('copilot_conversations')
        .select('id')
        .eq('organization_id', organization.organizationId)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { id: data.id as string } : null
    },
    [organization?.organizationId, canUseCopilot],
    { isEmpty: (data) => data === null },
  )

  useEffect(() => {
    if (canUseCopilot && query.status === 'success' && query.data) {
      navigation.replace('CopilotConversationWorkspace', { conversationId: query.data.id })
    }
  }, [canUseCopilot, query.status, query.data, navigation])

  if (orgLoading || (query.status !== 'success' && query.status !== 'empty')) {
    return (
      <ScreenContainer>
        <QueryStateView
          kind={query.status as 'loading' | 'error' | 'not_configured' | 'offline'}
          title={
            query.status === 'offline'
              ? "You're offline"
              : query.status === 'not_configured'
                ? 'Not connected'
                : 'Could not load the copilot'
          }
          description={
            query.status === 'offline'
              ? 'Try again when you have a connection.'
              : query.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : (query.error ?? undefined)
          }
          onRetry={query.refresh}
        />
      </ScreenContainer>
    )
  }

  if (!canUseCopilot) {
    return (
      <ScreenContainer>
        <QueryStateView
          kind="empty"
          title="Copilot isn't available for your role"
          description="Your current role has read-only access to copilot conversations, which isn't supported on mobile yet."
        />
      </ScreenContainer>
    )
  }

  // query.status === 'empty': no conversation exists yet for this user.
  return (
    <ScreenContainer>
      <QueryStateView
        kind="empty"
        title="No copilot conversation yet"
        description="Start a conversation on the web app, then continue it here — starting a brand-new conversation isn't supported on mobile yet."
        onRetry={query.refresh}
      />
    </ScreenContainer>
  )
}
