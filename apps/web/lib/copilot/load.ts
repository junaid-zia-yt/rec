import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type {
  CopilotCitation,
  CopilotConversationStatus,
  CopilotDataClassification,
  CopilotMessageRole,
  CopilotToolName,
  Role,
} from '@rqi/types'
import { isToolAllowedForRole, TOOL_REGISTRY } from './tool-registry'

/**
 * Build Phase 11, Wave 4, Task B — live data loaders for the copilot UI.
 * Mirrors apps/web/lib/outreach/load.ts / load-detail.ts exactly: plain
 * Supabase reads via the caller's own RLS-scoped session (own-conversation-
 * only, per 0031's `copilot_conversations_select_own_or_oversight` policy —
 * these loaders never use the admin/service-role client), mapped into
 * UI-shaped interfaces, no ORM.
 */

// ---------------------------------------------------------------------------
// 1. Conversation list
// ---------------------------------------------------------------------------

export interface CopilotConversationSummary {
  id: string
  status: CopilotConversationStatus
  title: string | null
  roleAtCreation: Role
  recruitmentProjectId: string | null
  recruitmentProjectTitle: string | null
  clientId: string | null
  dataClassification: CopilotDataClassification
  messageCount: number
  lastMessageAt: string | null
  createdAt: string
}

/** The current user's own conversations, newest activity first — RLS already scopes this to `user_id = auth.uid()` (plus read-only oversight rows for agency_admin/platform_admin, which this query deliberately does NOT surface here — an admin's OWN conversations, not everyone's, is what belongs in a "your conversations" list; a dedicated oversight view is future scope). */
export async function loadCopilotConversations(
  organizationId: string,
  userId: string,
): Promise<CopilotConversationSummary[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data: conversations } = await supabase
    .from('copilot_conversations')
    .select(
      'id, status, title, role_at_creation, recruitment_project_id, client_id, data_classification, created_at, updated_at',
    )
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (!conversations || conversations.length === 0) return []

  const projectIds = [
    ...new Set(
      conversations.map((c) => c.recruitment_project_id).filter((id): id is string => Boolean(id)),
    ),
  ]
  const conversationIds = conversations.map((c) => c.id)

  const [{ data: projects }, { data: messages }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from('recruitment_projects').select('id, role_title').in('id', projectIds)
      : Promise.resolve({ data: [] as { id: string; role_title: string }[] }),
    supabase
      .from('copilot_messages')
      .select('copilot_conversation_id, created_at')
      .in('copilot_conversation_id', conversationIds)
      .order('created_at', { ascending: false }),
  ])

  const projectTitleById = new Map(
    (projects ?? []).map((p) => [p.id as string, p.role_title as string]),
  )

  const lastMessageAtByConversation = new Map<string, string>()
  const messageCountByConversation = new Map<string, number>()
  for (const message of messages ?? []) {
    const id = message.copilot_conversation_id as string
    messageCountByConversation.set(id, (messageCountByConversation.get(id) ?? 0) + 1)
    if (!lastMessageAtByConversation.has(id)) {
      // messages were fetched newest-first, so the first one seen per
      // conversation id is its latest.
      lastMessageAtByConversation.set(id, message.created_at as string)
    }
  }

  return conversations.map((c) => ({
    id: c.id,
    status: c.status,
    title: c.title,
    roleAtCreation: c.role_at_creation,
    recruitmentProjectId: c.recruitment_project_id,
    recruitmentProjectTitle: c.recruitment_project_id
      ? (projectTitleById.get(c.recruitment_project_id) ?? 'Unknown project')
      : null,
    clientId: c.client_id,
    dataClassification: c.data_classification,
    messageCount: messageCountByConversation.get(c.id) ?? 0,
    lastMessageAt: lastMessageAtByConversation.get(c.id) ?? null,
    createdAt: c.created_at,
  }))
}

// ---------------------------------------------------------------------------
// 2. Conversation detail — messages + tool-call activity, for the transcript
// ---------------------------------------------------------------------------

export interface CopilotToolCallEntry {
  id: string
  toolName: CopilotToolName
  denied: boolean
  denialReason: string | null
  outputValidationStatus: 'pending' | 'valid' | 'invalid' | 'error'
  createdAt: string
  /** The propose -> confirm mutation scaffolding (0031). No tool in TOOL_REGISTRY sets `requiresConfirmation: true` as of this wave (tool-registry.ts's own header note — all 13 tools are read/summarize/explain/draft/compare/suggest, never a write), so this is always `false`/`null` today. Loaded anyway so the UI's ConfirmationDialog affordance has real fields to check the moment a future mutating tool sets them. */
  requiresConfirmation: boolean
  confirmedAt: string | null
}

export interface CopilotMessageEntry {
  id: string
  role: CopilotMessageRole
  content: string | null
  citations: CopilotCitation[]
  sequenceNumber: number
  createdAt: string
  /** Every `copilot_tool_calls` row this assistant turn made — the "tool activity" transparency indicator (brief Task C). Always empty for a `user`/`system_note` row. */
  toolCalls: CopilotToolCallEntry[]
}

export interface CopilotConversationDetail {
  id: string
  organizationId: string
  status: CopilotConversationStatus
  title: string | null
  roleAtCreation: Role
  recruitmentProjectId: string | null
  recruitmentProjectTitle: string | null
  clientId: string | null
  dataClassification: CopilotDataClassification
  messages: CopilotMessageEntry[]
}

/** One conversation's full transcript, own-conversation-only per RLS — returns null if the conversation does not exist or does not belong to the caller (RLS silently returns no row rather than an error, and this loader treats that identically to "not found"). */
export async function loadCopilotConversationDetail(
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<CopilotConversationDetail | null> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return null

  const { data: conversation } = await supabase
    .from('copilot_conversations')
    .select(
      'id, organization_id, status, title, role_at_creation, recruitment_project_id, client_id, data_classification',
    )
    .eq('id', conversationId)
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!conversation) return null

  const [{ data: project }, { data: messages }, { data: toolCalls }] = await Promise.all([
    conversation.recruitment_project_id
      ? supabase
          .from('recruitment_projects')
          .select('role_title')
          .eq('id', conversation.recruitment_project_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('copilot_messages')
      .select('id, role, content, citations, sequence_number, created_at')
      .eq('copilot_conversation_id', conversationId)
      .order('sequence_number', { ascending: true }),
    supabase
      .from('copilot_tool_calls')
      .select(
        'id, copilot_message_id, tool_name, denied, denial_reason, output_validation_status, requires_confirmation, confirmed_at, created_at',
      )
      .eq('copilot_conversation_id', conversationId)
      .order('created_at', { ascending: true }),
  ])

  const toolCallsByMessage = new Map<string, CopilotToolCallEntry[]>()
  for (const row of toolCalls ?? []) {
    const list = toolCallsByMessage.get(row.copilot_message_id as string) ?? []
    list.push({
      id: row.id,
      toolName: row.tool_name,
      denied: row.denied,
      denialReason: row.denial_reason,
      outputValidationStatus: row.output_validation_status,
      requiresConfirmation: row.requires_confirmation,
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
    })
    toolCallsByMessage.set(row.copilot_message_id as string, list)
  }

  const messageEntries: CopilotMessageEntry[] = (messages ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    citations: (row.citations as CopilotCitation[] | null) ?? [],
    sequenceNumber: row.sequence_number,
    createdAt: row.created_at,
    // A tool call is persisted against the USER message row that triggered
    // it (run-copilot-turn.ts's executeTool always inserts
    // `copilot_message_id: userMessageRow!.id`) — the transcript therefore
    // shows "tools this turn used" attached to the user's question that
    // prompted them, which reads more naturally than attaching them to the
    // assistant's reply.
    toolCalls: toolCallsByMessage.get(row.id) ?? [],
  }))

  return {
    id: conversation.id,
    organizationId: conversation.organization_id,
    status: conversation.status,
    title: conversation.title,
    roleAtCreation: conversation.role_at_creation,
    recruitmentProjectId: conversation.recruitment_project_id,
    recruitmentProjectTitle: (project as { role_title: string } | null)?.role_title ?? null,
    clientId: conversation.client_id,
    dataClassification: conversation.data_classification,
    messages: messageEntries,
  }
}

// ---------------------------------------------------------------------------
// 3. Suggested questions — deterministic, no AI call, no extra cost
// ---------------------------------------------------------------------------

export interface SuggestedQuestion {
  text: string
  /** The tool this question is expected to exercise — informational only, never sent to the model; used solely to decide whether this suggestion is offered at all (see the role-gating below). */
  toolName: CopilotToolName
}

/**
 * A small, fixed set of starter questions, phrased to naturally invoke one
 * of the 13 registry tools, filtered to only those a role may actually call
 * in THIS conversation's scope (tool-registry.ts's `isToolAllowedForRole` —
 * the same allowlist runCopilotTurn itself enforces, so a suggestion can
 * never prompt a question the copilot would then have to refuse). Purely
 * deterministic string data — no AI call, no extra API cost, per the brief.
 */
export function getSuggestedQuestions(params: {
  role: Role
  hasProjectScope: boolean
}): SuggestedQuestion[] {
  const { role, hasProjectScope } = params

  const candidates: SuggestedQuestion[] = hasProjectScope
    ? [
        { text: 'Summarize this recruitment project.', toolName: 'summarize_recruitment_project' },
        {
          text: "What's missing from this job's requirements?",
          toolName: 'find_missing_job_requirements',
        },
        { text: 'Explain the scorecard for this role.', toolName: 'explain_scorecard' },
        {
          text: "What's missing evidence for the top candidate?",
          toolName: 'identify_missing_evidence',
        },
        {
          text: 'Compare the candidates on the current shortlist.',
          toolName: 'compare_approved_candidates',
        },
        {
          text: 'What should I do next on this project?',
          toolName: 'suggest_next_workflow_action',
        },
      ]
    : [
        { text: 'Summarize this recruitment project.', toolName: 'summarize_recruitment_project' },
        { text: "Explain this candidate's match score.", toolName: 'explain_candidate_match' },
        { text: 'What should I do next?', toolName: 'suggest_next_workflow_action' },
      ]

  return candidates.filter((c) => isToolAllowedForRole(c.toolName, role)).slice(0, 4)
}

/** Every tool a role may invoke in a conversation of this scope — used by the UI's "tool activity" legend so a denied/hallucinated tool name (unauthorized_tool_attempt) can be visually distinguished from a real, allowed one. Re-exported from tool-registry.ts's own source of truth rather than duplicated. */
export function listAllowedToolNames(role: Role): CopilotToolName[] {
  return (Object.keys(TOOL_REGISTRY) as CopilotToolName[]).filter((name) =>
    isToolAllowedForRole(name, role),
  )
}

// ---------------------------------------------------------------------------
// 4. Project options for the "start a conversation" form
// ---------------------------------------------------------------------------

export interface CopilotProjectOption {
  id: string
  roleTitle: string
}

/**
 * The recruitment projects a given role may legally pin a new conversation
 * to — mirrors `startCopilotConversationAction`'s own ownership rules
 * (copilot-actions.ts) so the picker never even offers a project that
 * action would reject: recruiter -> their `project_assignments`,
 * client_decision_maker -> projects belonging to their own represented
 * client (`clientId`, required for that role), agency_admin -> every active
 * project in the org. Org-wide roles that cannot start a conversation at
 * all (platform_admin/read_only_reviewer) get an empty list — the calling
 * page should not even render this form for them (`hasPermission(...,
 * 'copilot', 'create')` is false).
 */
export async function loadCopilotProjectOptions(
  organizationId: string,
  userId: string,
  role: Role,
  clientId?: string | null,
): Promise<CopilotProjectOption[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  if (role === 'recruiter') {
    const { data: assignments } = await supabase
      .from('project_assignments')
      .select('recruitment_project_id')
      .eq('user_id', userId)
    const projectIds = [
      ...new Set((assignments ?? []).map((a) => a.recruitment_project_id as string)),
    ]
    if (projectIds.length === 0) return []
    const { data: projects } = await supabase
      .from('recruitment_projects')
      .select('id, role_title')
      .eq('organization_id', organizationId)
      .in('id', projectIds)
      .order('role_title', { ascending: true })
    return (projects ?? []).map((p) => ({ id: p.id, roleTitle: p.role_title }))
  }

  if (role === 'client_decision_maker') {
    if (!clientId) return []
    const { data: projects } = await supabase
      .from('recruitment_projects')
      .select('id, role_title')
      .eq('organization_id', organizationId)
      .eq('client_id', clientId)
      .order('role_title', { ascending: true })
    return (projects ?? []).map((p) => ({ id: p.id, roleTitle: p.role_title }))
  }

  if (role === 'agency_admin') {
    const { data: projects } = await supabase
      .from('recruitment_projects')
      .select('id, role_title')
      .eq('organization_id', organizationId)
      .order('role_title', { ascending: true })
    return (projects ?? []).map((p) => ({ id: p.id, roleTitle: p.role_title }))
  }

  return []
}
