# Rollback Runbook

Build Phase 15 Wave 1 (staging deployment preparation). This runbook covers
what to do when a staging (or, once one exists, production) deploy needs to
be undone or fixed forward. **Nothing in this document has been exercised
against a real deployment** — no Vercel account, Supabase project, or
staging deploy has ever existed in the environment this was written in (see
`.github/workflows/staging-deploy.yml`'s header). This describes the
realistic procedure given what this codebase and Vercel/Supabase actually
support, not a feature that has been built and tested end to end.

## 1. Identifying what's currently live

Every deploy produced by `staging-deploy.yml` is tagged
`staging-<UTC timestamp>-<short git SHA>` (e.g. `staging-20260315-141022-a1b2c3d`)
and pushed to this repository, and the deployed build itself carries its own
identity via two build-time environment variables
(`NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_RELEASE_TAG`, wired in
`apps/web/lib/env.ts`'s `getBuildInfo()` — see that file; rendering this
somewhere in the UI, e.g. a footer string or a non-production banner, is
explicitly **out of scope for this wave**, which only builds the underlying
data plumbing).

To find out what's live right now:

1. **Git tags** — `git tag -l 'staging-*' --sort=-creatordate | head -5` lists
   the most recent staging deploys, newest first; each tag's own commit is
   the exact source tree that was deployed.
2. **The deployed app's own build identity** — once a UI surface reads
   `getBuildInfo()` (a later wave), that is the authoritative "what is
   actually running right now" answer, since it reflects the literal build
   artifact live, not just what was last _intended_ to be deployed.
3. **The Vercel dashboard** — the staging Vercel project's Deployments tab
   shows every deployment, which one is currently promoted/aliased to the
   staging URL, and its git SHA.
4. **The GitHub Actions run itself** — `staging-deploy.yml`'s job summary
   (posted via `$GITHUB_STEP_SUMMARY` by its `summary` job) records the
   deployed URL, release tag, and git SHA for that specific run.

If any two of these disagree, trust #2 (the running app's own reported
identity) over the others — a git tag or a dashboard listing describes what
was _deployed_, but the running app is the only source that can't be stale.

## 2. Rolling back a bad Vercel deployment

This is the easy case, and Vercel supports it natively — describing
accurately what it actually does, not inventing a feature:

- **Instant rollback**: In the Vercel dashboard, the Deployments list for
  the staging project lets you select any prior deployment and "Promote to
  [environment]" (or, for a project using Vercel's Production
  environment/domain, "Instant Rollback"). This re-points the live
  alias/domain at that prior deployment's already-built, already-deployed
  static output — it does **not** rebuild anything, so it is fast (seconds)
  and carries no build-time risk. The Vercel CLI equivalent is
  `vercel rollback [deployment-url-or-id]`.
- **What this does NOT do**: it only changes which built artifact serves
  traffic. It does **not** touch the database — a Vercel rollback alone
  will not undo a database migration or any data written since the bad
  deploy. If the bad deploy included a schema change the rolled-back code
  is incompatible with, the Vercel rollback must be paired with the
  database procedure in §3 below, in the right order (see §4).
- **How this workflow supports it**: `staging-deploy.yml`'s `deploy-vercel`
  job never overwrites a previous deployment — every run creates a new,
  independent deployment (`vercel deploy --prebuilt --prod=false`), and (if
  `STAGING_APP_URL` is configured) only the _alias_ is re-pointed. Every
  prior deployment stays reachable at its own immutable URL until Vercel's
  own retention/cleanup removes it, so "roll back" is always available as
  long as the target deployment still exists.

## 3. Rolling back a bad Supabase migration

This is the hard case, and the honest answer is: **Postgres migrations in
this codebase are not automatically reversible.** There is no `down.sql` per
migration, no `supabase migration revert` step in any workflow here, and
building one was explicitly out of scope for this wave.

**Why "rollback" mostly isn't the right mental model here**: every migration
in `supabase/migrations/` (`0001` through the current max) is additive-only
by this codebase's own established convention — confirmed by inspection for
this runbook: zero `drop table` or `drop column` statements exist anywhere
in the migration set. New tables, new nullable columns, new indexes, new
policies — but nothing has ever been removed or destructively altered in
place. This is deliberate (see `docs/17-deployment-operations.md` §17.11:
"database migrations are written to be forward-compatible for at least one
release so a code rollback doesn't require a simultaneous schema rollback")
and it is exactly what makes §2's fast application-level rollback usually
sufficient on its own: an older application build is normally still
compatible with a newer, additive-only schema, since nothing it depends on
was removed.

Given that, "rolling back a bad migration" in practice means one of two
things, in order of preference:

1. **A new forward migration that undoes the change** (the normal case).
   If migration `0036_bad_change.sql` added a column with a wrong default,
   or a policy that turned out to over- or under-restrict access, the fix
   is `0037_fix_bad_change.sql` — a new, numbered, additive migration that
   corrects it (e.g. `alter table ... alter column ... set default ...`, or
   `drop policy ... ; create policy ...` for a single named policy, which is
   a normal, low-risk, forward-compatible schema change, distinct from
   dropping a table or column). This keeps the migration history honest
   (nothing is rewritten or force-pushed) and goes through the exact same
   `migration-validation.yml` CI gate as every other migration before it
   can be applied to staging.
2. **A true emergency: point-in-time restore.** If a migration (or a bad
   deploy combined with real writes) has actually corrupted or destroyed
   data in a way no forward migration can repair, Supabase's own
   point-in-time recovery (PITR) is the real mechanism — restoring the
   project's database to a timestamp before the bad change. This is
   described here honestly, not invented: PITR is a genuine Supabase
   platform feature, but it (a) requires the project to be on a paid tier
   with PITR enabled in its project settings _before_ the incident (it
   cannot be turned on retroactively to recover data already lost), (b) is
   performed from the Supabase dashboard/support, not from anything in this
   codebase or its CI, and (c) restores the _entire_ database to that
   point in time — any legitimate writes made between the restore point and
   now are lost too, which is exactly why this is the last resort, not the
   default rollback mechanism. Whether the staging (and eventually
   production) Supabase project has PITR enabled is a project-settings /
   billing decision for whoever owns that Supabase account — this codebase
   has no way to enable or verify it.

## 4. Ordering a combined rollback

When both the app and the database need to move backward together:

1. Roll back Vercel first (§2) to the last known-good build.
2. Only if that older build is genuinely incompatible with the current
   schema (rare, given the additive-only convention above) — write and
   apply a new forward migration (§3.1) that restores compatibility, never
   a destructive `drop`/`alter` of the problematic change, unless a true
   emergency (§3.2) is already underway.
3. Re-verify: run `scripts/verify_candidates.sql` against the target
   database state (see `.github/workflows/migration-validation.yml` for the
   exact bootstrap procedure) before considering the incident resolved.

## 5. Escalation / decision checklist — rollback vs. forward-fix

Ask, in order:

1. **Is the app simply serving broken/wrong behavior, with the database
   unaffected?** → Vercel rollback (§2) alone. Fast, safe, no data risk.
   This is the common case and should be the default first move for any
   "the new deploy is broken" report.
2. **Did the bad deploy write bad data (not just serve a bad UI)?** → Vercel
   rollback stops the bleeding immediately, but the bad data written during
   the incident window still needs a targeted fix (a forward migration or a
   manual, audited data correction) — rolling back the app does not undo
   rows already written.
3. **Is the schema itself now wrong** (a bad column default, an
   over-permissive policy, a broken constraint)? → A new forward migration
   (§3.1), gated through `migration-validation.yml` like any other change.
   Never hand-edit a live database outside of a migration file — this is an
   explicit engineering rule for this codebase, not just a runbook
   preference.
4. **Has data actually been destroyed or corrupted beyond what a forward
   migration can repair** (and PITR is available on the project)? → Point-
   in-time restore (§3.2), accepting the loss of any legitimate writes since
   the restore point. This requires a deliberate human decision, weighing
   that data loss against the cost of staying broken — never an automated
   or unilateral action.
5. **If in doubt, prefer the forward-fix over any destructive action.**
   Every rollback mechanism above that touches data (a restore) is strictly
   harder to undo than writing one more additive migration. When the
   correct fix is unclear, stop and get a second person's judgment before
   reaching for PITR — per this project's own engineering rules ("stop and
   report blockers when required credentials, business decisions, or source
   data are missing"), a restore decision is exactly that kind of blocker,
   not something to resolve alone under time pressure.

## 6. What this runbook explicitly does not cover

- Production rollback procedure specifically — this build phase's brief is
  staging-only ("do not deploy to production"); once a real production
  environment exists, this runbook's mechanics still apply, but the
  approval bar for actually invoking §3.2 (PITR) against a production
  database with real candidate data is a materially bigger decision than
  against a staging project seeded with synthetic data.
- Automatic rollback triggers (e.g. auto-rollback on a failed health check
  post-deploy) — nothing in this codebase watches a deploy and reacts
  automatically; every rollback described above is a deliberate, human-
  initiated action.
- Background-job (`background_jobs` table) recovery specifically — see
  `docs/17-deployment-operations.md` §17.7 for that subsystem's own,
  separately documented open limitations (no stale-row reclaim sweep),
  which are a related but distinct concern from a bad deploy or migration.
