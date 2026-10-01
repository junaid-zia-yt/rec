# 14 — POC Specification

## 14.1 Framing

**[CONFIRMED]** The MOM already defines the POC's shape: vendor and client independently source candidates for the same one or two live roles, starting from a shared point in time, compared on speed **and** quality against Dave's own 90%/95%/97–98% thresholds. **[CONFIRMED — risk, named in the MOM itself]**: success criteria are still qualitative ("equal or better quality"), which risks a disputed outcome. This document proposes the quantification the MOM calls for.

## 14.2 Recommended Role Selection

One standard role + one senior/difficult-to-fill role, per the project instructions. **[CLIENT CONFIRM]** Dave selects the actual two roles and supplies JDs (MOM action item #4) — this cannot be decided by the vendor.

## 14.3 Scope

- Same JD, same start timestamp, both sides sourcing independently and in parallel — no sharing of candidates found until the comparison point (to keep the benchmark uncontaminated).
- Platform side runs the full pipeline: JD parse → requirements → scorecard → sourcing/import → gates → scoring → recruiter review → shortlist.
- Client side runs Dave's existing manual process unchanged.

## 14.4 Role-Calibration Process

**[RECOMMENDATION]** Before sourcing starts, both sides review the JD and mandatory/preferred split together (a short calibration call) so the platform's scorecard isn't silently mis-tuned against what Dave actually means by "90%" — otherwise the comparison measures two different definitions of match, not two processes producing the same definition faster.

## 14.5 Shared Start Time & Search Boundaries

Both sides start from an agreed timestamp. **[CLIENT CONFIRM]** search boundaries (geography, source pools) should be explicitly agreed — the vendor pitch in the MOM discusses sourcing "Caribbean, North Africa, Europe" candidates, which is a broader pool than Dave's typical search; an unbounded comparison isn't a fair "same conditions" test unless that's the deliberate point (broader reach as part of the value prop, in which case say so explicitly in the report, not silently).

## 14.6 Deduplication Rules

If both sides independently surface the same candidate, that candidate counts toward each side's _speed_ metric (both found them) but is excluded from the _quality-differentiation_ comparison, since it can't distinguish the two methodologies.

## 14.7 Candidate-Contact Rules

**[CLIENT CONFIRM — blocks POC execution]** Given the unresolved LinkedIn/account-ownership question ([[11-integration-plan]] §11.3), the POC's outreach step needs an explicit agreement on whose accounts/channels the vendor side uses, so the POC doesn't stall on the same unanswered question from the discovery call.

## 14.8 Shortlist Size

2–3 candidates per side, matching Core Principle #9 and Dave's own stated practice.

## 14.9 Quality Metrics (quantified — this is the MOM's own request)

- **Gate-decision agreement rate** vs. Dave's manual assessment of the same candidates (does the platform agree with Dave on who's disqualified, and why).
- **Match-score correlation**, not identical numbers — the platform's methodology and Dave's proprietary algorithm are different systems; the meaningful test is whether they _rank the same candidates highly_, not whether "96%" means the same thing in both.
- **Evidence completeness** — % of the platform's shortlisted candidates' claims with verifiable, cited evidence (target: 100%, since this is a structural guarantee, not a tuning target).
- **Post-hoc interview/offer conversion**, if the timeline allows a follow-up check — the MOM's own long-run definition of quality (97–98%+ "typically convert to offers").

## 14.10 Speed Metrics

Time from shared start to shortlist-ready, measured in wall-clock hours, for each side.

## 14.11 Evidence Requirements

Every platform-side shortlisted candidate must ship with full evidence trails per [[08-candidate-scoring]] — this is itself a demonstrable differentiator to show Dave, not just an internal QA gate.

## 14.12 Human-Review Process

A recruiter (agency-side) completes the same QR-01 review step used in production — the POC is a real run of the actual workflow, not a demo shortcut, so its result is representative of what production behavior will actually look like.

## 14.13 Candidate-Progression Metrics

Track how many candidates were sourced → passed gates → reached the ranked pool → were shortlisted, for both sides, to show the funnel, not just the final 2–3.

## 14.14 Acceptance Criteria — POC Defaults (configurable, requires client approval)

Per the MOM: vendor proceeds to paid engagement if the platform is **faster and equal-or-better on quality**. The MOM does not itself specify numeric thresholds, so — per the "use these proposed POC defaults unless the MOM explicitly says otherwise" instruction — the following operating defaults are adopted as the working definition of "equal-or-better," **every one of them marked configurable and pending explicit client approval**, not yet agreed:

1. Two live recruitment roles benchmarked (one standard, one senior/difficult-to-fill) — matches §14.2.
2. Maximum **3** shortlisted candidates per role — matches Core Principle #9 / §14.8.
3. Minimum **90%** overall match score for a candidate to enter ranked consideration. **[Note — reconciling with §14.1/§14.4]**: this reuses Dave's own "90%" figure as a POC _operating parameter_ (a ranking cutoff we agree to use for this benchmark), not as evidence the two scoring methodologies are equivalent — [[08-candidate-scoring]] §8.13 still cautions against treating Dave's thresholds as a validated target for the platform's own methodology; adopting the number here is a pragmatic, revisable choice to give the benchmark a concrete cutoff, not a calibration claim.
4. **100%** mandatory-gate compliance among ranked/shortlisted candidates — a structural guarantee already enforced by [[08-candidate-scoring]] §8.1, not a target to hit but a property that must simply hold; see [[10-ai-evaluation-guardrails]] §10.13 for how this is verified.
5. **Zero** unsupported (non-evidence-grounded) claims in the POC candidate pool — hard gate, matches [[10-ai-evaluation-guardrails]] §10.4/§10.13.
6. Human review completed before any outreach is sent (matches OUT-01, Core Principle #3).
7. Where outreach is authorized for the POC, candidate interest is confirmed before a candidate enters the _final_ shortlist (distinct from entering ranked consideration under #3).
8. Shared benchmark start time for both sides (§14.5).
9. Duplicate candidates (found by both sides) excluded from the quality-differentiation comparison, though still counted toward each side's speed metric (§14.6).
10. Evidence coverage (the evidence-percentage figure) is reported **separately** from the overall match score — never blended into one number — matching the confirmed screenshot's own "score / gates-passed / evidence-%" pattern.
11. Speed is measured, but **never** allowed to override the quality gates above — a faster-but-lower-quality result fails the POC regardless of turnaround time, per the MOM's own explicit failure condition (§14.15).
12. The **client** (Dave) makes the final shortlist/go-no-go decision — the platform's metrics inform that decision, they do not automate it (Core Principle #7/#8).

Retained from the original draft, still in force: gate-decision AI-quality agreement ≥90% (an eval metric distinct from #4's structural guarantee — see [[10-ai-evaluation-guardrails]] §10.13) AND at least one platform-sourced finalist that Dave independently confirms he would have shortlisted himself.

## 14.15 Failure Criteria

Any of: a shortlisted candidate with a failed mandatory gate reaches Dave's review (structural failure, not just a quality miss); a fabricated/unverifiable evidence citation is found; the platform is slower than Dave's manual process; Dave does not independently endorse at least one finalist as one he'd have picked himself.

## 14.16 Dispute-Resolution Process

**[RECOMMENDATION]** Agree in advance (before the POC starts) that any scoring disagreement is resolved by joint review of the _evidence_, not the _percentage_ — i.e., "why did the platform say X passed this gate" is answerable by pointing at a citation, which is the whole point of the evidence-first design (Core Principle #2). This should be written down and agreed with Dave before the POC, not improvised if a dispute arises.

## 14.17 Completion Decision

Documented in a `POC_results` comparison report (see [[07-data-model]]), reviewed jointly, with an explicit go/no-go recorded — not left as an informal verbal impression, given how much rides on this one test per the MOM's own risk section.

Related documents: [[01-project-context]] · [[08-candidate-scoring]] · [[10-ai-evaluation-guardrails]] · [[18-blocking-questions]]
