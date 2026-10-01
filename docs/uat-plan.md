# UAT Plan — Recruitment Quality Intelligence (Staging)

Build Phase 15 (Staging Deployment Preparation), Wave 4. **Documentation
only** — no code changed to produce this plan. It is written for human
testers with a browser, run against a real, freshly-seeded staging
deployment once one exists. Nothing in this document has been executed —
no staging environment exists in this development sandbox (see
`docs/staging-deployment.md` and `docs/release-readiness.md` for that
honestly-stated limitation).

Every screen name, route, role capability, and seeded data reference below
is grounded directly in this codebase: `packages/types/src/permissions.ts`
(the real permission matrix), `docs/03-screen-inventory.md` (the real,
build-phase-annotated screen list), `docs/release-readiness.md` (the traced
17-step journey), and `apps/web/scripts/seed-staging.ts` (the actual seeded
demo data). Where the original Stitch-derived screen inventory describes
something that was descoped, consolidated, or built differently, this plan
follows what was actually built, not the original aspiration — each such
case is called out inline.

---

## 1. Setup

### 1.1 Accessing staging

1. Get the staging URL from whoever ran the `Staging Deploy` GitHub Actions
   workflow (`docs/staging-deployment.md` §10) — a placeholder such as
   `https://staging-rqi.example.com` or a Vercel-assigned domain. This plan
   never invents a real URL; ask your facilitator for it.
2. If the deployment has Basic Auth enabled (`docs/staging-deployment.md`
   §7 — `STAGING_BASIC_AUTH_USER`/`STAGING_BASIC_AUTH_PASSWORD`), your
   browser will show an HTTP credential prompt before the app loads at all.
   Get these shared credentials from your facilitator out of band (never
   committed to this repo). This prompt is a coarse gate to keep the
   staging URL off search engines and random visitors — it is **not** your
   sign-in. After it, you still sign in with a real Supabase Auth account
   (§1.2) to see any tenant data.
3. Confirm you can see the non-production banner at the top of the page
   (present when `NEXT_PUBLIC_ENVIRONMENT_NAME=staging` is set, per Wave 2)
   before doing anything else. If you don't see it, stop and tell your
   facilitator — you may be looking at the wrong environment.

### 1.2 Seeded demo accounts

Staging is seeded by `apps/web/scripts/seed-staging.ts`, under one
organization: **"Meridian Retail Partners (Staging Demo)"**. It creates
exactly four users, one per role:

| Role (matrix name)    | Seeded email                             | Notes                                                     |
| --------------------- | ---------------------------------------- | --------------------------------------------------------- |
| Agency admin          | `admin@staging-demo.rqi.local`           | Full internal administrative access                       |
| Recruiter             | `recruiter@staging-demo.rqi.local`       | Assigned as lead recruiter on the one seeded project      |
| Client decision-maker | `client-reviewer@staging-demo.rqi.local` | Scoped to the seeded client, "Fictional Meridian Mart Co" |
| Read-only reviewer    | `read-only@staging-demo.rqi.local`       | Org-wide read access, no write/approve anywhere           |

**Passwords are never printed or persisted by the seed script** (see the
script's own final log line). Your facilitator must set a known password
for each account via Supabase Auth's admin password-reset, or you use
"Forgot password" from the sign-in screen for each seeded email. This plan
does not — and cannot — supply credentials; get them from your
facilitator.

There is a separate, distinct seed script (`apps/web/scripts/seed.ts`) used
for local/dev seeding with the same four roles but a different email
domain — if you ever see accounts that aren't `@staging-demo.rqi.local`,
you may be looking at dev seed data, not the staging seed; flag it.

### 1.3 What's already in the seeded org

One client, one recruitment project, one job, one scorecard, seven
candidates — all synthetic:

- **Client:** "Fictional Meridian Mart Co" (Retail)
- **Project / Job:** role title **"Retail Store Manager"**, status
  `sourcing`, target shortlist size 3, match threshold 70. Job description
  is already pasted and parsed (`status: parsed`) — not uploaded as a file.
  The scorecard exists in `draft` status with its requirements already
  populated (marked `reviewed`, not yet approved).
- **Seven candidates**, each a named fixture with a distinct scenario and
  starting pipeline stage:

  | Candidate name      | Scenario               | Seeded pipeline stage |
  | ------------------- | ---------------------- | --------------------- |
  | Alex Testworthy     | clear pass             | Shortlisted           |
  | Jordan Failwright   | clear fail             | Rejected              |
  | Casey Ambiguous     | borderline             | Quality review        |
  | Morgan Unverified   | missing information    | Eligibility check     |
  | Taylor Injectionova | prompt injection probe | Quality review        |
  | Alex Prestige       | bias probe (A)         | Quality review        |
  | Jamie Regional      | bias probe (B)         | Quality review        |

  **Important:** the seed script deliberately does **not** write gate
  results, match scores, or scoring breakdowns for these candidates (see
  the script's own header comment) — those tables encode the platform's
  "evidence before scoring" guarantee and are only trustworthy when
  produced by the real matching pipeline, not hand-seeded. So a fresh
  staging environment shows these candidates at their seeded pipeline
  stage with **no gate/score data yet** — the Recruiter script below (§3)
  is what actually runs the pipeline against them and produces real gate
  and score results. Do not report "no score visible" on a just-seeded
  candidate as a bug; that is expected until a recruiter runs matching
  (Recruiter script, step 6).

### 1.4 This is synthetic data — read before you start

Every seeded name, email, and CV is fictional demonstration data, generated
for this project's own test fixtures (`lib/ai/eval-fixtures/`). **Never
enter real candidate, client, or contact PII into this staging
environment** — it exists to validate the platform, not to process real
recruitment work. If AI features are live on this staging deployment (an
Anthropic key was configured — check for a "not configured" message before
assuming otherwise), keep every input you type synthetic too.

### 1.5 Mobile

A subset of steps below are marked **(mobile)** or **(web+mobile)**. Per
Build Phase 13's own scope, the Expo mobile app is "primarily for
monitoring, reviewing, verifying, approving, shortlisting, client
decisions" — complex administration (org/user management, integrations,
scorecard building, JD upload) is web-only. Steps not marked mobile are
web-only by design, not a gap.

---

## 2. Role script — Agency Admin

Full administrative scope. 14 steps.

1. Sign in at the staging URL as `admin@staging-demo.rqi.local`. **Expected:** lands on the Home dashboard, not a sign-in loop or blank page.
2. Open **Settings → Integrations**. **Expected:** every provider (Apollo, calendar, email, TA Tracker) is listed with real connection status/mode — TA Tracker should show as a permanently-stubbed/not-available integration, not a working one (this is intentional, not a bug — see §5).
3. From Integrations, attempt to connect or disconnect a provider. **Expected:** the action is available (agency admin has full access here) and either succeeds or shows an honest "not configured" state if no staging credentials were set for that provider.
4. Open **Settings → User & role management** (or the org's user list). **Expected:** all four seeded users are visible with correct roles.
5. Open the seeded **"Retail Store Manager"** project. **Expected:** full visibility into the JD, requirements, scorecard, and candidate pipeline — same as a recruiter would see.
6. On the scorecard, attempt to **approve** the scorecard version (recruiter drafted requirements are already `reviewed`). **Expected:** agency admin can approve/lock the scorecard.
7. Open the **Candidates** roster (global, cross-project). **Expected:** all seven seeded candidates visible.
8. Open **Analytics**. **Expected:** a dashboard loads (pipeline throughput / gate-fail rate style metrics), even if numbers are near-zero on a fresh seed.
9. Open the **Audit log**. **Expected:** entries exist for at least your own sign-in and any action you just took (e.g. the scorecard approval in step 6) — org-wide, not just your own actions (agency admin gets org-wide audit read, unlike recruiter).
10. Open **POC / benchmark report** for the seeded project (`is_poc: true`). **Expected:** a POC report screen loads; it may show "not enough data yet" honestly rather than fabricated metrics, since no matching run has happened yet on a fresh seed.
11. **Expected-denial check:** open **Billing**. Confirm it is visible and editable (agency admin has full billing access) — this is a positive-access check, included here because billing is one of few resources where agency admin, not platform admin, holds full control.
12. **Cross-tenant isolation check — not exercisable against current seed data.** The seed script creates exactly one organization ("Meridian Retail Partners (Staging Demo)"). There is no second seeded org to attempt cross-tenant access against on a fresh staging deployment. Mark this check **N/A** rather than inventing an unfollowable step; if a second demo org is ever seeded, this script should be extended with a real cross-org URL-manipulation attempt.
13. Sign out. **Expected:** returns cleanly to the sign-in screen.
14. **(mobile)** Repeat steps 1 and 7 (sign in, view candidates) on the mobile app if available for this role. Note: full admin actions (integrations, billing, user management) are web-only by design (Build Phase 13 scope) — do not report their absence on mobile as a bug.

---

## 3. Role script — Recruiter

The core day-to-day workflow. This is the longest script, since it is most
of the platform's real work. 17 steps.

1. Sign in as `recruiter@staging-demo.rqi.local`. **Expected:** Home dashboard shows the seeded "Retail Store Manager" project (you are the assigned lead recruiter).
2. Open the project. **Expected:** the project workspace loads with tabs/sections for JD, requirements, scorecard, and candidate pipeline.
3. Open the **Job description** section. **Expected:** the pasted JD text for "Retail Store Manager" is visible, status `parsed`.
4. **Known limitation, not a bug to report:** if you try uploading a new JD file (PDF/DOCX) instead of pasting text, expect the upload to save but show a "text extraction is not yet available in this environment" message and remain in `draft` status — it will not proceed to requirement extraction. Only the paste-JD path is fully wired end to end today (see §5).
5. Open **Requirement extraction review**. **Expected:** the requirements list from `RETAIL_STORE_MANAGER_JOB` is visible, already marked `reviewed`. Try editing or adding a requirement. **Expected:** edits save and are reflected in the scorecard builder.
6. Open the **Scorecard builder**. **Expected:** weighted criteria and mandatory gates are visible matching the requirements. Submit the scorecard for approval (if not already approved by an agency admin in the Agency Admin script). **Expected-denial check:** attempt to approve your own submitted scorecard as recruiter. **Expected:** approval is not available to you — only agency admin can approve (`scorecards` matrix: recruiter = full minus approve; approval is agency-admin only).
7. Open the **Candidate pipeline board** for this project. **Expected:** all seven seeded candidates appear, each at its seeded stage (§1.3 table).
8. Open **Alex Testworthy**'s candidate profile (clear-pass fixture). **Expected:** profile loads with CV/document data already present from seeding.
9. From the candidate's document section, trigger **CV parsing** (document processing) if not already processed. **Expected:** a processing job runs (may take a moment) and produces extracted fields.
10. Review the extracted fields. **Expected:** each field shows a verification status (pending/verified/edited/rejected) — nothing is silently auto-applied. Verify or edit at least one field, then use "Accept all verified fields" (or equivalent). **Expected:** only verified/edited fields are applied to the candidate's real record; a rejected or still-pending field is never applied.
11. Trigger a **matching evaluation** run for Alex Testworthy against the "Retail Store Manager" scorecard. **Expected:** the run completes and produces mandatory gate results plus an overall match score.
12. Open the **mandatory gate results / evaluation** view. **Expected:** each mandatory requirement shows pass/fail with a linked evidence reference — no gate shows "pass" with zero evidence (this is deterministic, not model-decided: zero evidence always resolves to "insufficient evidence").
13. Repeat matching evaluation for **Jordan Failwright** (clear-fail fixture). **Expected:** at least one mandatory gate fails, and the candidate cannot be added to a shortlist (see step 15's expected-denial).
14. Open **Quality review / score override** for **Casey Ambiguous** (borderline fixture). Record a human review decision (approve, request more evidence, or override a gate with a reason). **Expected:** an override requires a reason and is recorded with an audit entry; overriding one gate does not silently flip the candidate's overall eligibility if another gate is still failing.
15. **Expected-denial check:** attempt to add **Jordan Failwright** (failed-gate candidate) to a shortlist. **Expected:** the system blocks this at the application layer with a clear message — a candidate who fails a mandatory requirement cannot enter the ranked shortlist (Core Business Rule #6).
16. Open **Outreach composer** for a passing/eligible candidate (e.g. Alex Testworthy). Draft an outreach message, review the AI-suggested personalization evidence, and **approve** it before it sends. **Expected:** nothing sends without your explicit approval action; any evidence citation not actually backed by the candidate's verified data is stripped from the draft, not shown as evidence-backed.
17. Create a **shortlist** for the project, adding 2–3 eligible (gate-passing) candidates. **Expected:** the shortlist enforces a soft cap around 2–3 candidates and only accepts eligible candidates (re-confirms step 15's rule from the shortlist-creation side).

---

## 4. Role script — Client Decision-Maker

The brief's "client reviewer" is this role's real matrix name:
`client_decision_maker`. Client-side view only. 8 steps.

1. Sign in as `client-reviewer@staging-demo.rqi.local`. **Expected:** lands on a scoped dashboard/home — no admin navigation items, no access to other clients' data.
2. Open **Shortlists**. **Expected:** only shortlists for "Fictional Meridian Mart Co" (the seeded client this account is scoped to) are visible — if the recruiter script above (§3 step 17) created one, it should appear here once submitted for client review.
3. Open a shortlist's detail (the Verification Matrix / Finalist Comparison view). **Expected:** candidate cards show score, gates passed, evidence %, completeness %, and the recruiter's note — but **not** internal-only recruiter notes. This is a real, previously-tested security property (Build Phase 14 privacy review): visually confirm it holds live, not just trust that it was unit-tested.
4. **Expected-denial check:** confirm there is no "Continue"/edit/build action on this screen — client decision-maker gets a read-only variant of this screen; only `approve`-level actions (accept/discuss/reject) are available, never `create`/`update`.
5. Record a decision on the shortlist: **accept**, **discuss**, or **reject**, with a comment. **Expected:** the decision saves and is reflected in the shortlist's status.
6. **Expected-denial check:** attempt to navigate directly to the scorecard builder or requirement extraction review URLs for this project (e.g. by editing the URL). **Expected:** access is denied or the page renders a permission-denied state — `scorecards` access for this role is `none`.
7. **Expected-denial check:** attempt to view a different, non-shortlisted candidate's full profile (one still in earlier pipeline stages, e.g. Casey Ambiguous). **Expected:** either not visible at all or visible only in a restricted read form appropriate to `candidate_records: read` — no internal recruiter notes or non-shortlisted-candidate detail should leak through.
8. **(mobile)** Sign in on the mobile app and repeat steps 2–5 (view shortlist, confirm no internal notes, record a decision) — this is one of the flows Build Phase 13's mobile app explicitly supports.

---

## 5. Role script — Read-Only Reviewer

Confirm broad read access with **no** write/approve action anywhere. 9
steps, deliberately including a few "does a write-shaped control even
render" probes.

1. Sign in as `read-only@staging-demo.rqi.local`. **Expected:** lands on Home dashboard with broad visibility (org-wide read on most resources per the matrix).
2. Open the "Retail Store Manager" project, its JD, requirements, and scorecard. **Expected:** all visible, read-only.
3. Open the candidate pipeline and a candidate profile (e.g. Alex Testworthy), including evidence detail and gate results. **Expected:** fully visible.
4. **Expected-denial probe:** on the candidate's evaluation/quality-review view, check whether an override/approve button renders at all. **Expected:** it does not render (this codebase's pattern is `{canX && <Button>}` — absent, not merely disabled).
5. **Expected-denial probe:** on the outreach section, check whether a "draft"/"approve" outreach action renders. **Expected:** none does — `outreach: none` for this role.
6. **Expected-denial probe:** on a shortlist, check whether any accept/reject/continue action renders. **Expected:** read-only view only.
7. Open the **Audit log**. **Expected:** visible (this role has `audit_logs: read`).
8. Open **Notifications**. **Expected:** own notifications visible and markable as read (`notifications: full` for this role covers read + mark-read, not arbitrary create/delete — the DB layer narrows what "full" can mean here to exactly that).
9. **Expected-denial check:** attempt to reach Billing or Integrations-connect actions directly by URL. **Expected:** denied or read-only-with-no-actions (`billing: none`, `integrations: read`).

---

## 6. Complete two-role POC journey

A single combined script spanning the recruiter and client_decision_maker
roles handing off to each other, mirroring the platform's Core Business
Rule flow and the 17-step trace in `docs/release-readiness.md`. Run this
as one continuous narrative — two testers (one per role), or one tester
switching accounts at the marked handoff. Ends at "view POC result" and
"inspect audit trail," per the original canonical 17-step journey.

**Facilitator note:** steps 1–3 (create client/project) can be skipped if
you use the already-seeded client/project instead — this script shows both
so it also demonstrates admin-created data, not only seeded data. If time
is short, start at step 4 using the seeded "Retail Store Manager" project.

1. **(Recruiter)** Sign in. Create a new client (or use the seeded "Fictional Meridian Mart Co").
2. **(Recruiter)** Create a new recruitment project under that client (or use the seeded "Retail Store Manager" project).
3. **(Recruiter)** Paste a job description (use the seeded JD text, or paste your own synthetic text — never a real JD with real employer specifics). **Expected:** status becomes `parsed`.
4. **(Recruiter)** Run requirement extraction. **Expected:** proposed requirements appear for review.
5. **(Recruiter)** Review/edit the extracted requirements, then build and submit the scorecard for approval.
6. **(Agency Admin — handoff)** Sign in as agency admin. Approve the scorecard version. **Expected:** scorecard status becomes `active`; the requirement snapshot is now frozen.
7. **(Recruiter — handoff back)** Add at least two candidates (use two of the seven seeded fixtures, e.g. Alex Testworthy and Casey Ambiguous, or add a new synthetic candidate).
8. **(Recruiter)** Parse each candidate's CV, review extracted fields, and accept verified fields.
9. **(Recruiter)** Run matching evaluation for each candidate. **Expected:** mandatory gate results and an overall score are produced for each.
10. **(Recruiter)** Review gate results. Confirm at least one candidate passes all mandatory gates and is eligible; for a deliberately failing candidate (e.g. Jordan Failwright), confirm it is marked ineligible.
11. **(Recruiter)** Record a human review decision for at least one borderline/reviewed candidate, with a reason if overriding anything.
12. **(Recruiter)** Draft outreach for an eligible candidate, review the evidence-grounded draft, and approve it.
13. **(Recruiter)** Record a candidate response (simulate one — manual/channel response entry) and classify it.
14. **(Recruiter)** Create a shortlist with 2–3 eligible candidates. **Expected:** attempting to add an ineligible (failed-gate) candidate is blocked.
15. **(Recruiter)** Submit the shortlist for client review.
16. **(Client Decision-Maker — handoff)** Sign in as the client reviewer. Open the shortlist. **Expected:** sees candidate cards with score/gates/evidence%, no internal recruiter notes.
17. **(Client Decision-Maker)** Record a decision (accept, discuss, or reject) on the shortlist, with a comment.
18. **(Agency Admin or Recruiter)** Open the **POC / benchmark report** for this project (it is seeded/created as `is_poc: true`). **Expected:** the report renders real captured metrics from the run above (score, gates passed, evidence %), plus the platform's correlation-not-causation disclaimer text — not a claim of a benchmark comparison that wasn't actually run.
19. **(Agency Admin)** Open the **Audit log** and filter to this project. **Expected:** a distinct, correctly-attributed audit entry exists for every major step above — client/project creation, JD paste, requirement extraction, scorecard submit/approve, candidate add, document processing, matching run, review decision, outreach approve, response recorded, shortlist create/submit, and client decision. This is the "full audit trail replay" check — confirm nothing in the journey happened invisibly.

---

## 7. UAT issue format

Use this exact template for every bug found. Copy it into
`docs/uat-results-template.md`'s per-bug section, or your own tracker.

```
Test ID: <role-script-abbrev>-<step-number>, e.g. REC-11
User role: <agency_admin | recruiter | client_decision_maker | read_only_reviewer>
Preconditions: <what state the seeded/created data was in before this step>
Steps: <exact click-through steps you took, numbered>
Expected result: <what this plan said should happen>
Actual result: <what actually happened>
Evidence: <screenshot filename/link, or a copied error message>
Severity: <Critical | High | Medium | Low>
Owner: <unassigned until triaged>
Status: <Open | In Progress | Fixed | Won't Fix | Deferred>
```

### Field guide

- **Test ID** — a short prefix for the script (`ADM` agency admin, `REC`
  recruiter, `CLI` client decision-maker, `RO` read-only reviewer, `POC`
  the combined journey) plus the step number it came from, so a failure
  traces straight back to this plan.
- **Severity** — reuse the same scale used across every Phase 14 review
  document for consistency:
  - **Critical** — crosses a tenant/security boundary, or a candidate that
    should have been blocked by a mandatory gate reaches the ranked
    shortlist (Core Business Rule #6 broken).
  - **High** — a role can do something its permission level should forbid
    (a real permission-matrix violation, not an expected-denial check
    passing), or a core workflow step is broken/unreachable.
  - **Medium** — a real defect with a workaround, or a data-correctness
    issue that doesn't cross a permission boundary.
  - **Low** — cosmetic, copy, or a minor inconsistency with no functional
    impact.
- **Status** — `Open` (new, untriaged) → `In Progress` (someone is working
  it) → `Fixed` (resolved and verified) / `Won't Fix` (accepted, won't be
  addressed) / `Deferred` (real, but scheduled for a later phase).

---

## 8. Known, already-disclosed gaps — not new UAT bugs

These are real, intentional, or previously-documented limitations of the
current build. Testers hitting these should **not** file a new bug — check
this list first.

1. **Uploaded JD file (PDF/DOCX) text extraction is not wired.** Uploading
   a JD file saves it with `status: draft` and an honest "text extraction
   is not yet available in this environment" message; it never reaches
   requirement extraction. **Only the paste-JD path works end to end.**
   (`docs/release-readiness.md` step 4; known since Build Phase 3.)
2. **TA Tracker integration is permanently stubbed.** It will never show a
   working connection or sync real data in this environment — this is a
   deliberate scope decision (the project brief explicitly says "do not
   invent a TA Tracker API"), not a bug.
3. **No live AI, Resend, or Apollo credentials may exist on this staging
   deployment**, depending on what was configured when it was set up
   (`docs/staging-deployment.md` §3). If so, the copilot, outreach email
   send, and Apollo sourcing will show their own honest "not configured" /
   safe-mode states rather than functioning live — check with your
   facilitator whether these were configured for this UAT round before
   reporting them as broken.
4. **Fresh-seeded candidates have no gate/score data until a recruiter runs
   matching.** The seed script deliberately does not hand-write
   `candidate_role_matches`/`mandatory_gate_results` rows (see §1.3). A
   candidate showing no score immediately after seeding is expected, not a
   bug — run the Recruiter script's matching-evaluation step first.
5. **No dedicated "decision history" screen for shortlists.** History is
   readable via the underlying activity/decision records but has no
   history-specific page yet — a known, flagged Build Phase 9+ candidate,
   not a regression.
6. **`CandidateProfileScreen` on mobile is a stub** (typed, wired into
   navigation, no real content) — it was outside Build Phase 13's explicit
   16-screen scope. Do not report it as broken; report only if it crashes
   rather than showing a stub.
7. **No real device/browser/assistive-technology testing has ever been
   done on this build** prior to this UAT round — the accessibility work
   to date is a static/code-level audit only. Genuine accessibility issues
   found live during UAT (screen reader, keyboard-only navigation, real
   color contrast) are valuable new findings, not something to skip.
8. **Cross-tenant isolation cannot be tested against the current seed
   data** — only one organization exists in the staging seed. This is
   noted, not swept under the rug, in the Agency Admin script (§2 step 12).

---

Related documents: [[uat-results-template]] · [[release-readiness]] ·
[[03-screen-inventory]] · [[06-roles-permissions]] · [[staging-deployment]] ·
[[16-testing-strategy]]
