'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react'
import { Alert, Button, Card, CardBody, ConfirmationDialog, StatusBadge, Textarea } from '@rqi/ui'
import type { CopilotToolName } from '@rqi/types'
import type {
  CopilotConversationDetail,
  CopilotMessageEntry,
  CopilotToolCallEntry,
  SuggestedQuestion,
} from '@/lib/copilot/load'
import {
  archiveCopilotConversationAction,
  endCopilotConversationAction,
  recordCopilotFeedbackAction,
  sendCopilotMessageAction,
  type CopilotSendMessageResult,
} from '@/lib/copilot/copilot-actions'

/**
 * The copilot chat panel (Build Phase 11 Wave 4, Task C): conversation
 * transcript, composer, suggested questions, citations, tool-activity
 * transparency, processing/error states per `CopilotTurnOutcome` variant,
 * feedback controls, and a confirmation-dialog affordance for a future
 * mutating tool. `useTransition` + FormData action calls, mirroring
 * apps/web/components/domain/outreach/outreach-sequence-workspace.tsx.
 *
 * NO OPTIMISTIC MESSAGE RENDERING: rather than locally rendering the user's
 * just-typed message before the server responds (which would need to be
 * reconciled against — or risk diverging from — what `runCopilotTurn`
 * actually persisted, including the cases where it does NOT persist the
 * user's message at all, e.g. `rate_limited`/
 * `permission_narrowed_since_conversation_start`, which return before step
 * 3's insert — see run-copilot-turn.ts's own step comments), this component
 * shows a transient "sending…" indicator only, then calls `router.refresh()`
 * after every outcome (success or failure) so the transcript always reflects
 * exactly what the database actually holds — never a client-side guess.
 */
export function CopilotConversationWorkspace({
  organizationId,
  detail,
  suggestedQuestions,
}: {
  organizationId: string
  detail: CopilotConversationDetail
  suggestedQuestions: SuggestedQuestion[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState('')
  const [lastOutcome, setLastOutcome] = useState<CopilotSendMessageResult | null>(null)
  const [statusMessage, setStatusMessage] = useState<{
    tone: 'success' | 'danger'
    text: string
  } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const canCompose = detail.status === 'active'

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    const fd = new FormData()
    fd.set('organizationId', organizationId)
    fd.set('conversationId', detail.id)
    fd.set('message', trimmed)
    setDraft('')
    setLastOutcome(null)
    startTransition(async () => {
      const outcome = await sendCopilotMessageAction(fd)
      setLastOutcome(outcome.status === 'success' ? null : outcome)
      router.refresh()
    })
  }

  function handleConversationAction(outcome: { success: boolean; message?: string }) {
    setStatusMessage(
      outcome.message
        ? { tone: outcome.success ? 'success' : 'danger', text: outcome.message }
        : null,
    )
    if (outcome.success) router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {statusMessage && <Alert tone={statusMessage.tone} title={statusMessage.text} />}

      <ConversationControls
        detail={detail}
        organizationId={organizationId}
        onDone={handleConversationAction}
      />

      <div className="flex flex-col gap-4">
        {detail.messages.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-muted text-sm">
                No messages yet. Ask a question below to get started.
              </p>
            </CardBody>
          </Card>
        ) : (
          detail.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              organizationId={organizationId}
              conversationId={detail.id}
            />
          ))
        )}

        {pending && (
          <div className="flex items-center gap-2 self-start">
            <span className="bg-secondary h-2 w-2 animate-pulse rounded-full" aria-hidden="true" />
            <span
              className="bg-secondary h-2 w-2 animate-pulse rounded-full [animation-delay:150ms]"
              aria-hidden="true"
            />
            <span
              className="bg-secondary h-2 w-2 animate-pulse rounded-full [animation-delay:300ms]"
              aria-hidden="true"
            />
            <span className="text-muted text-xs" role="status">
              The copilot is thinking…
            </span>
          </div>
        )}

        {lastOutcome && <TurnErrorState outcome={lastOutcome} />}
      </div>

      {detail.messages.length === 0 && suggestedQuestions.length > 0 && canCompose && (
        <div className="flex flex-wrap gap-2">
          {suggestedQuestions.map((q) => (
            <button
              key={q.text}
              type="button"
              disabled={pending}
              onClick={() => send(q.text)}
              className="rounded-badge border-outline-perimeter text-tertiary hover:bg-canvas border bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {q.text}
            </button>
          ))}
        </div>
      )}

      {canCompose ? (
        <form
          ref={formRef}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          <div className="flex-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask the copilot a question…"
              rows={2}
              maxLength={4000}
              disabled={pending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(draft)
                }
              }}
            />
          </div>
          <Button type="submit" variant="primary" disabled={pending || !draft.trim()}>
            {pending ? 'Sending…' : 'Send'}
          </Button>
        </form>
      ) : (
        <Alert
          tone="info"
          title={`This conversation is ${detail.status} and can no longer be used.`}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conversation-level controls (archive / end)
// ---------------------------------------------------------------------------

function ConversationControls({
  detail,
  organizationId,
  onDone,
}: {
  detail: CopilotConversationDetail
  organizationId: string
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [confirmEnd, setConfirmEnd] = useState(false)

  if (detail.status === 'ended') return null

  return (
    <div className="flex items-center gap-2">
      {detail.status === 'active' && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => {
            const fd = new FormData()
            fd.set('organizationId', organizationId)
            fd.set('conversationId', detail.id)
            startTransition(async () => onDone(await archiveCopilotConversationAction(fd)))
          }}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Archive
        </Button>
      )}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => setConfirmEnd(true)}
      >
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> End conversation
      </Button>
      <ConfirmationDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End this conversation?"
        description="This conversation will be permanently marked ended and can no longer be used. This cannot be undone."
        confirmLabel="End conversation"
        destructive
        onConfirm={() => {
          setConfirmEnd(false)
          const fd = new FormData()
          fd.set('organizationId', organizationId)
          fd.set('conversationId', detail.id)
          startTransition(async () => onDone(await endCopilotConversationAction(fd)))
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message bubble: content, citations, tool activity, feedback
// ---------------------------------------------------------------------------

/**
 * Historical messages carry no separate `citationsCaveatApplied`/
 * `unsupportedClaimsStripped` columns — those flags only exist on the
 * live `CopilotTurnOutcome` object `sendCopilotMessageAction` just
 * returned (`run-copilot-turn.ts` folds them into the persisted `content`
 * text itself as an appended note, rather than a separate column). This
 * heuristic detects that same exact note text on reload, so the safety
 * indicator survives a page refresh too — a deliberate JUDGMENT CALL
 * documented here for wave 5: it depends on `run-copilot-turn.ts`'s two
 * note strings staying exactly as they are today; if that wording ever
 * changes, this detection silently stops matching (it fails closed — the
 * warning indicator just stops showing, it never fabricates one).
 */
function detectSafetyCaveats(content: string | null): {
  unsupportedClaimsStripped: boolean
  citationsCaveatApplied: boolean
} {
  if (!content) return { unsupportedClaimsStripped: false, citationsCaveatApplied: false }
  return {
    unsupportedClaimsStripped: content.includes('could not be verified against retrieved records'),
    citationsCaveatApplied: content.includes('did not cite specific records'),
  }
}

const TOOL_LABELS: Partial<Record<CopilotToolName, string>> = {
  summarize_recruitment_project: 'project summary',
  explain_scorecard: 'scorecard explanation',
  find_missing_job_requirements: 'missing requirements check',
  summarize_candidate: 'candidate summary',
  explain_candidate_match: 'candidate match explanation',
  compare_approved_candidates: 'candidate comparison',
  identify_missing_evidence: 'missing evidence check',
  draft_verification_questions: 'verification questions draft',
  draft_interview_questions: 'interview questions draft',
  draft_outreach_message: 'outreach message draft',
  summarize_candidate_responses: 'candidate response summary',
  explain_poc_metrics: 'POC metrics explanation',
  suggest_next_workflow_action: 'next-action suggestion',
}

function MessageBubble({
  message,
  organizationId,
  conversationId,
}: {
  message: CopilotMessageEntry
  organizationId: string
  conversationId: string
}) {
  if (message.role === 'system_note') {
    // An internal-only annotation (e.g. "turn cancelled or timed out") —
    // never model- or user-authored, rendered as plain inline text, never
    // hidden: the brief's "never silently swallow a safety-relevant
    // outcome" concern applies here too.
    return (
      <div className="text-muted rounded-card border-outline-perimeter border border-dashed bg-white px-3 py-2 text-xs">
        {message.content}
      </div>
    )
  }

  const isUser = message.role === 'user'
  const caveats = !isUser
    ? detectSafetyCaveats(message.content)
    : { unsupportedClaimsStripped: false, citationsCaveatApplied: false }
  const hasSafetyCaveat = caveats.unsupportedClaimsStripped || caveats.citationsCaveatApplied

  return (
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`rounded-card max-w-[85%] whitespace-pre-wrap break-words px-4 py-3 text-sm ${
          isUser ? 'bg-secondary text-white' : 'border-outline-cell text-tertiary border bg-white'
        }`}
      >
        {/* message.content is rendered as plain text ONLY — never
            dangerouslySetInnerHTML, never markdown-parsed — since a `user`
            row can contain org-user-typed text and an `assistant` row's
            text is model output that may itself echo untrusted
            tool-returned data; React's default text-node rendering below
            is what keeps this safe regardless of content. */}
        {message.content ?? '(no content)'}
      </div>

      {hasSafetyCaveat && (
        <StatusBadge status="pending">
          {caveats.unsupportedClaimsStripped ? 'Unverified claim removed' : 'No cited sources'}
        </StatusBadge>
      )}

      {!isUser && message.citations.length > 0 && <CitationList citations={message.citations} />}

      {isUser && message.toolCalls.length > 0 && <ToolActivityList toolCalls={message.toolCalls} />}

      {!isUser && (
        <FeedbackControls
          organizationId={organizationId}
          conversationId={conversationId}
          messageId={message.id}
        />
      )}
    </div>
  )
}

function CitationList({ citations }: { citations: CopilotMessageEntry['citations'] }) {
  return (
    <div className="flex max-w-[85%] flex-col gap-1">
      <p className="text-muted text-[11px] font-semibold uppercase tracking-wide">Sources</p>
      <ul className="flex flex-col gap-1">
        {citations.map((citation, index) => (
          <li
            key={`${citation.kind}-${citation.id}-${index}`}
            className="rounded-badge border-outline-cell border bg-white px-2 py-1 text-xs"
          >
            <span className="text-tertiary font-medium">{citation.kind.replace(/_/g, ' ')}</span>
            {/* citation.excerpt is a verbatim excerpt from a platform
                record — untrusted, candidate-/document-sourced content in
                the general case — rendered as plain text only. */}
            {citation.excerpt && (
              <span className="text-muted"> — &ldquo;{citation.excerpt}&rdquo;</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ToolActivityList({ toolCalls }: { toolCalls: CopilotToolCallEntry[] }) {
  const allowed = toolCalls.filter((t) => !t.denied)
  const denied = toolCalls.filter((t) => t.denied)
  return (
    <div className="flex max-w-[85%] flex-col gap-1">
      {allowed.length > 0 && (
        <p className="text-muted text-xs">
          Looked up: {allowed.map((t) => TOOL_LABELS[t.toolName] ?? t.toolName).join(', ')}
        </p>
      )}
      {denied.map((t) => (
        <div key={t.id} className="flex items-start gap-1.5">
          <StatusBadge status="failed">Blocked</StatusBadge>
          <span className="text-danger text-xs">
            Attempted &ldquo;{t.toolName}&rdquo; —{' '}
            {t.denialReason ?? 'not permitted for your role.'}
          </span>
        </div>
      ))}
      {toolCalls.some((t) => t.requiresConfirmation && !t.confirmedAt) && (
        <PendingToolConfirmation
          toolCalls={toolCalls.filter((t) => t.requiresConfirmation && !t.confirmedAt)}
        />
      )}
    </div>
  )
}

/**
 * Confirmation-before-mutation affordance (brief Task C requirement). No
 * tool in TOOL_REGISTRY currently sets `requiresConfirmation: true`
 * (tool-registry.ts's own header note: all 13 tools are read-only —
 * summarize/explain/draft/compare/suggest, never a write), so this branch
 * never renders in the current build. It exists so the UI is ready the
 * moment a future mutating tool sets `requires_confirmation` on a
 * `copilot_tool_calls` row: it surfaces the pending row and a
 * `ConfirmationDialog`, but its "Confirm" action is deliberately a
 * disabled placeholder — there is no `confirmCopilotToolCallAction` server
 * action in this wave (out of scope: no mutating tool exists to confirm),
 * and wiring a fake one would let this affordance silently "succeed"
 * without actually setting `confirmed_at`/`confirmed_by`, which is exactly
 * the kind of dishonest UI state this codebase's conventions avoid. A
 * future wave that adds a mutating tool must add that action and replace
 * this placeholder.
 */
function PendingToolConfirmation({ toolCalls }: { toolCalls: CopilotToolCallEntry[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <StatusBadge status="pending">Needs confirmation</StatusBadge>
      <button
        type="button"
        className="text-secondary text-xs underline"
        onClick={() => setOpen(true)}
      >
        Review
      </button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title="Confirm before this action proceeds"
        description={`${toolCalls.map((t) => t.toolName).join(', ')} — no confirmation action is wired up yet in this build; this is scaffolding for a future mutating tool.`}
        confirmLabel="Not available yet"
        onConfirm={() => setOpen(false)}
      />
    </div>
  )
}

function FeedbackControls({
  organizationId,
  conversationId,
  messageId,
}: {
  organizationId: string
  conversationId: string
  messageId: string
}) {
  const [pending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState<'helpful' | 'not_helpful' | null>(null)

  function rate(rating: 'helpful' | 'not_helpful') {
    if (pending || submitted) return
    const fd = new FormData()
    fd.set('organizationId', organizationId)
    fd.set('conversationId', conversationId)
    fd.set('messageId', messageId)
    fd.set('rating', rating)
    startTransition(async () => {
      const outcome = await recordCopilotFeedbackAction(fd)
      if (outcome.success) setSubmitted(rating)
    })
  }

  if (submitted) {
    return (
      <p className="text-muted text-xs">
        {submitted === 'helpful'
          ? 'Marked helpful. Thanks!'
          : 'Marked not helpful. Thanks for the signal.'}
      </p>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Mark this response helpful"
        disabled={pending}
        onClick={() => rate('helpful')}
        className="text-muted hover:text-primary rounded-control p-1 disabled:opacity-50"
      >
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Mark this response not helpful"
        disabled={pending}
        onClick={() => rate('not_helpful')}
        className="text-muted hover:text-danger rounded-control p-1 disabled:opacity-50"
      >
        <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Turn error state — one distinct, honest rendering per CopilotTurnOutcome
// failure variant (brief Task C requirement)
// ---------------------------------------------------------------------------

function TurnErrorState({ outcome }: { outcome: CopilotSendMessageResult }) {
  switch (outcome.status) {
    case 'success':
      return null
    case 'invalid_request':
      return <Alert tone="danger" title={outcome.message} />
    case 'not_configured':
      return (
        <Alert tone="warning" title="AI copilot is not available in this environment.">
          No Anthropic API key is configured here.
        </Alert>
      )
    case 'permission_narrowed_since_conversation_start':
      return (
        <Alert tone="warning" title="Your access has changed.">
          {outcome.message}
        </Alert>
      )
    case 'rate_limited':
      return (
        <Alert tone="warning" title="Usage limit reached.">
          {outcome.message}
        </Alert>
      )
    case 'unauthorized_tool_attempt':
      // A HARD STOP, deliberately NOT styled like a retry-in-place error
      // (run-copilot-turn.ts's own "JUDGMENT CALL" note: this is not a
      // recoverable mistake, it is the copilot attempting something
      // outside its role's authority, and the whole turn was aborted for
      // safety) — never silently swallowed or downplayed as an ordinary
      // failure.
      return (
        <Alert tone="danger" title="This request was stopped for safety.">
          The copilot attempted to use &ldquo;{outcome.toolName}&rdquo;, which is not permitted for
          your role. This turn was stopped before it could complete — nothing further was attempted.
          This has been recorded in the audit log.
        </Alert>
      )
    case 'timeout':
      return (
        <Alert tone="danger" title="The copilot took too long to respond.">
          Please try again.
        </Alert>
      )
    case 'cancelled':
      return <Alert tone="info" title="This request was cancelled." />
    case 'provider_error':
      return (
        <Alert tone="danger" title="The copilot could not complete this request.">
          Please try again.
        </Alert>
      )
    case 'validation_rejected':
      return (
        <Alert tone="danger" title="The copilot could not produce a usable answer.">
          {outcome.message}
        </Alert>
      )
  }
}
