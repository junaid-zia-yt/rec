# Seed data

The actual seed script lives at `apps/web/scripts/seed.ts` (it needs the
`@supabase/supabase-js` admin client and reads the same environment
variables as the web app, so it lives in that workspace package rather than
here). This folder exists as the location `docs/21-implementation-contract.md`
§21.3 reserves for seed data, and holds this pointer plus the plain-SQL
alternative below for anyone applying seed data via the Supabase CLI instead.

## Running it

```bash
pnpm --filter web seed                  # creates users, doesn't print passwords
pnpm --filter web seed -- --print-passwords
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to be set
to a real Supabase project — see `supabase/README.md`. **This has not been
run against a live project in this environment**; there isn't one connected.

## What it creates

One organization ("Northfield Retail Group (Demo Agency)") and four users,
each with one active membership:

| Email                            | Role                    |
| -------------------------------- | ----------------------- |
| `admin@demo.rqi.local`           | `agency_admin`          |
| `recruiter@demo.rqi.local`       | `recruiter`             |
| `client-reviewer@demo.rqi.local` | `client_decision_maker` |
| `read-only@demo.rqi.local`       | `read_only_reviewer`    |

No `platform_admin` demo user is seeded — that role is vendor-side
(docs/06-roles-permissions.md §6.1) and provisioning one is an operational
decision, not something to fabricate demo credentials for.

## Why this can't use a plain SQL seed file

`auth.users` rows must be created through Supabase's Auth admin API (which
handles password hashing, email-confirmation state, and the trigger this
build's migrations attach in `0003_user_profiles.sql`) — inserting directly
into `auth.users` via SQL bypasses those guarantees and is not supported by
Supabase. `apps/web/scripts/seed.ts` uses `supabase.auth.admin.createUser()`
for exactly this reason.
