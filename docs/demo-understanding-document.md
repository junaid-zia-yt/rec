# Demo Understanding Document

Date: 2026-09-30
For: Dave, after the private demonstration of Recruitment Quality Intelligence
Purpose: a short, plain-language record of what was shown, what it means, and what isn't decided yet — so both sides are working from the same understanding before any next step is agreed.

This is not a contract and creates no obligation on either side. It exists so nothing from the demo gets misremembered or overstated later, in either direction.

---

## 1. What you saw

A private walkthrough of Recruitment Quality Intelligence, covering the full workflow for two sample roles (a Shift Lead, Quick Serve Restaurant role and a District Manager, Convenience Retail role):

- A job description turned into mandatory (pass/fail) and preferred (weighted) requirements, reviewed and approved before any candidate was scored against it.
- Ten fictional candidates evaluated against those requirements, with every score backed by a quoted piece of evidence — never a number the system produced without something to point to.
- Mandatory-requirement enforcement: a candidate who fails something mandatory (an expired certification, a suspended license) is excluded from the ranked shortlist automatically, regardless of how strong they look otherwise.
- A case where the evidence was genuinely missing, and the system said so rather than guessing.
- A case where two pieces of evidence conflicted, and the system flagged the conflict for a person to resolve rather than picking a side.
- A short, capped shortlist (up to 3 candidates) built only from candidates who passed every mandatory check.
- A drafted outreach message, clearly marked as a draft that was never sent.
- The same review, on a phone-width screen, with nothing missing or stripped down.

## 2. What was real, and what was a stand-in

**Real**: the scoring logic, the mandatory-gate enforcement, the evidence citations, the shortlist rule, and the review/approval workflow. These are the actual, working parts of the product — not a mockup of them.

**A labelled stand-in, not live AI**: the semantic judgment behind each score came from a deterministic, offline substitute built for this demo — not a live call to Claude. It was built to behave the way the real AI layer will, but it has not itself been verified against a live model. That verification comes later, once real infrastructure is in place.

**Fictional, throughout**: every candidate, client, and company name shown was invented for this demonstration. No real person's data was used or shown at any point.

## 3. What this demo does not establish

To be direct about the boundary, so it's not assumed later by accident:

- Nothing here is running on real, live infrastructure (no production or staging cloud environment exists yet for this project).
- No live AI model call has been exercised end to end.
- No outreach — email, SMS, or otherwise — was capable of actually sending anything during this demo.
- Nothing about production readiness, security certification, or uptime was tested or claimed.
- This demo does not represent a commitment from either side to proceed further.

## 4. What's still undecided

Items that would need your input before any further work begins, not resolved by this demo:

- Whether to proceed to a small, controlled proof-of-concept on two of your real roles.
- Which two roles those would be, if you do want to proceed.
- The success criteria that would define whether the proof-of-concept worked (a starting proposal is in `docs/post-demo-conversion-plan.md`, for you to confirm or change).
- Commercial terms for moving beyond the demo, also proposed in that same document.

## 5. Acknowledgement

This section is here so we both have the same record of what was understood at this point — not a signature required to continue talking.

- [ ] I understand this was a demonstration using fictional data, not a live or production system.
- [ ] I understand the AI-driven scores I saw came from a labelled stand-in, not a live model call.
- [ ] I understand no real outreach was sent, and none could have been sent from this demo.
- [ ] I understand nothing shown constitutes a commitment to purchase or proceed.

Name: _______________________
Date: _______________________

---

## Related documents

`docs/demo-script.md` (what was walked through) · `docs/demo-limitations.md` (the fuller, engineering-level version of §3) · `docs/post-demo-conversion-plan.md` (what proceeding would look like) · `docs/private-client-demo-guide.md` (operator's reference for running this demo again)
