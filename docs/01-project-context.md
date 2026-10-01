# 01 — Project Context Summary

Classification legend: **[CONFIRMED]** stated directly in the MOM or project instructions · **[INFERENCE]** reasonable reading of stated facts · **[RECOMMENDATION]** our proposal · **[CLIENT CONFIRM]** needs the client's explicit answer · **[BLOCKER]** cannot proceed past a named phase without this.

## 1.1 Client Business Model

**[CONFIRMED]** The client ("Dave") runs a two-person specialist recruitment and executive-placement consultancy focused on retail, convenience-store (C-store) and food-service employers. The business is two-sided: it sources candidates into a pipeline _and_ it acquires client companies with open roles. Most placements are on-site; a smaller share are hybrid/remote. Dave is a former retail CEO — an operator, not a technologist — running a proprietary, self-authored scoring methodology he trusts more than any vendor's.

## 1.2 Current Recruitment Workflow

**[CONFIRMED]**

1. Candidates are logged and tracked in "TA Tracker," an internal/proprietary pipeline database of unknown technical composition.
2. Sourcing draws on the TA Tracker history (past placements, prior contacts), LinkedIn connections, and active LinkedIn search.
3. A scoring algorithm (Dave's own, not disclosed in detail) rates JD fit as a percentage: **90%+** = closer review, **95%+** = prioritized for shortlisting, **97–98%+** = typically converts to an offer.
4. Apollo is used for contact enrichment when LinkedIn data is incomplete (~83% cited hit rate on verified phone numbers — vendor should treat this as Dave's self-reported figure, not a vendor SLA).
5. Outreach runs in parallel across LinkedIn messaging, phone/text, and email.
6. Only the top 2–3 matches are ever shortlisted to the end client — never a bulk list.

## 1.3 Existing Systems

**[CONFIRMED]** TA Tracker (internal, no known API — see [[11-integration-plan]]), LinkedIn (search + InMail/DM), Apollo (contact enrichment, paid), email/phone/SMS for outreach. **[INFERENCE]** No CRM, ATS, or BI tool was mentioned beyond TA Tracker; assume none exists until confirmed.

## 1.4 Primary Pain Points

**[INFERENCE]** — none were stated as explicit "pain points" in the MOM, but they are implied by what the client is evaluating a vendor for:

- Manual, time-intensive sourcing and multi-channel outreach across three channels.
- No independent verification of scoring — the percentage is Dave's own algorithm; there's no evidence trail supplied with it.
- Limited team capacity (two people) caps volume of roles that can be worked at once.
- Geographic sourcing reach is currently limited to what Dave and his recruiter can personally cover.

## 1.5 Commercial Concerns

**[CONFIRMED]**

- **Reputational risk dominates.** A bad candidate submission can cost Dave his own client relationship — this is the lens through which he evaluates everything.
- **No pricing has been discussed or agreed.** The vendor proposed a relationship/results-based model "expected to be lower" than Dave's current time cost, but gave no numbers. **[CLIENT CONFIRM]**
- **Account ownership for outreach is unresolved** — whose LinkedIn/Instagram/Apollo-equivalent accounts get used matters for compliance and for who owns the resulting relationships. **[BLOCKER — blocks Integration Plan / Phase 14]**

## 1.6 Quality Expectations

**[CONFIRMED]** Quality over quantity is described as "non-negotiable" — Dave stated it at least seven times on the call per the vendor's own notes. Volume or speed without quality is explicitly framed as a **failure condition**, independent of any automation gain. This is the single most important design constraint on the whole platform (see Core Product Principles in the project instructions, which mirror this directly).

## 1.7 Automation Expectations

**[CONFIRMED]** Automation is welcomed only as a secondary benefit once quality parity or superiority is proven. **[INFERENCE]** Dave is not asking to be automated _out_ of the loop — he wants defensible, evidence-backed shortlists he can still personally stand behind before they reach his own clients. This directly supports the platform's human-approval-gate design.

## 1.8 Initial Proof-of-Concept

**[CONFIRMED]**

- Structure: vendor and client independently source candidates for the **same one or two live roles** in parallel, starting from a shared point in time.
- Comparison axes: **turnaround speed** and **candidate quality/match against the JD**, benchmarked against Dave's own 90%/95%/97–98% thresholds.
- Outcome rule: vendor must be faster **and** equal-or-better on quality to proceed to a paid engagement. Quality shortfall fails the POC regardless of speed.
- **[CONFIRMED — Risk]** No demo date is fixed yet ("next week," unconfirmed), and success criteria are still qualitative ("equal or better") rather than numeric — this is called out in the MOM itself as something that must be quantified before the benchmark, to avoid a disputed outcome. See [[14-poc-specification]].

## 1.9 Conditions for Moving to a Paid Engagement

**[CONFIRMED]** A single successful POC round is the sole stated gate to a paid relationship. **[CONFIRMED — Risk]** Dave signaled low tolerance for underperformance and will walk away after one failed test — there is effectively one shot to prove the platform's evidence-based matching holds up against his own manual process.

## 1.10 What the Client Is Actually Purchasing

**[INFERENCE]** Dave is not purchasing "an AI recruiting tool" in the abstract. He is purchasing **a second, independently-verifiable scoring and sourcing process that he can trust as much as his own**, delivered fast enough to be worth outsourcing, without ever asking him to submit a candidate he hasn't personally reviewed. The product's value proposition is _defensible speed_, not just speed — every score must be traceable to evidence, exactly as required by Core Product Principles #2, #7, #8 and #9 in the project instructions.

## 1.11 What Would Cause the Engagement to Fail

**[INFERENCE]**

- A shortlist that scores well but does not survive Dave's own scrutiny against the JD (opaque or unverifiable scoring).
- Any candidate reaching a client dossier without a documented human sign-off.
- Missing/invented candidate qualifications — even one fabricated data point breaks trust irreparably given Dave's reputational exposure.
- A POC that is faster but lower quality — explicitly named as the failure mode in the MOM.
- Ambiguous, un-agreed success criteria at benchmark time, producing a disputed result neither side accepts.

Related documents: [[MASTER-ARCHITECTURE]] · [[08-candidate-scoring]] · [[14-poc-specification]] · [[18-blocking-questions]]
