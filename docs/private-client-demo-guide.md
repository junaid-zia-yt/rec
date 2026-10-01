# Private Client Demo Guide — Build Phase 17D

Date: 2026-09-29
Audience: whoever is running the private demonstration for Dave (recruiter, founder, or engineer).

This guide is the operational companion to `docs/demo-script.md`, `docs/demo-limitations.md`, and `docs/post-demo-conversion-plan.md`. Read this one first — it covers what environment to run, how to seed and reset it, and what to say if Dave asks what he's looking at.

---

## 1. What this demo is — and is not

This is a **private, controlled demonstration** of the product's workflow and design, run against fictional data, to help Dave (who has not approved a paid implementation) decide whether to move forward. It is explicitly **not**:

- Production.
- A staging environment certified for anything.
- A live UAT round.
- A real recruitment system processing real candidates or a real client relationship.
- Evidence that any cloud infrastructure (Supabase, Vercel, Sentry, a production Anthropic key, Resend sending, backups, rollback, or multi-tenant isolation) has been provisioned or verified live. **None of that exists yet in this project's history** — see `docs/demo-limitations.md` and `docs/final-release-report.md` for the full, unchanged list of production blockers.

The application displays a persistent **"Private Demonstration — Sample Data"** banner on every page for exactly this reason: nothing shown should be mistaken for a live system or real candidate data.

## 2. What is real, and what is a sample

This matters because it's the honest answer to "is this really AI, or is it fake?":

- **Real**: every gate pass/fail, every overall score, every evidence-coverage percentage, and every data-completeness percentage shown in the demo is a genuine output of the platform's real, unmodified deterministic pipeline (`runMatchingPipeline` → `computeDeterministicMatchResult`) — the exact same code that will run in production. Mandatory-gate enforcement (Core Rule #6: a candidate who fails a mandatory requirement cannot enter the ranked shortlist) is real, working logic, demonstrated on fictional candidates.
- **Sample, clearly labelled**: the semantic-relevance judgment normally supplied by a live Claude API call is replaced, in demo mode only, by a deterministic, offline stand-in (`ai_runs.model = 'sample-assessment-v1'`). It is never presented as live AI output. A labelling notice appears wherever an AI-influenced result is shown.
- **Never real**: all client, candidate, and job data in the demo is fictional — invented names, invented (nonexistent) companies, no real personal information. Outreach is preview/draft only; nothing is ever sent to a real inbox (see §5).

## 3. Environment

The demo runs from this same codebase, with demo mode switched on via `NEXT_PUBLIC_DEMO_MODE=true` (already set in `apps/web/.env.local`). Demo mode:

- Shows the persistent "Private Demonstration — Sample Data" banner on every page.
- Forces the outreach email adapter to a no-op/preview mode regardless of whether a real Resend key is configured (belt-and-suspenders — see `apps/web/lib/outreach/channels/email.ts`).
- Routes candidate matching through the sample-assessment provider rather than attempting a live Anthropic call.

No real Supabase, Vercel, Sentry, Resend, or Anthropic credential is required to run the demo, and none should be added to this environment for the purpose of the demo. A real (but disposable/local) Postgres database is still needed to hold the demo data, exactly as it is for any local development run of this app.

Fresh verification of this environment, completed 2026-09-29 (Build Phase 17D, Wave B):

| Check                                                                            | Result                                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                              | Clean                                                                                                                   |
| `npx turbo run lint --force`                                                     | 0 errors (18 pre-existing, unrelated mobile-app warnings, unchanged)                                                    |
| `npx turbo run typecheck --force`                                                | Clean across all 6 packages                                                                                             |
| `npx turbo run test --force`                                                     | 119 test files / 884 tests passing                                                                                      |
| `pnpm build` (`next build`)                                                      | Succeeds; `/icon` route present                                                                                         |
| Local migration replay (0001–0036)                                               | Clean, no errors                                                                                                        |
| `scripts/check-migration-sequence.mjs`                                           | OK — 36 migrations, strictly sequential, no gaps                                                                        |
| `scripts/verify_candidates.sql` regression suite                                 | 98 PASS assertions, 0 failures                                                                                          |
| Browser walkthrough — 11 routes × 2 viewports (desktop 1440×900, mobile 390×844) | 22/22 pages: HTTP 200, zero console errors, zero page errors, zero navigation errors, demo banner visible on every page |

## 4. Seeding and resetting demo data

Two scripts, deliberately separate from `seed.ts` (generic local dev) and `seed-staging.ts` (CI staging UAT fixtures) so the three can never be confused:

```bash
# Seed (creates a new demo organization — NOT idempotent, see script header)
ALLOW_DEMO_SEED=true \
NEXT_PUBLIC_SUPABASE_URL=<your local/dev Supabase URL> \
SUPABASE_SERVICE_ROLE_KEY=<your local/dev service role key> \
pnpm --filter web seed:demo

# Reset (wipe the private-demo organization and reseed cleanly)
ALLOW_DEMO_SEED=true \
NEXT_PUBLIC_SUPABASE_URL=<...> \
SUPABASE_SERVICE_ROLE_KEY=<...> \
pnpm --filter web reset:demo
```

Both scripts refuse to run unless `ALLOW_DEMO_SEED=true` is set explicitly — a deliberate safety rail against accidentally pointing this at a real database. **Never point either script at a production or paid-staging Supabase project.**

Run `reset-demo.ts` before the client meeting (clean state) and optionally again after, so the demo is always restorable to its original state.

Demo sign-in accounts (passwords are never persisted by the seed script — use "Forgot password" from the sign-in screen to set a known password before the meeting):

| Role                  | Email                                    |
| --------------------- | ---------------------------------------- |
| Agency admin          | `admin@private-demo.rqi.local`           |
| Recruiter             | `recruiter@private-demo.rqi.local`       |
| Client decision-maker | `client-reviewer@private-demo.rqi.local` |
| Read-only reviewer    | `read-only@private-demo.rqi.local`       |

## 5. What the seeded demo contains

One fictional organization ("Brightside Talent Partners (Private Demo)") and one fictional client ("Fictional Sunbelt Retail Holdings"), with two realistic sample roles:

1. **Shift Lead, Quick Serve Restaurant** (Tempe, AZ) — mandatory: 1+ years shift-lead experience in food service, valid food handler certification. Preferred: weekend/evening availability (60), cash-handling experience (40).
2. **District Manager, Convenience Retail** (multi-site, Central Texas) — mandatory: 5+ years multi-unit convenience retail management experience, valid driver's license. Preferred: P&L ownership across multiple locations (70), loss-prevention program experience (30).

Each role has 5 fictional candidates (10 total), deliberately covering the scenarios that make the quality-first story visible side by side:

- **2 clear passes** — clean mandatory-gate passes with strong, direct evidence.
- **1 clear mandatory-gate fail** — Core Rule #6 in action: expired certification / suspended license, excluded from the ranked shortlist regardless of other strengths.
- **1 borderline case** — mandatory gates pass, but a preferred-requirement claim is contradicted by an indirect note (a simulated reference-call observation). Routed to human review with a recorded reason, never auto-resolved.
- **1 missing-information case** — zero evidence exists for a mandatory requirement. Resolves to `insufficient_evidence` / `pending_verification`, never a guessed pass — Core Rule #4 in action.

Each role also has: an approved, active scorecard; a human review decision on its borderline candidate; a 3-candidate shortlist built only from gate-passing candidates via the real shortlist rule; and one drafted (never sent) outreach email for an eligible candidate.

## 6. If Dave asks a hard question

Answer honestly, using `docs/demo-limitations.md` as the reference — do not improvise a stronger claim than what's true. A short version of the most likely questions:

- **"Is this live AI?"** No — the demo uses a clearly-labelled sample assessment layer instead of a live model call, running through the same real deterministic logic that will be used in production. Real live-model behavior will be verified once a paid Anthropic key is configured (see `docs/demo-limitations.md`).
- **"Is my data safe here?"** No real candidate or client data has ever touched this environment — everything shown is fictional. Production data-handling (encryption, retention, RLS, backups) is designed but not yet verified against live infrastructure.
- **"Can I try it on our real roles?"** Not in this demo. That's exactly what the proof-of-concept described in `docs/post-demo-conversion-plan.md` is for.
- **"Why can't you show me TA Tracker / LinkedIn outreach working?"** Both are deferred by explicit project scope decision — see `docs/demo-limitations.md`.

## Related documents

`docs/demo-script.md` · `docs/demo-limitations.md` · `docs/post-demo-conversion-plan.md` · `docs/final-release-report.md` · `docs/build-phase-17a-staging-verification-report.md`
