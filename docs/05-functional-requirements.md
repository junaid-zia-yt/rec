# 05 — Functional Requirements

Format per requirement: **ID | Description | Class | Priority | Role | Acceptance Criterion | Dependencies | Source**
Class: CONFIRMED / INFERENCE / RECOMMENDATION. Priority: P0 (blocks architecture/MVP) – P3 (later). Source: `MOM` / `INSTR` (project instructions) / `DESIGN` (DESIGN.md) / `SCREEN` (confirmed screenshot).

## Authentication

| ID      | Description                                                                     | Class          | Pri | Role   | Acceptance Criterion                                        | Dependencies     | Source           |
| ------- | ------------------------------------------------------------------------------- | -------------- | --- | ------ | ----------------------------------------------------------- | ---------------- | ---------------- |
| AUTH-01 | Users sign in via Supabase Auth (email+password, optional magic link)           | RECOMMENDATION | P0  | All    | User can sign in and reach org-scoped home in <2 steps      | Supabase project | INSTR            |
| AUTH-02 | Session expires after configurable inactivity window                            | RECOMMENDATION | P1  | All    | Session invalidated after N min idle; re-auth required      | AUTH-01          | INSTR (security) |
| AUTH-03 | MFA available for Agency Admin and Platform Admin roles                         | RECOMMENDATION | P1  | Admin  | TOTP enrollment enforced for admin roles                    | AUTH-01          | INSTR (security) |
| AUTH-04 | Client Decision-Maker signs in via scoped invite link, no full account required | INFERENCE      | P1  | Client | External user reaches only their shortlist view, no org nav | Roles model      | INSTR            |

## Organizations & Tenancy

| ID     | Description                                                        | Class     | Pri | Role           | Acceptance Criterion                                       | Dependencies | Source |
| ------ | ------------------------------------------------------------------ | --------- | --- | -------------- | ---------------------------------------------------------- | ------------ | ------ |
| ORG-01 | Every data row belongs to exactly one `organization_id`            | CONFIRMED | P0  | System         | RLS policy rejects any cross-org read/write                | Supabase RLS | INSTR  |
| ORG-02 | Agency can operate multiple end-client relationships under one org | CONFIRMED | P0  | Agency Admin   | `clients` table scoped under `organization_id`, not global | MOM §3.1     | MOM    |
| ORG-03 | Platform Admin can view/manage all orgs; no org user can           | CONFIRMED | P0  | Platform Admin | Cross-org query only succeeds for platform-admin role      | ORG-01       | INSTR  |

## User Management

| ID     | Description                                                                 | Class          | Pri | Role         | Acceptance Criterion                                                     | Dependencies    | Source |
| ------ | --------------------------------------------------------------------------- | -------------- | --- | ------------ | ------------------------------------------------------------------------ | --------------- | ------ |
| USR-01 | Agency Admin invites users by email with a role assignment                  | RECOMMENDATION | P0  | Agency Admin | Invited user completes signup and lands with correct role                | AUTH-01, ORG-01 | INSTR  |
| USR-02 | A user can hold different roles in different orgs (multi-tenant membership) | INFERENCE      | P2  | All          | Role switches correctly on org switch                                    | ORG-01          | INSTR  |
| USR-03 | Deactivating a user preserves their historical audit trail                  | RECOMMENDATION | P1  | Admin        | Deactivated user's past actions still resolve to their name in audit log | AUD-01          | INSTR  |

## Client Management

| ID     | Description                                                                                 | Class     | Pri | Role         | Acceptance Criterion                         | Dependencies       | Source |
| ------ | ------------------------------------------------------------------------------------------- | --------- | --- | ------------ | -------------------------------------------- | ------------------ | ------ |
| CLI-01 | Agency records end-client companies with contact and vertical (retail/C-store/food service) | CONFIRMED | P0  | Agency Admin | `clients` record created, linked to org      | MOM §3.1           | MOM    |
| CLI-02 | Client Decision-Maker accounts are scoped to their own company's projects only              | CONFIRMED | P0  | Client       | Client cannot see another client's shortlist | Core Principle #12 | INSTR  |

## Recruitment Projects

| ID     | Description                                                                                | Class          | Pri | Role         | Acceptance Criterion                               | Dependencies      | Source |
| ------ | ------------------------------------------------------------------------------------------ | -------------- | --- | ------------ | -------------------------------------------------- | ----------------- | ------ |
| PRJ-01 | Recruiter creates a project tied to one client and one open role                           | CONFIRMED      | P0  | Recruiter    | Project record requires client + role title        | INSTR workflow #1 | INSTR  |
| PRJ-02 | Project has a status lifecycle (intake → sourcing → shortlisting → client review → closed) | RECOMMENDATION | P1  | Recruiter    | Status transitions are enforced, not free text     | PRJ-01            | INSTR  |
| PRJ-03 | POC projects are flagged distinctly from paid-engagement projects                          | INFERENCE      | P1  | Agency Admin | POC flag drives [[14-poc-specification]] reporting | MOM §6            | MOM    |

## Job Descriptions

| ID    | Description                                                                   | Class     | Pri | Role        | Acceptance Criterion                                     | Dependencies      | Source            |
| ----- | ----------------------------------------------------------------------------- | --------- | --- | ----------- | -------------------------------------------------------- | ----------------- | ----------------- |
| JD-01 | Recruiter uploads a JD file (PDF/DOCX/text) or pastes text                    | CONFIRMED | P0  | Recruiter   | File stored, text extracted                              | INSTR workflow #2 | INSTR             |
| JD-02 | AI extracts mandatory vs. preferred requirements as structured JSON           | CONFIRMED | P0  | System (AI) | Output validated against Zod schema before display       | AI-01 (see 09)    | INSTR workflow #4 |
| JD-03 | Recruiter reviews/edits every extracted requirement before it becomes binding | CONFIRMED | P0  | Recruiter   | No requirement reaches scoring without human review pass | Core Principle #2 | INSTR workflow #5 |

## Hiring Scorecards

| ID     | Description                                                                         | Class          | Pri | Role         | Acceptance Criterion                                              | Dependencies      | Source            |
| ------ | ----------------------------------------------------------------------------------- | -------------- | --- | ------------ | ----------------------------------------------------------------- | ----------------- | ----------------- |
| SCR-01 | Scorecard captures mandatory gates and weighted preferred criteria separately       | CONFIRMED      | P0  | Recruiter    | Two distinct criterion types in schema                            | Core Principle #4 | INSTR             |
| SCR-02 | Scorecard requires Agency-Admin approval before candidates can be scored against it | CONFIRMED      | P0  | Agency Admin | Scoring blocked until `scorecards.status = approved`              | JD-03             | INSTR workflow #7 |
| SCR-03 | Scorecards are versioned; a new version does not silently rescore old matches       | RECOMMENDATION | P1  | Recruiter    | Each match records the scorecard_version_id it was scored against | SCR-02            | INSTR workflow #7 |

## Candidate Profiles

| ID      | Description                                                                              | Class     | Pri | Role        | Acceptance Criterion                                                                | Dependencies         | Source |
| ------- | ---------------------------------------------------------------------------------------- | --------- | --- | ----------- | ----------------------------------------------------------------------------------- | -------------------- | ------ |
| CAND-01 | CV/profile parsed into normalized fields (experience, education, certifications, skills) | CONFIRMED | P0  | System (AI) | Structured schema populated; unparsed fields marked unverified, never blank-guessed | Core Principle #6/#7 | INSTR  |
| CAND-02 | Any field the parser could not confidently extract is labeled "Unverified," not omitted  | CONFIRMED | P0  | System (AI) | UI renders an explicit unverified badge, not a silently missing field               | Core Principle #6    | INSTR  |
| CAND-03 | Duplicate candidates are detected across sources (same person, multiple uploads)         | CONFIRMED | P1  | System      | Dedup match surfaced to recruiter for merge/reject, never auto-merged silently      | INSTR workflow #11   | INSTR  |

## Candidate Documents

| ID     | Description                                                                      | Class          | Pri | Role      | Acceptance Criterion                                                               | Dependencies   | Source           |
| ------ | -------------------------------------------------------------------------------- | -------------- | --- | --------- | ---------------------------------------------------------------------------------- | -------------- | ---------------- |
| DOC-01 | Candidate documents are versioned; a re-upload does not delete the prior version | RECOMMENDATION | P1  | Recruiter | Old version retrievable from audit/history                                         | Storage design | INSTR            |
| DOC-02 | Every uploaded document is scanned/validated for type and size before parsing    | RECOMMENDATION | P0  | System    | Reject disallowed MIME types and oversized files before they reach the AI pipeline | Security plan  | INSTR (security) |

## Candidate Pipeline

| ID      | Description                                                                                       | Class     | Pri | Role      | Acceptance Criterion                                        | Dependencies | Source         |
| ------- | ------------------------------------------------------------------------------------------------- | --------- | --- | --------- | ----------------------------------------------------------- | ------------ | -------------- |
| PIPE-01 | Candidate has a per-project pipeline stage (sourced → gated → reviewed → shortlisted → submitted) | INFERENCE | P1  | Recruiter | Stage field on `candidate_role_matches`, transitions logged | SCREEN       | SCREEN + INSTR |

## Candidate Sourcing

| ID     | Description                                                                         | Class     | Pri | Role      | Acceptance Criterion                                                                      | Dependencies      | Source |
| ------ | ----------------------------------------------------------------------------------- | --------- | --- | --------- | ----------------------------------------------------------------------------------------- | ----------------- | ------ |
| SRC-01 | Recruiter can manually import candidates found via LinkedIn (no automated scraping) | CONFIRMED | P0  | Recruiter | Import is manual/CSV/paste-profile only, per LinkedIn ToS constraint                      | INSTR limitations | INSTR  |
| SRC-02 | Apollo enrichment can be triggered per-candidate to fill missing contact data       | CONFIRMED | P2  | Recruiter | Enrichment result stored with source + timestamp, still marked unverified until confirmed | MOM §3.2          | MOM    |

## Candidate Matching

| ID       | Description                                                                                 | Class     | Pri | Role   | Acceptance Criterion                                                                                        | Dependencies                          | Source |
| -------- | ------------------------------------------------------------------------------------------- | --------- | --- | ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| MATCH-01 | Mandatory gates are evaluated deterministically, not purely by LLM judgment                 | CONFIRMED | P0  | System | Gate pass/fail is a rule evaluated against extracted+verified fields, with AI only proposing the extraction | Core Principle #4/#5, AI safety rules | INSTR  |
| MATCH-02 | A candidate who fails any mandatory gate cannot appear in the ranked shortlist              | CONFIRMED | P0  | System | Failed-gate candidates excluded from shortlist ranking view by construction                                 | Core Principle #5                     | INSTR  |
| MATCH-03 | Every match score is accompanied by an evidence percentage and per-criterion evidence links | CONFIRMED | P0  | System | Score UI cannot render without evidence references, per [[08-candidate-scoring]]                            | SCORE spec                            | SCREEN |

## Quality Reviews

| ID    | Description                                                                   | Class     | Pri | Role      | Acceptance Criterion                                           | Dependencies         | Source |
| ----- | ----------------------------------------------------------------------------- | --------- | --- | --------- | -------------------------------------------------------------- | -------------------- | ------ |
| QR-01 | A human recruiter must review/confirm a candidate's score before shortlisting | CONFIRMED | P0  | Recruiter | Shortlist action blocked without a `human_reviews` record      | Core Principle #3/#7 | INSTR  |
| QR-02 | Reviewer can override an AI score, with a mandatory reason field              | CONFIRMED | P0  | Recruiter | Override stored with reason, both AI and human values retained | AI safety rules      | INSTR  |

## Outreach

| ID     | Description                                                                                | Class     | Pri | Role        | Acceptance Criterion                                                         | Dependencies      | Source |
| ------ | ------------------------------------------------------------------------------------------ | --------- | --- | ----------- | ---------------------------------------------------------------------------- | ----------------- | ------ |
| OUT-01 | Outreach message is AI-drafted, human-approved before send                                 | CONFIRMED | P0  | Recruiter   | No message leaves the system without a `status=approved` transition          | Core Principle #3 | INSTR  |
| OUT-02 | Outreach spans email, and — where account access is confirmed — LinkedIn/SMS               | CONFIRMED | P1  | Recruiter   | Channel availability reflects [[11-integration-plan]] readiness, not assumed | MOM §3.2          | MOM    |
| OUT-03 | Inbound responses are classified (interested/declined/no-response) to drive pipeline stage | INFERENCE | P2  | System (AI) | Classification is advisory; recruiter can correct it                         | PIPE-01           | INSTR  |

## Shortlists

| ID    | Description                                                                            | Class     | Pri | Role      | Acceptance Criterion                                                                  | Dependencies      | Source      |
| ----- | -------------------------------------------------------------------------------------- | --------- | --- | --------- | ------------------------------------------------------------------------------------- | ----------------- | ----------- |
| SL-01 | Shortlist normally contains 2–3 candidates; system warns, does not hard-block, on more | CONFIRMED | P0  | Recruiter | Soft warning above 3; hard block requires explicit admin override reason              | Core Principle #9 | INSTR + MOM |
| SL-02 | Finalizing a shortlist requires the sticky "Continue"/"Sign-Off" human action          | CONFIRMED | P0  | Recruiter | Matches SCREEN observed pattern; action creates `human_reviews` + `audit_events` rows | Core Principle #3 | SCREEN      |

## Client Decisions

| ID     | Description                                                                       | Class     | Pri | Role   | Acceptance Criterion                                                | Dependencies | Source |
| ------ | --------------------------------------------------------------------------------- | --------- | --- | ------ | ------------------------------------------------------------------- | ------------ | ------ |
| DEC-01 | Client Decision-Maker can approve/reject each shortlisted candidate with comments | INFERENCE | P1  | Client | Decision recorded, visible to recruiter, immutable after submission | SL-02        | INSTR  |

## POC Benchmarking

| ID     | Description                                                                    | Class     | Pri | Role         | Acceptance Criterion                                          | Dependencies | Source |
| ------ | ------------------------------------------------------------------------------ | --------- | --- | ------------ | ------------------------------------------------------------- | ------------ | ------ |
| POC-01 | System can tag a project as POC and record parallel-process comparison metrics | CONFIRMED | P0  | Agency Admin | Speed + quality metrics captured per [[14-poc-specification]] | MOM §6       | MOM    |

## Analytics

| ID     | Description                                                                               | Class          | Pri | Role         | Acceptance Criterion                                          | Dependencies | Source |
| ------ | ----------------------------------------------------------------------------------------- | -------------- | --- | ------------ | ------------------------------------------------------------- | ------------ | ------ |
| ANL-01 | Dashboard shows time-to-shortlist, gate-fail rate, evidence-completeness rate per project | RECOMMENDATION | P2  | Agency Admin | Metrics computed from `audit_events`/`AI_runs`, not estimated | Data model   | INSTR  |

## Integrations

| ID     | Description                                                                                 | Class     | Pri          | Role           | Acceptance Criterion                                                                           | Dependencies      | Source |
| ------ | ------------------------------------------------------------------------------------------- | --------- | ------------ | -------------- | ---------------------------------------------------------------------------------------------- | ----------------- | ------ |
| INT-01 | TA Tracker integration remains unbuilt/unclaimed until technical access is supplied         | CONFIRMED | P0 (blocker) | System         | No TA Tracker API call exists in code; UI shows "Not connected — pending client documentation" | INSTR limitations | INSTR  |
| INT-02 | Apollo/email/calendar integrations are only claimed "working" after live credential testing | CONFIRMED | P1           | Platform Admin | Integration status field reflects a real successful test call, not configuration presence      | INSTR limitations | INSTR  |

## Notifications

| ID     | Description                                                                                | Class          | Pri | Role      | Acceptance Criterion                                       | Dependencies         | Source |
| ------ | ------------------------------------------------------------------------------------------ | -------------- | --- | --------- | ---------------------------------------------------------- | -------------------- | ------ |
| NTF-01 | User is notified of pending reviews, gate failures needing attention, and client decisions | RECOMMENDATION | P2  | Recruiter | In-app + email notification fires on relevant state change | Notification service | INSTR  |

## Audit Logging

| ID     | Description                                                                                                         | Class     | Pri | Role   | Acceptance Criterion                                                                           | Dependencies       | Source |
| ------ | ------------------------------------------------------------------------------------------------------------------- | --------- | --- | ------ | ---------------------------------------------------------------------------------------------- | ------------------ | ------ |
| AUD-01 | Every AI action, score, human review, and approval is recorded immutably                                            | CONFIRMED | P0  | System | `audit_events` write is transactional with the action it records; no action commits without it | Core Principle #10 | INSTR  |
| AUD-02 | Audit log records model, prompt version, inputs, outputs, confidence, timestamp, reviewer decision for every AI run | CONFIRMED | P0  | System | `AI_runs` row satisfies this schema for 100% of AI calls                                       | AI safety rules    | INSTR  |

## Administration

| ID     | Description                                                          | Class          | Pri | Role           | Acceptance Criterion                                                    | Dependencies | Source |
| ------ | -------------------------------------------------------------------- | -------------- | --- | -------------- | ----------------------------------------------------------------------- | ------------ | ------ |
| ADM-01 | Platform Admin can suspend an organization without deleting its data | RECOMMENDATION | P2  | Platform Admin | Org marked suspended; RLS blocks new writes, reads preserved for export | ORG-01       | INSTR  |

## Mobile Functionality

| ID     | Description                                                                                                                   | Class     | Pri | Role                    | Acceptance Criterion                                                            | Dependencies                                                   | Source         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | --------- | --- | ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------- |
| MOB-01 | Mobile app supports review and approval workflows (shortlist sign-off, gate review) as a priority over full data-entry parity | CONFIRMED | P1  | Recruiter, Agency Admin | Shortlist Verification Matrix screen fully functional on mobile first           | Project description ("mobile review and approval application") | INSTR + SCREEN |
| MOB-02 | Mobile app is built after the web platform is functional, sharing API types                                                   | CONFIRMED | P2  | System                  | Mobile phase begins only after Phase 12 (web) per [[15-implementation-roadmap]] | Project instructions                                           | INSTR          |

## Security

| ID     | Description                                                             | Class     | Pri | Role   | Acceptance Criterion                                      | Dependencies      | Source |
| ------ | ----------------------------------------------------------------------- | --------- | --- | ------ | --------------------------------------------------------- | ----------------- | ------ |
| SEC-01 | No API key or service credential is ever present in client-side bundles | CONFIRMED | P0  | System | Static scan of build output finds zero secret patterns    | Engineering rules | INSTR  |
| SEC-02 | RLS is enforced on every tenant-owned table, verified by automated test | CONFIRMED | P0  | System | RLS test suite denies cross-tenant access for every table | Engineering rules | INSTR  |

## Privacy

| ID      | Description                                | Class          | Pri | Role           | Acceptance Criterion                           | Dependencies      | Source           |
| ------- | ------------------------------------------ | -------------- | --- | -------------- | ---------------------------------------------- | ----------------- | ---------------- |
| PRIV-01 | Candidate can request data export/deletion | RECOMMENDATION | P2  | Platform Admin | Export/delete workflow exists, logged in audit | GDPR/CCPA posture | INSTR (security) |

## AI Governance

| ID     | Description                                                                                                 | Class     | Pri | Role   | Acceptance Criterion                                                                     | Dependencies    | Source |
| ------ | ----------------------------------------------------------------------------------------------------------- | --------- | --- | ------ | ---------------------------------------------------------------------------------------- | --------------- | ------ |
| AIG-01 | Text inside an uploaded CV/JD/document can never alter system instructions or AI behavior                   | CONFIRMED | P0  | System | Prompt-injection test suite (malicious CV fixtures) passes 100%                          | AI safety rules | INSTR  |
| AIG-02 | AI never calculates the final, authoritative match score alone — deterministic validation always runs after | CONFIRMED | P0  | System | Final score field is written only by the deterministic scoring service, not the LLM call | AI safety rules | INSTR  |

Related documents: [[06-roles-permissions]] · [[07-data-model]] · [[08-candidate-scoring]] · [[09-ai-architecture]]
