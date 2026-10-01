# 21 — Implementation Contract

This document is the binding reference for all Build phases. Any change to what it defines is a scope change and must be reflected here and in [[20-decision-register]] before code is written against it — not discovered after the fact in a PR review.

## 21.1 Approved MVP Scope

As defined in [[19-mvp-scope]] §19.1–19.4. No feature from §19.2 (Excluded) is built without a new, explicit decision entry in [[20-decision-register]].

## 21.2 Technology Stack (fixed, per project instructions)

Web: Next.js 16, TypeScript (strict), App Router, Tailwind CSS, shadcn/ui.
Mobile (Phase 13+): Expo React Native, TypeScript.
Backend: Supabase (PostgreSQL, Auth, Storage, RLS, pgvector).
AI: Anthropic Claude API, structured JSON outputs, Zod validation.
Infrastructure: Vercel, Resend (email), Sentry, Zod, Vitest, Playwright.
No substitution without a decision-register entry.

## 21.3 Repository Structure (proposed)

```
/app                        # Next.js App Router routes
  /(auth)                   # sign-in/up
  /(app)/[org]/projects      # recruiter/admin workspace
  /(app)/[org]/candidates
  /(app)/[org]/shortlists
  /(app)/[org]/admin
  /(client)/[client-token]   # scoped client decision-maker view
  /api                       # route handlers (webhooks, non-server-action endpoints)
/components
  /ui                        # shadcn/ui primitives
  /domain                    # dossier-card, gate-badge, sticky-approval-sheet, verification-matrix, etc.
/lib
  /domain                    # business logic services (scoring, gates, matching) — framework-agnostic
  /ai                        # Claude client wrapper, prompt templates, schema validators
  /db                        # Supabase client factories, RLS-aware query helpers
  /auth
/supabase
  /migrations
  /seed
/types                       # shared Zod schemas + inferred TS types (source of truth for mobile too)
/tests
  /unit /integration /e2e /rls /ai-eval /fixtures (incl. prompt-injection fixtures)
/docs                        # this document set, kept current
```

## 21.4 Naming Conventions

- Tables/columns: `snake_case`, matching [[07-data-model]] exactly — no renaming during implementation without updating that document first.
- TypeScript: `PascalCase` types/components, `camelCase` functions/variables, Zod schemas suffixed `Schema` (e.g., `CandidateProfileSchema`).
- Server actions: verb-first (`approveScorecard`, `finalizeShortlist`), matching the operation names in [[13-api-service-boundaries]] §13.4 where one exists.
- Branches: `phase-N/<short-slug>`; commits reference the FR/decision ID touched where applicable.

## 21.5 Architecture Boundaries

- UI components never call Supabase directly for anything beyond simple, RLS-safe reads used purely for display — all state-changing operations go through a server action that calls a domain service.
- Domain services (`/lib/domain`) contain business logic and are framework-agnostic — testable without Next.js or a browser.
- The AI orchestration layer (`/lib/ai`) is the **only** place Claude is called from; a domain service never embeds prompt text inline.
- The scoring/gate service is the **only** writer of `mandatory_gate_results` and `candidate_role_matches.overall_score` — no other code path writes these fields, enforced by code review and, where practical, DB grants.

## 21.6 Security Rules (non-negotiable, matches [[12-security-compliance]])

- No secret or API key in any `NEXT_PUBLIC_*` variable or client bundle — CI includes a secret-pattern scan on build output.
- Every tenant table has an RLS policy before it ships, verified by the RLS test suite — no table merges without one.
- File uploads validated for type/size before reaching the parsing pipeline; malware scanning wired in before any document reaches the AI pipeline.
- Client Decision-Maker access is implemented as its own narrow policy (never org membership) per [[06-roles-permissions]] §6.3.

## 21.7 Database Migration Rules

- Every schema change is a versioned Supabase migration file, no exceptions, no manual `ALTER TABLE` against any shared environment.
- Migrations are additive/backward-compatible for at least one release where practical (supports rollback per [[17-deployment-operations]] §17.11).
- A migration that touches a tenant table includes its RLS policy in the same migration, not a follow-up one.

## 21.8 Row Level Security Requirements

- Convention: `USING (organization_id = current_org_id())` on every tenant table; `current_org_id()` reads a custom JWT claim.
- Client Decision-Maker policies scoped to explicitly-shared `shortlist_candidates` rows only.
- Every new table ships with a corresponding entry in the RLS test suite in the same PR.

## 21.9 AI Implementation Rules (matches [[09-ai-architecture]])

- Every Claude call specifies a JSON schema; every response is Zod-validated before persistence.
- Untrusted document/CV/JD text is always passed as clearly delimited data, never concatenated into system instructions.
- The final mandatory-gate result and overall match score are always computed by deterministic code after AI proposes inputs — never written directly from a raw model response.
- Every AI call logs to `AI_runs` (model, prompt version, inputs ref, outputs, confidence, cost, timestamp) in the same transaction as its use.

## 21.10 Evidence Requirements (matches [[08-candidate-scoring]])

- No score or gate result may be displayed or persisted without an accompanying evidence reference (or an explicit `insufficient_evidence`/`unverified` state) — this is enforced at the schema level (a non-nullable evidence-reference field on `requirement_evidence`), not just a UI convention.
- Evidence excerpts are verbatim from a stored, versioned document — never paraphrased or reconstructed by the AI at read time.

## 21.11 Human Approval Requirements

- Shortlist finalization, outreach sending, scorecard approval, and candidate merge-on-dedup all require an explicit human action recorded as a `human_reviews` and/or `audit_events` row before the downstream effect occurs.
- Any override of an AI-derived value requires a non-empty reason field, stored in `review_decisions`.

## 21.12 Testing Requirements (matches [[16-testing-strategy]])

- No PR merges without: typecheck, lint, unit tests, and (where touched) RLS tests and AI schema-validation tests passing in CI.
- A new state-changing server action ships with at least one integration test covering its documented error cases ([[13-api-service-boundaries]] §13.4).
- The 8 critical E2E journeys in [[16-testing-strategy]] §16.1 run in CI before any staging promotion once Phase 11 is reached.

## 21.13 Definition of Done (per feature/phase)

A task is "done" only when: code implements the smallest complete vertical slice for its FR(s); typecheck/lint/tests pass; loading/empty/error/permission-denied states are implemented where applicable (per the project instructions' engineering rules); the relevant doc(s) in this set are updated if the implementation diverged from the spec; and the phase-completion report (§21.14) is produced.

## 21.14 Phase Completion Reporting Format

Each phase closes with a short report: (1) FRs/decisions implemented, (2) files changed, (3) migrations applied, (4) test results (pass/fail counts), (5) any deviation from this contract or the design docs and why, (6) blockers hit and how they were resolved or deferred, (7) explicit statement of what was **not** done and remains for a later phase.

## 21.15 Rules Preventing Unapproved Scope Expansion

- Nothing in [[19-mvp-scope]] §19.2 (Excluded) is implemented without a new decision-register entry, approved by the client, added before the work starts.
- A phase does not begin work belonging to a later phase in [[15-implementation-roadmap]] "to save time" — sequencing is deliberate (dependency-driven, not arbitrary).
- Any request to add a feature mid-phase is logged as a new row in [[20-decision-register]] rather than silently absorbed into the current task.
- If a required credential, business decision, or source data is missing, the phase stops and reports the blocker — per the project instructions — rather than guessing or stubbing around it silently.

Related documents: [[19-mvp-scope]] · [[20-decision-register]] · [[22-build-phase-1-plan]]
