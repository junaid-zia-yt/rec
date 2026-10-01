# POC Success Scorecard

Build Phase 16, Wave 1. **Documentation only.** This is the fillable
metrics instrument used to score the POC's outcome once it runs — it is
empty of real data today; every "Target" value below is a vendor-proposed
default carried over from [[14-poc-specification]] §14.14, **explicitly
pending Dave's agreement**, not an accepted number. Do not read a Target
column as agreed. See [[poc-launch-plan]] for the operational plan this
scorecard measures, and [[poc-operating-procedure]] for the day-of runbook
that produces the "Actual" values.

---

## 0. How to use this scorecard

- One copy of §§2–5 is filled in **per role** (standard role, senior/
  difficult role) — two role-tables total, since the POC benchmarks two
  roles ([[14-poc-specification]] §14.2).
- Each metric is recorded for **both sides** (Platform, Dave's manual
  process) side by side, so the comparison is legible at a glance.
- "Target" = the vendor-proposed default from §14.14. "Actual" = filled in
  after the POC run. "Pass/Fail" = Actual vs. Target, using §14.14's own
  framing of each item (structural guarantee vs. adjustable parameter — see
  the notes column).
- This scorecard does not itself decide go/no-go — §14.15's failure
  criteria and the joint `POC_results` review do (see [[poc-launch-plan]]
  §11). This is the instrument that feeds that decision, not a replacement
  for the human judgment §14.17 requires.

---

## 1. Benchmark identification (fill in once, applies to both role tables)

| Field                          | Value                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Role 1 (standard)              | _(pending Dave's role selection — [[poc-launch-plan]] §1)_                   |
| Role 2 (senior/difficult)      | _(pending Dave's role selection — [[poc-launch-plan]] §1)_                   |
| Shared benchmark start time    | _(pending — [[poc-launch-plan]] §4)_                                         |
| Search boundaries agreed       | _(pending — [[poc-launch-plan]] §5)_                                         |
| Scorecard version(s) frozen at | _(recorded once each role's scorecard is approved — [[poc-launch-plan]] §2)_ |

---

## 2. Quality metrics — per role

Source: [[14-poc-specification]] §14.9. Fill one table per role.

| Metric                                                        | Definition                                                                                                                                                                      | Target (vendor-proposed, pending approval)                                                                             | Platform — Actual | Dave — Actual                                                                | Pass/Fail | Notes                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate-decision agreement rate                                  | % of candidates where the platform's mandatory-gate pass/fail agrees with Dave's own manual assessment of the same candidate                                                    | ≥90% (retained legacy criterion, §14.14)                                                                               |                   | n/a (single agreement rate, not per-side)                                    |           | Eval metric distinct from the structural 100% gate-compliance guarantee below — see [[10-ai-evaluation-guardrails]] §10.13                           |
| Match-score correlation                                       | Do the two methodologies **rank** the same candidates highly — not whether the raw percentages match                                                                            | Not a numeric pass/fail target — directional agreement, reported qualitatively + rank-correlation figure if computable |                   |                                                                              |           | §14.9: correlation, not identity. [[08-candidate-scoring]] §8.13: do not treat Dave's 90/95/97–98 as a validated target for the platform's own scale |
| Evidence completeness                                         | % of platform-side shortlisted candidates' claims with verifiable, cited evidence                                                                                               | 100% (structural guarantee, not a tuning target)                                                                       |                   | n/a (Dave's manual process has no equivalent structural guarantee to report) |           | Enforced by construction in the platform — see [[08-candidate-scoring]] §8.1/§8.7                                                                    |
| Mandatory-gate compliance among ranked/shortlisted            | % of ranked/shortlisted candidates with zero failed mandatory gates                                                                                                             | 100% (structural guarantee — §14.14 item 4)                                                                            |                   | n/a                                                                          |           | Verified via [[10-ai-evaluation-guardrails]] §10.13; enforced at both app and DB layer (docs/release-readiness.md step 10)                           |
| Unsupported claims in POC pool                                | Count of non-evidence-grounded claims found                                                                                                                                     | 0 (hard gate — §14.14 item 5)                                                                                          |                   | n/a                                                                          |           | Matches [[10-ai-evaluation-guardrails]] §10.4/§10.13                                                                                                 |
| Post-hoc interview/offer conversion                           | If timeline allows a follow-up check, whether platform-sourced finalists convert to interview/offer at a rate consistent with Dave's own long-run 97–98%+ definition of quality | Follow-up only, not part of initial go/no-go if timeline doesn't allow it                                              |                   |                                                                              |           | §14.9's own long-run quality definition — optional, timeline-dependent                                                                               |
| At least one platform finalist Dave would have picked himself | Yes/No                                                                                                                                                                          | Yes required (retained legacy criterion + §14.15 failure condition)                                                    |                   | n/a                                                                          |           | Failure criterion, not just a quality miss — §14.15                                                                                                  |

---

## 3. Speed metrics — per role

Source: [[14-poc-specification]] §14.10.

| Metric                                    | Platform — Actual (wall-clock hours) | Dave — Actual (wall-clock hours) | Faster? | Notes                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------ | -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time from shared start to shortlist-ready |                                      |                                  |         | Per §14.14 item 11: speed is measured but never overrides the quality gates above — a faster-but-lower-quality result fails regardless of turnaround (§14.15) |

---

## 4. Candidate-progression funnel — per role, per side

Source: [[14-poc-specification]] §14.13.

| Stage                                                                                                  | Platform — count | Dave — count |
| ------------------------------------------------------------------------------------------------------ | ---------------- | ------------ |
| Sourced                                                                                                |                  |              |
| Passed mandatory gates                                                                                 |                  |              |
| Reached ranked pool                                                                                    |                  |              |
| Shortlisted (final 2–3)                                                                                |                  |              |
| Of which: duplicate with other side (excluded from quality-differentiation per [[poc-launch-plan]] §6) |                  |              |

---

## 5. Evidence requirements — per role

Source: [[14-poc-specification]] §14.11. Every platform-side shortlisted
candidate ships with a full evidence trail per [[08-candidate-scoring]] —
this is itself a demonstrable differentiator to show Dave, not only an
internal QA gate.

| Shortlisted candidate    | Evidence trail complete? | Any unverified/insufficient-evidence field remaining? | Reviewer sign-off |
| ------------------------ | ------------------------ | ----------------------------------------------------- | ----------------- |
| _(candidate 1)_          |                          |                                                       |                   |
| _(candidate 2)_          |                          |                                                       |                   |
| _(candidate 3, if used)_ |                          |                                                       |                   |

---

## 6. Acceptance criteria checklist (§14.14 — reported once per POC, not per role)

All twelve items, **status as of this wave: none agreed by Dave.** This
table exists to track agreement and, after the run, satisfaction — it does
not assert either has happened.

| #   | Criterion (see [[14-poc-specification]] §14.14 for full text)                                                                          | Agreed by Dave?                                                         | Satisfied in run? |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| 1   | Two live roles benchmarked (one standard, one senior/difficult)                                                                        | Pending                                                                 |                   |
| 2   | Max 3 shortlisted candidates per role                                                                                                  | Pending                                                                 |                   |
| 3   | Min 90% overall match score to enter ranked consideration (pragmatic cutoff, not a calibration claim — [[08-candidate-scoring]] §8.13) | Pending                                                                 |                   |
| 4   | 100% mandatory-gate compliance among ranked/shortlisted (structural)                                                                   | N/A — already enforced by construction                                  |                   |
| 5   | Zero unsupported claims (hard gate)                                                                                                    | N/A — already enforced by construction                                  |                   |
| 6   | Human review completed before any outreach                                                                                             | Pending                                                                 |                   |
| 7   | Candidate interest confirmed before final shortlist entry (where outreach authorized)                                                  | Pending — blocked on account-ownership question, [[poc-launch-plan]] §7 |                   |
| 8   | Shared benchmark start time for both sides                                                                                             | Pending — see [[poc-launch-plan]] §4                                    |                   |
| 9   | Duplicates excluded from quality-differentiation, counted toward speed                                                                 | Pending (methodology default, see [[poc-launch-plan]] §6)               |                   |
| 10  | Evidence % reported separately from overall score, never blended                                                                       | N/A — already enforced by construction                                  |                   |
| 11  | Speed never overrides quality gates                                                                                                    | Pending                                                                 |                   |
| 12  | Dave makes the final shortlist/go-no-go decision                                                                                       | N/A — structural, Core Principle #7/#8                                  |                   |
| —   | Retained: gate-decision AI-quality agreement ≥90% AND ≥1 platform finalist Dave independently confirms                                 | Pending                                                                 |                   |

---

## 7. Methodology-comparison framing (read before interpreting any table above)

Per [[14-poc-specification]] §14.9 and [[08-candidate-scoring]] §8.13: this
scorecard's match-score row is a **correlation** check, not an identity
check. The platform's weighted-scoring methodology and Dave's proprietary
90%/95%/97–98% algorithm are different systems measuring different things
in different ways — the meaningful comparison is whether they surface and
rank the same strong candidates, not whether "95%" means the same thing on
both sides. Nothing in this scorecard should be read as validating the
platform's score against Dave's thresholds as a calibration target; the
POC is the mechanism to compare two methodologies, not to reverse-engineer
one from the other.

Related documents: [[14-poc-specification]] · [[poc-launch-plan]] ·
[[poc-operating-procedure]] · [[08-candidate-scoring]] ·
[[10-ai-evaluation-guardrails]] · [[07-data-model]]
