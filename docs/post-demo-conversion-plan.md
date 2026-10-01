# Post-Demo Conversion Plan

Date: 2026-09-29
For: presenting to Dave after the private demonstration, if he wants to move forward.

This document lays out, honestly, what comes next if Dave wants to proceed — a controlled proof-of-concept, not a jump straight to production. Pricing here is a proposal for discussion, not an executed agreement; nothing here is binding until Dave and the agency's own counsel/finance sign off (per this project's own decision-register practice — see `docs/client-go-live-decisions.md`).

---

## 1. What comes next: a two-role controlled proof-of-concept

If Dave wants to proceed, the recommended next step is a **time-boxed, two-role POC** run against real infrastructure, real (consenting) candidates, and real client-supplied roles — not an expansion of the private demo, but a fresh, properly-provisioned environment built for it.

Suggested structure:

- **Two real roles**, chosen by Dave, ideally one straightforward front-line role and one more senior/judgment-heavy role — mirroring the Shift Lead / District Manager split shown in the demo, so the comparison is apples-to-apples.
- **A fixed duration** (suggested: 4–6 weeks from real infrastructure go-live to results review) rather than an open-ended trial.
- **A small, real candidate pool per role** — enough to exercise the full workflow (intake → scoring → human review → shortlist → outreach) without turning the POC into a production-scale operation before it's approved as one.
- **Every principle from the private demo carried through unchanged**: mandatory gates still block ineligible candidates, evidence is still required for every score, a human still approves every shortlist and every outreach send, missing information is still marked unverified rather than guessed.

## 2. Client success criteria (for Dave to confirm or adjust)

Proposed defaults, carried from this project's own POC specification, explicitly marked in that document as vendor-proposed pending client agreement — Dave's confirmation or revision of these is itself one of the required sign-offs before the POC starts:

- Shortlisted candidates rank in the top tier of client evaluation at least 90% of the time.
- 100% compliance with mandatory-gate rules — zero candidates who failed a mandatory requirement ever reach a client-facing shortlist.
- Zero unsupported evidence claims — every score-relevant claim traces to a real, cited piece of evidence.
- A qualitative measure Dave defines himself: e.g., "would you have made the same shortlisting decision without the tool," asked directly after each round.

## 3. Infrastructure required — only after Dave approves the POC

None of the following is provisioned today, and none will be provisioned before Dave's explicit approval to proceed:

- A real Supabase project (POC-scoped, with backups/point-in-time recovery enabled from day one).
- A real Vercel deployment with a proper domain and TLS.
- A real, budget-capped Anthropic API key, scoped to the POC.
- A real Sentry project for live error monitoring.
- A real Resend sending domain, if outreach sending is included in the POC scope (a decision Dave can make separately — the POC can run with outreach still preview-only if preferred).
- Legal sign-off on consent language, data-retention period, and lawful basis for processing the real candidate data the POC will handle.

Provisioning and testing this infrastructure — including a real staging pass, real monitoring verification, and a real backup/restore test — is the first work of the POC phase, not something assumed to already work because the demo looked polished.

## 4. Commercial terms (proposed)

| Item                         | Proposed terms                                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation fee           | **$5,000**, one-time — covers infrastructure provisioning, POC environment setup, real staging validation, and onboarding for the two POC roles.                                                                             |
| Ongoing subscription         | **$1,499/month**, Growth tier — covers continued platform access, monitoring, and support once the POC is complete and the client chooses to continue.                                                                       |
| Optional: dedicated platform | A separate statement of work, scoped and priced individually, for a client who wants a dedicated (single-tenant) deployment rather than the standard multi-tenant platform. Available on request; not included in the above. |

These figures are a starting proposal for discussion — not a signed quote. Any change to them, and the client's acceptance of them, should be recorded the same way this project records every other stakeholder decision (a dated, named sign-off, not an assumption).

## 5. What happens if Dave says yes

1. Dave confirms (or revises) the success criteria in §2 and selects the two real roles.
2. Commercial terms in §4 are agreed and recorded.
3. Real infrastructure (§3) is provisioned and independently verified — not assumed working because it was configured.
4. A real staging pass and a short internal UAT round run before any real candidate data is processed.
5. The POC runs for the agreed duration, with the same quality-first workflow shown in the demo, against real client roles.
6. Results are reviewed jointly against the confirmed success criteria, and a go/no-go decision is made on continuing past the POC.

## 6. What happens if Dave says no, or "not yet"

No further infrastructure is provisioned, no further commercial commitment is implied, and the private demo environment remains exactly what it has always been — a fictional, no-commitment demonstration. Dave is welcome to revisit this at any time.

## Related documents

`docs/private-client-demo-guide.md` · `docs/demo-script.md` · `docs/demo-limitations.md` · `docs/client-go-live-decisions.md` · `docs/14-poc-specification.md`
