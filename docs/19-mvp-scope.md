# 19 — MVP Scope

Defines the smallest complete product that can run the two-role POC ([[14-poc-specification]]) while preserving every Core Product Principle. Nothing here overrides a CONFIRMED business rule from [[01-project-context]] or [[05-functional-requirements]] — this document only decides _sequencing_, not requirements.

## 19.1 Included

| Area                      | Included capability                                                                                                                       | Source FR(s)                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Auth                      | Email/password + magic link sign-in, session management                                                                                   | AUTH-01, AUTH-02                   |
| Tenancy                   | One agency organization, RLS-isolated                                                                                                     | ORG-01, ORG-02                     |
| Roles                     | Recruiter, Agency Admin, Client Decision-Maker (scoped invite link) — **Read-Only Reviewer and multi-org membership deferred, see §19.3** | USR-01, AUTH-04                    |
| Recruitment projects      | Create/manage a project per client/role                                                                                                   | PRJ-01, PRJ-02                     |
| Job descriptions          | Upload/paste JD, AI extraction, human-reviewed requirements                                                                               | JD-01, JD-02, JD-03                |
| Scorecards                | Mandatory + weighted-preferred criteria, Agency Admin approval, versioning                                                                | SCR-01, SCR-02, SCR-03             |
| Candidates                | Manual/CSV import, CV upload, AI-parsed profile, unverified-field labeling                                                                | CAND-01, CAND-02, DOC-02           |
| Mandatory gates           | Deterministic pass/fail, evidence-linked                                                                                                  | MATCH-01, MATCH-02                 |
| Evidence-backed scoring   | Full six-layer model incl. weighted score + evidence % + completeness %                                                                   | MATCH-03, [[08-candidate-scoring]] |
| Human quality review      | Confirm/override with mandatory reason, audited                                                                                           | QR-01, QR-02                       |
| Candidate pipeline        | Stage tracking (sourced → gated → reviewed → shortlisted)                                                                                 | PIPE-01                            |
| Final shortlist           | ≤3-candidate sticky sign-off flow (matches confirmed screenshot)                                                                          | SL-01, SL-02                       |
| Client shortlist decision | Scoped client view, approve/reject with comment                                                                                           | DEC-01, CLI-02                     |
| POC comparison report     | Speed + quality metrics per [[14-poc-specification]]                                                                                      | POC-01                             |
| Audit events              | Full append-only log on every state-changing action                                                                                       | AUD-01, AUD-02                     |
| Web interface             | Stitch-matching responsive design (desktop + mobile web) per resolved design system                                                       | [[04-design-system]]               |

**Outreach — included at minimum viable scope only:** AI-drafted, human-approved outreach via **email only** (OUT-01), sufficient to satisfy POC default #6/#7 ([[14-poc-specification]] §14.14). LinkedIn/SMS outreach is manual-workflow-only (see Excluded).

## 19.2 Excluded (unless technically essential — none identified as such)

| Item                              | Why excluded from MVP                                                                                                  | Where it re-enters                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Fully automated LinkedIn activity | Prohibited by platform rules and project instructions regardless of MVP/full scope — never in-scope, not just deferred | Never — manual-only by permanent design decision, [[11-integration-plan]] §11.3 |
| Paid advertising                  | No functional requirement traces to this; outside the platform's stated workflows entirely                             | Not planned — outside product scope                                             |
| SMS sending                       | No approved-stack provider; not required to run the two-role POC (email satisfies OUT-01 for MVP)                      | Phase 10+, pending Q-P1-03                                                      |
| Complex billing                   | No billing UI required to run a POC                                                                                    | Post-commercial-model agreement, per Q-P3-02                                    |
| Marketplace features              | Not named in any workflow or MOM requirement                                                                           | Not planned                                                                     |
| Multiple AI providers             | Adds validation/eval surface with no POC benefit; Claude API is the approved stack                                     | Reassess only if a specific documented need arises                              |
| Production TA Tracker integration | No confirmed API exists ([[11-integration-plan]] §11.2) — cannot be built, not merely deferred                         | Only once client supplies technical access (Q-P2-03)                            |
| Full native mobile application    | Project instructions: mobile is built _after_ the web platform is functional                                           | Phase 13, [[15-implementation-roadmap]]                                         |
| Advanced analytics                | Basic POC comparison report (included) satisfies the POC; deeper analytics (ANL-01 dashboard) has no POC dependency    | Phase 12+                                                                       |
| Autonomous candidate submission   | Directly forbidden by Core Principle #8 — permanently excluded, not an MVP timing decision                             | Never                                                                           |

## 19.3 Deferred (in scope eventually, not required for the two-role POC)

- Read-Only Reviewer role (USR/role matrix supports it structurally; not needed until a second reviewer exists).
- Multi-org membership for a single user (USR-02).
- Candidate response auto-classification (OUT-03) — MVP can log responses manually reviewed by the recruiter without the AI classification step; the classification model needs a labeled dataset the POC itself will start producing.
- Interview scheduling / calendar integrations (INT scope, Google/Microsoft Calendar) — not on the critical path to a shortlist decision.
- Notification center polish beyond the essentials needed for review/approval prompts.
- Apollo enrichment (SRC-02) — genuinely useful but not required to prove the core evidence-based-scoring value proposition; can run manually (paste enriched contact data) for the POC.
- Full analytics dashboard (ANL-01).
- Platform Admin cross-org tooling beyond what's needed to provision the one POC organization.

## 19.4 Acceptance Criteria for MVP Completion

- A recruiter can take one JD from upload through an approved scorecard, imported/parsed candidates, deterministic mandatory gates, evidence-backed scoring, human review, and a finalized ≤3-candidate shortlist, entirely inside the platform.
- A Client Decision-Maker can view and decide on that shortlist through a scoped account, seeing only what [[06-roles-permissions]] §6.3 permits.
- Every step above produces a correct, replayable `audit_events` trail (AUD-01).
- No mandatory-gate-failed candidate can reach the shortlist under any code path (tested directly per [[16-testing-strategy]] journey #2).
- The POC comparison report renders the metrics defined in [[14-poc-specification]] §14.9–14.10 and §14.14's defaults, all clearly labeled as configurable/pending approval where applicable.
- The web UI matches the resolved design system ([[04-design-system]]) at least for the components proven in the one confirmed screenshot (dossier card, gate badge, sticky approval sheet, verification-matrix layout).
- Zero secrets in client bundles, RLS test suite passes for every tenant table (SEC-01/02).

## 19.5 Dependencies

Resolution (or an accepted default) for the P0 blockers in [[18-blocking-questions]] — specifically Q-P0-01 (now largely resolved by the Task 5 POC defaults above, pending final client sign-off), Q-P0-02 (design-system authority), and Q-P0-04 (employment-AI regulatory scope, which affects whether bias-testing work is in scope before the POC or only before production). Q-P0-03 (screenshot re-upload) is **not** a hard MVP dependency — MVP can proceed on the resolved design tokens plus the one confirmed screen and expand fidelity as more screens arrive.

## 19.6 Exit Criteria

MVP is complete and the two-role POC can run when: §19.4's acceptance criteria all pass, the POC defaults in §14.14 have been reviewed (approved-as-is or amended) by the client, and Build Phase 1 through the shortlist/client-decision phase ([[15-implementation-roadmap]] phases 1–11) have shipped to staging with the critical E2E journeys in [[16-testing-strategy]] §16.1 passing.

Related documents: [[05-functional-requirements]] · [[14-poc-specification]] · [[15-implementation-roadmap]] · [[20-decision-register]]
