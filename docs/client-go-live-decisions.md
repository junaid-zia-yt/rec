# Client Go-Live Decisions — Stakeholder Sign-Off Pack

Build Phase 17A ("Production Blocker Closure and Live Staging Verification"), Wave 4.
Documentation only — no code changes accompany this document.

---

## Why this document exists

`docs/production-readiness.md` Gate 13 ("Stakeholder approval: recorded") states plainly: **no document
anywhere in this Project records a signed-off, dated approval from Dave (the client) or any other named
stakeholder for any go-live decision, scorecard threshold, retention period, consent language, DPA term, or
outreach-account-ownership arrangement.** `docs/final-release-report.md` independently confirms the same
finding and blocks production release on it.

Per this Project's own repeated rule across every prior review (`docs/poc-launch-checklist.md`'s Mandatory
Completion Gate, `docs/production-readiness.md` Gate 13, `docs/final-release-report.md` §2): **an unsigned
item is never treated as approved.** A vendor-proposed default, however confidently it reads, however many
times it has been cited across this Project's documentation, is not a decision until a named person signs
it, on a specific date, in writing.

This document exists to close that gap structurally: it gives every open item identified across this
Project's history a real, fillable sign-off block — not a description of the decision, a place to actually
record it. Until a block below is filled in and dated, its item's status reads **UNSIGNED — NOT APPROVED**,
and it must be treated that way by every other document in this Project, including ones that currently cite
a "vendor-proposed default" as if it were settled.

Every item below is traced to where it was already raised in this Project — nothing here is a newly invented
open item.

---

### 1. Score thresholds (POC acceptance-criteria numeric cutoffs)

**Decision needed:** Confirm the numeric score thresholds proposed as POC acceptance criteria — principally
the 90% minimum match score to enter ranked consideration, and the MOM's own 95%/97–98% quality-framing
figures.

**Context:** `docs/14-poc-specification.md` §14.1 records the MOM's own 90%/95%/97–98% thresholds as Dave's
stated benchmarks. §14.14 item 3 proposes reusing the 90% figure as a POC _operating parameter_ — explicitly
"a pragmatic, revisable choice... not a calibration claim" that the two scoring methodologies are
equivalent ([[08-candidate-scoring]] §8.13 is the governing caution). `docs/poc-launch-checklist.md` item 4
states this item is blocked "awaiting Dave's approval" and cannot move past ❌ until he signs off on these
specific numbers.

**Vendor-proposed default (if any):** 90% minimum overall match score to enter ranked consideration
(reusing Dave's own figure as a benchmark cutoff, per §14.14 item 3's explicit caveat).

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 2. Mandatory qualification gates (per-role mandatory vs. preferred split)

**Decision needed:** For each POC role, confirm which requirements are mandatory pass/fail gates versus
preferred/weighted criteria.

**Context:** `docs/14-poc-specification.md` §14.4 recommends a role-calibration call before sourcing starts
specifically so the platform's mandatory/preferred split isn't "silently mis-tuned against what Dave
actually means by '90%'" — otherwise the comparison measures two different definitions of match, not two
processes producing the same definition faster. This is inherently role-specific: [[14-poc-specification]]
and [[poc-launch-plan]] both treat role selection (item 12 below) as a separate, still-open prerequisite, so
no global default can be proposed here.

**Vendor-proposed default (if any):** None — this cannot have a global default; it must be set per role,
after roles are selected (item 12) and reviewed jointly with the client per §14.4's recommended calibration
call.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 3. Human-review requirements (client-side reviewer assignment)

**Decision needed:** Confirm the client's own internal reviewer/point of contact who will conduct the
client-side review of the shortlist Dave receives — **not** whether human review before outreach/submission
happens at all.

**Context:** Core Business Rules #3 and #8 make human review before outreach and before client submission a
structural, non-negotiable platform rule — this is already enforced in code, in two independent layers, per
`docs/release-readiness.md` Part A steps 10/14 (the eligibility gate) and step 12 (the outreach-approval
evidence backstop). Nothing about that rule is decidable by the client or vendor; it cannot be turned off.
This item exists solely so the client names who, specifically, will exercise the client-side review Core
Rule #7/#8 gives Dave (`recordClientDecisionAction`, [[poc-launch-plan]] §10) — an operational assignment,
not a policy choice.

**Vendor-proposed default (if any):** None — this names a specific person on the client side; the platform
proposes no default reviewer.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 4. Data-retention period

**Decision needed:** Confirm how long candidate personal data is retained after a role closes.

**Context:** `docs/release-readiness.md` §(a) item 2 states directly: no retention-period concept exists
anywhere in the schema. `docs/18-blocking-questions.md` Q-P1-04 lists this as unresolved and notes a
recommended-but-unagreed 24-month default from `docs/12-security-compliance.md` §12.8. `docs/privacy-review.md`
§2 confirms this is "Tracked-business-decision-needed" — a real open item, not a code gap, and additionally
flags that even once a period is chosen, the automated purge mechanism to enforce it still does not exist in
code and is separate future work.

**Vendor-proposed default (if any):** None — requires the client's own determination. (A 24-month figure
was recommended as a starting point in `docs/12-security-compliance.md` §12.8, but that document itself
labels it a recommendation, not a default this Project treats as agreed.)

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 5. Candidate-erasure policy

**Decision needed:** Confirm the client's position on whether this platform's erasure implementation
(including its known, disclosed gaps) satisfies the client's own erasure obligations to candidates.

**Context:** `docs/privacy-review.md` §3 fixed the Critical gap that previously meant a data-subject erasure
request had no way to be fulfilled at all (`erasePersonalDataAction`, redacting PII across `candidates` and
related tables). **Update (Build Phase 17A, Wave 2):** the Storage-file-deletion gap flagged below as open
when this item was first drafted has since been closed in this same phase — `erasePersonalDataAction` now
deletes every uploaded CV/document's Storage object before anonymizing the DB record (Storage-first
ordering, idempotent retry, partial failure surfaced rather than swallowed), verified by real tests
asserting both the DB anonymization and the exact Storage paths deleted, not merely asserted in code
comments. One real limitation remains, disclosed rather than silently gapped: append-only audit and
evidence tables (`requirement_evidence`, `audit_events`, `communication_events`, `candidate_responses`)
retain verbatim PII excerpts indefinitely by deliberate design — whether anonymized-audit-retention of this
kind satisfies GDPR Art. 17 / CCPA deletion obligations is flagged in `docs/12-security-compliance.md` §12.9
as a legal determination, not a code question.

**Vendor-proposed default (if any):** None — requires the client's own determination, made jointly with
legal counsel per item 7 below.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 6. Consent and privacy responsibilities (candidate-facing language ownership)

**Decision needed:** Confirm who drafts the candidate-facing consent language and privacy notice — the
agency's own counsel, or the vendor.

**Context:** `docs/18-blocking-questions.md` Q-P2-01 asks this directly and records a recommended default.
`docs/privacy-review.md` §1 confirms the structural mechanism to _record_ consent already exists
(`candidate_consents.consent_status`/`consent_recorded_at`/`consent_recorded_by`), but what a candidate is
actually told and how consent is captured is not decided anywhere in this codebase — tracked as
"Tracked-business-decision-needed."

**Vendor-proposed default (if any):** The agency's own counsel owns drafting; the vendor supplies the
technical facts needed to draft it (per Q-P2-01's recommended default).

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 7. DPA / legal approval (Anthropic terms + overall legal sign-off)

**Decision needed:** Confirm this account's actual, current commercial API and Data Processing Agreement
terms with Anthropic have been reviewed and accepted, and record overall legal sign-off on processing real
candidate PII through this platform.

**Context:** `docs/release-readiness.md` §(a) item 4 states directly: "this account's actual, current
data-retention/training-use terms with Anthropic have not been confirmed; general knowledge of Anthropic's
standard terms is not a substitute for a signed agreement for this specific account." §(a) items 5–6 add
GDPR/UK-GDPR, CCPA/CPRA, and AI-employment-decision regulation (NYC Local Law 144-style bias-audit
requirements, EU AI Act high-risk classification) as dependent on facts (candidate geography, jurisdiction)
not yet known — none of these is a data-protection question this Project's own reviews can answer.
`docs/18-blocking-questions.md` Q-P0-04 flags the same regulatory-applicability question at P0 priority.

**Vendor-proposed default (if any):** None — requires the client's own legal determination. Q-P0-04's
recommended conservative posture (treat bias-audit/explainability requirements as a legal requirement until
a lawyer says otherwise) is a risk-management recommendation only, not a substitute for actual legal
sign-off.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 8. Outreach-account ownership — LinkedIn

**Decision needed:** Confirm whose LinkedIn account(s) the agency-side outreach in the POC and beyond will
use — client-owned, with the agency operating on the client's behalf under documented authorization, or
agency-owned.

**Context:** `docs/18-blocking-questions.md` Q-P1-01 records this was "asked directly in the discovery call
and left unanswered" (MOM §8). `docs/14-poc-specification.md` §14.7 and `docs/poc-launch-plan.md` §7 both
state this **blocks the POC's outreach step outright** — no outreach may be sent until it is answered.
`docs/11-integration-plan.md` §11.3 adds the unconditional platform-rule constraint that regardless of how
ownership is resolved, any LinkedIn-side activity must stay within LinkedIn's platform rules — manual
recruiter-driven outreach only, never scraping or automated messaging.

**Vendor-proposed default (if any):** Client-owned accounts, with the agency operating on the client's
behalf under a documented authorization — the lowest data-ownership risk for the client (Q-P1-01's
recommended default). Not yet agreed by Dave.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 9. Outreach-account ownership — Apollo

**Decision needed:** Confirm whether the agency provisions its own Apollo account/API key for contact
enrichment, or uses the client's existing Apollo account.

**Context:** `docs/11-integration-plan.md` §11.4 confirms Apollo is already in active use by the client (MOM
§3.2) and flags this as the same ownership question as LinkedIn, but a genuinely separate account/ownership
decision — it directly affects the Integrations screen's account-ownership field independently of item 8.
Build Phase 12 delivered a real, complete REST client against Apollo's People Match/Enrich endpoint
(`lib/integrations/apollo/apollo-client.ts`), unit-tested against mocked responses, but honestly never
exercised against a live Apollo account — no `APOLLO_API_KEY` has ever existed in this Project's history.

**Vendor-proposed default (if any):** None — this is genuinely an open ownership question distinct from
LinkedIn; §11.4 proposes no default, only that the ownership question must be answered before a key can be
configured.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 10. Email outreach (Resend) — pre-cleared, shown for completeness

**Decision needed:** None. Shown here only so the sign-off pack is complete and this channel's clean status
is on the record alongside the others.

**Context:** `docs/11-integration-plan.md` §11.5 states plainly: "Email is the only outreach channel with
zero blockers — it's in the approved stack (Resend) and requires no client account access." There is no
account-ownership question, no unresolved provider decision, and no client sign-off required for this
channel. (Separately, a live `RESEND_API_KEY` has never been configured in this Project's history —
`docs/poc-launch-checklist.md` item 8 — but that is an infrastructure-provisioning step, not a decision
requiring stakeholder sign-off, and is out of scope for this pack.)

**Vendor-proposed default (if any):** N/A — pre-cleared.

**Client decision:** N/A — no decision required for this channel.
**Approved by (name):** N/A
**Role/title:** N/A
**Date:** N/A
**Status:** ✅ NO CLIENT DECISION NEEDED — not subject to the UNSIGNED/NOT-APPROVED rule above, since
nothing here requires the client's approval.

---

### 11. SMS outreach

**Decision needed:** Confirm whether SMS outreach is deferred past the POC (no provider currently chosen),
or whether the client wants a provider selected and integrated before the POC.

**Context:** `docs/18-blocking-questions.md` Q-P1-03 states SMS is a named outreach channel in the client's
current process (MOM §3.2) but is not in the approved technology stack. `docs/11-integration-plan.md` §11.5
confirms a thin typed wrapper (`lib/integrations/sms/adapter.ts`) exists ready to plug a real provider
behind, but no provider is chosen, and `connectIntegrationAction` refuses to ever report SMS as connected
in the meantime.

**Vendor-proposed default (if any):** Defer SMS past the POC; email-only outreach for the initial build
(Q-P1-03's recommended default).

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 12. POC roles (role selection and JDs)

**Decision needed:** Confirm the two specific roles (one standard, one senior/difficult-to-fill) that will
be benchmarked in the POC, and supply both job descriptions.

**Context:** `docs/14-poc-specification.md` §14.2 and `docs/poc-launch-plan.md` §1 both state this is MOM
action item #4 and "cannot be decided by the vendor." `docs/18-blocking-questions.md` Q-P1-02 states plainly
there is no recommended default — "this genuinely requires the client." Every other timing-dependent item in
`docs/poc-launch-plan.md` (the shared benchmark start time, item 13's scorecard freeze, item 2's mandatory
gate split) is blocked on this item first.

**Vendor-proposed default (if any):** None — requires the client's own determination. There is genuinely
nothing to propose here.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 13. POC success criteria (consolidated §14.14 acceptance-criteria sign-off)

**Decision needed:** Confirm, as a single consolidated sign-off, the full set of POC acceptance criteria
defined in `docs/14-poc-specification.md` §14.14 — the twelve-item vendor-proposed operational definition of
"equal-or-better," plus the retained gate-decision AI-quality agreement (≥90%) and independent-finalist
criteria.

**Context:** §14.14's own text states every one of its twelve items is "marked configurable and pending
explicit client approval, not yet agreed." `docs/poc-launch-plan.md` §11 restates this without upgrading the
status: "this plan does not upgrade that status." The structural items (100% mandatory-gate compliance among
ranked candidates, zero unsupported evidence claims, human review before outreach, evidence % reported
separately from score) are properties the platform already enforces by construction and are not themselves
subject to negotiation — they are listed here so the client sees the complete picture in one place, not
because they are open. The one genuinely adjustable operating parameter — the 90% ranking-consideration
cutoff — is item 1 above; this item cross-references it rather than repeating it.

**Vendor-proposed default (if any):** Adopt all twelve §14.14 items as written, with item 1 (score
thresholds) as the one parameter still open above and cross-referenced here, not re-decided.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

### 14. Production release authority

**Decision needed:** Name, specifically, the individual with the authority to say "go" for a real production
deployment of this platform — this is itself an open decision, not a formality to be filled in later.

**Context:** `docs/06-roles-permissions.md` §6.1/§6.2 defines the platform's own role model — Platform Admin
(vendor-side SaaS operator, support/billing/infra only, explicitly never candidate decisions), Agency Admin
(owns the agency org), Recruiter, Client Decision-Maker, Read-Only Reviewer — but none of these titles is
itself "the person with authority to authorize a production deployment"; that is a business decision, not a
row in the permission matrix. `docs/go-live-plan.md` §3 proposes that "a human (Agency Admin or designated
release approver) triggers the `workflow_dispatch` run itself" as the recorded moment production deployment
is authorized, but names no specific individual. `docs/production-rollback.md` §7 goes further and states
directly that the one action capable of permanently destroying real candidate data (a point-in-time restore)
requires "a named business owner (e.g. Dave, or whoever holds that role once assigned)... no such named
business-owner approval authority has ever actually been recorded for this project" — the same gap this item
exists to close, extended here to ordinary go-live authority, not just disaster recovery. The actual
authorized signer for this business decision is Dave or the agency owner, not a platform role — the
platform's Agency Admin role is a permission level, not a legal authorization.

**Vendor-proposed default (if any):** None — this is itself the open decision; the platform's role model
(§6.1/§6.2) does not resolve it and this document proposes no substitute.

**Client decision:** _______________________________________________
**Approved by (name):** _______________________________________________
**Role/title:** _______________________________________________
**Date:** _______________________________________________
**Status:** 🔴 UNSIGNED — NOT APPROVED

---

## Master Approval-Status Table

Other phase reports and future waves should reference this table directly rather than re-deriving open-items
lists from `docs/poc-launch-checklist.md`, `docs/poc-launch-plan.md`, `docs/18-blocking-questions.md`, or
`docs/release-readiness.md` individually. This table is only ever authoritative for a row once that row's
sign-off block above has actually been filled in and dated — a citation of this table that reports a status
other than what the block above shows is wrong, not this table.

| #   | Item                                                   | Status                       |
| --- | ------------------------------------------------------ | ---------------------------- |
| 1   | Score thresholds                                       | 🔴 UNSIGNED — NOT APPROVED   |
| 2   | Mandatory qualification gates (per role)               | 🔴 UNSIGNED — NOT APPROVED   |
| 3   | Human-review requirements (client reviewer assignment) | 🔴 UNSIGNED — NOT APPROVED   |
| 4   | Data-retention period                                  | 🔴 UNSIGNED — NOT APPROVED   |
| 5   | Candidate-erasure policy                               | 🔴 UNSIGNED — NOT APPROVED   |
| 6   | Consent and privacy responsibilities                   | 🔴 UNSIGNED — NOT APPROVED   |
| 7   | DPA / legal approval                                   | 🔴 UNSIGNED — NOT APPROVED   |
| 8   | Outreach-account ownership — LinkedIn                  | 🔴 UNSIGNED — NOT APPROVED   |
| 9   | Outreach-account ownership — Apollo                    | 🔴 UNSIGNED — NOT APPROVED   |
| 10  | Email outreach (Resend)                                | ✅ NO CLIENT DECISION NEEDED |
| 11  | SMS outreach                                           | 🔴 UNSIGNED — NOT APPROVED   |
| 12  | POC roles (selection + JDs)                            | 🔴 UNSIGNED — NOT APPROVED   |
| 13  | POC success criteria (consolidated §14.14 sign-off)    | 🔴 UNSIGNED — NOT APPROVED   |
| 14  | Production release authority                           | 🔴 UNSIGNED — NOT APPROVED   |

**13 of 14 items UNSIGNED — NOT APPROVED. 1 of 14 pre-cleared (no decision required).** Zero items are
currently approved. This matches `docs/production-readiness.md` Gate 13 and `docs/final-release-report.md`
§2 exactly: as of this document, zero stakeholder approvals are recorded anywhere in this Project.

---

Related documents: [[14-poc-specification]] · [[poc-launch-checklist]] · [[poc-launch-plan]] ·
[[release-readiness]] · [[18-blocking-questions]] · [[production-readiness]] · [[final-release-report]] ·
[[06-roles-permissions]] · [[11-integration-plan]] · [[privacy-review]] · [[12-security-compliance]] ·
[[production-rollback]] · [[go-live-plan]]
