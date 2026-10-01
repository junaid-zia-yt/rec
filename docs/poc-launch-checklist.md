# POC Launch Checklist

Build Phase 16, Wave 3 — "Preparation for the two-role client POC."
Documentation-only. This checklist is the artifact the user reviews to
decide whether the POC may go live; it does not, by itself, authorize
anything.

---

## Executive summary

This document walks the concrete operational items a two-role client POC
needs (users/roles, tenant isolation, JD intake, scorecard thresholds,
candidate data permissions, AI configuration, outreach accounts,
notifications, audit logs, metrics, backups, monitoring, support contacts,
rollback, data retention) and states, for each, exactly what has been
verified in code/docs in this sandbox, what is partially ready, and what
cannot be verified at all until real infrastructure or a real business/legal
decision exists. Of the 15 items in Part A: **4 are ✅ Verified**, **5 are
⚠️ Partially ready**, and **6 are ❌ Not yet possible** pending the user's
own infrastructure provisioning or business/legal decisions.

---

## Mandatory Completion Gate — this checklist is not an approval

Per the user's own explicit instruction for this phase — **"Do not start
production usage until the launch checklist is approved"** — this document
is the checklist itself, not the approval. Approving it is a decision only
the user can make, and nothing in this build phase treats its existence as
that approval.

State of the world as of this document:

- **Production usage has not started.** No code change accompanies this
  document; nothing in this wave alters running behavior.
- **No live deployment exists anywhere** — no Vercel project, no Supabase
  project (staging or production), no Sentry project, no Resend sending
  domain, no live Anthropic API key has ever existed in this project's
  history (`docs/staging-release-report.md` §2).
- **Six items below are explicitly ❌ "Not yet possible"** — Scorecard
  thresholds, AI configuration, Outreach accounts, Backups, Support
  contacts, and Data retention — each blocked on a specific real-world
  action (a credential, a client decision, or a legal determination) that
  this sandbox cannot perform. See the item's own entry for exactly what is
  missing.
- **Two items (Scorecard thresholds, Support contacts) require a client
  decision from Dave**, not a code fix, before they can move past
  ⚠️/informational.

Nothing below should be read as "the platform is ready" — it is a precise
statement of what has and has not been checked, so the user can decide with
full information.

---

## Part A — Verify

### 1. Users and roles

**✅ Verified in code/locally.** `docs/06-roles-permissions.md` §6.1/§6.2
defines five roles (Platform Admin, Agency Admin, Recruiter, Client
Decision-Maker, Read-Only Reviewer) with a full resource-by-resource
permission matrix (`packages/types/src/permissions.ts`), and §6.2.1–§6.2.9
document row-level narrowing (assigned-project scoping for Recruiter,
own-client scoping for Client Decision-Maker) layered on top in both RLS
and application code. `docs/security-review.md` §3 ("Authorization")
independently re-derived, for all 145 `requirePermission`/`requireRole`
call sites across every server action and API route, whether the calling
role actually holds the permission level the code assumes, and found no
misalignment. For the POC's two roles specifically (Recruiter and Client
Decision-Maker, per this phase's brief), the matrix and its RLS mirror are
directly checkable in `docs/06-roles-permissions.md` §6.2/§6.2.1 and were
exercised by role-switched-session RLS tests referenced in
`docs/release-readiness.md` Part A step 15 (client-note visibility
re-verified directly against the render-path conditional, not just cited).
What this does **not** cover: real user accounts have never been created in
a real Supabase Auth instance — see item 2 and item 6.

### 2. Tenant isolation

**⚠️ Partially ready.** `docs/security-review.md` §4 found and fixed the
phase's one Critical finding (`ai_prompt_versions` had no RLS at all,
readable/writable cross-tenant by any authenticated user) and otherwise
confirmed all 71 tables across migrations `0001`–`0032` have RLS enabled
with at least one policy, including tables whose policies are set via
dynamic `DO $$ ... EXECUTE FORMAT(...) $$` loops that a naive grep would
miss (manually verified table-by-table). `docs/release-readiness.md` Part A
step 17 re-confirmed the `audit_events` read-scoping fix
(`0034_privacy_hardening.sql`) directly against the migration, not by
re-citing a prior wave's claim.

The gap, stated plainly: **every one of these verifications was run against
a from-scratch local `postgres:16` rebuild of the migration files, never a
real Supabase project** (`docs/staging-release-report.md` §2), and **every
RLS test used synthetic multi-organization test fixtures created for the
purpose, never real production tenants** — `docs/staging-release-report.md`
§7 item 8 states directly that "cross-tenant isolation cannot be tested
against the current seed data — only one organization exists in the staging
seed." Real-Supabase-specific behavior (`auth.uid()` resolution under a live
session, actual Storage bucket ACLs) has never been exercised. Tenant
isolation as _designed and locally tested_ is solid; tenant isolation as
_operated against live infrastructure with two real client organizations_
has zero verification history.

### 3. Job descriptions

**⚠️ Partially ready — real limitation for POC operation.**
`docs/release-readiness.md` Part A step 4: the **paste-JD path** is fully
wired end to end (`pasteJobDescriptionAction` writes `status: 'parsed'`
with `raw_text` populated, directly consumed by requirement extraction).
The **upload-JD path** (PDF/DOCX) is not: `uploadJobDescriptionAction`
writes `status: 'draft'` with `raw_text` left `null` — no text-extraction
library is wired in this environment, and the action's own return message
states this plainly rather than silently failing. This is a pre-existing,
previously-disclosed limitation from Build Phase 3, not new.

**Operational consequence for the POC**: the recruiter running the POC must
paste job description text into the platform, not upload a PDF/DOCX file —
uploading one will not reach requirement extraction. This should be
communicated to whoever runs the POC before it starts.

### 4. Scorecard thresholds

**❌ Not yet possible — awaiting Dave's approval.**
`docs/08-candidate-scoring.md` defines the scoring model itself (deterministic
mandatory gates, weighted scoring, evidence confidence, completeness — all
implemented per `docs/build-phase-7-report.md`) and is code-complete.
`docs/14-poc-specification.md` §14.14 lists the specific numeric POC
defaults proposed for this benchmark — 90% minimum match score to enter
ranked consideration, max 3 shortlisted candidates per role, 100%
mandatory-gate compliance, zero unsupported evidence claims — but **every
one of these is explicitly marked "configurable... requires client
approval," not yet agreed** by the document's own text. §14.14's own note
on the 90% figure is explicit that reusing Dave's number is "a pragmatic,
revisable choice... not a calibration claim," not evidence the platform's
and Dave's methodologies are equivalent. **This item cannot move past ❌
until Dave explicitly signs off on these specific numbers** — nothing in
this sandbox can make that decision on the user's behalf.

### 5. Candidate data permissions

**✅ Verified in code/locally.** `docs/06-roles-permissions.md` §6.2.3/
§6.2.4 defines the client-visibility boundary concretely:
`candidate_project_entries.client_visible` gates whether a Client
Decision-Maker can see a candidate at all (auto-set at `shortlisted`, or
explicit early share by a recruiter/admin); `candidate_documents` (raw CVs)
are unconditionally invisible to that role under any circumstance; contact
masking and `recruiter_notes` omission are enforced at the application
layer (`apps/web/lib/candidates/visibility.ts`), applied identically by
every screen rather than left per-call-site, specifically because RLS alone
cannot redact a single column. §6.3 confirms the boundary as Core Principle
#12 and lists exactly what a Client Decision-Maker must never see (other
non-shortlisted candidates, internal notes/override reasons/scoring
weights, other clients' projects, pricing/billing).

`docs/privacy-review.md` §5 independently re-checked the web shortlist
detail page's actual render conditional (`page.tsx:91`,
`canManageInternally = hasPermission(..., 'update')`) and the mobile
Phase-13 equivalents that an earlier wave's file list had not covered, and
found (then fixed) a real leak: mobile shortlist screens were exposing
internal recruiter notes to a client-facing screen with no role gate — this
is now fixed (`shortlist-data.ts`, `FinalShortlistScreen.tsx`,
`CandidateComparisonScreen.tsx`). `docs/release-readiness.md` Part A step 15
re-confirmed the fixed web conditional directly in code, a second
independent read.

### 6. AI configuration

**❌ Not yet possible.** Stated plainly: **no live Anthropic API key has
ever been used anywhere in this project's history.** `anthropicConfigured`
is `false` in every environment that has existed in this sandbox
(`docs/release-readiness.md` §(b) item 2, `docs/staging-release-report.md`
§2). Every AI feature — requirement extraction, CV parsing, candidate
matching's semantic-similarity layer, outreach drafting, the recruiter
copilot — will show a "not configured" / deterministic-fallback state
(`not_configured`, no thrown exception, per `docs/release-readiness.md`
Part A step 5) until a real `ANTHROPIC_API_KEY` is set on whatever
environment the POC actually runs on. This is not a code gap; it is
credential provisioning the user must do once real infrastructure exists
(`docs/staging-release-report.md` §4/§5).

### 7. Outreach accounts

**❌ Not yet possible — blocked on an unresolved client question.**
`docs/18-blocking-questions.md` Q-P1-01: _"Whose LinkedIn/Apollo/outreach
accounts will be used — client-owned or agency-owned?"_ — asked directly in
the discovery call and left unanswered (MOM §8). The document's own text is
explicit that this **blocks the POC's outreach step**
(`docs/14-poc-specification.md` §14.7) and recommends a default
(client-owned accounts, agency operating on the client's behalf under
documented authorization) but that default has not been confirmed by Dave.
**Outreach in the POC cannot proceed until this question is answered** —
this is a business decision, not something this codebase can resolve.

### 8. Notifications

**⚠️ Partially ready.** In-app notifications are fully built: the
`notifications` table (migration `0032`) is own-recipient-scoped by RLS,
append-only except `read_at` (enforced by a database trigger,
`notifications_read_only_mutation`), and `markNotificationReadAction`
additionally re-scopes to `recipient_user_id = auth.uid()` as
belt-and-suspenders even though RLS already enforces it
(`docs/06-roles-permissions.md` §6.2.9). This part works without any
external credential.

**Email delivery does not** — it requires a live `RESEND_API_KEY` on
whatever environment the POC runs on; unset, outreach/notification email
sending runs in a safe/dev-adapter mode rather than actually sending
(`docs/staging-release-report.md` §4). No Resend key has ever been
configured in this project's history.

### 9. Audit logs

**✅ Verified in code/locally.** `docs/release-readiness.md` Part A step 17
cross-referenced the `AuditAction` closed type union against every one of
the 17 traced journey steps and confirmed each major action — sign-in/out,
client/project/JD/requirement/scorecard/candidate/document-processing/
matching/gate-override/review-decision/shortlist/client-decision/outreach/
response/POC actions — has a dedicated `logAuditEvent(...)` call at its own
write site, read directly from the code, not inferred from the type union
alone. Read-path scoping was independently re-verified against migration
`0034`: org-wide read for `agency_admin`/`read_only_reviewer`/
`platform_admin`, narrowed to `actor_id = auth.uid()` for `recruiter` —
matching `docs/06-roles-permissions.md`'s documented design, and fixing the
org-wide-for-everyone bug `docs/privacy-review.md` §7 found and fixed in
this same phase.

### 10. Metrics

**⚠️ Partially ready.** `docs/14-poc-specification.md` §14.10–§14.13
defines the metrics the POC needs: speed (wall-clock hours to shortlist-ready
per side, §14.10), evidence requirements (§14.11), candidate-progression
funnel — sourced → passed gates → reached ranked pool → shortlisted, for
both sides (§14.13) — and §14.14's acceptance-criteria defaults tie back
into these. The underlying data model and comparison report exist in code:
`docs/release-readiness.md` Part A step 16 confirmed
`apps/web/lib/poc/compare-benchmark.ts`'s causation disclaimer is real,
non-empty, unit-tested, and actually rendered by
`poc-comparison-report.tsx`, not merely defined.

Honestly: **the POC report screen has never been exercised against real
data.** No live matching run has ever occurred in this sandbox (no live
Anthropic key — see item 6), and `docs/performance-report.md` §8 confirms
the standalone Dashboard/POC-Comparison pages currently render only typed
`DEMO_*` mock fixtures with no live query path at all. The metrics
_definitions_ and the _reporting code_ are ready; whether the report reads
correctly against a real, populated matching run has not been checked
because no such run has ever happened.

### 11. Backups

**❌ Not yet possible.** Stated plainly: this is a Supabase-project-level
setting (point-in-time recovery / backup schedule), configured once in the
Supabase dashboard for whichever project the POC runs against. **Nothing in
this codebase configures, checks, or verifies backups** — there is no
migration, script, or CI step in this repository that touches Supabase's
backup configuration, and none should be inferred to exist. This is purely
an infrastructure setting the user configures directly once a real staging
or production Supabase project exists (`docs/staging-release-report.md`
§5 step 1).

### 12. Monitoring

**⚠️ Partially ready.** `docs/monitoring-runbook.md` documents 9 wired
failure surfaces (application errors, API failures, background-job
failures, AI failures, AI cost, authentication anomalies, integration
failures, performance, audit-event failures), all routed through a single
shared, PII-safe `apps/web/lib/monitoring/capture.ts` helper
(`captureError`/`captureMonitoringMessage`/`captureBusinessMetric`), gated
on `sentryConfigured`, and exercised by this repo's automated tests with
the SDK mocked. `@sentry/nextjs`'s wiring was checked against the exact
pinned SDK version's own `build/types`/`package.json`, not assumed.

Honestly: **zero real events have ever been captured.** No `SENTRY_DSN` or
`NEXT_PUBLIC_SENTRY_DSN` has ever been set anywhere in this project's
history, and no Sentry project has ever been created
(`docs/monitoring-runbook.md`'s own "Honest status" section). The code is
correct against the SDK's documented API; whether it actually reports a
real error to a real Sentry project has never been observed and must be
confirmed (send one test event) before relying on it during the POC.

### 13. Support contacts

**❌ Not yet possible — an open item for the user, not a code feature.**
Stated plainly: no support-ticketing system is built anywhere in this
platform, and none should be invented here. Who the recruiter/client
contact for a POC-time issue (a broken screen, a confusing result, an
urgent question) is a business/operational decision for the agency to make
— this is listed as an open item for the user to decide before the POC
starts, not something this document resolves on the user's behalf.

### 14. Rollback

**✅ Verified in code/locally — never executed live.**
`docs/rollback-runbook.md` documents a real, code-complete procedure:
deploy identification via git tags (`staging-<UTC timestamp>-<short SHA>`),
the deployed build's own `NEXT_PUBLIC_BUILD_SHA`/`NEXT_PUBLIC_RELEASE_TAG`
identity plumbing, the Vercel dashboard, and the GitHub Actions job summary
as cross-checkable sources of "what is live right now," plus §3's explicit
statement that Postgres migrations in this codebase are additive-only by
convention (no per-migration `down.sql`) — a bad migration is corrected
forward, not rolled back. The procedure itself exists and is internally
consistent.

Honestly, per the runbook's own opening line: **nothing in this document
has been exercised against a real deployment** — no Vercel account,
Supabase project, or staging deploy has ever existed in this environment.
The runbook is a sound, ready-to-follow procedure; it has never been
rehearsed.

### 15. Data retention

**❌ Not yet possible — an undecided business/legal question.**
`docs/release-readiness.md` §(a) item 2 states this directly: **no
retention-period concept exists anywhere in the schema** — confirmed by
grep across the codebase for `retention_days`, a scheduled purge, or any
`archived_at`-based expiry, none of which exist
(`docs/privacy-review.md` §2). `docs/12-security-compliance.md` §12.8
already flagged `[CLIENT CONFIRM] No retention period was specified by the
client` and recommended a 24-month default as a starting point, but a
recommendation is not a decision, and `docs/18-blocking-questions.md`
Q-P1-04 lists this as unresolved. This is explicitly **not resolved by this
or any prior phase** — it requires the client to specify a period, and
`docs/privacy-review.md` §2/§8 additionally flags that even once a period is
chosen, the _automated enforcement mechanism_ for it (a scheduled purge)
still does not exist in code and would be separate future work.

---

## Part A — Summary counts

15 items total.

| Status                  | Count | Items                                                                                                                             |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| **✅ Verified**         | 4     | Users and roles · Candidate data permissions · Audit logs · Rollback (code-complete, never executed live — see item's own caveat) |
| **⚠️ Partially ready**  | 5     | Tenant isolation · Job descriptions · Notifications · Metrics · Monitoring                                                        |
| **❌ Not yet possible** | 6     | Scorecard thresholds · AI configuration · Outreach accounts · Backups · Support contacts · Data retention                         |

No item above is marked ✅ without a specific code file, migration, or
already-completed review document cited as the basis for that verification.

---

## Part B — What this phase produced

This document is the sixth artifact of Build Phase 16
("Preparation for the two-role client POC"), written alongside five others
being produced by parallel waves of this same phase. They may not all exist
in the Project yet at the time this document is written — referenced here
by name/path rather than blocked on:

1. `docs/poc-launch-plan.md`
2. `docs/poc-success-scorecard.md`
3. `docs/poc-operating-procedure.md`
4. `docs/user-training-guide.md`
5. `docs/demo-script.md`
6. **`docs/poc-launch-checklist.md`** — this document.

---

Related documents: [[staging-release-report]] · [[release-readiness]] ·
[[security-review]] · [[privacy-review]] · [[accessibility-report]] ·
[[performance-report]] · [[06-roles-permissions]] · [[08-candidate-scoring]]
· [[14-poc-specification]] · [[18-blocking-questions]] ·
[[monitoring-runbook]] · [[rollback-runbook]] · [[uat-plan]] ·
[[uat-results-template]]
