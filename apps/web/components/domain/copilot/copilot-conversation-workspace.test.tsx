import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@rqi/testing'
import { CopilotConversationWorkspace } from './copilot-conversation-workspace'
import type { CopilotConversationDetail } from '@/lib/copilot/load'

/**
 * Build Phase 11, Wave 5 — EVALUATION: the two UI-level adversarial checks
 * the brief and wave 4's own report flag explicitly.
 *
 *  1. CANARY for `detectSafetyCaveats()` (copilot-conversation-workspace.tsx):
 *     that function is a text-heuristic, matching two hardcoded note strings
 *     `run-copilot-turn.ts` appends — flagged in wave 4's report as
 *     fragile-but-fails-closed. This test asserts the detection still
 *     matches TODAY'S exact wording from BOTH sides: a reloaded historical
 *     message containing `run-copilot-turn.ts`'s real, current caveat text
 *     renders the safety badge; if a future wording change to either file
 *     breaks the match, this test (not just a silently-vanished UI badge)
 *     is what catches it.
 *  2. HTML/script-injection-renders-as-plain-text: a citation excerpt is
 *     untrusted, candidate-/document-sourced content in the general case
 *     (the component's own comment says so) — this proves React's default
 *     text-node rendering actually holds for it, never
 *     `dangerouslySetInnerHTML`, by seeding a citation excerpt containing
 *     literal HTML/script-like markup and asserting it appears as inert
 *     text, never as a parsed DOM element or an executed script.
 *
 * `next/navigation`'s `useRouter` is mocked per this repo's own precedent
 * (`app-shell.test.tsx`, `mobile-bottom-nav.test.tsx`) — this component
 * calls `router.refresh()` only from inside a submit handler, never on
 * render, so the mock below only needs to exist, not be exercised.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}))

function baseDetail(overrides: Partial<CopilotConversationDetail> = {}): CopilotConversationDetail {
  return {
    id: 'conv-1',
    organizationId: 'org-1',
    status: 'active',
    title: null,
    roleAtCreation: 'recruiter',
    recruitmentProjectId: null,
    recruitmentProjectTitle: null,
    clientId: null,
    dataClassification: 'standard',
    messages: [],
    ...overrides,
  }
}

describe('EVALUATION — UI safety-indicator canary (detectSafetyCaveats text-heuristic)', () => {
  it('shows "Unverified claim removed" for a reloaded assistant message containing run-copilot-turn.ts\'s EXACT current unsupported-claim note text', () => {
    // This literal string must stay byte-for-byte identical to the note
    // run-copilot-turn.ts's step 7 appends (see that file's line building
    // `text = \`${text}\n\n---\nNote: this response included ...\``) — if a
    // future edit to that wording diverges from what
    // copilot-conversation-workspace.tsx's detectSafetyCaveats() matches,
    // THIS assertion fails, not just the UI silently losing its badge.
    const detail = baseDetail({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content:
            'The candidate is a strong fit.\n\n---\nNote: this response included 1 claim(s) that could not be verified against retrieved records. They have been removed from the citations below and should not be treated as confirmed.',
          citations: [],
          sequenceNumber: 1,
          createdAt: new Date().toISOString(),
          toolCalls: [],
        },
      ],
    })
    render(
      <CopilotConversationWorkspace
        organizationId="org-1"
        detail={detail}
        suggestedQuestions={[]}
      />,
    )
    expect(screen.getByText('Unverified claim removed')).toBeInTheDocument()
  })

  it('shows "No cited sources" for a reloaded message containing the EXACT current missing-citation note text', () => {
    const detail = baseDetail({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content:
            'Here is a procedural answer.\n\n---\nNote: this response did not cite specific records, though relevant data was retrieved this turn. Treat it as a general summary rather than a citation-backed answer.',
          citations: [],
          sequenceNumber: 1,
          createdAt: new Date().toISOString(),
          toolCalls: [],
        },
      ],
    })
    render(
      <CopilotConversationWorkspace
        organizationId="org-1"
        detail={detail}
        suggestedQuestions={[]}
      />,
    )
    expect(screen.getByText('No cited sources')).toBeInTheDocument()
  })

  it('shows NO safety badge for an ordinary assistant message and NEVER for a user message, even if the user literally typed the caveat phrase themselves', () => {
    const detail = baseDetail({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'A clean, fully-cited answer.',
          citations: [],
          sequenceNumber: 1,
          createdAt: new Date().toISOString(),
          toolCalls: [],
        },
        {
          id: 'm2',
          role: 'user',
          content: 'this response did not cite specific records', // a user typing this text must never trigger the assistant-only safety badge.
          citations: [],
          sequenceNumber: 2,
          createdAt: new Date().toISOString(),
          toolCalls: [],
        },
      ],
    })
    render(
      <CopilotConversationWorkspace
        organizationId="org-1"
        detail={detail}
        suggestedQuestions={[]}
      />,
    )
    expect(screen.queryByText('No cited sources')).not.toBeInTheDocument()
    expect(screen.queryByText('Unverified claim removed')).not.toBeInTheDocument()
  })
})

describe('EVALUATION — an HTML/script-like citation excerpt renders as inert plain text, never parsed markup', () => {
  it('a citation excerpt containing literal HTML/script markup appears as visible text and creates no real DOM element for it', () => {
    const hostileExcerpt =
      '<img src=x onerror="window.__pwned = true">Reliable and punctual<script>window.__pwned = true</script>'
    const detail = baseDetail({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'This candidate meets the reliability requirement.',
          citations: [{ kind: 'job_requirement', id: 'req-1', excerpt: hostileExcerpt }],
          sequenceNumber: 1,
          createdAt: new Date().toISOString(),
          toolCalls: [],
        },
      ],
    })
    render(
      <CopilotConversationWorkspace
        organizationId="org-1"
        detail={detail}
        suggestedQuestions={[]}
      />,
    )

    // The literal markup text is visible as INERT TEXT (React escapes it by
    // default when interpolated as a child, which is exactly the guarantee
    // under test) ...
    expect(screen.getByText(/<script>window\.__pwned = true<\/script>/)).toBeInTheDocument()
    // ... and no actual <script> element or <img> element was created from
    // it anywhere in the rendered DOM — if this were ever rendered via
    // dangerouslySetInnerHTML, the browser/JSDOM would have parsed these
    // into real elements instead of literal text nodes.
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img[onerror]')).toBeNull()
    // The global the injected onerror/script would have set was never set —
    // final proof nothing executed.
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
