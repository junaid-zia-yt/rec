/**
 * Permission matrix — docs/06-roles-permissions.md §6.2, encoded literally
 * (same rows/columns, same legend) so the matrix in that document is the
 * single source of truth and this file is a direct transcription, not a
 * reinterpretation. Pure data + a pure function: no Supabase, no React, no
 * framework dependency, so it is usable from RLS-adjacent server code,
 * middleware, and (per docs/21-implementation-contract.md's package
 * boundaries) the future Expo mobile app without duplication.
 *
 * This is the APPLICATION-LAYER permission check (docs/12-security-
 * compliance.md §12.3's "server action/API route guard" layer). It is
 * deliberately independent of, and does not substitute for, the database's
 * own Row Level Security policies (supabase/migrations/*.sql) — per
 * docs/21-implementation-contract.md §21.6/§21.8, RLS is the layer that
 * still holds even if an application-layer check is missed.
 */

export const Resource = [
  'organizations',
  'users',
  'clients',
  'recruitment_projects',
  'job_descriptions',
  'scorecards',
  'candidate_records',
  'candidate_documents',
  'candidate_evidence',
  'human_reviews',
  'outreach',
  'shortlists',
  'poc_reports',
  'copilot',
  'integrations',
  'analytics',
  'billing',
  'settings',
  'audit_logs',
  'notifications',
  'background_jobs',
] as const
export type Resource = (typeof Resource)[number]

export const Action = ['create', 'read', 'update', 'delete', 'approve'] as const
export type Action = (typeof Action)[number]

/**
 * `full` = F (create/read/update/delete), `read` = R, `approve` = A
 * (approve/decision action only — implies read), `none` = – (no access).
 */
type PermissionLevel = 'full' | 'read' | 'approve' | 'none'

/**
 * Deliberately a standalone literal union, not `z.infer<typeof UserRole>`
 * from ./index — importing UserRole here would create a circular import
 * (index.ts re-exports this file). Kept in sync with `UserRole` in
 * ./index.ts by convention; index.test.ts / permissions.test.ts assert the
 * two enumerate the same five roles so drift is caught immediately.
 */
export type Role =
  'platform_admin' | 'agency_admin' | 'recruiter' | 'client_decision_maker' | 'read_only_reviewer'

/** Runtime-checkable list mirroring the `Role` union above, for the drift test described in the comment above (`UserRole.options` from ./index must equal this array). */
export const ROLES: Role[] = [
  'platform_admin',
  'agency_admin',
  'recruiter',
  'client_decision_maker',
  'read_only_reviewer',
]

/**
 * Build Phase 10 (`poc_reports`) decision: this resource covers the whole
 * POC benchmark/comparison surface — `poc_benchmarks`, `poc_roles`,
 * `poc_participants`, `poc_baselines`, `poc_metrics`, `poc_exclusions`,
 * `poc_results` and `poc_decisions` (supabase/migrations/0030) — rather than
 * adding a separate `poc_benchmarks` resource, since it already existed
 * from an earlier phase and is semantically the same surface the brief
 * describes.
 *
 * - `agency_admin: 'full'` — configuring a benchmark, recording baselines/
 *   metrics/exclusions, and recording the POC decision (proceed to paid
 *   pilot / extend / do not proceed) are all internal agency actions. This
 *   is also, per docs/14-poc-specification.md's "authorized approval"
 *   requirement, the role the 0030 migration's `poc_decisions` insert RLS
 *   policy restricts to (with `platform_admin`) — an internal sign-off,
 *   even though it is normally discussed with the client first
 *   (§14.16/§14.17 "reviewed jointly", "dispute... resolved by joint
 *   review of the evidence").
 * - `client_decision_maker: 'read'` (changed from `'none'`) — a POC's
 *   outcome is presented to and discussed with the client (§14.17: "a
 *   POC_results comparison report... reviewed jointly"); the client should
 *   be able to see the finished comparison report and the recorded
 *   decision, but never configure the benchmark, enter baselines, or make
 *   the go/no-go call themselves — that stays an agency decision per the
 *   0030 migration's RLS (client_decision_maker has SELECT-only policies
 *   on every poc_* table, no INSERT/UPDATE anywhere).
 * - `recruiter: 'read'` — a recruiter runs the day-to-day vendor-assisted
 *   process and needs visibility, but benchmark setup/configuration and
 *   the final decision are Agency Admin actions in this matrix; note the
 *   DB layer (0030) is slightly more permissive than this application-
 *   layer default — an assigned recruiter CAN insert poc_baselines/
 *   poc_metrics/poc_exclusions rows at the RLS layer (they are the ones
 *   actually running the process and recording raw data day to day), even
 *   though this resource-level matrix defaults recruiter to 'read'. Server
 *   actions for those specific writes should check role directly rather
 *   than relying solely on `hasPermission(role, 'poc_reports', 'create')`
 *   — flagged here for the next wave's server-action implementation.
 */
/**
 * Build Phase 11 (`copilot`) decision: this resource covers the whole
 * recruiter-AI-copilot surface — `copilot_conversations`,
 * `copilot_messages`, `copilot_tool_calls`, `copilot_usage_counters`
 * (supabase/migrations/0031). Same pattern as `poc_reports` above: one
 * resource row for a multi-table feature area, not one row per table.
 *
 * Unlike every other resource in this matrix, the DB layer (0031) narrows
 * copilot data to the OWNING USER, not the whole org — a conversation is a
 * personal AI session, never a shared work artifact (see 0031's header
 * note). This resource-level grant below controls whether a role may use
 * the copilot AT ALL (create/read their own conversations); it does not
 * and cannot express WHICH of the 13 allowlisted tools a role may invoke
 * within a conversation — that finer-grained, per-role tool restriction is
 * necessarily an application-layer concern for wave 2's orchestration code
 * (the DB's `copilot_tool_calls.tool_name` CHECK is a single shared
 * allowlist across all roles, not a per-role one — see 0031's tool-call
 * table comment). This is flagged explicitly as an OPEN DESIGN QUESTION
 * wave 2 must resolve: it should build its own role -> permitted-tool-
 * subset mapping in application code, layered under this resource grant,
 * the same way project/client row-level scoping is layered under several
 * other resources' grants in this file.
 *
 * - `platform_admin: 'read'` — no operational copilot conversations of
 *   their own for a tenant org (mirrors the `organizations` row's
 *   `platform_admin: 'read'` — platform admin oversees, does not operate,
 *   a tenant's day-to-day work). Their DB-layer access (0031) is the same
 *   read-only, cross-org oversight granted for audit purposes, never a
 *   path to start or write into a conversation.
 * - `agency_admin: 'full'` — full copilot access; also the read-only
 *   ORG-WIDE oversight role at the DB layer (0031) for every other user's
 *   conversation, since every AI action must remain auditable
 *   (Core Principle #10) even though a conversation itself is personal.
 * - `recruiter: 'full'` — the copilot's primary day-to-day user; every
 *   recruiter-scoped conversation is additionally pinned to one assigned
 *   project at the DB layer (0031's `copilot_conversations_scope_by_role`
 *   CHECK), never org-wide, mirroring `recruitment_projects`' existing
 *   assigned-project row-level narrowing (§6.2.1) — see docs/06-roles-
 *   permissions.md.
 * - `client_decision_maker: 'full'` — deliberately NOT `'none'` or a bare
 *   `'read'`: the brief explicitly wants this role to be ABLE to converse
 *   with the copilot, just over a "much narrower capability set" (brief:
 *   "summarize-project/explain-POC-metrics-they-can-see only, never
 *   candidate internal notes or scorecards with recruiter-only content").
 *   That narrowing is enforced two ways at the DB layer already (0031):
 *   every such conversation is forced to `data_classification =
 *   'restricted_notes_excluded'` and pinned to exactly one client/project
 *   (never org-wide) by CHECK constraint — but WHICH of the 13 tools this
 *   role may call (e.g. never `draft_outreach_message`, an internal
 *   recruiter action) is not, and cannot be, expressed by the shared
 *   `tool_name` CHECK constraint alone; wave 2's application-layer tool
 *   allowlist is where that specific role -> tool-subset mapping must
 *   live, per the OPEN DESIGN QUESTION above.
 * - `read_only_reviewer: 'read'` — consistent with this role's design
 *   throughout the rest of the matrix (near-universal read, never create):
 *   `hasPermission('read_only_reviewer', 'copilot', 'create')` is `false`,
 *   so this role's application-layer gate blocks starting a new
 *   conversation entirely. Combined with the DB layer's own-conversation-
 *   only visibility, a read_only_reviewer effectively has no working
 *   copilot access under this default (they have nothing of their own to
 *   read). This is a deliberately conservative default consistent with
 *   the role's read-everything/act-on-nothing philosophy, flagged here as
 *   an open product question — a later wave may want to bump this role to
 *   `'full'` if product wants read-only reviewers to have advisory-only
 *   chat access too; nothing in the 0031 schema itself would need to
 *   change to support that, only this one matrix cell.
 */
/**
 * Build Phase 12 (`notifications`, `background_jobs`) decisions —
 * supabase/migrations/0032.
 *
 * - `notifications: 'full'` for every role except `platform_admin`
 *   (`'none'`). A notification is inherently personal (0032's header
 *   note: "more so even than copilot_conversations" — no admin-oversight
 *   exception exists at the DB layer at all, unlike every other resource
 *   in this matrix). Every operating role needs at least read/update-own
 *   (read the list, mark read) — `'full'` is used rather than a bespoke
 *   partial level because the DB layer (0032's
 *   notifications_read_only_mutation trigger) already narrows what
 *   "full" can actually mean for this table to "read + set read_at
 *   once", independent of this application-layer grant; there is no
 *   `create` a client-side actor legitimately performs either (rows are
 *   system-generated by the notification-dispatch job), so `'full'` here
 *   is a ceiling the DB/server-action layer narrows further, not a
 *   literal grant of arbitrary create/update/delete. `platform_admin:
 *   'none'` mirrors the DB layer exactly (0032 grants platform_admin no
 *   SELECT policy on notifications at all) — platform admin oversees
 *   tenant infrastructure, not an individual user's personal
 *   notification inbox.
 * - `background_jobs: 'read'` for `platform_admin`/`agency_admin` only,
 *   `'none'` for every other role. Mirrors 0032's RLS exactly
 *   (background_jobs_select_oversight): no role "creates" a job directly
 *   through a permission check the way a shortlist-create is a direct,
 *   permission-gated user action — jobs are enqueued by server-side
 *   orchestration code reacting to whatever action a user already took
 *   (uploading a document, approving a match, etc.), so this resource
 *   exists purely for the "Job status" oversight UI (brief) rather than
 *   as a create/update gate. `recruiter`/`client_decision_maker`/
 *   `read_only_reviewer` all get `'none'` — a recruiter does not need to
 *   see the raw job queue to know their document finished processing
 *   (that is what the `notifications` resource above is for); job-queue
 *   visibility is an operational/admin concern, not a day-to-day
 *   workflow one.
 */
// prettier-ignore
const MATRIX: Record<Resource, Record<Role, PermissionLevel>> = {
  organizations:        { platform_admin: 'read',  agency_admin: 'full', recruiter: 'read',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  users:                { platform_admin: 'none',  agency_admin: 'full', recruiter: 'read',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  clients:              { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'read', read_only_reviewer: 'read' },
  recruitment_projects: { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'read', read_only_reviewer: 'read' },
  job_descriptions:     { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'read', read_only_reviewer: 'read' },
  scorecards:           { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  candidate_records:    { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'read', read_only_reviewer: 'read' },
  candidate_documents:  { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  candidate_evidence:   { platform_admin: 'none',  agency_admin: 'read', recruiter: 'read',    client_decision_maker: 'read', read_only_reviewer: 'read' },
  human_reviews:        { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  outreach:             { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  shortlists:           { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'approve', read_only_reviewer: 'read' },
  poc_reports:          { platform_admin: 'none',  agency_admin: 'full', recruiter: 'read',    client_decision_maker: 'read', read_only_reviewer: 'read' },
  copilot:              { platform_admin: 'read',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'full', read_only_reviewer: 'read' },
  integrations:         { platform_admin: 'full',  agency_admin: 'full', recruiter: 'read',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  analytics:            { platform_admin: 'read',  agency_admin: 'full', recruiter: 'read',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  billing:              { platform_admin: 'full',  agency_admin: 'full', recruiter: 'none',    client_decision_maker: 'none', read_only_reviewer: 'none' },
  settings:             { platform_admin: 'full',  agency_admin: 'full', recruiter: 'read',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  audit_logs:           { platform_admin: 'full',  agency_admin: 'read', recruiter: 'read',    client_decision_maker: 'none', read_only_reviewer: 'read' },
  notifications:        { platform_admin: 'none',  agency_admin: 'full', recruiter: 'full',    client_decision_maker: 'full', read_only_reviewer: 'full' },
  background_jobs:      { platform_admin: 'read',  agency_admin: 'read', recruiter: 'none',    client_decision_maker: 'none', read_only_reviewer: 'none' },
}

/**
 * Pure permission check: does `role` have `action` on `resource`?
 * `approve` level grants `read` and `approve` only — never create/update/delete.
 */
export function hasPermission(role: Role, resource: Resource, action: Action): boolean {
  const level = MATRIX[resource][role]
  switch (level) {
    case 'full':
      return action !== 'approve'
    case 'read':
      return action === 'read'
    case 'approve':
      return action === 'read' || action === 'approve'
    case 'none':
    default:
      return false
  }
}

/** Returns the raw permission level, for UI that needs to distinguish "full" from "approve-only" rather than a single action. */
export function permissionLevel(role: Role, resource: Resource): PermissionLevel {
  return MATRIX[resource][role]
}
