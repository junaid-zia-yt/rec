# UAT Results — Recruitment Quality Intelligence (Staging)

Duplicate this document per UAT round (e.g. `uat-results-2026-10-06.md`).
Every row below mirrors a numbered step in `docs/uat-plan.md` — fill in
**Result** and **Notes** as you go; leave everything else as-is unless a
step was renumbered in the plan. File a bug using the issue-format block
(§3) for anything that isn't a clean Pass, then link its Test ID in the
Notes column here.

**Round metadata** (fill in before starting)

- Staging URL tested:
- Staging deployment build SHA / release tag:
- Date(s) of this round:
- Facilitator:
- Testers (name → role(s) covered):

---

## 1. Summary rollup

Fill in once the round is complete.

| Metric                                         | Count |
| ---------------------------------------------- | ----- |
| Total steps run                                | / 67  |
| Pass                                           |       |
| Fail                                           |       |
| Blocked                                        |       |
| N/A (e.g. cross-tenant check, single-org seed) |       |

| Severity (failed steps only) | Count |
| ---------------------------- | ----- |
| Critical                     |       |
| High                         |       |
| Medium                       |       |
| Low                          |       |

**Overall round verdict** (Go / Go with tracked issues / No-Go):

**Notes:**

---

## 2. Summary table — all scripts

| Test ID        | Role                              | Result (Pass/Fail/Blocked/N-A) | Severity if failed | Notes  |
| -------------- | --------------------------------- | ------------------------------ | ------------------ | ------ |
| ADM-1 … ADM-14 | agency_admin                      |                                |                    | see §4 |
| REC-1 … REC-17 | recruiter                         |                                |                    | see §5 |
| CLI-1 … CLI-8  | client_decision_maker             |                                |                    | see §6 |
| RO-1 … RO-9    | read_only_reviewer                |                                |                    | see §7 |
| POC-1 … POC-19 | recruiter → client_decision_maker |                                |                    | see §8 |

(The block above is a quick roll-up; the detailed per-step rows below are
what you actually fill in.)

---

## 3. UAT issue format (copy this block once per bug found)

```
Test ID:
User role:
Preconditions:
Steps:
Expected result:
Actual result:
Evidence:
Severity:
Owner:
Status:
```

Severity scale: Critical / High / Medium / Low (see `docs/uat-plan.md` §7
for the full rubric). Status: Open / In Progress / Fixed / Won't Fix /
Deferred.

---

## 4. Agency Admin script (14 steps)

| Test ID         | Step                                                | Result                | Notes                                |
| --------------- | --------------------------------------------------- | --------------------- | ------------------------------------ |
| ADM-1           | Sign in as admin@staging-demo.rqi.local             |                       |                                      |
| ADM-2           | Open Settings → Integrations, view provider status  |                       |                                      |
| ADM-3           | Connect/disconnect a provider                       |                       |                                      |
| ADM-4           | Open User & role management, confirm 4 seeded users |                       |                                      |
| ADM-5           | Open "Retail Store Manager" project                 |                       |                                      |
| ADM-6           | Approve the scorecard version                       |                       |                                      |
| ADM-7           | Open global Candidates roster (7 candidates)        |                       |                                      |
| ADM-8           | Open Analytics dashboard                            |                       |                                      |
| ADM-9           | Open Audit log, org-wide entries                    |                       |                                      |
| ADM-10          | Open POC / benchmark report                         |                       |                                      |
| ADM-11          | Confirm full Billing access                         |                       |                                      |
| ADM-12          | Cross-tenant isolation check                        | N/A — single-org seed | not exercisable, see plan §2 step 12 |
| ADM-13          | Sign out                                            |                       |                                      |
| ADM-14 (mobile) | Sign in + view candidates on mobile                 |                       |                                      |

---

## 5. Recruiter script (17 steps)

| Test ID | Step                                                         | Result | Notes                         |
| ------- | ------------------------------------------------------------ | ------ | ----------------------------- |
| REC-1   | Sign in as recruiter@staging-demo.rqi.local                  |        |                               |
| REC-2   | Open project workspace                                       |        |                               |
| REC-3   | Open Job description (pasted JD, status parsed)              |        |                               |
| REC-4   | Upload JD file — expect honest "not available" state         |        | known gap, see plan §8 item 1 |
| REC-5   | Requirement extraction review, edit/add a requirement        |        |                               |
| REC-6   | Scorecard builder; expected-denial: recruiter cannot approve |        |                               |
| REC-7   | Candidate pipeline board, 7 candidates at seeded stages      |        |                               |
| REC-8   | Open Alex Testworthy profile                                 |        |                               |
| REC-9   | Trigger CV parsing                                           |        |                               |
| REC-10  | Review extracted fields, accept verified fields              |        |                               |
| REC-11  | Run matching evaluation — Alex Testworthy                    |        |                               |
| REC-12  | Review mandatory gate results + evidence links               |        |                               |
| REC-13  | Run matching evaluation — Jordan Failwright (fails gate)     |        |                               |
| REC-14  | Quality review / override — Casey Ambiguous                  |        |                               |
| REC-15  | Expected-denial: cannot shortlist Jordan Failwright          |        | Core Business Rule #6         |
| REC-16  | Outreach composer, draft + approve                           |        |                               |
| REC-17  | Create shortlist, 2-3 eligible candidates                    |        |                               |

---

## 6. Client Decision-Maker script (8 steps)

| Test ID        | Step                                                               | Result | Notes                            |
| -------------- | ------------------------------------------------------------------ | ------ | -------------------------------- |
| CLI-1          | Sign in as client-reviewer@staging-demo.rqi.local                  |        |                                  |
| CLI-2          | Open Shortlists, scoped to Fictional Meridian Mart Co              |        |                                  |
| CLI-3          | Open shortlist detail, confirm no internal recruiter notes         |        | privacy property, re-verify live |
| CLI-4          | Expected-denial: no Continue/edit action visible                   |        |                                  |
| CLI-5          | Record accept/discuss/reject decision with comment                 |        |                                  |
| CLI-6          | Expected-denial: cannot reach scorecard/requirements URLs          |        |                                  |
| CLI-7          | Expected-denial: cannot view full non-shortlisted candidate detail |        |                                  |
| CLI-8 (mobile) | Repeat shortlist view + decision on mobile                         |        |                                  |

---

## 7. Read-Only Reviewer script (9 steps)

| Test ID | Step                                                       | Result | Notes |
| ------- | ---------------------------------------------------------- | ------ | ----- |
| RO-1    | Sign in as read-only@staging-demo.rqi.local                |        |       |
| RO-2    | View project, JD, requirements, scorecard (read-only)      |        |       |
| RO-3    | View candidate pipeline + profile + evidence               |        |       |
| RO-4    | Expected-denial: no override/approve button renders        |        |       |
| RO-5    | Expected-denial: no outreach draft/approve action renders  |        |       |
| RO-6    | Expected-denial: no shortlist accept/reject action renders |        |       |
| RO-7    | View Audit log                                             |        |       |
| RO-8    | View + mark-read Notifications                             |        |       |
| RO-9    | Expected-denial: Billing/Integrations-connect blocked      |        |       |

---

## 8. Complete two-role POC journey (19 steps)

| Test ID | Step                                        | Role                      | Result | Notes                   |
| ------- | ------------------------------------------- | ------------------------- | ------ | ----------------------- |
| POC-1   | Sign in, create/use client                  | Recruiter                 |        |                         |
| POC-2   | Create/use "Retail Store Manager" project   | Recruiter                 |        |                         |
| POC-3   | Paste JD, status parsed                     | Recruiter                 |        |                         |
| POC-4   | Run requirement extraction                  | Recruiter                 |        |                         |
| POC-5   | Review/edit requirements, submit scorecard  | Recruiter                 |        |                         |
| POC-6   | Approve scorecard version                   | Agency Admin              |        | handoff                 |
| POC-7   | Add 2+ candidates                           | Recruiter                 |        | handoff back            |
| POC-8   | Parse CVs, review + accept extracted fields | Recruiter                 |        |                         |
| POC-9   | Run matching evaluation per candidate       | Recruiter                 |        |                         |
| POC-10  | Review gate results (pass + fail cases)     | Recruiter                 |        |                         |
| POC-11  | Record human review decision                | Recruiter                 |        |                         |
| POC-12  | Draft + approve outreach                    | Recruiter                 |        |                         |
| POC-13  | Record + classify candidate response        | Recruiter                 |        |                         |
| POC-14  | Create shortlist, blocked ineligible add    | Recruiter                 |        | Core Business Rule #6   |
| POC-15  | Submit shortlist for client review          | Recruiter                 |        |                         |
| POC-16  | Open shortlist, confirm no internal notes   | Client Decision-Maker     |        | handoff                 |
| POC-17  | Record accept/discuss/reject decision       | Client Decision-Maker     |        |                         |
| POC-18  | View POC / benchmark report                 | Agency Admin or Recruiter |        |                         |
| POC-19  | Inspect audit trail for full journey        | Agency Admin              |        | full audit replay check |

---

Related documents: [[uat-plan]] · [[release-readiness]] ·
[[03-screen-inventory]] · [[06-roles-permissions]]
