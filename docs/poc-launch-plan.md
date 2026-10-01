# POC Launch Plan — Two-Role Benchmark with Dave

Build Phase 16 ("Preparation for the two-role client POC"), Wave 1.
**Documentation only — no code changed to produce this plan.**

Approved scope for this wave: prepare the operational plan. **Do not start
production usage until the launch checklist is approved** (this wave's
explicit constraint, carried forward from the phase approval). Nothing in
this document should be read as authorization to run the POC yet — it is
the plan for how it will run once every open item below is resolved with
Dave.

This document operationalizes [[14-poc-specification]] into a launch-ready
plan. It cites that specification rather than restating it in full — read
[[14-poc-specification]] first for the underlying rules and reasoning.

---

## 1. Roles and JDs — requires Dave

Per [[14-poc-specification]] §14.2: one standard role + one senior/
difficult-to-fill role. **Dave selects the actual two roles and supplies
both JDs** — this is MOM action item #4 and cannot be decided by the
vendor (docs/18-blocking-questions.md Q-P1-02). Nothing about the roles
is assumed or defaulted here. Until both JDs are in hand, no other step
below can start its clock.

**Recommended (not yet agreed):** a short role-calibration call before
sourcing starts, per [[14-poc-specification]] §14.4, so the platform's
scorecard mandatory/preferred split matches what Dave actually means by
each requirement — otherwise the benchmark measures two different
definitions of "match," not two processes racing on the same definition.

---

## 2. Scorecard approval workflow (must complete before the benchmark clock starts)

The benchmark's shared start time (§4 below) is the point both sides begin
sourcing — so the platform-side scorecard must already be **frozen and
approved** before that timestamp, not built during the benchmark window.
Concretely, using the actual implemented pipeline (docs/release-readiness.md
Part A, steps 4–6):

1. JD is pasted into the platform (paste path only — see §7's note on the
   upload-extraction limitation) for each of the two roles.
2. Requirement extraction runs, producing proposed `job_requirements` rows.
3. The assigned recruiter reviews/edits the proposed requirements and
   builds the scorecard (mandatory gates + weighted criteria).
4. The agency admin approves the scorecard version. Approval freezes a
   `scorecard_versions.requirement_snapshot` — the exact version every
   candidate in the POC is scored against ([[08-candidate-scoring]] §8.9).
5. Only once both scorecards (one per role) are in `active` status does
   the benchmark clock start.

This sequencing is a hard prerequisite, not a suggestion: scoring a
candidate against a still-draft or later-edited scorecard would make the
comparison unauditable (§8.9's own point about a shortlist silently
reflecting a rescoring).

---

## 3. Role-calibration call

See §1 above — recommended, not yet scheduled or agreed with Dave.

---

## 4. Shared benchmark start time

Both sides commit to one agreed, recorded timestamp
([[14-poc-specification]] §14.5, §14.14 item 8). **Not yet set** — depends
on §1 (roles/JDs) and §2 (scorecards approved) both being complete first.
When agreed, record it in the eventual `POC_results` comparison report
([[14-poc-specification]] §14.17) as the anchor for every speed metric in
[[poc-success-scorecard]].

---

## 5. Search boundaries — requires Dave's explicit agreement

**Flagged, not defaulted.** [[14-poc-specification]] §14.5 and
docs/18-blocking-questions.md Q-P2-02 both leave this open: is the POC's
sourcing pool US-only (matching Dave's typical search), or the broader
international pool (Caribbean/North Africa/Europe) raised in the vendor's
own pitch? These are not "same conditions" tests unless the boundary is
identical for both sides, or the broader reach is the deliberate point of
the comparison — in which case that must be stated explicitly in the
final report, not silently assumed. **This plan takes no position and
adopts no default.** Dave's explicit agreement on scope is required before
sourcing starts on either side.

---

## 6. Candidate deduplication procedure

Operationalizing [[14-poc-specification]] §14.6's rule ("counts for speed,
excluded from quality-differentiation if found by both sides") into
concrete steps, since no dedup UI feature exists in the platform today
(there is no automated candidate-matching-across-sources feature built for
this purpose — this is a manual process, stated plainly, not a built
capability):

1. At the shared start time, both sides begin sourcing independently, with
   no visibility into what the other side has found (§14.3's "no sharing
   until the comparison point" rule).
2. At the point each side reaches shortlist-ready (or at an agreed
   checkpoint before then), the recruiter and Dave each produce a plain
   list of candidate full names (+ LinkedIn URL or equivalent identifier
   where available) they sourced, independent of pipeline stage.
3. The recruiter (or agency admin) manually cross-references the two name
   lists for exact or clear near-duplicate matches (same person, different
   spelling/source). This is a manual review step, not an automated
   dedup — record the method used in the POC results, since "how dedup was
   decided" is itself part of an auditable comparison.
4. Any candidate found on both lists is marked as a duplicate in the
   working notes:
   - It counts toward **each** side's speed metric (both found them,
     independently, within the window).
   - It is **excluded** from the quality-differentiation comparison in
     [[poc-success-scorecard]] (it can't distinguish methodologies if both
     found it).
5. The dedup decision and rationale for any ambiguous/near-match case is
   recorded in the `POC_results` report so a later dispute about "was that
   really a duplicate" is answerable, per [[14-poc-specification]] §14.16's
   evidence-first dispute-resolution principle.

---

## 7. Candidate-contact rules — BLOCKED

**This step cannot start until Dave confirms LinkedIn/Apollo account
ownership.** [[14-poc-specification]] §14.7 and docs/18-blocking-questions.md
Q-P1-01 both flag this as unresolved from the discovery call (MOM §8): does
the agency-side outreach in the POC use Dave's own LinkedIn/Apollo
accounts, or agency-owned accounts operating on his behalf? This has real
data-ownership and compliance implications and directly blocks POC
execution's outreach step — it is not a detail to work around or assume.
**No outreach may be sent in the POC until this is explicitly answered.**
The vendor's recommended default (client-owned accounts, agency operating
under documented authorization — docs/18-blocking-questions.md Q-P1-01) is
a recommendation only; it has not been agreed by Dave and this plan does
not treat it as settled.

Separately, and unconditionally regardless of how account ownership is
resolved: any LinkedIn-side activity must stay within LinkedIn's platform
rules — manual recruiter-driven outreach only, no scraping or automated
messaging (docs/11-integration-plan.md §11.3, project instructions).

---

## 8. Maximum candidates per role

**3 candidates per role**, matching Core Principle #9 and
[[14-poc-specification]] §14.8/§14.14 item 2. This is enforced in the
implemented platform by `shortlists.max_candidates` defaulting to 3, with
any override requiring a recorded authorizer + reason
(docs/release-readiness.md Part A step 14) — not a POC-specific control,
the same guardrail production shortlists use.

---

## 9. Human-review assignment

The platform-side QR-01 review step ([[14-poc-specification]] §14.12 —
"a real run of the actual workflow, not a demo shortcut") is completed by
**the recruiter assigned to the POC's two recruitment projects**, using
the same `recordReviewDecisionAction`/override workflow production uses
(docs/release-readiness.md Part A step 11). The agency admin retains
oversight (scorecard approval, and any escalation per §12 below), but the
QR-01 review itself is a recruiter action, matching the permission matrix
([[06-roles-permissions]] §6.2.5) and keeping the POC representative of
real production behavior rather than an admin-shortcut path.

**Specific individual assignment:** not yet named — to be confirmed once
the agency's POC team is finalized alongside role selection (§1).

---

## 10. Client-review process

Once the platform-side shortlist (2–3 candidates, §8) is built and
internally approved, it is submitted to Dave for review through the
platform's actual implemented client-facing flow, not a separate POC-only
interface:

1. Recruiter/agency admin completes internal build and approval of the
   shortlist (`shortlists.status` moves through `draft` →
   `pending_internal_approval` → `internally_approved`).
2. Agency admin or recruiter sends it to the client
   (`sendShortlistToClientAction`), moving `status` to `sent_to_client` —
   the first point at which Dave's `client_decision_maker` account can see
   it at all ([[06-roles-permissions]] §6.2.6).
3. Dave reviews the shortlist via the client-facing shortlist view: score,
   gates-passed, evidence %, completeness %, and the recruiter's
   client-visible note — never internal recruiter notes or scoring-
   methodology internals ([[06-roles-permissions]] §6.2.6/§6.3).
4. Dave records a decision — **accept**, **discuss**, or **reject** — with
   a comment, via `recordClientDecisionAction`, the one action his role has
   an `approve`-level permission on (docs/release-readiness.md Part A step
   15). There is no other decision surface for him in this workflow.
5. Any "discuss" outcome is resolved through the dispute-resolution
   approach in §12 below before the POC is marked complete.

This is the same client-decision mechanism production will use — the POC
does not get a bespoke review UI.

---

## 11. Completion and decision criteria

Cross-referencing [[14-poc-specification]] §14.14 (acceptance criteria)
and §14.15 (failure criteria) — cited here, not re-pasted in full; read
those sections directly for the complete list.

**Success**, per the MOM's own framing: the platform is **faster and
equal-or-better on quality** than Dave's manual process. §14.14's twelve
numbered items are the vendor-proposed _operational definition_ of
"equal-or-better," every one of them explicitly marked in that section as
configurable and pending Dave's explicit approval — this plan does not
upgrade that status. Structural items (100% mandatory-gate compliance
among ranked candidates, zero unsupported claims, human review before
outreach, evidence % reported separately from score) are properties the
platform already enforces by construction, not tuning targets. The one
adjustable operating parameter — the 90% ranking-consideration cutoff
(§14.14 item 3) — is explicitly reused from Dave's own figure as a
_pragmatic benchmark cutoff_, not a claim that the two methodologies are
calibrated to the same scale; [[08-candidate-scoring]] §8.13 remains the
governing caution on that point.

**Failure**, per §14.15: any shortlisted candidate with a failed mandatory
gate reaching Dave's review; a fabricated/unverifiable evidence citation
found anywhere in the POC pool; the platform running slower than Dave's
manual process; or Dave not independently endorsing at least one finalist
as someone he'd have picked himself.

The result is documented in a `POC_results` comparison report
([[14-poc-specification]] §14.17, [[07-data-model]]), reviewed jointly by
both sides, with an explicit go/no-go recorded — never left as an informal
verbal impression.

### Requires Dave's explicit confirmation before launch

None of the following has been agreed. This plan flags each one rather
than defaulting silently:

1. **Role selection and JDs** — the two actual roles for the benchmark and
   their job descriptions (§1; MOM action item #4; Q-P1-02).
2. **Search boundaries** — US-only vs. the broader international sourcing
   pool (§5; §14.5; Q-P2-02).
3. **Candidate-contact / account ownership** — whose LinkedIn/Apollo
   accounts the agency side uses for outreach (§7; §14.7; Q-P1-01). POC
   outreach cannot start without this.
4. **The §14.14 acceptance-criteria defaults themselves** — all twelve are
   vendor-proposed operating parameters, explicitly pending client
   approval, not yet agreed (§11).
5. **Shared benchmark start time** — the specific agreed timestamp (§4).
6. **Role-calibration call** — whether Dave will do the recommended
   pre-sourcing calibration session (§1/§3).
7. **Human-review assignment** — the specific individual recruiter for the
   POC, once the agency's POC team is finalized (§9).

Related documents: [[14-poc-specification]] · [[poc-success-scorecard]] ·
[[poc-operating-procedure]] · [[08-candidate-scoring]] ·
[[06-roles-permissions]] · [[11-integration-plan]] ·
[[18-blocking-questions]] · [[07-data-model]]
