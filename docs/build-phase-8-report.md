# Build Phase 8 report — Human Review and Shortlisting

Per docs/21-implementation-contract.md §21.14 and the Build Phase 8
completion gate. Covers exactly what this phase implements: the controlled
quality-review process that turns Build Phase 7's gate/evidence/score
output into a maximum 2–3 candidate shortlist for client approval — the
brief's full workflow tail (Candidate Evaluation → Recruiter Quality
Review → Verification Required or Approved → Outreach Eligible → Candidate
Interest Confirmed → Proposed Shortlist → Internal Approval → Client
Review → Accepted, Discuss or Rejected), plus a candidate-level
verification-request workflow and an append-only client decision record.
No new AI workflow is added this phase — it consumes Build Phase 7's
already-built AI-assisted matching output; every gate/score value the
review queue and shortlist builder display was computed by that prior
phase's pipeline, never recomputed or reinterpreted here.

**The same two blockers carried into every prior phase's report remain
unchanged in kind, with one additional honest note this phase**:

1. No live Supabase project is connected to this repository's environment
   (no `apps/web/.env.local`, no `SUPABASE_*` env vars) — the full schema
   and RLS policy set were instead functionally verified against a real
   local PostgreSQL 16 instance (§4).
2. No `ANTHROPIC_API_KEY` is configured. This is not directly relevant to
   this phase's own scope — Build Phase 8 adds no new AI call of its own —
   but it remains true of the platform as a whole and is repeated here per
   the project's "never claim an external integration works until it has
   been configured and tested" rule, since the AI-assisted matching output
   this phase's review queue displays still traces back to a
   never-exercised `AnthropicMatchingProvider` call.
3. **New this phase, flagged as an open design question before the build
   started and left unresolved by design, not by oversight**: the
   `candidate_project_entries.current_stage = 'shortlisted'` pipeline-stage
   transition (Build Phase 5, drives `client_visible` auto-flip per
   docs/07-data-model.md §7.3/§6.2.3) is **not** wired to
   `shortlist_candidates` insertion. Adding a candidate to a
   `shortlist_candidates` row does not itself move their
   `candidate_project_entries.current_stage` to `shortlisted`, and the two
   "client can see this candidate" mechanisms — the Build Phase 5 pipeline
   flag and this phase's shortlist-status-gated RLS (§1.1) — currently
   operate independently. In practice this phase's own RLS is strictly
   narrower and reached later in the workflow (only once a shortlist is
   `sent_to_client` or later), so a client can never see an unshortlisted
   candidate through the shortlist tables even without the wiring; the gap
   is that the pipeline board (Build Phase 5's Kanban view) will not
   reflect "shortlisted" automatically when a shortlist is built. This is a
   reasonable Build Phase 9 follow-up (§6), not a security gap.

Everything below is code-complete, typechecked, linted, and tested at every
layer that does not require a live backend or a real AI provider, and — as
with every prior phase — the full schema and its Row Level Security
policies were functionally verified against a real local PostgreSQL 16
instance, including live role-switching RLS tests specific to the six new
tables and the two extended Build Phase 7 tables (§4).

## 0. Pre-build verification

The full existing test/typecheck/lint/build suite was confirmed green
before any Phase 8 code was written (340 tests, matching the Phase 7
report's final count).

## 1. What was implemented

### 1.1 Database schema + RLS (migration `0028_human_review_shortlisting.sql`)

Two Build Phase 7 tables extended, then six new tables in dependency order:

**Extended:**

| Table.column                           | Change                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `human_reviews.decision`               | CHECK extended to add `'escalated'`, `'note_added'` (`note_added` is a pure internal-notes entry with no eligibility/review_status side effect — `reason` holds the note text).                                                                                                              |
| `candidate_role_matches.review_status` | CHECK extended to add `'escalated'`.                                                                                                                                                                                                                                                         |
| `candidate_project_entries`            | New `interest_status` (`unknown`/`interested`/`declined`, default `unknown`), `interest_confirmed_by`, `interest_confirmed_at`, `interest_note` columns — the brief's "Candidate Interest Confirmed" workflow step, recorded by a recruiter from an outreach response, never inferred by AI. |

**New, in dependency order:**

| Table                   | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verification_requests` | Candidate-level "Request verification" workflow object — distinct from `mandatory_gate_results`' existing per-gate `verification_requested_*` columns (which stay as-is). This is the trackable open/resolved entity a reviewer's "Request verification" decision creates; it may reference a specific requirement's gate or the candidate as a whole (`requirement_id` nullable). A `verification_requests_resolution_requires_detail` CHECK requires `resolved_by`+`resolved_at` together whenever `status <> 'open'`.                                                                                        |
| `shortlists`            | One mutable header row per job. `status` mirrors the brief's full workflow tail (`draft`/`pending_internal_approval`/`internally_approved`/`sent_to_client`/`accepted`/`discuss`/`rejected`). Carries the size-cap authorization fields (`max_candidates` default 3, `override_max_candidates`, `override_by`, `override_reason`) — the authorization itself; actual cap enforcement is the `shortlist_candidates` trigger below, since only it can see the current row count. `shortlists_override_requires_reason` CHECK requires `override_by`+`override_reason` together whenever the override flag is set. |
| `shortlist_versions`    | Immutable snapshot per submission cycle — the `scorecard_versions` pattern applied here (docs/07-data-model.md §7.1/§7.5). A version freezes at `submitted` and is never edited again; later lifecycle transitions (internal approval, sent-to-client) are timestamps on the **same** row, since the candidate set has not changed — a new `version_number` is only created after a `discuss`/`rejected` client decision, when the recruiter rebuilds the shortlist from scratch. `unique(shortlist_id, version_number)`.                                                                                       |
| `shortlist_candidates`  | Candidates on one `shortlist_versions` row. `matching_run_id`/`scorecard_version_id` are frozen at add-time (brief: "preserve candidate evaluation version") — they never follow a later re-score of the same match. `unique(shortlist_version_id, candidate_id)` and `unique(shortlist_version_id, rank)` prevent duplicates and rank collisions. `recruiter_note` is internal-only.                                                                                                                                                                                                                           |
| `client_decisions`      | Append-only client Accept/Discuss/Reject record against one frozen `shortlist_versions` row. `client_decisions_notes_required_unless_accept` CHECK requires non-empty `notes` unless `decision = 'accept'`.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `shortlist_activity`    | Shortlist-scoped activity feed, mirroring `project_activity`'s pattern (`0013`) exactly, plus a `client_visible boolean default false` flag — the brief's "do not expose private recruiter notes to clients," applied to the whole activity stream, not just candidate notes. Explicitly **not** the compliance audit log (`audit_events` remains that).                                                                                                                                                                                                                                                        |

**The `enforce_shortlist_candidate_rules()` BEFORE INSERT trigger** on
`shortlist_candidates` enforces the two cross-row rules a CHECK constraint
cannot express on its own, since both require reading other rows/tables:
(a) the referenced `candidate_role_matches.eligibility` must be `'eligible'`
— the brief's "never rank failed mandatory-gate candidates," applied again
at the shortlist-build boundary, not just at the review-queue-view level;
(b) `organization_id`/`candidate_id` on the new row must match the
referenced `candidate_role_matches` row; (c) the version's current
candidate count (not yet including the row being inserted, since this is a
BEFORE INSERT trigger) must not exceed `shortlists.max_candidates` unless
`override_max_candidates = true`. Duplicate prevention is the plain
`unique(shortlist_version_id, candidate_id)` constraint above, not the
trigger, since it needs no cross-table read.

**RLS**, following the established §6.2.2/§6.2.3/§6.2.4/§6.2.5 shape:
Platform Admin/Agency Admin/Read-Only Reviewer org-wide (read; Agency Admin
also full write); Recruiter scoped to `can_access_candidate()` and/or
`is_assigned_to_project()` per table (directly, or via a join back to the
parent `candidate_role_matches`/`shortlists`/`shortlist_versions` row for
child tables). **Client Decision-Maker gets a real, narrow read policy this
phase — the first of the matching-and-review table set to grant one** (in
contrast to §6.2.5's Build Phase 7 tables, which grant the role nothing at
all): read-only, own `client_id` only, and only once the parent
`shortlists.status` has reached `sent_to_client`/`accepted`/`discuss`/
`rejected` — never `draft`/`pending_internal_approval`/
`internally_approved`. `shortlist_versions` additionally requires the
specific version's own `status ∈ {sent_to_client, superseded}`.
`shortlist_activity` additionally requires `client_visible = true` per row.
Client Decision-Maker may **insert** exactly one kind of row anywhere in
this table set — `client_decisions`, gated to their own `client_id` and
only while the parent shortlist is `sent_to_client`. Column-level
redaction (`shortlist_candidates.recruiter_note`, internal-only activity
rows) is enforced at the application layer
(`apps/web/lib/shortlists/visibility.ts`), mirroring
`apps/web/lib/candidates/visibility.ts`'s established pattern, since RLS is
row-level only. Append-only enforcement via `REVOKE UPDATE, DELETE` at the
database-role level on `shortlist_candidates`, `client_decisions`,
`shortlist_activity`; `verification_requests` gets `REVOKE DELETE` only
(resolution is a legitimate UPDATE); `shortlists`/`shortlist_versions` keep
ordinary UPDATE grants, since their own lifecycle fields are meant to be
mutated in place by the actions in §1.4.

All migrations `0001`–`0028` were applied to a freshly created local
PostgreSQL 16 database, independently re-verified for this report (§4), in
strict numeric order with zero errors.

### 1.2 Types

`packages/types/src/index.ts`: `MatchReviewStatus` extended with
`'escalated'`, `MatchHumanReviewDecision` extended with `'escalated'`/
`'note_added'`. New: `VerificationRequestStatus`/`VerificationRequestSchema`,
`ShortlistRecordStatus`/`ShortlistRecordSchema`,
`ShortlistVersionStatus`/`ShortlistVersionSchema`, `ShortlistCandidateSchema`,
`ClientSafeShortlistCandidateSchema` (an `.omit({ recruiterNote: true })`
projection, produced only by `apps/web/lib/shortlists/visibility.ts`, never
sent to the database), `ClientDecisionKind`/`ClientDecisionSchema`,
`ShortlistActivitySchema`, `CandidateInterestStatus`. All deliberately
named apart from the pre-existing Build Phase 1/2 demo mock schemas that
still back the fallback demo view (`ShortlistSchema`, `ShortlistStatus`,
`HumanReviewSchema`) — confirmed still present and untouched in the file,
each with a comment marking them as the demo-era schemas being
superseded by the Build Phase 7/8 entities in practice, not in the type
system itself.

### 1.3 Deterministic logic (pure, unit-tested, no AI, no DB)

- `apps/web/lib/shortlists/queue.ts` — `sortQualityReviewQueue()` groups by
  eligibility first (eligible, then pending_verification, then ineligible)
  and ranks by score only within the eligible group, so an ineligible
  candidate is never interleaved into ranked output while still remaining
  visible to a reviewer; `filterRankable()` is the hard eligibility filter
  behind any ranked/shortlist-candidate view.
- `apps/web/lib/shortlists/rules.ts` — `canAddCandidateToShortlist()`,
  `nextShortlistRank()`, `validateOverrideAuthorization()`: friendly
  pre-flight checks mirroring the migration's trigger/CHECK constraints
  exactly, so a bad request gets a clear message from the server action
  rather than a raw Postgres error — the database (§1.1) remains the final
  authority regardless.
- `apps/web/lib/shortlists/visibility.ts` —
  `serializeShortlistCandidateForClient()`/
  `filterShortlistActivityForClient()`, mirroring
  `apps/web/lib/candidates/visibility.ts`'s established column-redaction
  pattern for this domain.

Each has a `.test.ts` file alongside it (§2).

### 1.4 Server actions

`apps/web/lib/shortlists/verification-actions.ts`:
`openVerificationRequestAction`, `resolveVerificationRequestAction`,
`confirmCandidateInterestAction`.

`apps/web/lib/shortlists/shortlist-actions.ts`: `createShortlistAction`,
`addCandidateToShortlistAction`, `removeCandidateFromShortlistAction`
(implemented as: on a still-`draft` version, a real delete under the
version's append-only-once-submitted grant; once a version is submitted,
removal is unsupported in place — a new draft version must be built
instead, since `shortlist_candidates` is append-only from that point),
`submitShortlistForInternalApprovalAction`,
`internallyApproveShortlistAction`, `sendShortlistToClientAction`,
`recordClientDecisionAction`, `rebuildShortlistVersionAction`.

`apps/web/lib/matching/matching-actions.ts`'s `recordReviewDecisionAction`
was extended to accept the two new `'escalated'`/`'note_added'` decision
values.

**Caught and fixed during this build, before this report was written, not
shipped as a known bug — a self-correction in the same spirit as Build
Phase 7's `risk_notes` addition:** the permission matrix's `'approve'`
**action** on the `shortlists` resource is specifically what Client
Decision-Maker's `'approve'` permission **level** grants
(`packages/types/src/permissions.ts`'s `hasPermission()`:
`case 'approve': return action === 'read' || action === 'approve'`).
Agency Admin's and Recruiter's `'full'` level deliberately _excludes_ the
`'approve'` action (`case 'full': return action !== 'approve'`) — a
carve-out that already existed in the permission matrix from an earlier
phase but had never been exercised by a real gated action until this one.
An early pass at `internallyApproveShortlistAction`/
`sendShortlistToClientAction` gated on `'approve'`, which would have
**denied** Agency Admin/Recruiter (the actual actors of those two actions)
while only working for Client Decision-Maker — backwards from intent. Both
are now gated on `'update'`; `recordClientDecisionAction` is the sole
action in this build gated on `'approve'`, matching `client_decisions`'s
RLS insert policy exactly. See docs/07-data-model.md §7.10 and
docs/06-roles-permissions.md §6.2.6.

New `AuditAction` values were added to `apps/web/lib/audit/log.ts`:
`candidate_match.verification_requested`,
`candidate_match.verification_resolved`,
`candidate_match.interest_confirmed`, `shortlist.created`,
`shortlist.candidate_added`, `shortlist.candidate_removed`,
`shortlist.submitted_for_internal_approval`,
`shortlist.internally_approved`, `shortlist.sent_to_client`,
`shortlist.client_decided`, `shortlist.rebuilt_new_version`.

Every write action is gated on the `human_reviews`/`shortlists`/
`candidate_records` permission resources per docs/06-roles-permissions.md
§6.2.6, matching the RLS write policies exactly.

### 1.5 UI

- `apps/web/components/domain/shortlists/review-queue-panel.tsx` — the
  quality-review queue, its reviewer decision dialog, and an inline
  "request verification" trigger, consolidated onto one screen. **This is a
  deliberate scope decision, not the brief's literal three-separate-screen
  reading** (queue screen + decision dialog screen + verification-request
  screen) — a reviewer acts on a candidate without leaving the queue.
  Links out to the candidate detail page's Build Phase 7 "Evaluation" tab
  ("Open full evaluation") for the underlying gate/score detail rather than
  duplicating it.
- `apps/web/components/domain/shortlists/shortlist-builder-panel.tsx`,
  `shortlist-workspace-panel.tsx`, `start-shortlist-button.tsx` — the
  candidate-add/remove builder, the workflow-stage action buttons
  (submit/approve/send/decide/rebuild, each an explicit, separately
  permissioned, human-initiated action — nothing auto-advances, per Core
  Principle #3/#8), and the entry point that creates a shortlist header +
  its first draft version for an eligible-candidate-bearing job.
- `apps/web/lib/shortlists/load.ts`, `load-detail.ts` — live Supabase data
  loaders for the queue and the per-shortlist workspace view.
- `apps/web/app/(app)/shortlists/page.tsx` reworked to two tabs (Quality
  Review / Shortlists) under the existing "Shortlists" nav entry, with live
  data when Supabase is configured and the original demo fallback
  otherwise.
- `apps/web/app/(app)/shortlists/[shortlistId]/page.tsx` reworked to a
  server component: a live workspace view (score/gates-passed/evidence %/
  completeness %/recruiter note per candidate, confirmed by reading
  `load-detail.ts` and the page directly) when configured, falling back to
  the original Build Phase 1 demo "Verification Matrix" view — extracted
  verbatim, unchanged, into a new file,
  `apps/web/app/(app)/shortlists/[shortlistId]/demo-view.tsx` — when not.

**Honest gaps, not hidden:**

- No dedicated mobile-specific shortlist or candidate-comparison screens
  were built beyond the existing responsive Tailwind layout — no separate
  mobile-only view exists, only responsive flow of the same components.
- No dedicated "decision history" screen exists. History is readable via
  `shortlist_activity`/`client_decisions` rows, but there is no
  history-specific page presenting them as a timeline yet — a natural
  Build Phase 9 candidate (§6).
- The live candidate-comparison view is simpler than the Build Phase 1
  demo's comparison grid: `DEMO_COMPARISON`'s `siteCount`/`headcount`/
  `plVolume`/`domain`/`city`/`distance` fields (confirmed present in
  `apps/web/lib/mock-data.ts` and rendered only by `demo-view.tsx`) have no
  backing columns anywhere in the schema — known and reported unresolved
  since Build Phase 7, unchanged this phase. The live workspace view
  therefore shows only what is actually backed by real data: score, gates
  passed, evidence %, completeness %, and the recruiter's note.

## 2. Tests added

**340 → 360 tests** (20 new), all passing, zero regressions:

- `lib/shortlists/queue.test.ts` (5 tests) — eligibility-group ordering,
  score ordering within the eligible group, oldest-first tie-break,
  `filterRankable`'s hard exclusion of non-eligible entries.
- `lib/shortlists/rules.test.ts` (12 tests) — not-eligible rejection,
  duplicate-candidate rejection, max-candidates enforcement with and
  without an override, `nextShortlistRank`'s never-reuse-a-rank behavior,
  `validateOverrideAuthorization`'s missing-authorizer/missing-reason
  cases.
- `lib/shortlists/visibility.test.ts` (3 tests) — `recruiterNote` is
  omitted entirely (not nulled) from the client-safe projection,
  `shortlist_activity` filtering keeps only `clientVisible` rows.

## 3. Commands run (verification gate)

```
pnpm --filter @rqi/types typecheck   # clean
pnpm typecheck                        # clean, all 5 packages
pnpm lint                             # clean
pnpm test                             # 360 passed, 0 failed (51 test files)
pnpm --filter web build               # succeeds; /shortlists prerenders
                                       # static, /shortlists/[shortlistId]
                                       # server-renders on demand (ƒ)
```

All four commands were re-run directly for this report, not taken on
trust from an earlier pass: `pnpm test` reported `Test Files 51 passed
(51)` / `Tests 360 passed (360)`; `pnpm typecheck` and `pnpm lint` both
completed with no errors across all five packages; `pnpm --filter web
build` compiled successfully and listed `/shortlists` as a static (○)
route and `/shortlists/[shortlistId]` as dynamic (ƒ), alongside every
pre-existing route unchanged.

## 4. RLS functional verification (`/tmp/pgverify`)

`/tmp/pgverify/verify_candidates.sql` (mirrored at
`scripts/verify_candidates.sql`) extended with a new **TEST 14** block
(14a–14m). For this report, the verification was re-run from a completely
fresh database, not reused from an earlier pass: migrations `0001`–`0028`
were applied in strict numeric order to a newly created local PostgreSQL 16
database (`pgverify_check`) with zero errors, then the full
`verify_candidates.sql` script (TEST 1 through TEST 14m, the complete
suite carried since Build Phase 5) was run against it — **exit code 0, zero
`FAILED`/`ERROR` lines**, 53 labeled `test`/`pass` assertion rows plus 27
`NOTICE ... PASS` messages, all green. TEST 14 specifically confirms:

- **14a** — a candidate whose `candidate_role_matches.eligibility <>
'eligible'` is rejected by `enforce_shortlist_candidate_rules()` when an
  insert into `shortlist_candidates` is attempted — never rank a
  failed-mandatory-gate candidate.
- **14b** — a duplicate `(shortlist_version_id, candidate_id)` insert is
  rejected by the UNIQUE constraint.
- **14c** — a second candidate on a `max_candidates = 1` shortlist is
  rejected without an override, and succeeds once an authorized override
  (`override_max_candidates = true` + `override_by` + `override_reason`) is
  set.
- **14d** — an override attempted with no `override_by` is rejected by
  `shortlists_override_requires_reason`.
- **14e** — a `client_decisions` reject/discuss with no `notes` is
  rejected by `client_decisions_notes_required_unless_accept`; accept
  requires none.
- **14f** — the recruiter assigned to the project (a2) can see the
  shortlist and its candidates; an unassigned recruiter in the same org
  (a3) cannot.
- **14g** — a client cannot see a still-draft/pending-approval shortlist,
  but can see one that has reached `sent_to_client`, including that
  shortlist's current-version candidates.
- **14h** — tenant isolation: an admin/recruiter in a completely different
  organization (b2) sees no shortlist or shortlist_candidates row in org
  a1.
- **14i** — `shortlist_candidates` is append-only at the database-role
  level: a direct DELETE is denied by the `REVOKE`, matching `0028`.
- **14j** — resolving a `verification_requests` row without
  `resolved_by`/`resolved_at` is rejected by
  `verification_requests_resolution_requires_detail`; a properly resolved
  row carries its resolution note.
- **14k** — the extended `human_reviews.decision`/
  `candidate_role_matches.review_status` CHECK constraints accept
  `escalated`/`note_added` and still reject an invalid value.
- **14l** — `candidate_project_entries.interest_status` defaults to
  `unknown`, updates to `interested`, and rejects an invalid value.
- **14m** — `shortlist_activity`: a client cannot see an internal-only
  (`client_visible = false`) row but can see a `client_visible = true` one
  on a shortlist already visible to them.

## 5. Known blockers / not configured in this environment

- **No live Supabase project connected.** Same as every prior phase — no
  `apps/web/.env.local`, no `SUPABASE_*` env vars. The schema and RLS were
  instead verified functionally against local PostgreSQL 16 (§4), which is
  a real functional check but not a substitute for running against the
  actual managed Postgres/Auth/Storage stack this app will deploy on.
- **No `ANTHROPIC_API_KEY` configured.** Unchanged from every prior phase.
  Not a new blocker introduced this phase — Build Phase 8 adds no AI call
  of its own — but repeated here because the review queue and shortlist
  builder both display scores/evidence that trace back to Build Phase 7's
  never-exercised `AnthropicMatchingProvider` call.
- **The `candidate_project_entries.current_stage = 'shortlisted'`
  transition is not wired to `shortlist_candidates` insertion** (§ blockers
  intro, item 3). Confirmed by reading `apps/web/lib/candidates/
pipeline.ts` directly: it defines the stage-transition rules and the
  `client_visible` auto-flip on entering `'shortlisted'`, but nothing in
  `apps/web/lib/shortlists/shortlist-actions.ts` calls into it. This was a
  named open design question before this build started and remains
  unresolved by design — the two "client visibility" mechanisms (pipeline
  stage flag, shortlist-status-gated RLS) currently operate independently,
  and this phase's RLS is strictly the narrower/later gate of the two, so
  no candidate leaks early as a result — but the Build Phase 5 pipeline
  board will not visually reflect "shortlisted" when a shortlist is built
  through this phase's UI.
- **No background job queue.** Every server action in this phase runs
  synchronously inside the request, same as every prior phase's write
  actions.
- **No dedicated mobile-specific shortlist/comparison screens or
  decision-history screen.** See §1.5's honest-gaps list.
- **The live candidate-comparison view is narrower than the Build Phase 1
  demo's comparison grid** (`siteCount`/`headcount`/`plVolume`/`domain`/
  `city`/`distance` have no backing schema columns) — known since Build
  Phase 7, unchanged this phase, not addressed by this build's brief.

## 6. Recommendation for next build

Wire the `candidate_project_entries.current_stage → 'shortlisted'`
transition to `shortlist_candidates` insertion (§5) so the Build Phase 5
pipeline board reflects shortlist state automatically, and build a
dedicated decision-history view over `shortlist_activity`/
`client_decisions` — both are small, well-scoped follow-ups against this
phase's schema rather than new schema work. Beyond that, the outreach
workflow (personalized outreach management, screens 16/17 of
docs/03-screen-inventory.md) is the next unimplemented workflow named in
the project instructions, and would benefit from `candidate_project_entries
.interest_status` (this phase) and the eligible/reviewed candidate set
(Build Phase 7) both already existing to build against. A live Supabase
project and Anthropic API key remain the two blockers that would let every
AI-touching phase since Build Phase 4 actually run instead of just being
verified structurally.

Related documents: [[07-data-model]] · [[06-roles-permissions]] · [[08-candidate-scoring]] · [[09-ai-architecture]] · [[03-screen-inventory]]
