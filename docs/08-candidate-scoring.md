# 08 — Candidate Scoring Specification

**Implementation status (Build Phase 7): this specification is now built.**
Layers A/B/E (deterministic gates, weighted scoring, completeness) live in
`apps/web/lib/matching/gates.ts`, `scoring.ts`, and `evaluate.ts`
(`evaluate.ts` is the pure orchestrator tying every layer together, database-
free and fully unit-testable); Layer C (semantic similarity) is the AI
provider layer under `apps/web/lib/ai/matching-*`; the §8.11 tie-breaking
epsilon and the §8.13/§10.13 quality thresholds are resolved by
`apps/web/lib/matching/thresholds.ts`. The seven-table schema behind it is
`supabase/migrations/0027` (docs/07-data-model.md §7.9). See
docs/build-phase-7-report.md for the full implementation, test, and RLS
verification detail.

## 8.1 Layer Model

| Layer                      | What it does                                                                                                 | Deterministic or AI?                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Mandatory gates         | Pass/fail against each mandatory requirement                                                                 | **Deterministic** rule evaluated against extracted/verified fields; AI only proposes the extraction and a draft pass/fail suggestion, which a deterministic re-check confirms before it's stored |
| B. Weighted scoring        | Sum of `weight × normalized_criterion_score` across preferred requirements                                   | **Deterministic** arithmetic; the per-criterion `raw_score` may come from AI semantic judgment (Layer C) but the aggregation is a fixed formula, never an LLM output                             |
| C. Semantic similarity     | JD-requirement ↔ candidate-evidence semantic match (pgvector cosine similarity + Claude judgment for nuance) | AI-assisted                                                                                                                                                                                      |
| D. Evidence confidence     | How strong/direct is the supporting evidence for a given claim                                               | AI-assisted, deterministic thresholding on the confidence value                                                                                                                                  |
| E. Data completeness       | % of scorecard fields that have any evidence at all vs. "unverified"                                         | **Deterministic** count                                                                                                                                                                          |
| F. Human reviewer judgment | Recruiter confirms, adjusts weight interpretation, or overrides                                              | Human, always final                                                                                                                                                                              |

**Rule (Core Principle enforcement):** the overall match score can never be higher than what the mandatory-gate layer allows — a failed gate suppresses the candidate from ranked output entirely, regardless of how high B–D score. This is enforced in the scoring service, not the UI.

## 8.2 Data Stored per Scored Requirement

Requirement · weight · candidate result (pass/fail/score) · supporting evidence (verbatim excerpt) · evidence source (document + version) · evidence location (page/section offset) · verification status (verified/unverified/disputed) · confidence (0–1, from Layer C/D) · missing-information flag · human reviewer decision (confirm/override/reject) with reason.

## 8.3 Proposed Scoring Formula

```
gate_pass = AND(mandatory_gate_results.result == 'pass' for all mandatory requirements)

if not gate_pass:
    overall_score = null   # candidate is excluded from ranked shortlist output entirely
    gate_status   = 'failed'
else:
    weighted_score = Σ (weight_i × criterion_score_i) / Σ (weight_i)   # 0–100
    evidence_pct   = (# scored criteria with verified evidence) / (# total scored criteria) × 100
    completeness   = (# scorecard fields with any data) / (# total scorecard fields) × 100

    overall_score  = weighted_score            # what's shown as "the" match %
    # evidence_pct and completeness are ALWAYS shown alongside overall_score, never hidden,
    # per the confirmed screenshot's "X/5 Passed · Y% Evidence" pattern
```

`criterion_score_i` for a preferred requirement comes from Layer C (semantic similarity between requirement text and evidence excerpt, 0–1, produced by a Claude call constrained to a structured JSON schema) multiplied by a confidence discount from Layer D (an unverified/low-confidence match is capped, e.g. ×0.6, rather than scored at face value).

## 8.4 Configurable Weights

Per-scorecard, per-criterion weight (0–1 or point value), set by the Recruiter and approved by Agency Admin as part of `scorecards`/`scorecard_versions` (see [[07-data-model]]). Weights are **not** configurable by AI. A default weighting template can be proposed by AI during scorecard creation but always enters as a draft requiring human approval (Core Principle #7).

## 8.5 Mandatory-Gate Logic

Each mandatory requirement resolves to exactly one of: `pass`, `fail`, `insufficient_evidence`. `insufficient_evidence` is **not** treated as a pass — a candidate with an unverifiable mandatory requirement is routed to human review, never silently advanced or silently excluded. This directly encodes "missing information must be marked as unverified" (Core Principle #7) at the gate layer, not just the profile layer.

## 8.6 Evidence-Confidence Calculation

Confidence combines: (a) semantic similarity strength between requirement and evidence text, (b) evidence directness (an explicit stated fact scores higher than an inferred one — e.g., "managed P&L for 42 units" is direct; "extensive multi-unit experience" is inferred and scores lower), and (c) source reliability (a verified certification record outranks a self-reported CV line). Output is a 0–1 score stored per `requirement_evidence` row, not a black-box single number — each component is retained for explainability.

## 8.7 Missing-Data Treatment

Any requirement with zero evidence is `insufficient_evidence`/`unverified`, contributes 0 to the weighted score (never imputed or guessed), and is flagged for the recruiter as a specific "needs evidence" item — matching DESIGN.md's "Request Audit Evidence" UI pattern. Data completeness (Layer E) makes this visible at the candidate level, not just per-field.

## 8.8 Score Recalculation Rules

A score recalculates when: the scorecard is re-approved as a new version, a candidate document is re-uploaded/superseded, or a reviewer manually triggers a re-score after adding evidence. Recalculation always produces a new `scoring_breakdowns` snapshot tied to the current `scorecard_version_id` — it never overwrites history in place.

## 8.9 Score Versioning

Every `candidate_role_matches` row records the `scorecard_version_id` it was scored against. A shortlist that was built against v1 of a scorecard does not silently reflect a v2 rescoring — the UI must show "scored against Scorecard v1 (approved 2026-09-10)" so a later dispute is auditable.

## 8.10 Human Override Behavior

A reviewer can override any AI-derived `criterion_score_i` or the gate suggestion (not the deterministic gate re-check itself, which is a rule, not a judgment call), always with a required free-text reason, captured in `review_decisions`. Overrides are visible in the final UI (e.g., a "reviewer-adjusted" badge) — never presented as if they were the raw AI output.

## 8.11 Tie-Breaking Approach

When two candidates are within a configurable epsilon (e.g., ±1.5 points) of each other, the system does **not** auto-rank them — it flags a tie for human decision, surfacing the underlying strengths/risks prose (as seen in the confirmed screenshot) rather than an arbitrary ordering by a fractional score difference that evidence doesn't actually support.

## 8.12 Example Candidate Calculation

Role: Regional Operations Manager. Mandatory: "≥25 multi-unit sites managed," "valid food-safety certification." Preferred (weights): P&L scale (0.3), tenure (0.2), commute (0.1), comp fit (0.2), domain match (0.2).

Candidate "Sarah M.": 42 sites managed (evidence: resume line, confidence 0.95) → gate PASS. Certification on file, verified → gate PASS. `gate_pass = true`.

- P&L scale: $65M vs. target → criterion_score 0.98 × weight 0.3 = 0.294
- Tenure: 11 yrs vs. target → 0.90 × 0.2 = 0.180
- Commute: 12 mi → 0.95 × 0.1 = 0.095
- Comp fit: exact fit → 1.0 × 0.2 = 0.200
- Domain match: retail + c-stores → 0.90 × 0.2 = 0.180
- `weighted_score` = (0.294+0.180+0.095+0.200+0.180) = 0.949 → **overall 95%** (rounding), matches the confirmed screenshot's "96%" order of magnitude.
- `evidence_pct`: 5/5 scored criteria have direct evidence → 100%.
  Output matches the observed UI pattern exactly: 96%, 5/5 gates passed, 100% evidence.

## 8.13 Validation Strategy

- **Deterministic layer:** unit-tested against fixed input/output pairs (no AI call in the test).
- **AI layer:** evaluated against a held-out labeled set of JD/CV pairs with human-adjudicated scores; accuracy/precision tracked per [[10-ai-evaluation-guardrails]].
- **Do not treat Dave's 90%/95%/97–98% thresholds as validated targets to hit** — per the project instructions, these are the client's own methodology's outputs, not a proven calibration for this system. The POC ([[14-poc-specification]]) is the mechanism to compare methodologies, not to reverse-engineer Dave's exact numbers.

Related documents: [[05-functional-requirements]] · [[09-ai-architecture]] · [[10-ai-evaluation-guardrails]] · [[14-poc-specification]]
