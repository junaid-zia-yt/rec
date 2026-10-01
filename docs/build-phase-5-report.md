# Build Phase 5 report — candidate foundation

Per docs/21-implementation-contract.md §21.14 and the Build Phase 5
completion gate ("I approve the Candidate Foundation build... Apply the
Mandatory Completion Gate"). Covers exactly what this phase implements:
candidate records, secure CV/document management, normalized candidate
profiles, deduplication (deterministic + configurable fuzzy suggestion),
and the eight-stage recruitment pipeline with permission-checked,
audited, human-decided stage transitions. AI CV parsing and match scoring
are explicitly out of scope for this phase, per the brief ("Do not
implement AI CV parsing or match scoring yet"), and are untouched — the
Phase-1 `candidates`/`candidate_role_matches` demo scoring-preview types
and fixtures remain exactly as they were, modeling a distinct future
entity (docs/07-data-model.md §7.1).

**The same two blockers carried into every prior phase's report remain
unchanged in kind**: (1) no live Supabase project is connected to this
repository's environment (no `apps/web/.env.local`, no `SUPABASE_*` env
vars); (2) no `ANTHROPIC_API_KEY` is configured — moot for this phase
specifically, since it implements no AI code path at all (candidate
matching/parsing, the only AI-touching part of the candidate domain, is
explicitly deferred). Everything below is code-complete, typechecked,
linted, and tested at every layer that does not require a live backend,
and — going further than static review — the full schema and its Row
Level Security policies were functionally verified against a real local
PostgreSQL 16 instance, including live role-switching RLS tests (§1.1).

## 0. Pre-build verification

The full existing test/typecheck/lint/build suite was confirmed green
before any Phase 5 code was written (229 tests today were 169 at the start
of this phase — see §2).

## 1. What was implemented

### 1.1 Database schema + RLS (migrations `0018`–`0021`)

| Migration                            | Adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0018_candidates.sql`                | `candidates` (full_name, primary_email/phone, **generated** `normalized_email`/`normalized_phone` columns mirroring the application's own normalization exactly, `status` active/archived/merged/deletion_requested, `merged_into_candidate_id` self-FK with paired constraints, reserved `deleted_at`), `candidate_profiles` (1:1 — every profile field the brief lists, `recruiter_notes` and `client_visible_notes` as two separate columns), `candidate_contact_points` (one row per channel, partial unique index one-primary-per-type)                                                               |
| `0019_candidate_documents.sql`       | `candidate_documents` — reuses the shared `document_uploads` table (Build Phase 3) for file/checksum/MIME/size bookkeeping rather than duplicating it; `unique(candidate_id, doc_type, version_no)`; no `client_decision_maker` policy anywhere for this table                                                                                                                                                                                                                                                                                                                                             |
| `0020_candidate_profile_details.sql` | `candidate_experiences`, `candidate_education`, `candidate_certifications`, `candidate_skills` (unique per candidate, case-insensitive), `candidate_sources` (nullable project — a candidate can be sourced before assignment)                                                                                                                                                                                                                                                                                                                                                                             |
| `0021_candidate_pipeline.sql`        | `candidate_project_entries` (the 8 brief-exact pipeline stages, `client_visible`), `public.can_access_candidate()` (the single RLS helper every candidate-\* table's recruiter/client policy relies on — docs/07-data-model.md §7.3 has the full rule), `candidate_pipeline_events` (append-only — `REVOKE UPDATE, DELETE`), `candidate_consents` (1:1, consent + deletion-request fields). Also retrofits the recruiter/client_decision_maker policies deferred from `0018`–`0020` now that `can_access_candidate()` exists (the same deferred-policy convention as `is_assigned_to_project()` in `0012`) |

Every new table carries `organization_id` and RLS, per the project's
standing rule.

**Verified beyond static review, further than any prior phase.** All 21
migrations were applied in order against a real local PostgreSQL 16
instance (the same harness Build Phase 4 introduced, extended this phase
with a `storage` schema stub and `auth.users.raw_user_meta_data`). A
24-assertion SQL script confirmed, against live rows:

- the generated `normalized_email`/`normalized_phone` columns compute
  correctly;
- the `merged` status ↔ `merged_into_candidate_id` pairing constraint
  rejects the contradiction;
- the compensation-range check constraint rejects `max < min`;
- the case-insensitive unique-skill-per-candidate index rejects a
  duplicate;
- the pipeline-stage check constraint rejects an invalid stage value;
- `candidate_pipeline_events` genuinely has no UPDATE/DELETE grant at the
  database-role level (`has_table_privilege()`), not just an RLS policy;
- **live RLS role-switching**, using `SET ROLE authenticated` plus
  `set_config('request.jwt.uid', ...)` to impersonate each role in turn —
  going beyond Phase 4's constraint/trigger-only verification, which did
  not exercise RLS at all:
  - a recruiter assigned to a candidate's project can see it; an
    unassigned recruiter who did not source it cannot;
  - a client reviewer cannot see a candidate until
    `candidate_project_entries.client_visible` is set true, then can;
    they can never see `candidate_documents` regardless;
  - an unauthorized recruiter's write is silently filtered to 0 rows by
    RLS, not merely rejected by application code;
  - **cross-tenant denial** — an agency_admin and a recruiter belonging
    to a wholly separate organization can neither read nor write another
    org's candidate, its profile, or its pipeline entries, and an attempted
    cross-org write affects 0 rows (added specifically for this phase's
    §TESTING "Cross-tenant denial" requirement — see §2);
  - `candidate_documents` correctly resolves its checksum through the
    shared `document_uploads` table, and a duplicate
    `(candidate_id, doc_type, version_no)` is rejected.

This is real, executed confidence the schema and RLS are behaviorally
correct — not just syntactically valid or reviewed by eye — though it
remains a hand-built local stub, not Supabase itself: Supabase's actual
`auth.uid()`/JWT-claim wiring and its RLS query planner are not
byte-for-byte reproduced, so this is strong evidence, not a substitute for
running the real migrations against a live Supabase project.

### 1.2 Deterministic candidate logic (`apps/web/lib/candidates/`)

Kept entirely separate from any I/O, per the project's convention of
testing pure decision logic directly:

- `dedup.ts` — `findDuplicateSuggestions()`: exact normalized-email,
  normalized-phone, and document-checksum matches (confidence 1), plus a
  **configurable token-overlap (Jaccard) fuzzy heuristic** over
  name/company/location (`DEFAULT_DEDUP_CONFIG`, weighted 0.6/0.25/0.15,
  threshold 0.6). This is a deliberate scope decision, recorded honestly
  in docs/07-data-model.md §7.4: the original data-model plan called for
  pgvector embedding similarity, but Build Phase 5 implements a
  dependency-free heuristic instead, since AI CV parsing (which would
  supply richer text to embed) is out of scope this phase. Never
  auto-merges — always a suggestion for a human decision.
- `pipeline.ts` — `checkPipelineTransition()` (sequential forward/back-one
  among the 6 active stages, or into either terminal stage from any
  non-terminal one; same-stage and any move out of a terminal stage are
  invalid), `nextClientVisible()` (auto-shares only on reaching
  `shortlisted`, never auto-unshares), `transitionRequiresReason()` (true
  only for the two terminal stages).
- `visibility.ts` — the single place contact-masking and
  recruiter-notes/client-notes separation live (RLS is row-level only and
  cannot redact a column): `contactValueForRole()`,
  `serializeCandidateProfileForRole()` (omits `recruiterNotes` entirely,
  never nulls it, for roles outside
  `platform_admin/agency_admin/recruiter/read_only_reviewer`).
- `merge.ts` — `validateCandidateMerge()`: rejects self-merge, cross-org
  merge, and merging into/from an already-merged record.
- `csv-import.ts` — `parseCandidateCsv()`: a hand-rolled RFC4180-ish CSV
  parser plus per-row Zod validation, order/case-insensitive header
  matching, only `full_name` required.

### 1.3 File security for CV uploads

`apps/web/lib/files/validate.ts` extended with
`validateCandidateDocumentFile()` (PDF/.docx, 10 MB limit) — refactored
the existing job-description validator into a shared private
`validateDocumentFile()` rather than duplicating the MIME/size/extension
logic. Storage itself (private bucket, signed access, checksum) reuses the
Build Phase 3 `document_uploads`/`uploadDocument()` infrastructure
unchanged, with a new `'candidate_document'` owner type it had already
anticipated.

### 1.4 Server actions (brief §FUNCTIONAL REQUIREMENTS, §UI)

- `actions.ts` — `createCandidateAction` (manual entry, optional
  immediate project assignment + source tracking),
  `importCandidatesFromCsvAction` (commits only rows already reviewed
  client-side — never re-parses the raw file server-side, so a
  recruiter's in-review corrections are respected; still Zod-revalidates
  every row before writing, per "never trust client data"),
  `uploadCandidateDocumentAction` (validates, checksums, versions —
  supersedes rather than replaces the prior active version of the same
  doc type), `updateCandidateAction`, `archiveCandidateAction`,
  `requestCandidateDeletionAction` (records the request; does not itself
  erase data — see §4).
- `pipeline-actions.ts` — `assignCandidateToProjectAction`,
  `transitionCandidateStageAction` (every transition: permission-checked,
  timestamped, actor recorded via RLS-backed `auth.uid()` — never
  spoofable, reason enforced for terminal stages, re-validated server-side
  by the same pure `checkPipelineTransition` the UI uses to decide which
  moves to even offer, both a `candidate_pipeline_events` row and an
  `audit_events` row produced), `setCandidateClientVisibilityAction`
  (explicit share/unshare, independent of stage, agency_admin/recruiter
  only).
- `detail-actions.ts` — create+delete (no in-place edit, a deliberate
  simplification noted in the file's own header comment) for employment
  history, education, certifications, skills.
- `merge-actions.ts` — `mergeCandidatesAction`: the only code path in the
  repository that can set `candidates.status = 'merged'`; reassigns the
  losing candidate's child rows to the surviving one, handles the two
  unique-constrained child tables (`candidate_skills`,
  `candidate_project_entries`) by dropping true duplicates and recording
  the drop count in the audit event rather than silently losing data;
  never deletes the losing candidate's row (kept as a resolvable alias).
  **Known limitation, reported honestly rather than glossed over**: this
  reassignment is a sequence of ordinary Supabase calls, not one atomic
  Postgres transaction — a mid-sequence failure could leave a merge
  partially applied. A follow-up phase should move this into a single
  Postgres RPC function.
- `dedup-lookup.ts` — the I/O wrapper around the pure
  `findDuplicateSuggestions`.

Every write follows the established pattern: Zod validation,
`requirePermission`/`requireProjectAccess`, a Supabase write, an
`audit_events` row, `revalidatePath`, the shared `ActionResult` shape.

### 1.5 UI (brief §UI)

- `/candidates` — rebuilt into a real pipeline screen
  (`CandidatePipelineView`): a searchable/filterable list view and a
  per-project kanban board view, both responsive (mobile: cards/stacked
  columns via Tailwind breakpoints, the established convention — no
  separate mobile route).
- `/candidates/new` — manual-entry form and a CSV-import review screen in
  tabs; CSV parsing/validation happens client-side (the same pure
  function the server re-validates with) so a recruiter fixes problems
  before anything commits.
- `/candidates/[candidateId]` — rebuilt around a tabbed detail page:
  **Profile** (edit form, recruiter notes vs. client-visible notes as
  genuinely separate fields), **Background** (experience/education/
  certifications/skills, add + delete), **Documents** (upload + version
  history), **Pipeline** (per-project stage stepper, transition controls
  that only ever offer a currently-valid move, terminal-stage reason
  field, client-visibility toggle, assign-to-new-project), **Duplicates**
  (suggestions with a merge-confirmation flow), **Privacy** (archive,
  deletion request, consent status), and **AI match preview** — the
  original Phase-1 "Mandatory gates"/"Evidence" section, kept exactly as
  it was and relabeled as a preview of the future AI-scoring phase this
  build does not implement, rather than removed or silently repurposed.

Contact values and recruiter notes are passed through
`lib/candidates/visibility.ts` once, at the top of the page, so no
individual tab can forget to mask or omit them.

### 1.6 Types (`packages/types/src/index.ts`)

`CandidatePipelineStage` (+ active/terminal stage arrays), `CandidateStatus`,
`WorkplacePreference`, `CompensationPeriod`, `ContactPointType`,
`CandidateSourceChannel`, `CandidateDocumentType`, `SkillProficiency`, and
schemas for every table in §1.1 plus `CsvCandidateRowSchema`/
`CsvRowValidationSchema` and `DuplicateCandidateSuggestionSchema`. The
existing Phase-1 `CandidateSchema`/`CandidateMatchSchema`/`PipelineStage`
demo-scoring types are untouched, by design (see the opening summary).

## 2. Tests added

61 new tests (230 total, up from 169), all passing:

- `lib/candidates/dedup.test.ts` (12) — exact email/phone/checksum
  matches, the fuzzy heuristic's threshold and weighting, no
  false-positive on dissimilar candidates.
- `lib/candidates/pipeline.test.ts` (12) — every valid and **invalid**
  transition (skipped stages, out of a terminal stage, same-stage),
  reason-required-for-terminal, client-visibility auto-share behavior.
- `lib/candidates/visibility.test.ts` (11) — **restricted contact
  access** (masked vs. unmasked per role) and **recruiter-notes privacy**
  (omitted, not nulled, for a client-safe projection).
- `lib/candidates/merge.test.ts` (5) — **merge behavior** guard rails:
  self-merge, cross-org merge, merging an already-merged record, all
  rejected before any write is attempted.
- `lib/candidates/csv-import.test.ts` (13) — **CSV validation**: header
  recognition (order/case-insensitive), required-field enforcement,
  malformed rows.
- `lib/files/validate.test.ts` (+7, 20 total) — **secure files**:
  PDF/.docx accepted, other MIME types and oversized files rejected.
- `lib/audit/log.test.ts` (+1) — **audit records**: a candidate-domain
  action (`candidate.stage_transitioned`) with `before`/`after`/`metadata`
  serializes into the exact `audit_events` row shape.
- `app/(app)/candidates/[candidateId]/page.test.tsx` (2, updated) — the
  Phase-1 unverified-evidence and verified-evidence assertions still
  pass, now reached via a real user click into the "AI match preview" tab
  (Radix Tabs unmounts inactive panels), confirming the rebuild didn't
  silently drop that behavior.

**Cross-tenant denial and the full RLS/audit surface are covered by the
local-Postgres SQL harness, not Vitest** (§1.1) — consistent with this
repo's established boundary that RLS/database-role behavior is verified
functionally against real Postgres, while pure application logic is
unit-tested. `verify_candidates.sql` grew from 19 to 24 assertions this
session specifically to add the brief's "Cross-tenant denial" testing
item, which had no coverage before: TEST11a–e now confirm an
agency_admin and a recruiter in a wholly separate organization can
neither read nor write org a1's `candidates`, `candidate_profiles`, or
`candidate_project_entries` rows.

Permission-boundary enforcement for the new server actions
(`requirePermission`/`requireProjectAccess`) reuses the unchanged,
already-unit-tested `lib/auth/permissions.ts`/`lib/auth/membership.ts`
logic from Build Phase 2 — no new pure logic was introduced there to
test, so no new test file was added for it; this is a reuse decision, not
a coverage gap.

## 3. Commands run (verification gate)

```
pnpm typecheck                  PASS (all 5 workspace packages)
pnpm --filter web lint          PASS (0 errors, 0 warnings)
pnpm --filter web test          PASS — 230/230 (36 files)
pnpm --filter web build         PASS — all routes compiled/prerendered,
                                        including 5 candidate detail routes
psql verify_candidates.sql      PASS — 24/24 assertions, against a fresh
                                        local Postgres 16 database with all
                                        21 migrations applied from scratch
```

## 4. Known limitations / deferred

- **No live Supabase project connected** — identical in kind to the
  blocker reported in every prior phase. The migrations, RLS policies,
  and every live-Supabase-data code path (`loadLiveDetail()`'s live
  branch, every new server action's Supabase writes) are code-complete
  and typechecked but have never executed against a real Supabase
  project. The local-Postgres verification (§1.1) is real evidence of
  correctness, not a replacement for this.
- **No AI CV parsing or match scoring** — explicitly out of scope per the
  brief; every candidate field is human-entered (manual form or reviewed
  CSV row) this phase, never AI-extracted. `document_uploads`/
  `candidate_documents` are ready to be the input to a future parsing
  phase, but nothing reads the file contents today beyond validating its
  format.
- **Merge is not atomic** — a sequence of Supabase calls, not one
  Postgres transaction (§1.4). Reported here rather than silently risked.
- **Deletion requests are recorded, not fulfilled** — `candidates.status`
  reflects a pending request and `candidate_consents` durably records who
  asked and why, but no code path actually erases candidate data. Real
  erasure needs an explicit data-retention policy decision this build
  does not make, and should be a separate, even-more-carefully-audited
  admin action in a later phase.
- **Employment history/education/certifications/skills are create+delete
  only** — correcting an entry is delete-and-re-add rather than in-place
  edit, a deliberate scope simplification (`detail-actions.ts` header
  comment), not an oversight.
- **Deduplication uses a heuristic, not embeddings** — see §1.2 and
  docs/07-data-model.md §7.4 for the honest record of this deviation from
  the original data-model plan and why it's a reasonable one for this
  phase.

## 5. Recommendation for next build

With the Candidate Foundation in place, the natural next phase is AI CV
parsing and evidence-based match scoring against an approved scorecard
version (Build Phase 4's output) — the brief explicitly deferred both
here. That phase will need the `ANTHROPIC_API_KEY` blocker resolved (still
unconfigured, carried since Build Phase 4) to do more than
adapter-double testing, same as Build Phase 4's own recommendation. The
Supabase connection remains the larger, longer-standing blocker and
should be resolved once, covering all phases' live-data paths together.

---

**BUILD PHASE 5: BUILD INCOMPLETE — BLOCKERS REMAIN**

(Code-complete, fully typechecked/linted, 230/230 unit tests passing,
production build succeeds, and the full schema/RLS — including, new this
phase, live cross-tenant-denial RLS testing — was functionally verified
against a real local Postgres instance, 24/24 assertions passing.
Incomplete because no live Supabase project is connected in this
environment, carried unchanged since Build Phase 2, so every live-database
code path has never been executed against a real backend.)
