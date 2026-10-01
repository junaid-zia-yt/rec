# Recruitment Quality Intelligence — Master Architecture

## Executive Summary

Recruitment Quality Intelligence converts a specialist recruitment agency's manual, expertise-driven scoring process into a defensible, evidence-backed platform — without removing the human from any decision that matters. The client ("Dave") is not buying automation for its own sake; he is buying a second sourcing-and-scoring process he can trust as much as his own, fast enough to be worth outsourcing, that never puts a candidate in front of his own clients without a documented human sign-off and a traceable evidence trail. Everything in this architecture is organized around that single constraint.

## Client Need

Quality over quantity, stated repeatedly and treated by Dave as non-negotiable (MOM §5, §9.1). A fast but lower-quality result is an explicit failure condition. The immediate commercial gate is a single proof-of-concept: parallel sourcing on 1–2 live roles, compared on speed and quality against Dave's own 90%/95%/97–98% scoring thresholds, with no second chance if it fails (MOM §6, §8). See [[01-project-context]].

## Recommended Product

A multi-tenant Next.js/Supabase/Claude platform structured around six enforced principles baked into the architecture, not just the UI copy:

1. Mandatory requirements are **deterministic** pass/fail gates — never an LLM judgment call taken at face value ([[08-candidate-scoring]]).
2. A candidate who fails a mandatory gate is **structurally excluded** from the ranked shortlist — not filtered by convention.
3. Every score ships with an evidence percentage and per-criterion citations, matching the UI pattern already visible in the one confirmed Stitch screenshot ([[02-asset-inventory]] §2.3.1).
4. Nothing reaches a client without a human "sign-off" action, audited immutably ([[07-data-model]] §7.7).
5. Missing data is labeled unverified, never guessed or silently omitted.
6. AI never writes the authoritative score or gate result directly — only a deterministic service does, after validating AI-proposed extractions.

## System Context

```
Recruiter / Agency Admin ──▶ Web app (Next.js) ──┐
Client Decision-Maker ──▶ Web/Mobile (scoped) ───┼──▶ Domain services ──▶ Supabase (Postgres/RLS/Storage/pgvector)
Field recruiter ──▶ Mobile app (Expo, review-first) ┘        │
                                                                ▼
                                                        Anthropic Claude API
                                                (structured JSON, schema-validated,
                                                 every call logged to AI_runs)
```

## Main Users

Platform Admin (vendor-side) · Agency Admin (Dave) · Recruiter (Dave + his colleague, today; scales later) · Client Decision-Maker (Dave's own clients) · Read-Only Reviewer. Full permission matrix in [[06-roles-permissions]].

## Core Workflows

JD upload → AI extraction → human-reviewed requirements → approved scorecard → candidate import/CV parsing → deterministic mandatory gates → evidence-backed weighted scoring → human quality review (confirm/override) → 2–3-candidate shortlist with sticky sign-off → client decision → (in parallel) approved, evidence-backed outreach. Full detail in [[05-functional-requirements]] and [[03-screen-inventory]].

## High-Level Architecture

See [[13-api-service-boundaries]] §13.1 for the full diagram. In short: thin Next.js Server Action/API layer → domain services (recruitment, scoring, AI orchestration, document processing, notifications, integrations, audit, analytics) → Supabase for all persistence, auth, storage, and RLS-enforced tenant isolation.

## Data Architecture Summary

36 entities spanning tenancy, recruitment-project lifecycle, candidate profile/document/evidence, scoring, review, shortlisting, outreach, AI governance, and audit. Every tenant-owned row carries `organization_id`; no hard deletes on anything audit or evidence depends on; scores are versioned against the scorecard version they were computed from. Full detail in [[07-data-model]].

## AI Architecture Summary

18 distinct AI workflows, each with a defined trust boundary (raw document text is always untrusted, never concatenated into system instructions), each schema-validated before persistence, each logged to `AI_runs` with model/prompt-version/confidence. The final match score and gate result are **always** computed deterministically after AI proposes the underlying extraction — this is the architecture's core AI-safety guarantee. Full detail in [[09-ai-architecture]] and [[10-ai-evaluation-guardrails]].

## Candidate-Scoring Summary

Six-layer model (mandatory gates → weighted scoring → semantic similarity → evidence confidence → data completeness → human judgment), where a failed gate suppresses the overall score entirely rather than merely lowering it. Worked example in [[08-candidate-scoring]] §8.12 reproduces the exact 96%/5-of-5/100%-evidence pattern seen in the confirmed screenshot.

## Security Model

RLS-enforced multi-tenant isolation, three-layer authorization (RLS + server-side guard + UI), append-only audit log, no client-side secrets, adversarial prompt-injection testing as a CI gate, and an explicit legal-review track for consent, human-oversight-in-employment-decision regulation, and cross-border data-residency questions raised by the vendor's own broader-geography sourcing pitch. Full detail in [[12-security-compliance]].

## Integration Strategy

Email (Resend) and file storage are unblocked today. Apollo is technically straightforward pending an account-ownership answer. LinkedIn is manual-only by design (no scraping/auto-messaging). **TA Tracker has no confirmed API and is explicitly out of scope until the client supplies technical access** — this is the single most consequential integration blocker in the whole project. Full detail in [[11-integration-plan]].

## POC Strategy

The MOM already defines the POC's shape; this architecture adds the missing quantification the MOM itself calls for (gate-agreement rate, evidence completeness, ranking correlation, time-to-shortlist) so the go/no-go decision isn't left to a disputed subjective judgment. Full detail in [[14-poc-specification]].

## Implementation Phases

15 phases, Discovery → Foundation → Auth/Tenancy → Design System → (Project/JD → Requirements/Scorecard → Candidates → Gates/Scoring → AI Hardening → Matching/Review → Outreach → Shortlists/Client Decisions) → POC/Analytics → Mobile → Integrations → Security Hardening/Launch. Full detail, dependencies, and per-phase decisions-required in [[15-implementation-roadmap]].

## Major Risks

1. **Two conflicting design systems uploaded under an identical filename** — real risk of building the wrong one ([[02-asset-inventory]] §2.2).
2. **24 of 25 screenshots are currently inaccessible** due to a filename-collision limitation in the file-access tooling — screen inventory is largely inferred, not observed ([[02-asset-inventory]] §2.3).
3. **TA Tracker integration has no known technical path** — must not be promised to the client on any timeline until documentation arrives ([[11-integration-plan]] §11.2).
4. **Unresolved account-ownership for LinkedIn/Apollo outreach** — was asked directly in the discovery call and never answered; blocks both Phase 14 and the POC's outreach step ([[11-integration-plan]] §11.3).
5. **Subjective POC success criteria** — the MOM itself names this as a risk; an unquantified benchmark invites a disputed outcome at the one moment the client has said he'll walk away after a single failure ([[14-poc-specification]]).
6. **Potential AI-employment-decision regulatory exposure** — unresolved which jurisdictions apply, materially affects required bias-testing and explainability rigor ([[12-security-compliance]] §12.20).

## Blocking Decisions

Full prioritized list in [[18-blocking-questions]]; the four P0 items (POC success criteria, design-system authority, screenshot re-upload, employment-AI regulatory scope) should be resolved, or explicitly defaulted per our stated recommendations, before Phase 3 begins.

## Supporting Documents

[[01-project-context]] · [[02-asset-inventory]] · [[03-screen-inventory]] · [[04-design-system]] · [[05-functional-requirements]] · [[06-roles-permissions]] · [[07-data-model]] · [[08-candidate-scoring]] · [[09-ai-architecture]] · [[10-ai-evaluation-guardrails]] · [[11-integration-plan]] · [[12-security-compliance]] · [[13-api-service-boundaries]] · [[14-poc-specification]] · [[15-implementation-roadmap]] · [[16-testing-strategy]] · [[17-deployment-operations]] · [[18-blocking-questions]]

---

_Analysis phase only, per the STOP CONDITION in the project instructions. No code, migrations, dependencies, or external connections were created. Awaiting review and explicit approval before Build Phase 1._
