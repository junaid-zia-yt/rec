# POC Operating Procedure — Day-of Runbook

Build Phase 16, Wave 1. **Documentation only.** This is the step-by-step
runbook for the agency team (agency admin + recruiter) running the
platform side of the POC. It maps the platform's actual, code-verified
workflow (docs/release-readiness.md Part A's 17-step trace) onto the
operational rules in [[14-poc-specification]] and [[poc-launch-plan]].
Every step below cites the real implementing action from
docs/release-readiness.md — nothing here describes a feature or workflow
step that does not exist in the codebase today.

**Before this runbook may be used to run a real POC**, every open item in
[[poc-launch-plan]] §11 ("Requires Dave's explicit confirmation before
launch") must be resolved, and the launch checklist referenced below must
be approved — per this wave's own constraint: do not start production
usage until the launch checklist is approved.

---

## 0. Before you start — pre-flight checklist

See **docs/poc-launch-checklist.md** for the full pre-flight checklist
(produced separately, Wave 3 of this build phase). At minimum, before any
step below begins, confirm:

- Roles and JDs are in hand from Dave ([[poc-launch-plan]] §1).
- Search boundaries are explicitly agreed, not assumed ([[poc-launch-plan]]
  §5).
- Candidate-contact/account-ownership is resolved if outreach is in scope
  for this POC run ([[poc-launch-plan]] §7) — otherwise, plan to stop
  before the outreach step (§8 below) and record that as expected, not a
  failure.
- Both scorecards are built and approved (§2 below) **before** the shared
  start time is triggered.
- The shared benchmark start time is agreed and about to be recorded
  ([[poc-launch-plan]] §4).

---

## 1. Sign in

Agency admin and recruiter each sign in with their real accounts
(`signInAction`, docs/release-readiness.md step 1). Confirm you are
operating in the correct organization/tenant before proceeding — this is
real candidate/client data from this point forward, not seed/demo data.

## 2. Create client (if not already existing)

Agency admin or recruiter creates the client record for Dave's agency/end
client (`createClientAction`, step 2). If Dave's client record already
exists from prior engagement setup, use it — do not create a duplicate.

## 3. Create recruitment project (one per POC role)

Create one `recruitment_projects` row per benchmarked role — two total
(`createProjectAction`, step 3). Each project starts at `status: 'intake'`.

## 4. Add job description (paste path only — known limitation)

Paste the JD text for each role (`pasteJobDescriptionAction`, step 4).
**Known, disclosed limitation, not a new gap:** uploading a JD as a file
(PDF/DOCX) saves it but does not reach requirement extraction in this
environment — text-extraction is not wired
(`uploadJobDescriptionAction`'s own "text extraction is not yet available
in this environment" message). **Only the paste path reaches step 5.** If
Dave's JD arrives as a file, the recruiter transcribes/pastes its text
manually before this step — this is a manual workaround for a real
platform gap, not a hidden feature.

## 5. Extract requirements

Run requirement extraction for each JD (`runRequirementExtractionAction`,
step 5), producing proposed `job_requirements` rows.

**POC-specific check:** if the role-calibration call ([[poc-launch-plan]]
§1/§3) happened, cross-check the extracted mandatory/preferred split
against what was agreed on that call before moving to scorecard approval —
this is a manual review the recruiter does, not an automated step.

## 6. Approve scorecard

Recruiter reviews/edits proposed requirements and builds the scorecard;
agency admin approves it (`submitScorecardForApprovalAction`,
`decideScorecardApprovalAction`, step 6). Approval freezes
`scorecard_versions.requirement_snapshot`.

**POC-specific gate:** both roles' scorecards must reach `active` status
**before** the shared benchmark start time is recorded. Do not start the
benchmark clock with either scorecard still in draft — see
[[poc-launch-plan]] §2 for why this ordering is a hard prerequisite, not a
convenience.

**→ Record the shared benchmark start time now, once both scorecards are
active.**

## 7. Add candidates (sourcing)

As each candidate is sourced, add them (`createCandidateAction` or CSV
import, step 7).

**POC-specific check — deduplication:** before adding each candidate,
check the working name-list against what Dave's side has already reported
finding, per the manual dedup procedure in [[poc-launch-plan]] §6. There is
no automated cross-side dedup feature in the platform; this is a manual
recruiter check against a plain list, not a system-flagged duplicate. Mark
any duplicate in the POC working notes at the point it's found, not
retroactively.

## 8. Parse CVs

For each candidate, run document processing
(`startCandidateDocumentProcessingAction`, step 8), then review extracted
fields (verify/reject/edit) and accept verified fields
(`acceptAllVerifiedFieldsAction`). Only verified/edited fields are ever
applied to the candidate's real record — a rejected or still-pending field
never is (this is enforced in code, not a process reminder).

## 9. Evaluate mandatory gates

Gate evaluation (`evaluateMandatoryGates`, step 9) runs as part of the
matching evaluation in step 10 below — it is a pure deterministic function,
not a separate manual action. Zero evidence always resolves to
`insufficient_evidence`, never a pass, regardless of any AI suggestion.

## 10. Calculate evidence-backed match

Run matching evaluation for each candidate against the role's active
scorecard (`runMatchingEvaluationAction`, step 10), producing
`candidate_role_matches.eligibility`, gate results, and the overall score.

**POC-specific check — evidence completeness:** before a candidate can be
considered for the ranked pool in the POC scorecard
([[poc-success-scorecard]] §2), confirm its evidence completeness is
tracking toward the 100% structural target. A candidate with unresolved
`insufficient_evidence` gates routes to human review (step 11), not
straight to the ranked pool — this is enforced by the platform, not a
manual gate the recruiter has to remember.

## 11. Human quality review

Recruiter completes the QR-01 review for each candidate
(`recordReviewDecisionAction`, `overrideMandatoryGateAction`, step 11) —
per [[poc-launch-plan]] §9, this is the recruiter's action for the POC,
matching production. Any override requires a reason and is recorded with
an audit entry; overriding one gate never silently flips overall
eligibility while another gate still fails.

## 12. Approve outreach — conditional, may not run in this POC

**Do not proceed with this step unless [[poc-launch-plan]] §7's account-
ownership question has been explicitly answered by Dave.** If it has not,
skip outreach entirely for this POC run and record that explicitly in the
`POC_results` report as a scoped-out step, not a failure or an oversight.

If unblocked: draft outreach for eligible candidates
(`generateOutreachDraftAction`), review the evidence-grounded
personalization (any citation not backed by verified candidate data is
stripped automatically before it's ever shown), and approve
(`recordOutreachApprovalAction`, step 12) before anything sends.

## 13. Record candidate response

If outreach ran, record each response as it comes in
(`recordCandidateResponseAction`/`recordManualChannelResponseAction`,
step 13) and classify it.

## 14. Create shortlist (max 2–3 candidates)

Create the shortlist and add only eligible (gate-passing) candidates
(`createShortlistAction`, `addCandidateToShortlistAction`, step 14). The
platform enforces the 2–3 cap (`max_candidates` default 3) and blocks any
ineligible candidate from being added at both the application layer and a
database trigger — this is Core Business Rule #6's actual enforcement
mechanism, not a process convention the recruiter has to police manually.

## 15. Client decision

Submit the shortlist to Dave and record his decision
(`recordClientDecisionAction`, step 15) — see [[poc-launch-plan]] §10 for
the full client-review process. Dave's account only ever sees the
shortlist once it reaches `sent_to_client` status, and only ever sees
score/gates/evidence%/client-visible notes, never internal recruiter
reasoning.

## 16. View POC result

Open the POC/benchmark report for the project (`compare-benchmark.ts`,
`poc-comparison-report.tsx`, step 16). It renders the real captured
metrics from the run above plus the platform's correlation-not-causation
disclaimer — it does not fabricate a comparison that wasn't actually run.
Transcribe these figures into [[poc-success-scorecard]] for the joint
review.

## 17. Inspect audit trail

Open the audit log, filtered to the POC's projects (`logAuditEvent`
entries, step 17). Confirm a distinct, correctly-attributed entry exists
for every major action above — this is the audit trail Dave (or a future
dispute) can be pointed at.

---

## Escalation and dispute resolution

Per [[14-poc-specification]] §14.16: any scoring disagreement during or
after the POC is resolved by **joint review of the evidence, not the
percentage** — "why did the platform say X passed this gate" is answered
by pointing at the actual citation behind that gate result, which is the
whole point of the evidence-first design (Core Principle #2). This applies
to:

- A gate result Dave disagrees with (compare against the specific
  evidence excerpt and source, step 9/10's output, not a re-argued score).
- A duplicate-candidate dedup call either side disputes (§7 above — refer
  to the recorded rationale in the working notes).
- A "discuss" outcome on the client decision (step 15) — resolved by the
  same evidence-first review before the POC is marked complete, per
  [[poc-launch-plan]] §10.

Agree this dispute-resolution approach with Dave **before** the POC
starts, not improvised if a disagreement arises mid-run
([[14-poc-specification]] §14.16's own recommendation).

Related documents: [[14-poc-specification]] · [[poc-launch-plan]] ·
[[poc-success-scorecard]] · docs/poc-launch-checklist.md (Wave 3, this
phase) · [[06-roles-permissions]] · [[08-candidate-scoring]] ·
[[release-readiness]]
