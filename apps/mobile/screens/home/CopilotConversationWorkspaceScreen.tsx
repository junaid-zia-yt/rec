import { useCallback, useRef, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { hasPermission, type CopilotCitation } from '@rqi/types'
import { Button, Card, Input, QueryStateView, ScreenContainer } from '@/components/ui'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import { useNetworkStatus } from '@/lib/network/networkStatus'
import { sendCopilotTurn, type CopilotTurnFailure } from '@/lib/api/client'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { HomeStackParamList } from '@/navigation/types'

type Props = NativeStackScreenProps<HomeStackParamList, 'CopilotConversationWorkspace'>

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system_note'
  content: string | null
  citations: CopilotCitation[]
  /** Set only on a locally-synthesized failure bubble (never a real
   * `copilot_messages` row) — rendered distinctly so it never looks like
   * something the assistant said. */
  failure?: CopilotTurnFailure['status']
}

/** Human-readable copy for every non-success `CopilotTurnOutcome` status,
 * per the task brief's "CLEAR handling of every non-success status"
 * requirement — one line each, never a raw status string shown to the
 * user. */
const FAILURE_COPY: Record<CopilotTurnFailure['status'], string> = {
  not_configured: "This assistant isn't configured in this environment.",
  permission_narrowed_since_conversation_start:
    'Your permissions have changed since this conversation started, so this request could not be completed.',
  rate_limited: "You're sending messages too quickly. Wait a moment and try again.",
  timeout: 'The assistant took too long to respond.',
  provider_error: 'The assistant is temporarily unavailable.',
  cancelled: 'That request was cancelled.',
  validation_rejected: "That message couldn't be sent — check it and try again.",
  unauthorized_tool_attempt:
    'The assistant attempted an action it is not authorized to take, so the request was blocked.',
}

/** Statuses worth a plain "Retry" affordance — transient failures, not
 * permission/validation problems retrying would not fix. */
const RETRYABLE: ReadonlySet<CopilotTurnFailure['status']> = new Set([
  'timeout',
  'provider_error',
  'rate_limited',
])

/**
 * Copilot chat (Build Phase 13, Wave 5). Shows the most recent
 * conversation's messages (direct RLS-scoped read of `copilot_messages`)
 * with citations rendered plainly, a text input + send wired to
 * `POST /api/mobile/copilot/turn`, and explicit handling for every
 * non-success outcome the contract defines.
 *
 * HARD RULE mirrored from the web copilot (docs/10-ai-evaluation-
 * guardrails.md): the assistant may recommend, explain and cite —
 * NEVER decide, approve, or submit anything. Every citation here is
 * rendered as plain informational text, never as a button or action; if a
 * turn's response ever implied an action was taken, this screen would
 * still only show it as informational text, never as a completed
 * decision (this build's orchestration does not surface tool-call
 * results as anything but grounding for the prose, so there is nothing
 * beyond `citations` for this screen to render either way).
 */
export function CopilotConversationWorkspaceScreen({ route }: Props) {
  const { conversationId } = route.params
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null
  const canUseCopilot = organization ? hasPermission(organization.role, 'copilot', 'create') : false
  const { online } = useNetworkStatus()

  const query = useQueryState<ChatMessage[]>(
    async (supabase) => {
      const { data, error } = await supabase
        .from('copilot_messages')
        .select('id, role, content, citations, sequence_number')
        .eq('copilot_conversation_id', conversationId)
        .order('sequence_number', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []).map((row) => ({
        id: row.id as string,
        role: row.role as ChatMessage['role'],
        content: row.content as string | null,
        citations: ((row.citations as CopilotCitation[] | null) ?? []) as CopilotCitation[],
      }))
    },
    [conversationId],
    { isEmpty: () => false },
  )

  // Messages appended by THIS screen since it mounted — a send's optimistic
  // user bubble, the assistant's reply, or a failure bubble. Deliberately
  // NOT synced from `query.data` via an effect (that pattern is both an
  // unnecessary same-tick setState-in-effect and pointless here — this
  // screen never re-fetches `copilot_messages` after the initial load, so
  // there is nothing for an effect to resync). `messages` below is just
  // the persisted rows the initial query already loaded, plus whatever
  // this screen has appended locally since.
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  const messages = [...(query.data ?? []), ...localMessages]

  const send = useCallback(
    async (text: string) => {
      if (!organizationId || !text.trim()) return
      // The Send button is already disabled while offline (the top banner
      // covers the "why"), so this is defense against the button/online
      // flag racing rather than the normal path — still fails clean
      // rather than attempting a doomed request.
      if (!online) return

      const userMessage: ChatMessage = {
        id: `local-user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        citations: [],
      }
      setLocalMessages((prev) => [...prev, userMessage])
      setInput('')
      setSending(true)

      const outcome = await sendCopilotTurn({
        organizationId,
        conversationId,
        message: text.trim(),
      })
      setSending(false)

      if (outcome.success) {
        setLocalMessages((prev) => [
          ...prev,
          {
            id: outcome.data.messageId,
            role: 'assistant',
            content: outcome.data.text,
            citations: outcome.data.citations,
          },
        ])
        return
      }

      if ('data' in outcome) {
        setLocalMessages((prev) => [
          ...prev,
          {
            id: `local-fail-${Date.now()}`,
            role: 'system_note',
            content: null,
            citations: [],
            failure: outcome.data.status,
          },
        ])
      } else {
        setLocalMessages((prev) => [
          ...prev,
          {
            id: `local-fail-${Date.now()}`,
            role: 'system_note',
            content: outcome.error,
            citations: [],
          },
        ])
      }
    },
    [organizationId, conversationId, online],
  )

  function handleSend() {
    if (!input.trim() || sending) return
    void send(input)
  }

  function handleRetry(lastUserText: string | null) {
    if (!lastUserText) return
    void send(lastUserText)
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

  if (query.status !== 'success' && query.status !== 'empty') {
    return (
      <ScreenContainer>
        <QueryStateView
          kind={query.status as 'loading' | 'error' | 'not_configured' | 'offline'}
          title={
            query.status === 'offline'
              ? "You're offline"
              : query.status === 'not_configured'
                ? 'Not connected'
                : 'Could not load this conversation'
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

  function findLastUserText(upToIndex: number): string | null {
    for (let i = upToIndex - 1; i >= 0; i -= 1) {
      const candidate = messages[i]
      if (candidate && candidate.role === 'user') return candidate.content
    }
    return null
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!online && (
          <Text style={styles.offlineBanner}>
            You&rsquo;re offline — messages won&rsquo;t send until you&rsquo;re back online.
          </Text>
        )}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Ask the copilot about this project or a candidate.</Text>
          }
          renderItem={({ item, index }) => {
            if (item.failure || item.role === 'system_note') {
              const copy = item.failure
                ? FAILURE_COPY[item.failure]
                : (item.content ?? 'Something went wrong sending that message.')
              return (
                <View style={styles.failureBubble}>
                  <Text style={styles.failureText}>{copy}</Text>
                  {item.failure && RETRYABLE.has(item.failure) && (
                    <Pressable
                      onPress={() => handleRetry(findLastUserText(index))}
                      accessibilityRole="button"
                    >
                      <Text style={styles.retryLink}>Retry</Text>
                    </Pressable>
                  )}
                </View>
              )
            }

            const isUser = item.role === 'user'
            return (
              <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
                <Card style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
                  <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
                    {item.content}
                  </Text>
                  {item.citations.length > 0 && (
                    <View style={styles.citations}>
                      <Text style={styles.citationsLabel}>
                        Cited (informational only, not a decision):
                      </Text>
                      {item.citations.map((citation, i) => (
                        <Text key={i} style={styles.citationLine}>
                          • {citation.excerpt ?? citation.kind}
                        </Text>
                      ))}
                    </View>
                  )}
                </Card>
              </View>
            )
          }}
        />

        <View style={styles.inputRow}>
          <Input
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask the copilot…"
            multiline
            editable={!sending}
            maxLength={4000}
          />
          <Button
            onPress={handleSend}
            loading={sending}
            disabled={sending || !input.trim() || !online}
          >
            Send
          </Button>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  offlineBanner: {
    ...typeScale.bodySm,
    color: colors.warningText,
    backgroundColor: colors.warningBg,
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.sm8,
    borderRadius: 6,
    marginBottom: spacing.sm8,
  },
  list: { gap: spacing.sm8, paddingBottom: spacing.lg16 },
  emptyText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl24,
  },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', gap: spacing.xs4 },
  bubbleAssistant: { backgroundColor: colors.surfaceBase },
  bubbleUser: { backgroundColor: colors.secondary },
  bubbleText: { ...typeScale.bodyMd, color: colors.tertiary },
  bubbleTextUser: { color: colors.white },
  citations: { marginTop: spacing.xs4, gap: 2 },
  citationsLabel: { ...typeScale.labelMd, color: colors.textMuted },
  citationLine: { ...typeScale.bodySm, color: colors.textMuted },
  failureBubble: {
    alignSelf: 'center',
    backgroundColor: colors.errorBg,
    borderRadius: 6,
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.sm8,
    gap: spacing.xs4,
    alignItems: 'center',
  },
  failureText: { ...typeScale.bodySm, color: colors.errorText, textAlign: 'center' },
  retryLink: { ...typeScale.labelMd, color: colors.secondary },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm8,
    alignItems: 'flex-end',
    paddingVertical: spacing.sm8,
  },
  input: { flex: 1, minHeight: 44, maxHeight: 120 },
})
