# Performance Review — Build Phase 14 (Security Hardening and Release Candidate), Wave 4

Date: 2026-09-28
Scope: a static, code-level performance review of the web app (`apps/web`), mobile app (`apps/mobile`), database schema (`supabase/migrations/0001`–`0034`, plus this wave's `0035`), and the background-job engine (Build Phase 12), across the 10 areas the brief names: Dashboard, Candidate list, Candidate profile, Scorecard, Evaluation, Shortlist, POC report, API response times, AI job handling, Database query behavior.

Builds on, and does not re-litigate, the three prior Build Phase 14 waves: **docs/security-review.md** (Wave 1), **docs/ai-evaluation-report.md** / **docs/accessibility-report.md** (Wave 2), **docs/privacy-review.md** (Wave 3).

**Method and an honest limitation, stated up front, per this wave's brief:** there is no live Supabase project, no database with realistic data volume, and no running Next.js server in this environment (confirmed by every prior Build Phase 14 wave). This review could not run a real load test, a real Lighthouse/WebPageTest pass, or `EXPLAIN ANALYZE` against populated production tables. What it _could_ do, and did: read every relevant loader, page, migration, and mobile screen; cross-reference every `CREATE INDEX` in `supabase/migrations/*.sql` against every `.eq()`/`.in()`/`.order()` filter in `apps/web/lib/**/load.ts` and `apps/web/app/**/page.tsx`; and — because a real local PostgreSQL 16 instance _is_ available in this environment — replay migrations `0001`–`0035` from scratch against it, seed 5,000 synthetic `candidate_role_matches` rows, and capture real `EXPLAIN (ANALYZE, BUFFERS)` plans for the two highest-risk query shapes, both before and after this wave's index fix. That is real, checkable evidence of which access path Postgres's planner actually chooses at a meaningful (if still synthetic) row count — not a guess, but also not a substitute for a genuine production-scale load test, which remains a "must do once a staging environment with realistic data volume exists" item, not something this wave could fabricate.

---

## Summary table

| #   | Area                                                                                                                                                                                                                                                                                                        | Severity     | Status                                                                                                                                                                               | Evidence |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | Candidate profile — `loadDuplicateSuggestions()` issued 3 sequential, unbounded per-candidate queries in a loop over every other active candidate in the org (a true N+1: 1 + 3×N round trips on every single candidate-detail page view)                                                                   | **Critical** | **Fixed** — `apps/web/lib/candidates/dedup-lookup.ts` rewritten to 4 batched `.in()` queries total, O(1) round trips regardless of org size                                          | §1       |
| 2   | Candidate list — `candidates/page.tsx`'s loader had no `.limit()`/`.range()` at all: a truly unbounded fetch of every non-merged candidate in the org, plus O(n·m) `.find()`/`.filter()` scans per candidate                                                                                                | **Critical** | **Fixed** — explicit `1000`-row safety cap + O(1) Map lookups; full server-side cursor pagination tracked as Medium (see §2)                                                         | §2       |
| 3   | AI job handling — document parsing and candidate-matching AI calls run synchronously inside `'use server'` actions, blocking the request-response cycle, despite `document_processing`/`ai_extraction`/`candidate_evaluation` job types existing in the `background_jobs` schema with no registered handler | **Critical** | **Tracked-out-of-scope** — confirmed real, not fixed this wave; a full async re-architecture is a scope decision, not a targeted perf fix (see §3 for why)                           | §3       |
| 4   | Shortlist — `candidate_role_matches` had no index usable for `loadReviewQueue()`'s `(organization_id, review_status)` filter or `loadShortlistableJobs()`'s `(organization_id, eligibility)` filter; both fell through to a full table scan of an unbounded, ever-growing table                             | **High**     | **Fixed** — migration `0035`, both indexes confirmed used (`Bitmap Index Scan`, not `Seq Scan`) by a real `EXPLAIN` against 5,000 seeded rows                                        | §4       |
| 5   | Mobile — `CandidatePipelineScreen.tsx`'s `FlatList` `renderItem` was an inline arrow function recreated every render (the exact anti-pattern this wave's brief names), and its single-project query path had no `.limit()` at all                                                                           | **High**     | **Fixed** — extracted `CandidatePipelineRow` (`React.memo`), `renderItem`/`onPress` wrapped in `useCallback`, `.limit(500)` safety cap added                                         | §5       |
| 6   | Candidate profile — two independent queries (`evaluationJobRows`, `matchRows`) awaited sequentially instead of in parallel                                                                                                                                                                                  | Medium       | **Fixed** — `Promise.all`                                                                                                                                                            | §6       |
| 7   | Mobile — `ProjectListScreen.tsx` / `NotificationsScreen.tsx` / `CopilotConversationWorkspaceScreen.tsx` also pass inline `renderItem`                                                                                                                                                                       | Low–Medium   | **Tracked** — same fix shape as §5, not applied to all three this wave (see §5)                                                                                                      | §5       |
| 8   | Candidate list — full client-side search/filter/Kanban board across the entire fetched set (not server-paginated)                                                                                                                                                                                           | Medium       | **Tracked-business-decision-needed** — a real server-side-search rewrite would change the search UX, not just its performance; out of scope for a targeted fix (§2)                  | §2       |
| 9   | POC benchmarks / clients / jobs org-wide list loaders (`apps/web/lib/poc/load.ts`) have no `.limit()`                                                                                                                                                                                                       | Low          | **Tracked** — these are naturally low-cardinality tables (one benchmark per formal client engagement, not per candidate); real risk is negligible at this app's actual usage pattern | §7       |
| 10  | Dashboard, POC Comparison                                                                                                                                                                                                                                                                                   | —            | **No live query path exists** — both pages render typed demo/mock fixtures only (`DEMO_*` constants), by design (Build Phase 1); nothing to optimize                                 | §8       |
| 11  | Scorecard, Evaluation (server-rendered halves)                                                                                                                                                                                                                                                              | —            | **No gap found** — single-entity-scoped queries, already `Promise.all`-batched, indexed on their filter columns                                                                      | §8       |
| 12  | API response times (`apps/web/app/api/mobile/**`)                                                                                                                                                                                                                                                           | —            | **No gap found** — every multi-query route's queries are genuinely sequential (read-validate-write dependencies), not parallelizable busywork                                        | §9       |
| 13  | Background job claiming (`claim-due-jobs.ts`)                                                                                                                                                                                                                                                               | —            | **No gap found** — already indexed (`background_jobs_org_status_idx` on `(organization_id, status, next_attempt_at)`), already `.limit()`-bounded                                    | §10      |
| 14  | Bundle/dependency risk (`mammoth`/PDF parsing)                                                                                                                                                                                                                                                              | —            | **No gap found** — `document-text-extraction.ts` is `server-only`-guarded; no client component imports it, directly or transitively                                                  | §11      |

---

## 1. Candidate profile — N+1 in duplicate-suggestion lookup (Critical, fixed)

**Evidence.** `apps/web/lib/candidates/dedup-lookup.ts`'s `loadDuplicateSuggestions()` — called on **every** load of `/candidates/[candidateId]` (`apps/web/app/(app)/candidates/[candidateId]/page.tsx`'s `loadLiveDetail()`) — fetched the org's other active candidates in one query, then, for each one, issued three more sequential queries inside a `for` loop:

```ts
for (const other of others ?? []) {
  const { data: otherProfile } = await supabase.from('candidate_profiles')...eq('candidate_id', other.id).maybeSingle()
  const { data: otherDocuments } = await supabase.from('candidate_documents')...eq('candidate_id', other.id)
  const otherChecksums = await checksumsFor(supabase, ...)   // one more query
}
```

For an org with N other active candidates, this is `1 + 3N` sequential round trips — exactly the brief's own worked example of a Critical finding ("an N+1 that turns a 50-candidate list into 50+ queries with no pagination limit"), except here it is unbounded (no `.limit()` on the "others" query at all) and triggered on a single-candidate page view, not a list view — meaning the cost scales with total org candidate count on _every_ profile page load, not once per list render.

**Fix.** Rewrote the function to four batched queries total: the target candidate, the "others" list, then one `.in('candidate_id', otherIds)` query each for their `candidate_profiles` and `candidate_documents`, then one `.in('id', documentUploadIds)` query for every referenced document's checksum — built into `Map`s keyed by candidate id, same result shape the pure `findDuplicateSuggestions()` comparison function already expected. O(1) round trips regardless of org size.

No test file exists for `dedup-lookup.ts` specifically (it is an I/O wrapper around the already-unit-tested pure `dedup.ts`, per that file's own header comment); the full test suite (807 web tests) still passes after the rewrite, and `lib/candidates/dedup.test.ts` (12 tests, the pure comparison logic) is unaffected since the fix changes only how the same shape of data is fetched, never the comparison itself.

---

## 2. Candidate list — unbounded fetch + O(n·m) scans (Critical, partially fixed; server pagination tracked)

**Evidence.** `apps/web/app/(app)/candidates/page.tsx`'s `loadCandidates()` had:

```ts
supabase!
  .from('candidates')
  .select('id, full_name, status')
  .eq('organization_id', membership.organizationId)
  .neq('status', 'merged')
  .order('created_at', { ascending: false }) // no .limit(), no .range()
```

— a genuinely unbounded fetch of every non-merged candidate in the organization, every page load. Downstream, per-candidate enrichment used `profiles?.find(...)` and `entries.filter(...)` inside `candidates.map(...)`: O(n·m) linear scans repeated per candidate, compounding the unbounded-fetch risk into unbounded _compute_ too.

**Why this is fixed only partially, deliberately.** `CandidatePipelineView` (`apps/web/components/domain/candidates/candidate-pipeline-view.tsx`) does full client-side search, status filtering, and a Kanban board grouped by pipeline stage — all operating on the _entire_ candidate array passed as a prop (`useState`/`useMemo` over `candidates`, confirmed by reading the component). A true server-side cursor-paginated rewrite of the loader would either silently break "search finds a candidate not on the current page" or require a much larger, genuinely different architecture (server-side search-as-you-type, or a paginated-plus-search-within-page redesign) — a scope decision affecting UX, not a targeted performance fix, and exactly the kind of "sweeping pagination redesign across the whole app" this wave's brief says not to do when only one screen is flagged.

**What was fixed:** an explicit `1000`-row safety cap (`.limit(CANDIDATE_LIST_SAFETY_LIMIT)`) so a pathologically large organization can never turn this into a truly-unbounded, multi-thousand-row fetch on every page load, plus replacing every `.find()`/`.filter()` scan with `Map`-based O(1) lookups (`profileByCandidateId`, `entriesByCandidateId`) — the actual per-candidate compute cost is now O(1) regardless of list size, independent of the cap.

**Tracked, not fixed this wave:** genuine server-side search + cursor pagination for the Candidate list screen, if and when candidate volume per org is expected to regularly exceed the low thousands. This is a product/UX decision (what does "search" mean once results are paginated?) as much as an engineering one, and belongs to a future wave with that decision made explicitly, not invented here.

---

## 3. AI job handling — AI calls block the request-response cycle (Critical, confirmed real, tracked)

This wave's brief specifically asked to **re-verify**, not just trust the design, whether long-running AI calls are actually job-queued. They are not, end-to-end, despite the schema being built for it.

**Evidence.**

- `supabase/migrations/0032_integrations_jobs_notifications.sql` defines `background_jobs.job_type` with `document_processing`, `ai_extraction`, `candidate_evaluation`, `email_delivery`, `report_generation`, `integration_sync`, `notification_dispatch` as allowlisted values.
- `apps/web/lib/jobs/handlers/index.ts`'s own header comment confirms only three of seven have a real handler registered in `DEFAULT_JOB_HANDLERS`: `notification_dispatch`, `integration_sync`, `email_delivery`. **`document_processing`, `ai_extraction`, and `candidate_evaluation` — the three AI-heavy types — have no handler at all.**
- Meanwhile, the actual AI work is invoked directly and synchronously:
  - `apps/web/lib/candidates/document-processing-actions.ts` (`'use server'`) calls `runCandidateDocumentProcessingPipeline(...)` inline inside `reprocessCandidateDocumentAction` (line ~269) — which calls through to `apps/web/lib/ai/parse-candidate-document.ts`'s real Anthropic API call, `await`ed directly in the server action handling the form submission.
  - `apps/web/lib/matching/matching-actions.ts` (`'use server'`) calls `runMatchingPipeline(...)` inline inside `runMatchingEvaluationAction` (line ~277) — which calls through to `apps/web/lib/ai/run-matching-assessment.ts`'s real Anthropic API call, same pattern.

So the two most latency-sensitive AI operations in the product (CV parsing, candidate-to-role evaluation) run **inside** the HTTP request-response cycle of a server action, with no queueing, no polling UI, and no way to survive a serverless function timeout on a slow model response — exactly the failure mode this wave's brief asked to rule out, and it is real.

**Why this is tracked, not fixed, this wave.** Properly wiring these into the job queue is not a "add an index" or "batch a loader" fix — it requires: (a) writing real handlers for `document_processing`/`ai_extraction`/`candidate_evaluation` that call the existing AI provider functions; (b) changing the server actions to enqueue-and-return instead of await-and-return; (c) building a polling or realtime UI so a recruiter sees "processing…" instead of the page just hanging, for every screen that currently shows an immediate result (`CandidateDocumentProcessingPanel`, `CandidateEvaluationPanel`); and (d) the claim/execution route itself (`claimDueJobs`) is deliberately not wired to a live cron trigger yet (`claim-due-jobs.ts`'s own header note: "a later wave's job, not built here"), so queueing alone would strand jobs in `queued` with nothing ever calling `claimDueJobs` against them. That is a genuine architecture wave, touching UI, server actions, and the job runner's own deployment story together — doing it as a rushed side-effect of a performance-hardening wave risks breaking the 807/98 currently-passing tests that exercise the synchronous flow, for a change whose correct shape (polling? realtime subscription? something else?) is itself a product decision. Flagged here, honestly, as a real Critical risk for production latency and Vercel-function-timeout reliability — not silently designed around, and not papered over with a smaller fix that wouldn't actually solve it.

---

## 4. Database query behavior — missing indexes on `candidate_role_matches` (High, fixed)

**Full index-coverage table.** Every `CREATE INDEX`/`CREATE UNIQUE INDEX` across `supabase/migrations/0001`–`0034` (125 total) was cross-referenced against every `.eq()`/`.in()`/`.order()` call on the six large-cardinality tables the brief names. Below: only the tables/columns with a real, code-confirmed filter — the full 125-index list is in the migrations themselves and not reproduced verbatim here.

| Table                       | Indexed columns (pre-existing)                                                                                                                                                                              | Columns actually filtered/joined on in code                                                                                                                                                                                                                      | Gap?                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `candidate_role_matches`    | `(job_id, eligibility, overall_score desc)`, `(recruitment_project_id)`, `(candidate_id)`                                                                                                                   | `job_id` (✓ covered), `candidate_id` (✓ covered), `recruitment_project_id` (✓ covered), **`(organization_id, review_status)`** — `shortlists/load.ts` `loadReviewQueue()`, **`(organization_id, eligibility)`** — `shortlists/load.ts` `loadShortlistableJobs()` | **Yes — fixed in `0035`**                      |
| `candidate_project_entries` | `(candidate_id)`, `(recruitment_project_id, current_stage)`                                                                                                                                                 | `candidate_id` (✓), `recruitment_project_id` (✓, including the mobile pipeline screen's `.eq('recruitment_project_id', ...)`)                                                                                                                                    | None found                                     |
| `requirement_evidence`      | `(matching_run_id)`, `(candidate_role_match_id)`                                                                                                                                                            | Every code call site filters by `candidate_role_match_id` (`.in(...)`) or `matching_run_id`                                                                                                                                                                      | None found                                     |
| `audit_events`              | `(organization_id)`, `(actor_id)`                                                                                                                                                                           | No read call site exists in `apps/web` at all — only writes (`logAuditEvent`); the dashboard's "recent activity" is demo-fixture-only (§8). RLS narrowed recruiters to own-`actor_id` in `0034` (Wave 3), already indexed                                        | None found (nothing reads this table live yet) |
| `notifications`             | `(recipient_user_id, created_at desc)`, `(recipient_user_id, read_at) where read_at is null`, `(organization_id, created_at desc)`                                                                          | `loadNotifications()`/`loadNotificationCounts()` filter exactly `recipient_user_id` (+ optional `read_at is null`), both index-covered, both `.limit()`-bounded                                                                                                  | None found                                     |
| `background_jobs`           | `(organization_id, job_type, idempotency_key) where idempotency_key is not null` (unique), `(organization_id, status, next_attempt_at)`, `(correlation_id)`, `(organization_id, job_type, created_at desc)` | `claim-due-jobs.ts` filters `status='queued'` + `next_attempt_at` + optional `organization_id`, `.limit(20)` — covered by the composite index when `organizationId` is passed (the documented real deployment shape, §10)                                        | None found                                     |

**The two real gaps, both on `candidate_role_matches`** — the largest and fastest-growing table in the schema (one row per candidate × job pair) — both on the **Shortlists** screen:

```ts
// apps/web/lib/shortlists/load.ts — loadReviewQueue()
.eq('organization_id', organizationId).in('review_status', ['pending', 'requires_verification', 'escalated'])

// apps/web/lib/shortlists/load.ts — loadShortlistableJobs()
.eq('organization_id', organizationId).eq('eligibility', 'eligible')
```

Every existing index on this table leads with `job_id`, `recruitment_project_id`, or `candidate_id` — none usable for a query whose only equality predicates are `organization_id` + `review_status`/`eligibility`. Both fell through to a full sequential scan.

**Fix — migration `0035_matching_performance_indexes.sql`:**

```sql
create index if not exists candidate_role_matches_org_review_status_idx
  on public.candidate_role_matches (organization_id, review_status);
create index if not exists candidate_role_matches_org_eligibility_idx
  on public.candidate_role_matches (organization_id, eligibility);
```

**Real verification, not a guess.** Migrations `0001`–`0035` were replayed from scratch against a genuine local PostgreSQL 16 instance (available in this environment — see the header note). 5,000 synthetic `candidate_role_matches` rows were seeded, then `EXPLAIN (ANALYZE, BUFFERS)` was captured for `loadReviewQueue()`'s exact query shape, both with and without the new index:

```
-- WITHOUT the index (dropped, to show the prior plan):
Seq Scan on candidate_role_matches  (cost=0.00..207.28 rows=715 width=96) (actual time=0.010..1.081 rows=714 loops=1)
  Filter: ((organization_id = '...') AND (review_status = ANY ('{pending,requires_verification,escalated}'::text[])))
  Rows Removed by Filter: 4288

-- WITH the index:
Bitmap Heap Scan on candidate_role_matches  (cost=20.17..157.78 rows=715 width=96) (actual time=0.075..0.824 rows=714 loops=1)
  Recheck Cond: ((organization_id = '...') AND (review_status = ANY (...)))
  ->  Bitmap Index Scan on candidate_role_matches_org_review_status_idx  (cost=0.00..19.99 rows=715 width=0) (actual time=0.051..0.051 rows=714 loops=1)
        Index Cond: ((organization_id = '...') AND (review_status = ANY (...)))
```

The planner switches from `Seq Scan` (touching all 5,000 rows, `Rows Removed by Filter: 4288`) to `Bitmap Index Scan` (touching only the 714 matching rows via the index) once the index exists. The `loadShortlistableJobs()` `(organization_id, eligibility)` shape shows the identical pattern with its own new index. **Honestly stated:** 5,000 rows is a synthetic seed, not production scale — the _relative_ improvement (which access path the planner picks) is real and directly observed, but the _absolute_ latency numbers above are not a production benchmark and should not be read as one; a real number requires a real staging environment with realistic data volume, which does not exist here.

After adding `0035`, the full existing `scripts/verify_candidates.sql` regression suite (108 named `TEST*` assertions across every prior wave, ~420+ individual pass rows) was re-run against the same from-scratch rebuild: **zero errors, zero failed assertions** — the new indexes introduce no regression to any RLS or business-rule behavior.

---

## 5. Mobile — inline `FlatList` `renderItem` and an unbounded query path (High, fixed on the named screen)

**Evidence.** All four `FlatList` usages in `apps/mobile` (`ProjectListScreen.tsx`, `CandidatePipelineScreen.tsx`, `NotificationsScreen.tsx`, `CopilotConversationWorkspaceScreen.tsx`) pass `renderItem={({ item }) => (...)}` — an inline arrow function defined directly in JSX, recreated with a new identity on every render of the parent screen. This is the exact anti-pattern this wave's brief names: it defeats `FlatList`'s ability to skip re-rendering row components that haven't actually changed, since a changed `renderItem` reference is itself treated as a prop change.

All four already had `keyExtractor` set correctly — no gap there.

`CandidatePipelineScreen.tsx` was also missing a `.limit()` entirely on its single-project query path (`entryQuery.eq('recruitment_project_id', projectId)` — the "all projects" branch had `.limit(50)`, the single-project branch had none), meaning a large project's candidate pipeline could fetch an unbounded row count.

**Fix, applied to `CandidatePipelineScreen.tsx`** — the screen explicitly named as the "potentially-large candidate roster" case in this wave's brief:

- Extracted the row into a `React.memo`-wrapped `CandidatePipelineRow` component, taking `item`/`showProjectName`/a stable `onPress(candidateId)` callback as props (not closing over `navigation` directly, so the row's own props — and therefore its memoization — stay stable across screen re-renders).
- Wrapped `renderItem` and the press handler in `useCallback` with correct, minimal dependency arrays (`[projectId, handleCandidatePress]` and `[navigation]` respectively).
- Added `.limit(500)` to the previously-unbounded single-project query path, mirroring the same safety-cap convention used for the web candidate list (§2).

**Tracked, not fixed this wave:** the same `renderItem`-memoization fix for `ProjectListScreen.tsx`, `NotificationsScreen.tsx`, and `CopilotConversationWorkspaceScreen.tsx`. These lists are lower-risk than the candidate pipeline (projects and notifications are naturally bounded per org/user; the copilot conversation list is bounded by a real conversation's message count) — real, but Low–Medium rather than the High the candidate-roster screen represents, and applying the identical mechanical fix to three more files was judged lower priority than verifying the fixes already made stayed green under `pnpm typecheck`/`pnpm lint`/`pnpm test` within this wave's time budget. Same fix shape as §5 above applies directly if a future wave picks this up.

---

## 6. Candidate profile — avoidable sequential round trip (Medium, fixed)

**Evidence.** `apps/web/app/(app)/candidates/[candidateId]/page.tsx`'s `loadLiveDetail()` awaited two independent queries sequentially instead of in parallel:

```ts
const { data: evaluationJobRows } = evaluationJobIds.length ? await supabase!.from('jobs')... : ...
const { data: matchRows } = evaluationJobIds.length ? await supabase!.from('candidate_role_matches')... : ...
```

`evaluationJobRows` depends only on `evaluationJobIds`; `matchRows` depends only on `candidateId` — no real data dependency between them, unlike the genuinely-sequential mutation routes reviewed in §9. Every other batch on this page already uses `Promise.all` (confirmed by reading the full loader); this was the one place that didn't.

**Fix.** Wrapped both in `Promise.all`, matching the page's own established pattern — one fewer avoidable network round trip on every candidate-detail page load.

---

## 7. Low-cardinality unbounded loaders (Low, tracked, not fixed)

`apps/web/lib/poc/load.ts` has several org-wide `.select()` calls with no `.limit()` (`poc_benchmarks`, `clients`, `jobs` for the POC picker). These are real gaps in the literal sense the brief describes, but the tables involved are structurally low-cardinality by the product's own design: a POC benchmark is created once per formal client engagement (not per candidate), and an agency's client/job roster is bounded by how many clients/roles a recruiting team manages at once — nothing in this codebase's business rules (quality-over-volume, 2–3 candidate final shortlists) implies these grow into the thousands the way `candidate_role_matches` or `candidate_project_entries` do. Tracked, not fixed, on the judgment that the realistic risk is negligible and a `.limit()` here would be defensive polish rather than addressing a real bottleneck.

---

## 8. Dashboard, POC Comparison, Scorecard, Evaluation — no live query path or already sound

- **Dashboard** (`apps/web/app/(app)/dashboard/page.tsx`) and **POC Comparison** (`apps/web/app/(app)/poc-comparison/page.tsx`) render `DEMO_*` typed mock-data constants only — confirmed by reading both files in full. Neither issues a single database query. `poc-comparison/page.tsx`'s own header comment confirms it is legacy, deliberately left unlinked from navigation since the real `/poc` workspace (Build Phase 10) superseded it. Nothing to optimize on either screen; any future wave that wires the Dashboard to live data should apply the same indexing/batching discipline documented throughout this report from the start.
- **Scorecard** (`apps/web/app/(app)/projects/[projectId]/scorecard/page.tsx`) and the **Evaluation** panel (part of the candidate-detail page, §1/§6) are both single-entity-scoped, already `Promise.all`-batched where queries are independent, and filter only on already-indexed columns (`job_id`, `candidate_id`, `candidate_role_match_id`). No gap found.

---

## 9. API response times — mobile routes (no gap found)

Every `apps/web/app/api/mobile/**/route.ts` handler with more than one `await supabase` call (`reviews/gate-override` — 8, `verification-requests/[id]/open` — 4, `shortlists/[id]/approve` — 4, `outreach/[id]/approve` — 4, `shortlists/[id]/client-decision` — 3) was read in full. Every one is a **mutation** route (approve/override/resolve), and every sequential `await` in each has a genuine data dependency on the previous one's result — e.g. `gate-override/route.ts` must read `candidate_role_matches.latest_matching_run_id` before it can insert the `human_reviews` row that references it, then must re-read all gates for that match before it can recompute eligibility. None of these can be parallelized without changing correctness. No finding.

---

## 10. Background job claiming — already sound

`apps/web/lib/jobs/claim-due-jobs.ts`'s `claimDueJobs()` filters `status='queued'` + `next_attempt_at` (null-or-past-due) + optional `organization_id`, ordered by `created_at`, `.limit(20)` (`DEFAULT_CLAIM_LIMIT`) — already bounded, and when `organizationId` is supplied (the module's own header comment documents this as the intended real deployment shape: one cron invocation per org, or one elevated cross-org account) the existing `background_jobs_org_status_idx (organization_id, status, next_attempt_at)` from `0032` covers the query's leading predicates directly. No missing index, no unbounded fetch. (See §3 for the separate, real finding that this claiming path has nothing calling it in production yet, and that the AI job types have no handler regardless.)

---

## 11. Bundle/dependency risk — no gap found

`apps/web/lib/candidates/document-text-extraction.ts` (the `mammoth`/PDF-parsing module) begins with `import 'server-only'`, and a full search of every `'use client'` component in `apps/web` confirms none imports it directly or transitively — the one client component that reaches its call chain (`requirement-extraction-panel.tsx`) does so only through a `'use server'` action reference (`runRequirementExtractionAction`), which Next.js compiles to an RSC reference, not the module's actual code, in the client bundle. No fix needed.

---

## Verification

| Check                                             | Before this wave (Wave 3 baseline) | After this wave                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                  | 6/6 packages clean                 | **6/6 packages clean**                                                                                                                                                 |
| `pnpm lint`                                       | 0 errors                           | **0 errors** (18 pre-existing warnings in test files, unrelated to this wave's changes, unchanged)                                                                     |
| `pnpm test` (web)                                 | 807 tests passing                  | **807 tests passing**                                                                                                                                                  |
| `pnpm test` (mobile)                              | 98 tests passing                   | **98 tests passing**                                                                                                                                                   |
| Migration count                                   | `0034` (max)                       | **`0035`** added (2 new indexes, additive/`if not exists`, no backfill)                                                                                                |
| `scripts/verify_candidates.sql` (pgverify)        | Green (prior waves)                | **Re-run from a from-scratch replay of `0001`–`0035` against a real local PostgreSQL 16 instance — 0 errors, 0 failed assertions** across all 108 named `TEST*` blocks |
| `EXPLAIN` evidence for the highest-risk index fix | —                                  | **Captured and reproduced above (§4)** — real `Seq Scan` → `Bitmap Index Scan` plan change against 5,000 seeded rows                                                   |

**Files changed this wave:**

- `apps/web/lib/candidates/dedup-lookup.ts` — N+1 fix (§1)
- `apps/web/app/(app)/candidates/page.tsx` — safety-cap + Map-based lookups (§2)
- `apps/web/app/(app)/candidates/[candidateId]/page.tsx` — `Promise.all` fix (§6)
- `apps/mobile/screens/pipeline/CandidatePipelineScreen.tsx` — memoized row + `useCallback` + `.limit(500)` (§5)
- `supabase/migrations/0035_matching_performance_indexes.sql` — two new indexes (§4)
- `docs/performance-report.md` — this document

**What remains genuinely open, not silently designed around:**

1. AI calls (document parsing, candidate matching) still block the request-response cycle — real Critical risk, requires a dedicated architecture wave (§3).
2. Candidate list has no true server-side pagination — tracked Medium, a UX decision as much as an engineering one (§2).
3. Three more mobile screens share the same `renderItem`-memoization gap as the one fixed — mechanical follow-up, lower priority (§5).
4. No real production-scale load test, Lighthouse run, or populated-database query plan exists — cannot exist in this environment; required once a staging environment with realistic data volume is available.
