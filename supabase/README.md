# Supabase — schema, RLS, and required manual configuration

Build Phase 2 (`docs/build-phase-2-report.md`) added migrations `0001`–`0007`
(orgs, users, memberships, invitations, audit log, the JWT hook). Build
Phase 3 (`docs/build-phase-3-report.md`) added `0008`–`0014` (clients,
recruitment projects, jobs, job descriptions, project assignments, project
activity, and the private documents Storage bucket) and extended the seed
script. **No live Supabase project is connected to this repository** —
nothing here has been applied to or verified against a real Postgres
instance. This file is the checklist for doing that.

## Applying the migrations

```bash
supabase link --project-ref <your-project-ref>   # once, with the Supabase CLI
supabase db push                                  # applies migrations/*.sql in order
```

Migrations are numbered and must be applied in order (`0001` → `0014`). Each
one is additive; none has been run yet, so there is no rollback history to
worry about.

Two Build-Phase-3 migrations need a moment's attention before a production
apply, even though neither is destructive: `0008` adds a `client_id` column
to the existing `organization_memberships` table (nullable, `on delete set
null` — safe on a table with existing rows), and `0014` inserts a Storage
bucket row and two `storage.objects` policies (idempotent via `on conflict`
for the bucket; the policies are created fresh and will error on a second
apply if already present, same as every other `create policy` in this
migration set — none of them use `create or replace`).

## Manual steps the migrations cannot perform

1. **Register the custom access token hook** (`0007_custom_access_token_hook.sql`
   creates the function; it does nothing until registered). In the Supabase
   Dashboard: Authentication → Hooks → "Customize Access Token (JWT) Claims
   hook" → select `public.custom_access_token_hook`. Or in
   `supabase/config.toml`:

   ```toml
   [auth.hook.custom_access_token]
   enabled = true
   uri = "pg-functions://postgres/public/custom_access_token_hook"
   ```

   Until this is registered, every issued JWT has no `org_id` claim,
   `current_org_id()` returns null, and every RLS policy above fails closed
   (denies access) rather than granting the wrong organization's data — this
   was a deliberate fail-closed design choice, not an oversight.

2. **Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY`** in the web app's environment
   (`apps/web/.env.local`, see `.env.example`). Until these are set,
   `lib/env.ts`'s `supabaseConfigured` flag is `false` and the app runs with
   authentication un-enforced and clearly labeled as such (see
   `apps/web/middleware.ts`).

3. **Run the seed script** (`pnpm --filter web seed`, see `seed/README.md`)
   once the above is done, to create the demo organization and its five
   demo users.

4. **Enable MFA enforcement for Agency Admin / Platform Admin**
   (docs/12-security-compliance.md §12.2, AUTH-03) — this is a Supabase Auth
   project setting, not something a migration can express; flagged here as a
   blocker for production readiness, not attempted in this build phase.

## Why nothing above has been "tested"

The project instructions ("Never claim an external integration works until
it has been configured and tested") and the Build Phase 2 completion gate
both require this to be said plainly: this SQL has been written to the
letter of docs/07-data-model.md and docs/12-security-compliance.md and
reviewed for internal consistency, but it has not been executed against a
real Postgres/Supabase instance — there isn't one connected to this
environment. `docs/build-phase-2-report.md` lists this as the single largest
open blocker for the phase.
