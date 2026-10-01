# 12 — Security & Compliance Architecture

Each item is tagged **[ENG]** engineering control we implement, **[LEGAL]** requires legal review before finalizing, or **[POLICY]** an operational/organizational decision, not code.

## 12.1 Multi-Tenant Isolation & RLS **[ENG]**

Every tenant table carries `organization_id`; Supabase RLS policies enforce `organization_id = current_org_id()` on all reads/writes, with `current_org_id()` sourced from a custom JWT claim set at login/org-switch. An automated RLS test suite runs in CI against every table, asserting cross-tenant access is denied (see [[16-testing-strategy]]). Client Decision-Maker access uses a separate, narrower policy scoped to explicitly-shared `shortlist_candidates` rows, never org membership (see [[06-roles-permissions]] §6.3).

## 12.2 Authentication & Session Management **[ENG]**

Supabase Auth (email/password + magic link); MFA required for Agency Admin/Platform Admin (AUTH-03); session inactivity timeout configurable per org; refresh-token rotation on the Supabase default. Client Decision-Maker uses scoped invite-link auth, not a full account, to minimize their attack surface and onboarding friction.

## 12.3 Authorization / Role-Based Access **[ENG]**

Enforced at three layers: RLS (data), server action/API route guards (operation), and UI (visibility only — never the sole enforcement layer). Permission matrix in [[06-roles-permissions]] is the source of truth; every new endpoint is checked against it before merge.

## 12.4 Candidate Personal Data **[ENG + LEGAL]**

Candidate PII (name, contact, CV content, employment history) is the platform's most sensitive data class. **[ENG]** Encrypted at rest (Supabase default, Postgres + Storage), encrypted in transit (TLS everywhere), access logged via `audit_events` on every read of a candidate record by a human (not just writes) so a "who viewed this candidate" question is answerable. **[LEGAL]** Whether candidate consent is required for AI processing of their CV, and under what lawful basis, depends on jurisdiction — flag for legal review before processing any EU-resident candidate data.

## 12.5 CV / File Security **[ENG]**

File type allowlist (PDF, DOCX, common image formats for scans) and size limits enforced before any file reaches storage or the parsing pipeline (DOC-02). **[RECOMMENDATION]** malware scanning on upload (e.g., ClamAV via a Supabase Edge Function or a scanning service) before a file is ever passed to the Claude API or opened by any internal tool — an uploaded "CV" is untrusted input in the fullest sense, not just for prompt injection.

## 12.6 Secrets Management **[ENG]**

All API keys (Anthropic, Apollo, Resend, Supabase service role) live in server-side environment variables only, never in client bundles or repo history (SEC-01). Rotated on a defined schedule; access to production secrets restricted to a small named set of people (**[POLICY]**).

## 12.7 Consent & Lawful Processing **[LEGAL]**

**[LEGAL — flag explicitly]** The platform processes personal data about job candidates who, in most cases, did not directly consent to _this specific vendor's_ AI processing — they consented (at most) to Dave's own process. This needs a legal opinion on: whether a data-processing agreement between the agency and this platform is sufficient, whether candidates need direct notice, and what lawful basis (legitimate interest vs. consent) applies per jurisdiction.

## 12.8 Data Retention **[POLICY + ENG]**

**[CLIENT CONFIRM]** No retention period was specified by the client. **[RECOMMENDATION]** default candidate-data retention of 24 months from last activity, configurable per org, with automated soft-delete-then-purge scheduling; audit_events retained longer (e.g., 7 years) for dispute-defense purposes, since they're the record that would resolve a "was this candidate properly evaluated" question.

## 12.9 Candidate Deletion Requests **[ENG + LEGAL]**

**[ENG]** A deletion request redacts PII fields (candidates/candidate_profiles/candidate_contact_points/experiences/education/certifications/skills/extracted CV text) while preserving referential integrity and an anonymized audit skeleton (so historical scoring integrity/audit isn't destroyed) — implemented Build Phase 14 Wave 3 as `erasePersonalDataAction` (`apps/web/lib/candidates/privacy-actions.ts`), gated on a prior recorded `candidate_consents.deletion_requested`. **[LEGAL]** This pattern still needs sign-off on whether anonymized-audit-retention satisfies applicable deletion-right obligations (GDPR Art. 17, CCPA) — in particular, `requirement_evidence.excerpt`, `audit_events.before_json/after_json`, `communication_events.raw_payload`, and `candidate_responses.raw_response_text` are append-only (REVOKE UPDATE/DELETE) by deliberate design and retain verbatim historical PII excerpts indefinitely even after an erasure action runs. See docs/privacy-review.md §3 for the full accounting of what is and isn't reachable.

## 12.10 Data Export **[ENG]**

Candidate self-service or agency-initiated export of a candidate's stored data as structured JSON, satisfying portability/access-request obligations — implemented Build Phase 14 Wave 3 as `exportCandidateDataAction` (`apps/web/lib/candidates/privacy-actions.ts`). See docs/privacy-review.md §4.

## 12.11 Audit Logging **[ENG]**

Covered in depth in [[07-data-model]] §7.7 — append-only `audit_events`, DB-role-level revoked UPDATE/DELETE, transactional with the action it records.

## 12.12 AI-Provider Data Exposure **[ENG + LEGAL]**

Candidate CV content and JD text are sent to the Anthropic API for processing. **[LEGAL]** Confirm the applicable Anthropic API data-handling terms (retention, training-use opt-out) satisfy the agency's obligations to its clients and candidates, and document this in the agency's own privacy notice. **[ENG]** No candidate data is sent to any AI provider beyond Anthropic without an explicit, reviewed integration.

## 12.13 Prompt Injection & Malicious Document Handling **[ENG]**

Covered in [[09-ai-architecture]] §9.1 and [[10-ai-evaluation-guardrails]] §10.8 — untrusted document text is never concatenated into system instructions; adversarial fixture tests run in CI. The same untrusted-data framing (Rule 0 of the copilot's own system prompt, `apps/web/lib/copilot/orchestration/system-prompt.ts`) now covers the Recruiter AI Copilot's retrieved data as well — any tool-result content, however it got there, is DATA for the model to read and reason about, never something it obeys, and this is asserted directly for every role/classification combination by `eval/prompt-injection.test.ts` (§10.14) rather than left implicit.

## 12.14 File Type/Size Validation, Malware Scanning **[ENG]**

See §12.5.

## 12.15 Rate Limiting & Abuse Prevention **[ENG]**

Per-org and per-user rate limits on AI-triggering endpoints (upload, re-score) to bound cost exposure and prevent a single misbehaving client from degrading service for others; standard IP-based rate limiting on auth endpoints.

## 12.16 Backup & Recovery **[ENG]**

Supabase automated daily backups (point-in-time recovery per plan tier) plus a documented restore drill before production launch; Storage bucket versioning for candidate documents doubles as a lightweight recovery mechanism given the no-hard-delete policy ([[07-data-model]] §7.5–7.6).

## 12.17 Incident Response **[POLICY]**

**[RECOMMENDATION]** A written incident-response runbook (who's paged, candidate-data-breach notification obligations and timelines per jurisdiction) should exist before production launch, not be improvised during a live incident — this is a **[LEGAL]** input, **[POLICY]** owned deliverable.

## 12.18 GDPR Considerations **[LEGAL]**

Applies if any candidate or client contact is an EU/UK resident — even a US-based client's candidate pool may include this given the "Europe, MENA" sourcing scope discussed in the MOM's vendor pitch (§4). Flag explicitly rather than assume US-only scope.

## 12.19 US Privacy Considerations **[LEGAL]**

State-level laws (e.g., CCPA/CPRA for California candidates) may apply depending on client and candidate location; **[LEGAL]** confirm scope once the client's actual candidate geography is known.

## 12.20 Human Oversight in Employment Decisions **[LEGAL + ENG]**

**[LEGAL — high priority]** AI-assisted candidate scoring used in an employment context may be subject to emerging AI-employment-decision regulation (e.g., NYC Local Law 144-style bias-audit requirements, EU AI Act high-risk classification for recruitment AI) depending on jurisdiction. This is **not** a generic "nice to have" — it directly shapes whether bias testing ([[10-ai-evaluation-guardrails]] §10.7) is a QA best practice or a legal compliance requirement. **[CLIENT CONFIRM / LEGAL]** flag as a P0 blocking question — see [[18-blocking-questions]].

## 12.21 Recruiter AI Copilot Data Classification **[ENG]**

Build Phase 11 (`supabase/migrations/0031_copilot.sql`) adds a `copilot_conversations.data_classification` column (`standard` | `restricted_notes_excluded`) as the schema-level signal for whether a conversation's retrieval may include recruiter-only annotations at all. A CHECK constraint forces `restricted_notes_excluded` (never `standard`) for every `client_decision_maker`-authored conversation, and forces exactly one project and one client (never org-wide scope) on the same row — narrowing the retrieval surface at the schema layer before any application code executes. Field-level redaction of recruiter-only content (`candidate_profiles.recruiter_notes`, `shortlist_candidates.recruiter_note`, `human_reviews`-derived reviewer notes) for a `restricted_notes_excluded` conversation happens inside each tool handler itself (`apps/web/lib/copilot/redaction.ts`), before a prompt is ever assembled — the same "RLS is row-level, column redaction is application-layer" principle §6.2.3/§12.1 already established for every other candidate-facing surface, applied here to the copilot's own retrieval path. Every copilot tool call is additionally re-validated for resource ownership (organization, client, project) on every single invocation, never assumed from the conversation's own scope snapshot alone (docs/07-data-model.md §7.12), and the outcome — validated or denied — is persisted on the `copilot_tool_calls` row as an auditable fact, satisfying the same "who viewed this candidate" answerability §12.4 requires of every other candidate-record read. See docs/07-data-model.md §7.12, docs/09-ai-architecture.md §9.9, and docs/10-ai-evaluation-guardrails.md §10.14 for the full schema/orchestration/eval-suite detail.

Related documents: [[06-roles-permissions]] · [[07-data-model]] · [[09-ai-architecture]] · [[18-blocking-questions]]
