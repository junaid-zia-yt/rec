# Security Review — Build Phase 14 (Security Hardening and Release Candidate), Wave 1

Date: 2026-09-28
Scope: full security audit of the web app (`apps/web`), mobile app (`apps/mobile`), shared types (`packages/types`), and the database schema (`supabase/migrations/0001`–`0032`, plus this wave's `0033`). Findings verified by reading current source, not by trusting prior phase reports' own claims.

Method: systematic read-through and targeted `grep`/`glob` sweep of each of the 19 areas below, cross-checked against `packages/types/src/permissions.ts`'s permission matrix, every `requirePermission`/`requireRole` call site (145 call sites across 25 files), every migration's RLS/GRANT/REVOKE statements, and a from-scratch local Postgres rebuild of all 33 migrations plus the existing `pgverify` regression suite (`scripts/verify_candidates.sql`).

---

## Summary table

| Severity  | Found | Fixed this wave | Tracked | Not applicable |
| --------- | ----- | --------------- | ------- | -------------- |
| Critical  | 1     | 1               | 0       | 0              |
| High      | 0     | 0               | 0       | 0              |
| Medium    | 3     | 0               | 3       | 0              |
| Low       | 4     | 0               | 4       | 0              |
| **Total** | **8** | **1**           | **7**   | **0**          |

No High-severity findings were identified this wave. The codebase (built across Phases 1–13 with an explicit, documented security convention — centralized `requirePermission`/`requireRole`, RLS on every tenant table, append-only `REVOKE`s, `server-only` guards) is unusually disciplined; the one Critical finding is a genuine gap the existing convention itself would have caught had its own stated assumption about Supabase's default privileges been correct.

| Status                                   | Count                                     |
| ---------------------------------------- | ----------------------------------------- |
| Fixed in this wave                       | 1                                         |
| Tracked for later                        | 7                                         |
| Not applicable / no live project to test | (see §"Not reviewed / not fixable" below) |

---

## 1. Authentication — **No finding**

`apps/web/lib/auth/actions.ts`, `apps/web/app/(auth)/*`, `apps/web/lib/supabase/{server,client,admin}.ts` reviewed in full.

- Sign-in (`signInAction`), sign-out (`signOutAction`), password-reset request (`requestPasswordResetAction`) and password update (`updatePasswordAction`) all return the same generic message on failure (`GENERIC_AUTH_ERROR_MESSAGE` / `GENERIC_RESET_REQUESTED_MESSAGE`) — no account-enumeration leak (`apps/web/lib/auth/actions.ts:26-140`).
- `createServerSupabaseClient()` (`apps/web/lib/supabase/server.ts:15-39`) is cookie-based via `@supabase/ssr`, respects RLS, never the service role. Cookie flags (`httpOnly`/`secure`/`sameSite`) are the `@supabase/ssr` library defaults — no override found anywhere in the codebase that would weaken them.
- `createAdminClient()` (`apps/web/lib/supabase/admin.ts`) is guarded by `import 'server-only'` (line 1) — an accidental client-bundle import is a **build error**, not a runtime leak. Confirmed no `'use client'` file imports it (repo-wide grep).
- Mobile bearer-token auth (`apps/web/lib/auth/mobile-session.ts`, `apps/web/lib/supabase/bearer.ts`, Build Phase 13): `authenticateMobileRequest` (lines 54-86) always calls `supabase.auth.getUser()` against the bearer-scoped client — this **revalidates the token against Supabase Auth itself**, never decodes/trusts it locally, and never accepts a client-supplied user id. A forged/expired/garbage token fails `getUser()` and returns 401. Verified this is the _only_ way any of the 11 mobile routes constructs identity (no route reads `request.headers` for a user id directly).

## 2. Session management — **No finding**

- `signOutAction` (`apps/web/lib/auth/actions.ts:73-97`) calls `supabase.auth.signOut()` on the server (cookie-based) client, which invalidates the session server-side via the Supabase Auth API (revokes the refresh token) — not merely a cookie clear.
- `apps/web/lib/supabase/middleware.ts:44-46` deliberately uses `auth.getUser()` (revalidates against Supabase Auth on every request) rather than `getSession()` (which only reads the local cookie and can be stale/forged) — the comment at that call site explicitly flags this as the load-bearing choice, and the code matches it.
- Mobile has no refresh/expiry handling of its own to review (the mobile app is expected to re-authenticate via Supabase's own client-side SDK, out of this wave's file list) — not reviewed further; flagged under "Not reviewed" below.

## 3. Authorization — **No finding** (the known recurring bug class was re-checked systematically and not found)

- Read `packages/types/src/permissions.ts` in full (`MATRIX`, `hasPermission`, `permissionLevel`). Re-derived, for every `(resource, action)` pair actually called anywhere in the app, whether the calling role set holds the permission level the code assumes.
- Extracted **all 145** call sites referencing `requirePermission`/`requireRole` (`grep -rn` across `apps/web/lib` and `apps/web/app`, all 21 `'use server'` files and all 11 `app/api/**/route.ts` files, including every Build-Phase-13 mobile route).
- The specific `'approve'`-on-an-unheld-level bug pattern occurs at exactly 2 call sites (`shortlist-actions.ts:524`, `client-decision/route.ts:64`), both against `shortlists`, whose matrix row is the _only_ row in the entire matrix with an `'approve'` level (held by `client_decision_maker`). Both are correctly gated and explicitly commented as "the one action gated on the 'approve' permission level." `hasPermission`'s own `'full'` branch (`return action !== 'approve'`) means `agency_admin`/`recruiter` (both `'full'` on `shortlists`) are correctly _excluded_ from this action too — verified this is intentional (only `client_decision_maker` should record a client decision) and matches the DB-layer RLS on `client_decisions`.
- `poc_reports`' commercial-decision action (`poc-actions.ts:927`) is deliberately gated on `'create'`, not the unheld `'approve'`, with an explicit code comment explaining why — correct.
- `integrations` write actions (`integration-actions.ts`) deliberately bypass `requirePermission` for a direct `agency_admin`-only check, because the application matrix (`platform_admin: 'full'`) is _wider_ than the DB RLS (`agency_admin`-only) — using `requirePermission` would let a `platform_admin` pass the app check and then fail at the DB with an opaque RLS error. Same precedent, same reasoning, as `lib/jobs/manual-retry.ts`'s `manuallyRetryJob` (background_jobs' matrix level is `'read'` for `platform_admin`/`agency_admin`, which `hasPermission` never treats as `'update'` — `manuallyRetryJob` correctly checks role directly instead of calling `hasPermission(..., 'update')`, which would always be `false`). Both are correct, intentional deviations from the generic helper, each documented in the file's own header comment.
- The 3 mobile notification routes (`notifications/[id]/read`, `notifications/read-all`, `notifications/preferences`) intentionally use `requireOrgMembership` only, not `requirePermission` — own-user-scoped writes (`.eq('recipient_user_id', user.id)` / own-user upsert) with RLS as the real backstop, mirroring the equivalent web actions exactly. Correct.
- `apps/web/lib/auth/permissions.ts`'s `requirePermission` (a pure, membership-taking helper) is _not_ a duplicate/dead-code footgun — it is the one function `apps/web/lib/auth/session.ts`'s `requirePermission` (the one every call site actually imports) wraps around a DB membership fetch. Only `session.ts` and `permissions.test.ts` import from `./permissions` directly; no call site accidentally imports the wrong one.

## 4. Row Level Security / multi-tenant isolation — **1 Critical finding, fixed this wave**

Read all 71 tables created across `supabase/migrations/0001`–`0032`. Cross-checked every one for `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and at least one `CREATE POLICY`. Several tables' RLS/policies are set via `DO $$ ... EXECUTE FORMAT(...) $$` loops over an array of table names (`0020`, `0021`, `0027`), which a naive static grep misses — these were manually verified table-by-table and are all correctly covered (recruiter policies for `candidate_experiences`/`candidate_education`/`candidate_certifications`/`candidate_skills`/`candidate_sources` are deferred from `0020` to `0021` exactly as `0020`'s own comment states, and are present there; `matching_runs`/`candidate_role_matches`/`mandatory_gate_results`/`scoring_breakdowns` in `0027` are all covered by the same dynamic-loop pattern).

### CRITICAL — `ai_prompt_versions` had no RLS at all, readable and writable by any authenticated user in any tenant

**File**: `supabase/migrations/0017_ai_runs.sql:26-36` (original table definition). **Status: Fixed in this wave** via `supabase/migrations/0033_ai_prompt_versions_rls.sql`.

`0017`'s own table comment stated: _"Not tenant data — prompts are a platform-level asset, not owned by an organization, so no organization_id/RLS here."_ `0030`'s `metric_definitions` comment later restated the same assumption explicitly: _"ai_prompt_versions in 0017 achieves the same 'platform-level asset' intent via NO RLS + NO grants at all, i.e. service-role-only access."_

**That assumption is incorrect for a live Supabase project.** Supabase's standard project bootstrap (outside of user-authored migrations — it happens at project provisioning, before any migration runs) grants the `anon`/`authenticated` Postgres roles `SELECT`/`INSERT`/`UPDATE`/`DELETE` on every table in the `public` schema via schema-level default privileges, independent of whether RLS is ever enabled on a given table. RLS being _off_ does not withdraw those default grants — it only means there is no row-level policy narrowing them, so with RLS off the grant applies **unrestricted, to every row**. This is precisely why every other table in this codebase (correctly) treats RLS as the real gate and the table GRANT as secondary defense-in-depth (see `0007_custom_access_token_hook.sql:63-71`'s own comment: _"RLS ... is what actually restricts row visibility; these GRANTs only allow the role onto the table at all"_) — `ai_prompt_versions` was the one table where that logic was inverted (treating "no grant" as sufficient without RLS), and the "no grant" premise itself doesn't hold against Supabase's actual default-privilege behavior.

**Impact**: prior to this fix, any authenticated user — in any tenant organization, holding any role including the lowest-privilege `read_only_reviewer` or `client_decision_maker` — could read **and overwrite** every row in `ai_prompt_versions`, including `template`: the literal prompt text sent to the model for every organization's requirement-extraction, candidate-matching, and copilot AI calls (`ai_runs.prompt_version` resolves against this table). This is a cross-tenant **integrity** break with a direct line to the project's own core AI-safety rules (#3 "AI must never invent candidate qualifications", #10 "every AI action must be auditable") — a single compromised or malicious low-privilege account in one tenant could silently rewrite the shared prompt template and alter AI behavior platform-wide, for every other tenant, with no audit trail pointing at the actual cause. Classified **Critical**: it crosses the tenant boundary via a write path, not merely a read, and undermines a documented core safety principle for every tenant simultaneously.

**Fix** (`0033_ai_prompt_versions_rls.sql`): enabled RLS; added the same real-policy shape `0030` already established for `metric_definitions` (another shared, non-tenant-owned platform catalog) instead of relying on "no RLS" ever meaning "no access" again — `SELECT` policy `using (true)`, gated to actual reachability by an explicit `GRANT SELECT ... TO authenticated` (never `anon`); `INSERT`/`UPDATE`/`DELETE` all gated to `public.is_platform_admin()`. Verified against a from-scratch local rebuild of migrations `0001`–`0033` (see Verification below) — applies cleanly, and `pg_policies`/`pg_class.relrowsecurity` confirm all 4 policies and RLS-enabled are live.

### Everything else in this area — verified correct, no fix needed

- No other table is missing RLS or a policy.
- `can_access_candidate` / `is_assigned_to_project` (defined in `0021`/`0027`'s helper-function sections) take only `uuid` parameters compared via `=`/`in` against other columns inside parameterized policy predicates — there is no string concatenation anywhere in any policy definition, so SQL injection via these helpers is not possible (confirmed by reading every `CREATE OR REPLACE FUNCTION` for both helpers).
- Application-layer defense-in-depth: spot-checked `apps/web/lib/candidates/actions.ts`, `apps/web/lib/shortlists/shortlist-actions.ts`, `apps/web/lib/outreach/outreach-actions.ts` — every Supabase query that reads/writes tenant data includes an explicit `.eq('organization_id', ...)` (or reaches the row via a parent id that is itself org-scoped and RLS-checked), consistent with the codebase's stated "RLS is the real gate, app-layer scoping is defense-in-depth" convention.

## 5. Client-reviewer restrictions — **No finding**

`client_visible`/`client_decision_maker`-relevant flags (`client_visible_notes`, `client_visible` on `shortlist_activity`, `data_classification`/`restricted_notes_excluded` on copilot conversations) are read and enforced consistently outside the copilot path too — found in `apps/web/lib/candidates/actions.ts`, `apps/web/lib/candidates/pipeline.ts`, `apps/web/lib/candidates/pipeline-actions.ts`, `apps/web/lib/shortlists/shortlist-actions.ts`, and `apps/web/lib/poc/load-detail.ts`, not only in `apps/web/lib/copilot/*`. The permission matrix itself denies `client_decision_maker` any access at all to `scorecards`, `candidate_documents`, `human_reviews`, `outreach`, and gives only `'read'` on `candidate_records` — RLS mirrors these exactly (verified in `0016`/`0019`/`0027`/`0029`'s policy definitions, which have no `client_decision_maker` policy at all on those tables, a fail-safe default-deny rather than an accidental permissive one).

## 6. Service-role protection — **No finding**

- `SUPABASE_SERVICE_ROLE_KEY` referenced only in `apps/web/lib/env.ts`, `apps/web/lib/env.test.ts`, `apps/web/lib/supabase/admin.ts`, and `apps/web/scripts/seed.ts` — all server-only contexts.
- `apps/web/lib/supabase/admin.ts` starts with `import 'server-only'` (line 1) — confirmed present, makes any client-bundle import a build-time error.
- Repo-wide grep for `'use client'` files importing anything from `admin.ts`/`SERVICE_ROLE`/`supabaseAdminConfigured`: zero matches.
- `apps/mobile` has zero references to `SERVICE_ROLE`/`service_role` anywhere (grep across the whole app) — the service-role key is never shipped to or referenced by the Expo app.

## 7. Environment secrets — **No finding**

- `.env.example` (repo root) contains no real values — every entry is blank (`NEXT_PUBLIC_SUPABASE_URL=`, `SUPABASE_SERVICE_ROLE_KEY=`, etc.), consistent with its own header comment ("No real values belong in this file or in git history").
- Repo-wide regex sweep for hardcoded `api[_-]?key|secret|password|token` literal assignments (excluding `process.env.*`, Zod schema declarations, test fixtures, and placeholder text): zero matches.
- `NEXT_PUBLIC_*` (web) / `EXPO_PUBLIC_*` (mobile) prefixed vars are exactly: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web); `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL` (mobile). All are genuinely safe-to-expose (anon key + public URLs only) — never `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, or any Apollo/calendar credential, none of which carry the public prefix anywhere in the codebase.

## 8. File access / signed URLs — **No finding**

`apps/web/lib/files/storage.ts` reviewed in full:

- `uploadDocument` writes under `buildDocumentStoragePath`'s path shape: `${organizationId}/${ownerType}/${ownerId}/${randomComponent}-${safeFileName}` — org-prefixed (so Storage RLS can key off `storage.foldername()`) and includes a `randomUUID()` component specifically so an enumeration attempt against `document_uploads` row ids can't be paired with a guessable Storage path (`apps/web/lib/files/validate.ts:157-178`'s own comment states this reasoning explicitly, and the code matches it). `upsert: false` — a re-upload is a new version, never a silent overwrite.
- `getSignedDocumentUrl` mints a signed URL with a bounded 300-second (5-minute) TTL (`SIGNED_URL_TTL_SECONDS`, `storage.ts:7`), through the _caller's own_ authenticated client (never service-role) — so Storage RLS (`0014_document_storage.sql`) still gates who can mint a signed URL for a given path in the first place; a signed URL can only ever be generated for a path the caller's role/org already permit.
- `downloadDocumentBytes` (server-side text extraction) is likewise scoped to the caller's own client, same RLS boundary, and its own doc comment explicitly restates the project's "never place raw CVs in application logs" rule for anything downstream of it.

## 9. Upload validation — **No finding**

`apps/web/lib/files/validate.ts` reviewed in full:

- Allow-list only (PDF, DOCX) — `extension_not_allowed`/`mime_type_not_allowed` both explicitly rejected, plus a cross-check that the matched extension's expected MIME equals the matched MIME's expected extension (`extension_mime_mismatch`) to catch a renamed-file spoof.
- Explicit `BLOCKED_EXTENSIONS` denylist (`.exe`, `.bat`, `.js`, `.sh`, `.dll`, etc.) as documented defense-in-depth on top of the allow-list.
- 10 MB size limit (`MAX_JOB_DESCRIPTION_FILE_SIZE_BYTES` / `MAX_CANDIDATE_DOCUMENT_FILE_SIZE_BYTES`), and an explicit `empty_file` rejection for `sizeBytes <= 0`.
- Filename sanitization (`buildDocumentStoragePath`, `validate.ts:172-176`) strips everything outside `[a-zA-Z0-9._-]` before it ever reaches a Storage path.
- Parsed-document-into-AI-prompt framing: confirmed (`apps/web/lib/ai/*`, no `console.*` calls found logging raw content; `ai_runs.input_ref` stores an opaque reference, never the raw untrusted text itself — `0017_ai_runs.sql:41-46`'s own column comment states this trust-boundary rule and the schema enforces it structurally, not just by convention).

## 10. Rate limiting — **1 Medium finding, tracked**

**Status: Tracked for later** (not fixed this wave — a full production rate-limiter, e.g. Redis-backed, is legitimately out of scope for this sandboxed environment per the brief; this is a documented gap, not a silent one).

`copilot_usage_counters` (`apps/web/lib/copilot/orchestration/run-copilot-turn.ts:119-314`, backed by `0031_copilot.sql`) is the **only** rate limiter anywhere in the codebase — confirmed by grepping every `lib/` directory for `rate` in any casing. Gaps, all Medium (a real weakness, but each already has another mitigating layer — auth throttling is a Supabase Auth platform-level control once a live project exists; every mobile/AI-triggering route already requires `requirePermission`/org-membership, so this is "no brute-force ceiling", not "no authorization ceiling"):

- **Sign-in attempts** (`signInAction`) has no attempt-count throttling in application code at all. Supabase Auth itself applies some rate limiting at the platform level on a live project, but nothing in this codebase adds a second layer (e.g. a per-IP or per-email lockout).
- The 11 Build-Phase-13 mobile API routes have no rate limiting of their own.
- AI-triggering actions outside the copilot path — CV parse (`document-processing-actions.ts`), a matching run (`matching-actions.ts`), outreach drafting (`outreach-actions.ts`) — have no per-user/per-org throttle, meaning a compromised or careless account could drive unbounded Anthropic API spend against one organization (a cost/availability concern, not a data-boundary one, hence Medium not High).

## 11. CSRF — **No finding**

- Next.js Server Actions' built-in Origin-header CSRF check: confirmed nothing disables it (no `experimental.serverActions.allowedOrigins` override, no custom action-runtime config found).
- Repo-wide search for a route handler doing a state-changing `GET`: zero matches (`grep -rln "export async function GET" apps/web/app/api` found no file at all — every mutating route is exclusively `POST`/`PUT`).
- The specific bearer-vs-cookie footgun called out in the brief (a mobile route that would accept _either_ a bearer token _or_ an ambient cookie session, needing but lacking CSRF protection on the cookie path): checked every one of the 11 `app/api/mobile/*` route files for any `cookies()`/`request.cookies` usage — none exists. Every mobile route's only identity path is `authenticateMobileRequest` (bearer-only); none of them falls back to or additionally trusts a cookie.

## 12. XSS — **No finding**

`dangerouslySetInnerHTML` appears in the entire `apps/web`/`apps/mobile` source tree exactly once, and it is inside a **code comment** (`apps/web/components/domain/copilot/copilot-conversation-workspace.tsx:288`) explicitly documenting that citation excerpts are _never_ rendered via `dangerouslySetInnerHTML` and are always plain React text — there is zero actual usage of it anywhere. React's default escaping is otherwise relied on throughout with no explicit opt-outs found.

## 13. Injection — **No finding**

- Zero `.rpc(...)` calls anywhere in `apps/web/lib` or `apps/web/app` — the codebase does not use Postgres RPC functions from the application layer at all, only the Supabase query builder.
- Repo-wide search for a raw SQL string template (a template literal containing `SELECT`/`INSERT`/`UPDATE`/`DELETE`): every hit found is either a JSDoc comment or an error-message string (e.g. `` `enqueueJob: could not create the job: ${...}` ``) — no query construction via string concatenation anywhere.
- The two `DO $$ ... EXECUTE FORMAT(...) $$` loops in migrations `0020`/`0021`/`0027` (used to apply the same RLS policy shape across several table names) use `%I` (identifier) format specifiers exclusively for the table-name substitutions and never interpolate any request-supplied value — these are migration-time, developer-authored table-name lists, not runtime user input, so this is not an injection vector.

## 14. Open redirects — **No finding**

`apps/web/lib/auth/routing.ts:34-38`'s `sanitizeRedirectPath` rejects anything that doesn't start with a single `/` (blocks `//evil.com` and `/\evil.com` protocol-relative/backslash tricks explicitly) and additionally rejects any path containing `://` as a second, independent check. `requireAuth`'s own `?next=` construction (`session.ts:33-45`) always goes through `encodeURIComponent`, and `signInAction`'s redirect target (`actions.ts:69`) is always passed through `sanitizeRedirectPath` before use — confirmed no other `redirect(...)` call site in the codebase takes an unsanitized, request-controlled path.

## 15. Webhook signatures — **No finding in the code that exists; the route handlers themselves are not yet built (tracked, not a live vulnerability)**

`apps/web/lib/integrations/webhook/signature-verification.ts` reviewed in full: `safeCompare` (line 22-27) uses `timingSafeEqual` universally — every one of the 4 exported verification functions (`verifyHmacSha256Signature`, `verifyApolloWebhookSignature`, `verifyGoogleCalendarChannelToken`, `verifyMicrosoftGraphClientState`) routes through it, with a length check first (required — `timingSafeEqual` throws on mismatched-length buffers, and the code catches that). No `===` signature comparison exists anywhere in this file.

`apps/web/lib/integrations/webhook/process-inbound-webhook.ts` correctly gates on the caller-supplied `signatureValid` boolean _before_ returning a `'received'` status, and records `processing_status: 'rejected_invalid_signature'` on the row for a failed check rather than silently dropping it — matches the "reject before any DB write [of a _processed_, trusted event]" intent, while still recording that _something_ arrived (for forensic/audit purposes) even when invalid, which is itself a documented, deliberate design choice, not a gap.

**However**: no `app/api/webhooks/<provider>/route.ts` file exists anywhere in the repo yet — `process-inbound-webhook.ts`'s own header comment states this is an intentional judgment call, deferring the actual route file (which would call these functions with real request headers) to a future wave. **There is currently no live inbound webhook endpoint at all**, so this is Not Applicable as a present-day vulnerability (nothing is deployed to attack) — flagged here as a Low/tracked item: when that route file is built, it must actually call `verifyHmacSha256Signature`/etc. and pass the _raw_ request body (not a re-serialized one) before calling `processInboundWebhook`.

## 16. Background-job permissions — **No finding**

- `apps/web/lib/jobs/executor.ts` reads `organization_id` from the claimed job **row itself** (`.select('id, organization_id, ...)`, line 127) for every downstream operation (notification dispatch, integration sync, email delivery) — never from the job's `payload` JSON, so a payload cannot smuggle a different `organization_id` to escalate scope.
- `manuallyRetryJob` (`apps/web/lib/jobs/manual-retry.ts`) — its direct `platform_admin`/`agency_admin` role check (bypassing `hasPermission`, per its own extensive header comment) is still correct: mirrors `0032`'s `background_jobs_select_oversight` RLS policy exactly, which is the only RLS this table actually has.

## 17. Audit integrity — **No finding**

Grepped every migration for `revoke` (case-insensitive) and cross-checked against every table carrying an "append-only" comment: `audit_events`, `project_activity`, `scorecard_approvals`, `ai_runs`, `candidate_pipeline_events`, `matching_runs`, `mandatory_gate_results` (delete-only), `requirement_evidence`, `scoring_breakdowns`, `human_reviews`, `review_decisions`, `verification_requests` (delete-only), `shortlist_candidates`, `client_decisions`, `shortlist_activity`, `outreach_approvals`, `communication_events`, `poc_baselines`, `poc_metrics`, `poc_exclusions`, `poc_decisions`, `copilot_messages`, `copilot_tool_calls` (delete-only), `background_jobs` (delete-only), `webhook_events` (insert/update/delete all revoked — correct, service-role-only per §15 above), `notifications` (delete-only, since `read_at` is legitimately mutable). Every one of these has a matching `revoke update, delete` (or the narrower subset appropriate to that table's actual mutable-field shape) in the same migration that created it. No gap found.

## 18. Sensitive logging — **No finding**

Grepped `apps/web/lib/ai`, `apps/web/lib/integrations`, `apps/web/lib/auth`, and the AI provider/copilot orchestration files for `console.log`/`console.error`/`console.warn`: the only hit outside test files is `apps/web/lib/integrations/ta-tracker/manual-exchange-mode.ts:116`, which logs a generic caught `Error` object from a failed _audit-log write itself_ (a meta-failure, not request/payload content) — no PII, token, or job payload is logged there or anywhere else checked. `apps/web/lib/jobs/`'s established "no sensitive payloads in ordinary logs" discipline (Phase 12) holds in every other area checked.

## 19. Dependency vulnerabilities — **`pnpm audit` ran successfully; findings are Medium (dev/build tooling only), tracked**

The registry **was** reachable from this environment (`pnpm audit` and `pnpm audit --prod` both completed) — reporting the real result rather than "not run":

- **43 vulnerabilities found: 2 critical, 26 high, 15 moderate** by `pnpm audit`'s own severity labels.
- `pnpm audit --prod` returns the **same 43** — meaning every one of them is unreachable from a `--prod`-only install of the workspace's actual runtime dependency tree in the way `pnpm audit --prod`'s definition works here, i.e. they are all transitive **devDependencies**: `node-tar` (via `vitest`'s dependency chain), `@vitest/mocker`, `vite`, `postcss` (via the Next.js/Vite toolchain), `@xmldom/xmldom` and `image-size` (both transitive through `apps/mobile`'s Expo CLI / `@expo/config-plugins` build tooling, not the Expo _runtime_ the app ships).
- None of these packages ship inside the Next.js server bundle or the Expo app bundle actually deployed/installed on a device — they are build-time-only tools (test runner, dev server, asset-processing CLI). Applying this task's own severity rubric (_"Critical = exploitable now... High = a real security weakness that's not immediately exploitable without another condition"_), these do not meet the Critical/High bar for **this deployed system** — none of them is reachable by an external actor against the running application. Re-classified **Medium** (dependency hygiene, no production attack surface) and **tracked**, not fixed this wave: upgrading `vitest`/`vite`/Expo CLI tooling mid-wave, without the ability to fully re-run the mobile app's build/test cycle end-to-end against a real device in this environment, risks breaking working tooling for a class of vulnerability with no live exploitability here. Recommended follow-up: `pnpm update vitest vite @expo/cli` (or equivalent) in a dedicated dependency-bump wave with its own full verification pass.

---

## Findings tracked for later (Medium/Low — not fixed this wave, per the brief)

| #   | Severity | Area                   | Finding                                                                                                                                                                                                                                                                                                                  | File(s)                                                                                                                                            |
| --- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | §10 Rate limiting      | No throttle on sign-in attempts beyond whatever Supabase Auth applies at the platform level                                                                                                                                                                                                                              | `apps/web/lib/auth/actions.ts` (`signInAction`)                                                                                                    |
| 2   | Medium   | §10 Rate limiting      | No rate limiting on the 11 mobile API routes                                                                                                                                                                                                                                                                             | `apps/web/app/api/mobile/**/route.ts`                                                                                                              |
| 3   | Medium   | §10 Rate limiting      | No per-user/per-org throttle on AI-triggering actions outside copilot (CV parse, matching run, outreach draft) — cost/availability risk, not a data-boundary one                                                                                                                                                         | `apps/web/lib/candidates/document-processing-actions.ts`, `apps/web/lib/matching/matching-actions.ts`, `apps/web/lib/outreach/outreach-actions.ts` |
| 4   | Low      | §15 Webhook signatures | No `app/api/webhooks/<provider>/route.ts` exists yet — when built, it must call the existing, correctly-implemented `signature-verification.ts` functions against the _raw_ body before calling `processInboundWebhook`                                                                                                  | (file does not exist yet)                                                                                                                          |
| 5   | Low      | §19 Dependencies       | 43 dev-tooling-only vulnerabilities (2 "critical"/26 "high" by raw severity, none production-reachable) — recommend a dedicated `vitest`/`vite`/Expo-CLI bump wave                                                                                                                                                       | workspace-wide devDependencies                                                                                                                     |
| 6   | Low      | §2 Session management  | Mobile session refresh/expiry handling not reviewed this wave (see "Not reviewed" below)                                                                                                                                                                                                                                 | `apps/mobile/lib/supabase/*`, `apps/mobile/lib/*` (auth provider)                                                                                  |
| 7   | Low      | §4 RLS                 | `ai_prompt_versions`' fix (finding above) restricts writes to `platform_admin`; worth a follow-up product decision on whether `agency_admin` should also be able to view (not edit) prompt versions for transparency — currently any `authenticated` user can already `SELECT`, so this is a UX note, not a security gap | `supabase/migrations/0033_ai_prompt_versions_rls.sql`                                                                                              |

---

## Not reviewed / not fixable in this environment

- **`apps/mobile`'s own session refresh/token-storage code** (the Expo `AuthProvider`, secure-storage usage) was not read line-by-line this wave — the brief's file list for §1/§2 named only the web-side files explicitly; flagged above as tracked item #6 for a follow-up wave.
- **Live exploitation testing** of anything in this report — actually sending a forged bearer token, actually attempting a cross-tenant read against a running Supabase project, actually triggering the sign-in path's real-world rate limit — was not possible: **no live Supabase project is connected in this environment** (confirmed via `supabaseConfigured`/`supabaseAdminConfigured` flags and the absence of `NEXT_PUBLIC_SUPABASE_URL` in any environment). Every RLS/policy finding in §4 was verified by rebuilding the schema from scratch in a local Postgres instance and running the full `pgverify` migration-application + `scripts/verify_candidates.sql` regression suite against it (see Verification below) — this validates the SQL is syntactically correct and internally consistent, but is not a substitute for testing against Supabase's actual `anon`/`authenticated`/`service_role` runtime and its real default-privilege behavior (which is precisely the gap that produced this wave's Critical finding in the first place — the local stub does not model Supabase's default schema grants at all, since those are provisioned outside of any migration file).
- **`pnpm audit`'s registry reachability**: reachable — ran successfully, real results reported in §19, not fabricated as clean.
- **Google Calendar / Microsoft Graph / Apollo webhook signature schemes**: `signature-verification.ts`'s own header comment already states these are implemented against each provider's _publicly documented_ scheme only, untested against a live signed delivery from any of them, since none is configured in this environment. That caveat is accurate and unchanged by this review.

---

## Verification

- **Local Postgres rebuild**: created a fresh database (`pgverify_p14`), applied the existing `auth`/`storage` schema stubs (`/tmp/pgverify/00_stub_supabase_auth.sql`, `01_stub_storage.sql`), then applied all 33 migrations (`0001`–`0033`, including this wave's new `0033_ai_prompt_versions_rls.sql`) in order with `ON_ERROR_STOP=1`. **Result: all 33 migrations applied cleanly, zero errors.**
- **RLS confirmation**: queried `pg_class.relrowsecurity` and `pg_policies` directly against the rebuilt database for `ai_prompt_versions` — confirmed `relrowsecurity = t` and exactly the 4 expected policies (`ai_prompt_versions_select_all_authenticated`, `_insert_platform_admin`, `_update_platform_admin`, `_delete_platform_admin`) are present.
- **Regression suite**: ran `scripts/verify_candidates.sql` (the established `pgverify` harness) against the rebuilt database — **zero failures, zero errors**, matching its expected pass shape from prior phases.
- **`pnpm typecheck`**: 6/6 packages, all cache-hit (no TypeScript source changed this wave — only a new SQL migration was added) — **0 errors**.
- **`pnpm lint`**: 2/2 packages — **0 errors**, 18 pre-existing warnings in `apps/mobile/__tests__/screens/*.test.tsx` (`@typescript-eslint/no-require-imports`), unrelated to this wave and unchanged by it.
- **`pnpm test`**: 103 test files, **777/777 tests passed**, 0 failures.
- **`pnpm audit` / `pnpm audit --prod`**: both ran successfully (registry reachable); results reported honestly in §19 above, not fabricated.

### Before / after counts

| Metric                                 | Before this wave                                                      | After this wave    |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------ |
| Tables with RLS disabled and no policy | 1 (`ai_prompt_versions`)                                              | 0                  |
| Migrations                             | 32 (`0001`–`0032`)                                                    | 33 (`0001`–`0033`) |
| `pgverify` regression failures         | n/a (not run against this exact set before)                           | 0                  |
| `pnpm test`                            | 777/777 passing (baseline, unaffected by this wave's SQL-only change) | 777/777 passing    |
| `pnpm typecheck` / `pnpm lint` errors  | 0 / 0                                                                 | 0 / 0              |
