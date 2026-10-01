# 06 — User Roles & Permissions

## 6.1 Roles

| Role                      | Description                                                                  | Scope                                                                    |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Platform Admin**        | Vendor-side operator of the SaaS itself                                      | All organizations (support/billing/infra only — not candidate decisions) |
| **Agency Admin**          | Owns an agency org (e.g., Dave); manages users, clients, scorecards, billing | One organization, all its clients/projects                               |
| **Recruiter**             | Day-to-day sourcing, scoring review, outreach, shortlisting                  | One organization, assigned projects (or all, per org policy)             |
| **Client Decision-Maker** | The agency's end client (e.g., a hiring manager)                             | One client's projects/shortlists only, read + approve/reject             |
| **Read-Only Reviewer**    | Auditor, QA reviewer, or a second recruiter for spot-checks                  | One organization, view-only including audit log                          |

**[INFERENCE]** The MOM describes a two-person agency (Dave + one recruiter), so in practice Agency Admin and Recruiter may be the same person initially — the role model should not assume a large team, but must still support one when the agency grows or when a client company itself needs the Client Decision-Maker role provisioned.

## 6.2 Permission Matrix

Legend: **F** full (create/read/update/delete as applicable) · **R** read-only · **A** approve/decision action only · **–** no access

| Resource             | Platform Admin            | Agency Admin          | Recruiter            | Client Decision-Maker            | Read-Only Reviewer |
| -------------------- | ------------------------- | --------------------- | -------------------- | -------------------------------- | ------------------ |
| Organizations        | R (support)               | F (own org)           | R (own org)          | –                                | R                  |
| Users                | –                         | F (own org)           | R (own org)          | –                                | R                  |
| Clients              | –                         | F                     | F                    | R (own record)                   | R                  |
| Recruitment projects | –                         | F                     | F                    | R (own client's)                 | R                  |
| Job descriptions     | –                         | F                     | F                    | R                                | R                  |
| Scorecards           | –                         | F (approve)           | F (draft, propose)   | –                                | R                  |
| Candidate records    | –                         | F                     | F                    | R (shortlisted only)             | R                  |
| Candidate documents  | –                         | F                     | F                    | –                                | R                  |
| Candidate evidence   | –                         | R                     | R (system-generated) | R (shortlisted only)             | R                  |
| Human reviews        | –                         | F                     | F                    | –                                | R                  |
| Outreach             | –                         | F                     | F                    | –                                | R                  |
| Shortlists           | –                         | F                     | F                    | A (approve/reject)               | R                  |
| POC reports          | –                         | F                     | R                    | –                                | R                  |
| Copilot              | R (oversight, cross-org)  | F                     | F                    | F (5-of-13-tool subset — §6.2.8) | R                  |
| Integrations         | F (platform-level)        | F (org-level connect) | R                    | –                                | R                  |
| Analytics            | R (aggregate, anonymized) | F                     | R                    | –                                | R                  |
| Billing              | F                         | F                     | –                    | –                                | –                  |
| Settings             | F (platform)              | F (org)               | R                    | –                                | R                  |
| Audit logs           | F (all orgs)              | R (own org)           | R (own actions)      | –                                | R (own org)        |

## 6.2.1 Row-level scoping added in Build Phase 3

§6.2's "F" for Recruiter on Clients/Recruitment projects/Job descriptions and
"R (own client's)" for Client Decision-Maker are resource-level grants
(packages/types/src/permissions.ts). Build Phase 3 adds a **row-level**
layer on top, per its own §PERMISSIONS, implemented in both RLS
(supabase/migrations/0009–0013) and the application layer
(apps/web/lib/auth/project-scope.ts):

- **Recruiter** is further narrowed to _assigned_ recruitment projects only
  (`project_assignments`), not every project in the org. Clients remain
  org-wide F for a recruiter (client scoping doesn't apply there — a
  recruiter needs to see all clients to start a new project for one).
- **Client Decision-Maker**'s "own client's" scope is now concrete: their
  `organization_memberships.client_id` column (supabase/migrations/0008)
  names the one client they represent; RLS and `project-scope.ts` both key
  off it, never off an org-wide role check.
- **Agency Admin**, **Platform Admin**, and **Read-Only Reviewer** are
  unaffected — their §6.2 grants remain org-wide.

## 6.2.2 Job requirements and scorecards — Build Phase 4

§6.2's "F (approve)" for Agency Admin and "F (draft, propose)" for Recruiter
on Scorecards now cover `job_requirements`, `scorecards`, `scorecard_versions`
and `scorecard_approvals` (supabase/migrations/0015–0017). Row-level scoping
follows the same §6.2.1 pattern:

- **Recruiter** may draft/edit requirements and scorecard versions only for
  jobs within their _assigned_ recruitment projects
  (`is_assigned_to_project()`, reused unchanged from Build Phase 3) — never
  approve.
- **Agency Admin** approves org-wide (`scorecard_approvals` insert policy),
  matching §6.2's "F (approve)".
- **Client Decision-Maker** gets §6.2's base "–" on Scorecards by default —
  they may read a scorecard's existence/status and, once a version reaches
  `pending_approval`, the approved-or-pending version's requirement
  snapshot for their own client's jobs, but they can never read raw
  `job_requirements` rows, AI-run internals/cost data, or scoring
  methodology (§6.3). A new **explicit, per-project opt-in** —
  `recruitment_projects.client_can_approve_scorecards` (default `false`,
  settable only by an Agency Admin) — is required before a Client
  Decision-Maker's `scorecard_approvals` insert is permitted at all
  (Build Phase 4 brief §PERMISSIONS: "Client reviewers may approve only if
  explicitly permitted"). This does not change the §6.2 base matrix; it is a
  row-level narrowing on top of it, same as §6.2.1's Recruiter/Client
  Decision-Maker scoping.
- **Read-Only Reviewer** keeps org-wide R on all four tables.
- Once a `scorecard_versions` row's `status` first becomes `active`, every
  column except `status` (only to `superseded`) is frozen by a database
  trigger (`enforce_scorecard_version_immutability`), independent of RLS —
  editing an approved scorecard always creates a new draft version, never
  mutates the approved one (Build Phase 4 brief §"Scoring validation").

## 6.2.3 Candidate Foundation — Build Phase 5

§6.2's Candidate records / Candidate documents rows now cover the full
Candidate Foundation schema (§7.1: `candidates`, `candidate_profiles`,
`candidate_contact_points`, `candidate_documents`,
`candidate_experiences/_education/_certifications/_skills`,
`candidate_sources`, `candidate_project_entries`,
`candidate_pipeline_events`, `candidate_consents`;
`supabase/migrations/0018–0021`). Row-level scoping follows §6.2.1's
pattern but is centralized in a single reusable function rather than
repeated per table:

- **`can_access_candidate(target_candidate uuid)`** (`0021`) is the one
  helper every `candidate_*` table's recruiter/client policy calls — see
  docs/07-data-model.md §7.3 for its exact org-wide / assigned-project /
  shortlisted-or-shared logic per role.
- **Recruiter**'s §6.2 "F" on Candidate records/documents is narrowed the
  same way as §6.2.1: a candidate they sourced (`created_by`) or that is in
  a `candidate_project_entries` row for a project they're assigned to
  (`is_assigned_to_project()`, unchanged from Build Phase 3) — not every
  candidate in the org.
- **Client Decision-Maker**'s §6.2 "R (shortlisted only)" on Candidate
  records is now concrete and does **not** require the candidate to have
  reached the `shortlisted` pipeline stage specifically: a
  `candidate_project_entries.client_visible = true` row for their own
  client is what grants access, set automatically once a candidate reaches
  `shortlisted` **or** explicitly by a recruiter/agency admin sharing a
  candidate earlier (Build Phase 5 brief §PRIVACY: "shortlisted or
  explicitly shared candidates") — a share/unshare toggle independent of
  stage, never available to the client themselves.
  Client Decision-Maker's "–" on Candidate documents is unconditional: no
  policy grants that role access to `candidate_documents` under any
  circumstance (§7.1) — CVs are never client-visible in this build.
- **Contact masking and recruiter-notes/client-notes separation are
  application-layer, not RLS** (RLS is row-level only and cannot redact a
  column): `apps/web/lib/candidates/visibility.ts` is the single place both
  concerns are implemented, applied identically by every screen and server
  action rather than left to each call site to remember. A role outside
  `platform_admin`/`agency_admin`/`recruiter` gets a masked contact value
  (e.g. `j***@example.com`); a role outside
  `platform_admin`/`agency_admin`/`recruiter`/`read_only_reviewer` gets
  `candidate_profiles.recruiter_notes` **omitted entirely** from its
  payload (never nulled), so a later serialization bug can't leak it back
  in.
- **Merging two candidate records** (§7.4) requires the same permission as
  archiving/deletion-request (`candidate_records: delete`) — Agency Admin
  and Recruiter only, always a human decision, never automatic.
- **Read-Only Reviewer** keeps org-wide R on Candidate records/documents
  via `can_access_candidate()`'s admin/reviewer branch, matching §6.2.

## 6.2.4 AI Candidate Document Processing — Build Phase 6

§6.2's Candidate evidence row now has a concrete implementation
(`candidate_document_processing_jobs`, `candidate_extracted_fields`,
`supabase/migrations/0022`/`0025`/`0026`). This is the one place in the
build so far where the permission matrix's raw grant level does not map
1:1 onto which server actions a role may call, so the mapping is recorded
explicitly rather than left implicit:

- **`candidate_document_processing_jobs`** (internal pipeline state —
  processing queue/progress, model, prompt version, error detail) follows
  exactly the same visibility rule as `candidate_documents`: org-wide for
  Platform Admin/Agency Admin/Read-Only Reviewer, `can_access_candidate()`-
  scoped for Recruiter, and **unconditionally invisible** to Client
  Decision-Maker — never shown even once a candidate is shared/shortlisted,
  same as the CV file itself.
- **`candidate_extracted_fields`** (the evidence: source excerpt, page/
  section, confidence, verification status) is **client-visible** once a
  candidate is shortlisted or explicitly shared — this is the `candidate_
evidence: client_decision_maker = read` row from §6.2's base matrix, now
  concrete: a client reviewer may see the excerpt behind a shortlisted
  candidate's profile even though they can never fetch the original CV
  file.
- **Every write action** — kick off processing, reprocess with reason,
  verify/reject/edit a field, accept-all-verified
  (`apps/web/lib/candidates/document-processing-actions.ts`) — is gated on
  the **`candidate_documents`** resource (Agency Admin/Recruiter: full),
  **not** `candidate_evidence` (Agency Admin/Recruiter: read-only in the
  matrix). This is a deliberate interpretation, not an oversight: the
  matrix's `candidate_evidence: read` reflects that the evidence's
  _content_ is AI-authored — no human "creates" it, the model does — but
  starting/reprocessing a job and recording a human review decision
  (verify/reject/edit) are human actions performed _on_ the CV-document
  pipeline, the same category of action the matrix already grants full
  access to via `candidate_documents`. Migration `0022`'s RLS write
  policies (`candidate_document_processing_jobs_write_internal`,
  `candidate_extracted_fields_write_internal`) encode the identical
  interpretation at the database layer: Platform Admin/Agency Admin
  org-wide, Recruiter via `can_access_candidate()`, Client Decision-Maker
  **never** (their matrix-granted `read` on `candidate_evidence` is
  enforced purely by the RLS select policy — they have no server action
  here that could write). See docs/07-data-model.md §7.8 and
  docs/build-phase-6-report.md for the full reasoning.

## 6.2.5 Candidate Matching — Build Phase 7

§6.2's "Candidate evidence"/"Human reviews" rows now have a concrete
implementation for match scoring (`matching_runs`, `candidate_role_matches`,
`mandatory_gate_results`, `requirement_evidence`, `scoring_breakdowns`,
`human_reviews`, `review_decisions`; `supabase/migrations/0027`). Row-level
scoping follows §6.2.1's/§6.2.3's established pattern — Platform Admin/
Agency Admin/Read-Only Reviewer org-wide, Recruiter narrowed to
`can_access_candidate()` **and** `is_assigned_to_project()` together — but
this phase makes one access decision explicit that prior phases did not need
to:

- **Client Decision-Maker has NO RLS policy on any of the seven new
  tables** — not even a narrowed "shortlisted only" read, unlike
  `candidates`/`candidate_extracted_fields` in §6.2.3/§6.2.4. This is a
  **deliberate Build Phase 7 scope decision, not an oversight**: gate
  detail, evidence excerpts tied to a specific requirement, scoring
  breakdowns, and reviewer override reasoning are recruiter/admin-facing
  internals in this build. A client-facing shortlist or finalist-comparison
  view — the eventual surface where a Client Decision-Maker would see a
  curated subset of this data (final 2–3 candidates, strengths/risks
  prose, no methodology internals, per §6.3) — is out of scope for this
  phase and deferred to a future Shortlist build, which will define its own
  narrow read policy the same way §6.2.2 did for `scorecard_approvals`
  rather than widening any of this phase's tables directly.
- **Reviewer identity is enforced at the database layer, not just
  application code**: `human_reviews`'s insert policy additionally requires
  `reviewer_id = auth.uid()`, so a review can only ever be recorded as the
  acting user's own decision — no role, however privileged, can write a
  review attributed to someone else.
- **Human override remains a `human_reviews`/`mandatory_gate_results`
  write**, gated the same way as every other write in this table set
  (Agency Admin org-wide, Recruiter via `can_access_candidate()` +
  `is_assigned_to_project()`) — never a separate, more permissive path.

See docs/07-data-model.md §7.9 and docs/build-phase-7-report.md for the full
reasoning and the RLS verification results.

## 6.2.6 Human Review and Shortlisting — Build Phase 8

§6.2's "Shortlists: F / F / A (approve/reject)" row now has a concrete
implementation (`verification_requests`, `shortlists`, `shortlist_versions`,
`shortlist_candidates`, `client_decisions`, `shortlist_activity`;
`supabase/migrations/0028`). Two things this phase makes explicit that no
prior phase needed to:

- **The `'approve'` permission LEVEL and the `'approve'` permission ACTION
  are two different things, and this phase is where the distinction first
  matters.** `packages/types/src/permissions.ts`'s `hasPermission()` grants
  Client Decision-Maker's `'approve'` level exactly `{read, approve}` on the
  `shortlists` resource — nothing else. Agency Admin's and Recruiter's
  `'full'` level, by contrast, is `every action except 'approve'`
  (`case 'full': return action !== 'approve'`) — a deliberate carve-out so
  that "full" internal control over a shortlist never accidentally includes
  the one action the matrix reserves for the client's own decision. **This
  was caught and fixed during this build, not shipped as a known gap**: an
  early draft of `internallyApproveShortlistAction`/
  `sendShortlistToClientAction` (`apps/web/lib/shortlists/shortlist-actions.ts`)
  gated on `'approve'`, which would have denied Agency Admin/Recruiter (whose
  `'full'` level excludes it) and only worked for Client Decision-Maker —
  backwards from the intent. Both actions are gated on `'update'` instead;
  `recordClientDecisionAction` is the **only** action in this build gated on
  `'approve'`, matching `client_decisions`' RLS insert policy (Client
  Decision-Maker, own client_id, only while `shortlists.status =
'sent_to_client'`) exactly.
- **Client visibility is a compound, status-gated read, not a blanket
  "shortlisted" flag** (contrast §6.2.3's `candidate_project_entries.
client_visible` boolean): a Client Decision-Maker reads a `shortlists`/
  `shortlist_versions`/`shortlist_candidates` row only once
  `shortlists.status ∈ {sent_to_client, accepted, discuss, rejected}` **and**
  it is their own `client_id` — `draft`/`pending_internal_approval`/
  `internally_approved` are never visible, so a shortlist mid-build or
  mid-internal-review can never leak to the client ahead of a deliberate
  human "send" action (Core Principle #8, `sendShortlistToClientAction`).
  `shortlist_activity` adds a second, independent gate on top —
  `client_visible = true` per row, default `false` — so that even once a
  shortlist itself is client-visible, internal recruiter reasoning,
  override rationale, and notes stay agency-internal unless a row is
  explicitly marked otherwise at write time. `shortlist_candidates.
recruiter_note` is redacted the same way §6.2.3/§6.2.4 redact contact
  values and `recruiter_notes` — at the application layer
  (`apps/web/lib/shortlists/visibility.ts`'s
  `serializeShortlistCandidateForClient`), since RLS is row-level only and
  cannot omit one column from an otherwise-visible row.
- **`verification_requests` follows the same gating as every other reviewer
  decision** — `human_reviews: update`, Agency Admin org-wide, Recruiter via
  `can_access_candidate()` + `is_assigned_to_project()`; Client
  Decision-Maker has no policy on it at all, same exclusion §6.2.5 made for
  the seven Build Phase 7 tables.

See docs/07-data-model.md §7.10 and docs/build-phase-8-report.md for the full
reasoning and the RLS verification results.

## 6.2.7 Outreach — Build Phase 9

§6.2's "Outreach: F / F / –" row now has a concrete implementation (`communication_preferences`, `outreach_templates`, `outreach_sequences`, `outreach_messages`, `outreach_approvals`, `communication_events`, `candidate_responses`; `supabase/migrations/0029`). One thing this phase makes explicit that §6.2.6 did not need to, because it points the opposite direction:

- **Unlike `shortlists` (§6.2.6), no role has the `'approve'` permission LEVEL on `outreach` at all** — `packages/types/src/permissions.ts`'s `MATRIX.outreach` is `{ agency_admin: 'full', recruiter: 'full', client_decision_maker: 'none', read_only_reviewer: 'read' }`, with no `'approve'` entry anywhere in the row. Combined with `hasPermission()`'s `'full'` branch (`action !== 'approve'`), this means **every** outreach write — including recording an approve/reject/changes-requested decision on a draft (`recordOutreachApprovalAction`) — must be gated on the `'update'` action, never `'approve'`, or it would be uncallable by any role in the system. This was verified explicitly before the first outreach server action was written (`apps/web/lib/outreach/outreach-actions.ts`'s own module comment records the same reasoning), rather than discovered as a bug afterward the way §6.2.6's shortlist mis-gating was — the §6.2.6 precedent is exactly why this phase checked first.
- **Client Decision-Maker has zero access to outreach, not a narrowed read like `candidate_evidence`/`shortlists`.** `client_decision_maker: 'none'` on the `outreach` resource means no RLS policy and no server action ever grants this role anything on any of the seven Build Phase 9 tables, even read — outreach drafting, approval, sending and response-handling is entirely an internal recruiter/agency-admin workflow the client never sees any part of, at any workflow stage. This is stricter than §6.2.5's Build Phase 7 tables (also zero access) and unlike §6.2.3/§6.2.4's `candidate_extracted_fields`/`candidate_project_entries.client_visible` (narrowed but non-zero client read).
- **The opt-out and approval hard gates are enforced at the database-trigger layer, independent of this permission matrix entirely** — see docs/07-data-model.md §7.11. A role with `'update'` on `outreach` still cannot force a message past either gate; the gates read `outreach_approvals`/`communication_preferences` state, not the caller's role.

See docs/07-data-model.md §7.11 and docs/09-ai-architecture.md §9.7 for the full reasoning and the RLS verification results.

## 6.2.8 Recruiter AI Copilot — Build Phase 11

The `copilot` resource's matrix grant (`packages/types/src/permissions.ts`) is coarse — `agency_admin`/`recruiter`/`client_decision_maker`: `'full'` (unlike every other resource in the matrix, the DB layer narrows copilot data to the _owning user_, not the whole org — a conversation is a personal AI session, never a shared work artifact, so `client_decision_maker`'s `'full'` here is deliberately NOT `'none'`/bare `'read'`: the brief explicitly wants this role able to converse with the copilot, just over a much narrower _capability_ set, enforced below), `read_only_reviewer`: `'read'` only (`hasPermission('read_only_reviewer', 'copilot', 'create')` is `false`, blocking starting a new conversation entirely — "has nothing of their own to read," the matrix's own comment), `platform_admin`: `'read'` only (oversight of other users' conversation records for audit, mirroring the `organizations` row's own `platform_admin: 'read'` — oversees, never operates a tenant's day-to-day work). This resource-level grant controls whether a role may use the copilot **at all**; it cannot express **which** of the 13 allowlisted tools a role may invoke within a conversation (the DB's `copilot_tool_calls.tool_name` CHECK is one shared allowlist across every role, not a per-role one) — `permissions.ts`'s own module comment flags this as an **open design question** for the next wave's application code to resolve. Build Phase 11 is that resolution, implemented as a second, tool-level allowlist layered under the coarse resource grant, never a replacement for it:

- **`agency_admin`/`recruiter`: all 13 tools.** Every one of the 13 capabilities (`apps/web/lib/copilot/tool-registry.ts`'s `TOOL_REGISTRY`) is squarely a recruiter/admin's own workflow or oversight need.
- **`client_decision_maker`: a deliberately narrow 5-tool subset**, matching the brief's own example ("summarize-project/explain-POC-metrics they can see only, never candidate internal notes or scorecards with recruiter-only content"): `summarize_recruitment_project` (their own project only, narrowed further by `resource-ownership.ts`'s client branch), `explain_candidate_match` (only for a candidate whose `candidate_project_entries.client_visible = true` row is on a project of theirs — the same gate §6.2.3 already established), `compare_approved_candidates` (their own shortlist only), `explain_poc_metrics` (their own benchmark only), `suggest_next_workflow_action` (every suggestion is independently re-filtered through `hasPermission()` for their live role inside the handler, so it can never suggest an action they could not actually take). **Excluded, explicitly, with the resource-matrix reasoning each maps to**: `explain_scorecard`/`find_missing_job_requirements` (`scorecards`: client_decision_maker `'none'`), `summarize_candidate`/`identify_missing_evidence` (a redacted candidate profile is still a broader detail surface than the brief intends for a client — `explain_candidate_match`'s narrower, already-scored, already-redacted view is the client-safe equivalent; `human_reviews`: `'none'`), `draft_verification_questions`/`draft_interview_questions`/`draft_outreach_message` (`outreach`: client_decision_maker `'none'`, §6.2.7), `summarize_candidate_responses` (candidate replies are an internal recruiter channel, §6.2.7). `eval/client-reviewer-restrictions.test.ts` (docs/10-ai-evaluation-guardrails.md §10.14) is an exhaustive truth table over all 13 tools confirming exactly this split, re-derived independently of the registry's own constant so a silent widening or narrowing is caught by comparison.
- **`read_only_reviewer`/`platform_admin`: no tools at all**, consistent with their coarse `'read'`-only resource grant — a `read_only_reviewer` cannot start a conversation in the first place; a `platform_admin` may read other tenants' conversation records for oversight (0031's cross-org read policy) but never operate the copilot inside a tenant's own context.
- **Deny-by-default, allowlist-by-exception, checked on every single tool call, not once at conversation start.** `isToolAllowedForRole()` is consulted by `executeTool` inside `run-copilot-turn.ts` for every tool invocation the model requests, against the caller's **current, live** role — never the conversation's `role_at_creation` snapshot alone (docs/07-data-model.md §7.12's "scope snapshot, not live lookup" principle) and never anything the model itself claims. `eval/unauthorized-tool-calls.test.ts` confirms a denied attempt never reaches the tool's handler function at all (a handler spy proves zero invocations), records a `copilot_tool_calls` denial row and an `audit_events` entry, and that a forbidden tool is structurally never even offered to a role outside its `allowedRoles` in the first place.
- **Hidden recruiter-only content is redacted at the field level for every `restricted_notes_excluded` (i.e. every `client_decision_maker`) conversation**, independent of which of the 5 allowed tools is called — `apps/web/lib/copilot/redaction.ts`, docs/07-data-model.md §7.12. This is the copilot's own instance of the same rule §6.2.3's `visibility.ts` and §6.2.6's `shortlist-visibility.ts` already established for other surfaces: RLS is row-level only, column redaction is always an application-layer concern, and it happens before a prompt is ever assembled, never trusted to the model's own discretion.

See docs/07-data-model.md §7.12 and docs/09-ai-architecture.md §9.9 for the full schema/orchestration detail, and docs/10-ai-evaluation-guardrails.md §10.14 for the adversarial test suite proving this section's guarantees hold under real attack scenarios, not just code review.

## 6.2.9 Integrations, Jobs & Notifications — Build Phase 12

Three new resources land on the matrix (`packages/types/src/permissions.ts`): `integrations` (`platform_admin`: `'full'`, `agency_admin`: `'full'`, `recruiter`/`read_only_reviewer`: `'read'`, `client_decision_maker`: `'none'`), `background_jobs` (`platform_admin`/`agency_admin`: `'read'` only — "exists purely for the 'Job status' oversight UI... rather than as a create/update gate," that resource's own matrix comment), and `notifications` (every role but `platform_admin`: `'full'`).

**The `integrations` matrix-vs-RLS discrepancy — resolved at the action/loader layer, not by editing the matrix.** 0032's actual RLS on `integration_connections` is narrower than the matrix's literal grant at two points: it gives write access to `agency_admin` **only** (not `platform_admin`, despite the matrix's `'full'`), and read access to `agency_admin`/`platform_admin` **only** (not `recruiter`/`read_only_reviewer`, despite the matrix's `'read'`) — `client_decision_maker` gets neither, consistent both places. Rather than widen RLS or run a wider-scoped query through an elevated-trust client on a narrower role's behalf, Build Phase 12 resolved this at the call-site layer, twice:

- **Write side** (`lib/integrations/integration-actions.ts`): every mutating action (`connectIntegrationAction`, `disconnectIntegrationAction`, `triggerIntegrationSyncAction`, `recordAccountOwnerAction`) checks the caller's role directly against `agency_admin` only, never `requirePermission(..., 'integrations', 'update')` — trusting the wider matrix grant here would let a `platform_admin` pass the application check and then fail at the database with an opaque RLS rejection.
- **Read side** (`lib/integrations/load.ts`): `loadIntegrationConnections` returns `{visible: false, connections: [...every provider marked not_connected]}` for any role outside `agency_admin`/`platform_admin`, **without attempting a query at all** — an attempted query for those roles would return zero rows under RLS, which the UI could misread as "nothing is connected" rather than "you cannot see this." `load.test.ts` asserts the no-query guarantee directly (a `from()` call-count spy), not just the returned shape.

Both `manuallyRetryJobAction` (`platform_admin`/`agency_admin` only, mirroring `background_jobs`' RLS exactly) and this same `integrations` write gate follow the identical documented precedent: **a server action for a specific, narrow write checks role directly rather than relying solely on the shared permission matrix**, per that matrix's own `poc_reports` comment already flagging this as an accepted pattern, not a one-off. This is flagged here as **worth revisiting** if a future phase adds a third resource needing the same treatment — three independent occurrences of the same workaround is a signal the matrix itself may need a narrower-than-role-name-implies grant level, not just role-name-based levels.

**`notifications`' matrix `'full'` grant is narrower in practice than the DB permits it to mean.** 0032's RLS is own-recipient-only, and a trigger (`notifications_read_only_mutation`) rejects any column change but `read_at` going from `null` to a timestamp — so the matrix's `'full'` on `notifications` can only ever cash out as "mark my own notification(s) read," never arbitrary write access, regardless of the label. `markNotificationReadAction` additionally re-scopes its own `UPDATE` to `recipient_user_id = auth.uid()` even though RLS would already enforce the same boundary — belt-and-suspenders, confirmed by `notification-actions.ts`'s own header comment.

See docs/07-data-model.md §7.13 and docs/build-phase-12-report.md for the full build/verification record.

## 6.3 Agency vs. Client Data Separation

**[CONFIRMED — Core Principle #12]** Client-owned candidate data must stay isolated across organizations. Within one agency org, the **Client Decision-Maker** role is the one place data crosses a trust boundary deliberately: they must see enough to approve a shortlist (candidate profile, gate results, evidence, strengths/risks) but must **not** see:

- Other candidates who were sourced/screened/gated but not shortlisted for their role.
- Internal recruiter notes, override reasons, or scoring weights/methodology internals.
- Any other client's projects, even within the same agency.
- Pricing, billing, or POC benchmark data.

**[RECOMMENDATION]** Implement this as a dedicated, narrowly-scoped Postgres view/RLS policy set (`client_shortlist_view`) rather than field-level filtering in application code, so the boundary holds even if a new screen is added later and a developer forgets to filter it.

Related documents: [[05-functional-requirements]] · [[07-data-model]] · [[12-security-compliance]]
