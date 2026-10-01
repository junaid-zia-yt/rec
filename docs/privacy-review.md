# Privacy Review — Build Phase 14 (Security Hardening and Release Candidate), Wave 3

Date: 2026-09-28
Scope: a GDPR/CCPA-style data-protection review of candidate PII handling across the web app (`apps/web`), mobile app (`apps/mobile`), shared types (`packages/types`), and the database schema (`supabase/migrations/0001`–`0033`, plus this wave's `0034`). Recruitment Quality Intelligence is a **processor**; the recruitment agency (tenant organization) is the **controller** for candidate data.

Builds on, and does not re-litigate, two prior Build Phase 14 waves:

- **docs/security-review.md** (Wave 1) — full security audit; fixed the `ai_prompt_versions` RLS gap; confirmed RLS/multi-tenant isolation and client-reviewer restriction generally hold (its §5 finding is cited and extended here, not redone).
- **docs/ai-evaluation-report.md** / **docs/accessibility-report.md** (Wave 2).

Method: read-through of docs/07-data-model.md, docs/12-security-compliance.md, every `supabase/migrations/*` file for consent/retention/deletion/export-related schema, `apps/web/lib/candidates/*`, `apps/web/lib/audit/*`, `apps/web/lib/ai/*`, `apps/web/lib/outreach/*`, `packages/types/src/index.ts`, `packages/types/src/permissions.ts`, and — going beyond the security wave's own scope — the mobile Build-Phase-13 shortlist/comparison screens' read paths, cross-checked against a from-scratch local Postgres rebuild of migrations `0001`–`0034` and the existing `pgverify` regression suite.

---

## Summary table

| #   | Area                                                                                                                                                                                                                            | Severity                                                  | Status                                                                                                                                                          | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Consent — no mechanism to _record_ consent                                                                                                                                                                                      | —                                                         | **No gap found** — structure already exists (`candidate_consents.consent_status/consent_recorded_at/consent_recorded_by`, Build Phase 5, `0021`)                | §1       |
| 1b  | Consent — what language/mechanism the agency uses to actually obtain it                                                                                                                                                         | Low (documentation)                                       | **Tracked-business-decision-needed**                                                                                                                            | §1       |
| 2   | Retention — no automated retention/purge mechanism at all                                                                                                                                                                       | Medium                                                    | **Tracked-out-of-scope** (not built this wave — see §2 for why)                                                                                                 | §2       |
| 2b  | Retention — the actual retention period                                                                                                                                                                                         | —                                                         | **Tracked-business-decision-needed** (already flagged docs/12-security-compliance.md §12.8)                                                                     | §2       |
| 3   | Erasure — no way to actually fulfill a recorded deletion request                                                                                                                                                                | **Critical** (before fix)                                 | **Fixed** — `erasePersonalDataAction` (migration `0034` + `apps/web/lib/candidates/privacy-actions.ts`)                                                         | §3       |
| 3b  | Erasure — append-only tables (`requirement_evidence`, `audit_events`, `communication_events`, `candidate_responses`) retain verbatim PII excerpts forever, by design                                                            | High                                                      | **Tracked-business-decision-needed** (genuinely cannot be fixed without a legal call — docs/12-security-compliance.md §12.9 already flagged this exact tension) | §3       |
| 3c  | Erasure — uploaded CV/document file bytes in Supabase Storage are not deleted                                                                                                                                                   | High                                                      | **Tracked-out-of-scope** (no storage-delete function exists in this codebase yet; disclosed honestly rather than silently gapped)                               | §3       |
| 3d  | Erasure — `candidate_extracted_fields.edited_value` cannot be redacted for `verification_status='edited'` rows without violating a CHECK constraint                                                                             | Low                                                       | **Tracked-out-of-scope**                                                                                                                                        | §3       |
| 4   | Export — no data-subject-access/portability export existed                                                                                                                                                                      | High                                                      | **Fixed** — `exportCandidateDataAction`                                                                                                                         | §4       |
| 5   | Internal-vs-client-visible notes — mobile shortlist read paths                                                                                                                                                                  | High                                                      | **Fixed** — `shortlist-data.ts`, `FinalShortlistScreen.tsx`, `CandidateComparisonScreen.tsx`                                                                    | §5       |
| 6   | AI-provider (Anthropic) data exposure — what's sent, data minimization, ToS confidence                                                                                                                                          | Low (already well-architected; documentation deliverable) | **Fixed** (documented here) + **Tracked-business-decision-needed** (confirm live Anthropic commercial terms)                                                    | §6       |
| 7   | Audit access — `audit_events` RLS granted org-wide read to recruiters, contradicting the documented "own actions only" design, exposing candidate PII (`before_json`/`after_json`) outside a recruiter's assigned-project scope | High                                                      | **Fixed** — migration `0034`, verified functionally against a rebuilt Postgres                                                                                  | §7       |
| 8   | Documentation requiring legal review                                                                                                                                                                                            | —                                                         | **Deliverable** (list below)                                                                                                                                    | §8       |

---

## 1. Candidate consent

**Structural mechanism: already exists, no gap.** `candidate_consents` (Build Phase 5, `supabase/migrations/0021_candidate_pipeline.sql:234-253`) has `consent_status` (`granted`/`withdrawn`/`unknown`), `consent_recorded_at`, `consent_recorded_by` — a real, queryable record of whether and when a candidate's data-processing consent was recorded, 1:1 per candidate, org-scoped RLS, never client-visible. This was built two build phases before this review and nothing about it needed fixing.

**What genuinely is a gap: nothing in this codebase captures _what the candidate was actually told_ or _how_ consent was obtained** (a consent notice, a checkbox on an application form, a verbal confirmation logged by a recruiter). That is a **business/legal decision** this review does not invent an answer to, per the project's own engineering rule ("Stop and report blockers when required credentials, business decisions or source data are missing"): what consent language to use, whether "legitimate interest" is a sufficient lawful basis instead of consent for a given jurisdiction (docs/12-security-compliance.md §12.7 already flags this as `[LEGAL]`), and whether the _mechanism_ should be a recruiter checkbox, a candidate-facing portal, or something else. **Tracked-business-decision-needed** — no code change proposed, since inventing consent language or a lawful-basis determination is explicitly out of bounds.

---

## 2. Retention controls

**No retention-period concept exists anywhere in this codebase** — confirmed by grep: no `retention_days`, no scheduled purge, no `archived_at`-based expiry on any candidate table. docs/12-security-compliance.md §12.8 already flagged this (`[CLIENT CONFIRM] No retention period was specified by the client`) and recommended a 24-month default, but recommending is not building.

**Judgment call, made explicitly rather than silently split:** building a genuinely safe, tested, _admin-configurable, default-off_ retention/auto-archive mechanism (a new `organizations.candidate_retention_days` column, a scheduled `background_jobs` job type that finds candidates past that threshold and calls the same `erasePersonalDataAction` logic, a migration, RLS, and end-to-end tests for the scheduling path) is a real, non-trivial vertical slice — not a one-line structural field like consent's timestamp columns. Attempting it in the remaining time budget of this wave risked shipping an under-tested background-job path touching every tenant's candidate data on a timer, which is a worse outcome than reporting the gap honestly. **This wave does not build retention automation.** It is **Tracked-out-of-scope** for a dedicated follow-up wave (recommended shape: reuse the existing `background_jobs` executor pattern from Build Phase 12, docs/07-data-model.md §7.13, and the exact same redaction logic `erasePersonalDataAction` already calls — `apps/web/lib/candidates/privacy.ts` — so the two paths never diverge).

**The retention _period_ itself remains, separately, a business/legal decision** — jurisdiction-dependent, and this review does not invent a number. **Tracked-business-decision-needed.**

---

## 3. Archive and deletion (erasure) workflows

### Before this wave

`archiveCandidateAction` (soft, non-destructive) and `requestCandidateDeletionAction` (records the request only) already existed (Build Phase 5). But docs/07-data-model.md §7.6 stated explicitly: _"Actually fulfilling a deletion request is deliberately left for a later, explicitly audited admin action once a data-retention policy exists... `candidates.deleted_at` exists in the schema but is reserved, never set by this phase's code."_ Confirmed by grep: no `exportCandidate*`, no `deleteCandidate*`, no `anonymizeCandidate*`, no `eraseCandidate*` action existed anywhere. **A data-subject erasure request had no way to actually be fulfilled — classified Critical**, matching this review's own rubric ("no way to ever delete a candidate's data on request").

### Fixed this wave

`erasePersonalDataAction` (`apps/web/lib/candidates/privacy-actions.ts`), backed by pure, unit-tested logic in `apps/web/lib/candidates/privacy.ts` (8 new tests, `privacy.test.ts`), following the established server-action template (Zod validation, `requirePermission('candidate_records', 'delete')` — the same permission level `archiveCandidateAction`/`requestCandidateDeletionAction` already use — an `audit_events` row, `revalidatePath`):

- **Gated on a prior recorded request** (`candidate_consents.deletion_requested = true`) — erasure is never a single, undiscussed action; it always follows `requestCandidateDeletionAction`.
- **Redacts** (in place, preserving referential integrity — every downstream FK from the deleted child tables is `ON DELETE SET NULL`, confirmed against `supabase/migrations/0027_candidate_matching.sql:269-273`):
  - `candidates`: `full_name` → `[erased]`, `primary_email`/`primary_phone` → null, `deleted_at` stamped (the reserved column from `0018`, finally set).
  - `candidate_profiles`: every free-text/PII column nulled (`current_title`, `current_company`, `summary`, `location`, `work_authorization`, compensation fields, `availability_notes`, `leadership_scope`, `pnl_responsibility`, `notice_period_days`, `workplace_preference`, `recruiter_notes`, `client_visible_notes`).
  - `candidate_contact_points`, `candidate_experiences`, `candidate_education`, `candidate_certifications`, `candidate_skills`, `candidate_sources` — deleted outright (several of these columns are `NOT NULL` with a non-empty `CHECK`, e.g. `candidate_experiences.company`, so in-place nulling isn't possible; deletion is safe because nothing downstream requires the row to survive).
  - `candidate_document_processing_jobs.extracted_text` and `candidate_extracted_fields.extracted_value`/`source_excerpt` — nulled (these are ordinary mutable columns, not append-only).
  - `candidate_consents.deletion_fulfilled_at`/`deletion_fulfilled_by` — new structural columns (migration `0034`) recording that fulfillment actually happened, distinct from the request.
- Logs `candidate.pii_erased` to `audit_events` with a metadata note naming exactly what was _not_ reached (see below) — never pretends completeness it doesn't have.

`exportCandidateDataAction` (same file) — a full JSON export of a candidate's own data (core identity, profile, contact points, experience/education/certification/skill history, document metadata, consent status, communication preferences, outreach message metadata, response classifications) for a data-subject access/portability request. Same permission gate as erasure (a full-PII export is at least as sensitive as an archive). Read-only, safe to call repeatedly, logs `candidate.data_exported`.

### What this fix does NOT reach — disclosed honestly, not glossed over

1. **Append-only audit/evidence tables retain verbatim excerpts forever.** `requirement_evidence.excerpt` (`REVOKE UPDATE, DELETE`, `0027`), `audit_events.before_json`/`after_json` (e.g. `candidate.created`'s `after_json` stores `fullName` — `apps/web/lib/candidates/actions.ts:183`), `communication_events.raw_payload` (`0029`), and `candidate_responses.raw_response_text` (`0029`) are all append-only **by deliberate design**, so that a scoring or audit history can never be silently altered — this is the same design docs/07-data-model.md §7.7/§7.9/§7.11 documents repeatedly and the security wave's §17 confirmed is correctly enforced. This module does not touch that design. **This is precisely the tension docs/12-security-compliance.md §12.9 already flagged for legal review** ("whether anonymized-audit-retention satisfies applicable deletion-right obligations... GDPR Art. 17, CCPA") — this review does not invent an answer. **Tracked-business-decision-needed.**
2. **The uploaded CV/document file itself, in Supabase Storage, is never deleted.** `apps/web/lib/files/storage.ts` has `uploadDocument`/`getSignedDocumentUrl`/`downloadDocumentBytes` — no delete/remove function exists anywhere in this codebase (confirmed by reading the file in full). The original CV PDF/DOCX very likely carries _more_ identifiable information than any extracted field. This is a real, significant gap, not a minor one — flagged prominently rather than silently left out. **Tracked-out-of-scope** for a follow-up wave: add a `deleteDocumentFile` function (Supabase Storage `.remove()` against the stored path) and wire it into `erasePersonalDataAction`, then mark the candidate's `candidate_documents` rows `status = 'rejected'`.
3. **`candidate_extracted_fields.edited_value`** cannot be nulled for rows where `verification_status = 'edited'` without violating `candidate_extracted_fields_edited_has_value` (a CHECK constraint requiring a non-null `edited_value` whenever that status is set) — changing the status itself would alter a historical human-review record, which this action deliberately does not do. **Tracked-out-of-scope**, Low severity (a narrow residual field, not a systemic gap).

---

## 4. Data export

Covered above (§3) — `exportCandidateDataAction` is the fix. Classified High rather than Critical (a real, now-fixed gap, but with no live regulator/candidate request pending against this pre-production system, so "not actively harming anyone yet" at the time of finding).

---

## 5. Internal vs. client-visible notes — read-path re-verification

The security wave's §5 already confirmed `client_visible`/`recruiter_notes` enforcement across `apps/web/lib/candidates/actions.ts`, `pipeline.ts`, `pipeline-actions.ts`, `apps/web/lib/shortlists/shortlist-actions.ts`, and `apps/web/lib/poc/load-detail.ts`. This review specifically re-checked the **web shortlist detail page's render path** (`apps/web/app/(app)/shortlists/[shortlistId]/page.tsx`) and the **mobile Phase-13 equivalents**, which the security wave's file list did not cover.

**Web: confirmed correct, no gap.** `ShortlistDetailPage` is a React Server Component; `row.recruiterNote && canManageInternally && (...)` (`page.tsx:90`) means the note text is only ever included in the server-rendered tree when `canManageInternally = hasPermission(membership.role, 'shortlists', 'update')` is true — a `client_decision_maker` never receives it, not even in the RSC payload. The full candidate array (with `recruiterNote`) is only ever passed as a prop to `ShortlistBuilderPanel` when `isDraft && canManageInternally`.

**Mobile: two real gaps found and fixed.**

1. `apps/mobile/screens/shortlists/shortlist-data.ts`'s shared `loadShortlistDetail` (used by both `FinalShortlistScreen` — internal — and `ClientDecisionScreen` — client-facing) fetched `shortlist_candidates.recruiter_note` **unconditionally**, for every caller regardless of role. `ClientDecisionScreen` never rendered it, but it was still fetched onto the client_decision_maker's device and held in JS memory — a data-minimization violation (RLS permits the _row_ once a shortlist has reached the client, but RLS cannot redact the _column_, the same limitation docs/07-data-model.md §7.3/§12.1 document repeatedly for every other candidate-facing surface — this is the one place it wasn't yet applied on mobile).
2. `FinalShortlistScreen.tsx:111` rendered `{c.recruiterNote && <Text>...}` with **no role gate at all** — unlike the equivalent web page. Any caller who could reach this screen (recruiter, agency_admin, read_only_reviewer, or, if this screen were ever linked to a client-facing nav flow, a client_decision_maker) would see internal recruiter notes.
3. `CandidateComparisonScreen.tsx` queried `shortlist_candidates.recruiter_note` directly and rendered it with no role gate at all. Currently unreachable through any wired navigation call site (grep confirmed zero `navigate('CandidateComparison', ...)` calls anywhere), so **not a live UI exposure today** — but, per this review's own "RLS is the real boundary" convention (matching docs/security-review.md §4's stated logic), a role-authorized direct query bypassing the UI would still receive it, and the screen is registered in the navigation type and will presumably be wired up in a future wave.

**Fix**: `loadShortlistDetail` now takes an `includeInternalNotes` option (default **false** — safe by default), and strips `recruiterNote` to `null` in its mapped output unless the caller explicitly opts in. `FinalShortlistScreen` and `CandidateComparisonScreen` now pass `includeInternalNotes: hasPermission(role, 'shortlists', 'update')` — the identical condition the web page already uses. `ClientDecisionScreen` needed no call-site change (the new default is exactly the behavior it always needed). All 98 existing mobile tests (including `FinalShortlistScreen.test.tsx`, `CandidateComparisonScreen.test.tsx`, `ClientDecisionScreen.test.tsx`) pass unchanged.

---

## 6. AI-provider (Anthropic) data exposure

Read `apps/web/lib/ai/candidate-prompt.ts`, `matching-prompt.ts`, `outreach-draft-prompt.ts`, `response-classification-prompt.ts` in full.

**Data minimization: already good, no code fix needed.**

- **CV parsing** (`candidate-prompt.ts`): sends the **full extracted CV text** to Anthropic. This is necessary and proportionate — the whole point of the call is field extraction from the full document; sending less would defeat the workflow.
- **Candidate matching** (`matching-prompt.ts`): sends only the **already-extracted evidence bundle** (short excerpts tagged with source id/kind), plus the job title and requirement list — never the full CV, never contact info. Good data minimization.
- **Outreach drafting** (`outreach-draft-prompt.ts`): same evidence-bundle pattern, plus job title/client name/recruiter name (all non-candidate, trusted business context) — never a candidate's contact info.
- **Response classification** (`response-classification-prompt.ts`): sends only the candidate's own reply text (which the model is classifying, so this is the minimum necessary) plus the single outbound message it's replying to — no other candidate data.

**What every one of these prompts sends is scoped to what the specific workflow needs.** No workflow sends more candidate PII than its task requires.

**Anthropic's commercial API data-handling terms** (docs/12-security-compliance.md §12.12 already flags this `[LEGAL]`): as of this review, Anthropic's standard commercial API terms do not use customer API inputs/outputs to train its models by default, and API data retention is governed by Anthropic's commercial terms (typically short-term, for abuse monitoring/trust & safety, with options for zero/reduced retention on qualifying commercial plans) — **stated plainly as what is generally known, not verified against a live, signed agreement for this specific account**, and this review does **not** treat that general knowledge as a substitute for confirming the actual, current commercial terms Logigates has (or will have) in place with Anthropic before real candidate data is processed. **Tracked-business-decision-needed**: confirm the live Anthropic commercial/DPA terms and document them in the agency's own privacy notice, exactly as docs/12-security-compliance.md §12.12 already instructs.

---

## 7. Audit access

`packages/types/src/permissions.ts:233`'s matrix: `audit_logs: { platform_admin: 'full', agency_admin: 'read', recruiter: 'read', client_decision_maker: 'none', read_only_reviewer: 'read' }`. docs/06-roles-permissions.md §6.2's own table is more specific: _"Recruiter: R (own actions)"_ — a narrower grant than the coarse matrix level alone expresses (the matrix only says a role _can_ read the resource at all; the DB-layer RLS is what's supposed to narrow _which_ rows, the same "RLS is the real gate" convention this codebase uses everywhere else).

**Finding: the actual RLS policy did not implement that narrowing.** `audit_events_select_own_org` (`supabase/migrations/0006_audit_events.sql:36-42`, unchanged since Build Phase 2) granted **any** org member — including a `recruiter` — org-wide read of every `audit_events` row, not just their own. Since `audit_events.after_json`/`before_json` routinely carries candidate PII (`candidate.created`'s `after_json` stores `fullName`, `apps/web/lib/candidates/actions.ts:183`), this meant a recruiter could read audit history — including candidate names and other before/after state — for candidates and projects **outside their assigned scope**, bypassing the entire `can_access_candidate()` row-level-visibility model that every other candidate-facing table in this codebase enforces (docs/07-data-model.md §7.3).

No application UI currently reads `audit_events` at all (grep confirmed: only `apps/web/lib/audit/log.ts`'s insert path touches this table) — so this had not yet been exploited through the app's own UI. But per this codebase's own stated security convention (docs/security-review.md §4: _"RLS... is what actually restricts row visibility"_), RLS is reachable directly through the public anon/authenticated key regardless of whether any screen reads the table — the absence of a UI screen means this was not yet _exploited_, not that it was _safe_.

**Fixed**: migration `0034_privacy_hardening.sql` replaces the policy — `agency_admin`/`read_only_reviewer`/`platform_admin` keep org-wide read exactly as before (matching their documented matrix rows); `recruiter` is narrowed to `actor_id = auth.uid()`, matching docs/06-roles-permissions.md §6.2 exactly. **Verified functionally**, not just "applies cleanly": rebuilt Postgres from all 34 migrations, inserted two recruiters' audit rows in the same org, and confirmed under `SET ROLE authenticated` + JWT-claim switching that recruiter A sees only their own row and recruiter B sees only theirs (see Verification below for the exact query and result).

---

## 8. Requires legal/business review before real candidate data is processed

Every item below is a genuine business or legal decision this review deliberately did **not** invent an answer to, per the project's own engineering rule ("Stop and report blockers when required credentials, business decisions or source data are missing"):

1. **Consent language and mechanism** (§1) — what a candidate is actually told, how/where consent is captured, and whether consent vs. legitimate interest is the correct lawful basis per jurisdiction (docs/12-security-compliance.md §12.7).
2. **Data retention period(s)** (§2) — how long candidate data is kept after a role closes, per jurisdiction; no number is invented here (docs/12-security-compliance.md §12.8).
3. **Whether anonymized-audit-retention satisfies erasure obligations** (§3b) — GDPR Art. 17 / CCPA deletion rights vs. this platform's deliberate append-only audit/evidence design, which retains verbatim excerpts of erased candidates' data indefinitely (docs/12-security-compliance.md §12.9).
4. **Anthropic's live commercial API terms** (§6) — confirm actual, current data-retention/training-use terms for this account specifically, and document them in the agency's own privacy notice (docs/12-security-compliance.md §12.12).
5. **GDPR/UK and US state-law (CCPA/CPRA) applicability** — depends on actual candidate geography once known (docs/12-security-compliance.md §12.18/§12.19), unchanged by this wave.
6. **AI-employment-decision regulation** (NYC Local Law 144-style bias-audit requirements, EU AI Act high-risk classification) — flagged as P0 in docs/12-security-compliance.md §12.20/docs/18-blocking-questions.md, unchanged by this wave; not re-litigated here since it's a scoring-fairness question, not a data-protection one.
7. **The specific GDPR Art. 15/17 response-timeline obligations** this platform's export/erasure actions need to meet operationally (e.g. "respond within 30 days") — this wave built the _technical capability_; the _process_ around who monitors/responds to a request and within what SLA is an agency operational decision, not this platform's to define.

---

## Verification

- **`pnpm typecheck`**: 6/6 packages — **0 errors** (before and after this wave).
- **`pnpm lint`**: 2/2 packages — **0 errors**, 18 pre-existing warnings (`apps/mobile/__tests__/screens/*.test.tsx`, unrelated to this wave, unchanged).
- **`pnpm test`**: web **807/807** passing (799 baseline + 8 new tests in `apps/web/lib/candidates/privacy.test.ts`); mobile **98/98** passing (unchanged — `FinalShortlistScreen.test.tsx`/`CandidateComparisonScreen.test.tsx`/`ClientDecisionScreen.test.tsx` all still pass against the new `includeInternalNotes`-gated behavior, since their existing fixtures already implicitly exercised the internal/recruiter role paths).
- **Migration rebuild**: fresh local Postgres database, all 34 migrations (`0001`–`0034`, including this wave's new `0034_privacy_hardening.sql`) applied with `ON_ERROR_STOP=1` — **applied cleanly, zero errors**.
- **pgverify regression suite** (`scripts/verify_candidates.sql`) run against the rebuilt database — **zero failures, zero errors** (matches the security wave's baseline).
- **Functional RLS verification of the `audit_events` fix** (not just "applies cleanly" — actually exercised): created two recruiters (`f1`, `f2`) in one test org, inserted one `audit_events` row per recruiter, then queried under `SET ROLE authenticated` with `request.jwt.uid` set to each in turn — recruiter A's query returned exactly their own row (`entity_id = c1`), recruiter B's query returned exactly their own row (`entity_id = c2`); confirmed `pg_class.relrowsecurity` and `pg_policies` show the new policy live.
- **`candidate_consents.deletion_fulfilled_at`/`deletion_fulfilled_by`** confirmed present via `\d candidate_consents` against the rebuilt database.

### Before / after counts

| Metric                                     | Before this wave                                     | After this wave                                                      |
| ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Migrations                                 | 33 (`0001`–`0033`)                                   | 34 (`0001`–`0034`)                                                   |
| `pnpm test` (web + mobile)                 | 799 web + 98 mobile passing (baseline, prior waves)  | 807 web + 98 mobile passing                                          |
| `pnpm typecheck` / `pnpm lint` errors      | 0 / 0                                                | 0 / 0                                                                |
| Candidate erasure fulfillment path         | None (recorded-request only)                         | `erasePersonalDataAction`, redacts every safely-redactable field     |
| Candidate data export path                 | None                                                 | `exportCandidateDataAction`, full JSON export                        |
| `audit_events` recruiter read scope        | Org-wide (contradicted docs/06-roles-permissions.md) | Own actions only, matching documented design                         |
| Mobile shortlist `recruiter_note` exposure | Fetched/rendered for every role reaching the screen  | Gated behind `shortlists`/`update` permission, matching the web page |

Related documents: [[07-data-model]] · [[12-security-compliance]] · [[06-roles-permissions]] · [[09-ai-architecture]] · [[security-review]] · [[18-blocking-questions]]
