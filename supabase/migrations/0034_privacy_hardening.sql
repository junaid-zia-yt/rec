-- 0034_privacy_hardening.sql
-- Build Phase 14 (Security Hardening and Release Candidate), Wave 3 —
-- Privacy review (docs/privacy-review.md). Two independent fixes:
--
--   1. audit_events read-scoping bug: docs/06-roles-permissions.md §6.2's
--      own permission matrix documents "Recruiter: R (own actions)" for
--      Audit logs, but 0006_audit_events.sql's actual SELECT policy grants
--      ANY org member (recruiter included) org-wide read of every row —
--      including before_json/after_json, which routinely carries candidate
--      PII (e.g. candidate.created's after_json stores fullName,
--      apps/web/lib/candidates/actions.ts:183). RLS is the real security
--      boundary here (docs/security-review.md §4's own stated convention:
--      "RLS ... is what actually restricts row visibility"), reachable
--      directly via the public anon/authenticated key regardless of
--      whether any UI screen reads this table yet (none does today — grep
--      confirmed zero application read call sites — but that only means
--      this has not yet been exploited through the app's own UI, not that
--      the RLS boundary is safe). This narrows recruiter to their own
--      actor_id, matching the documented design; agency_admin/
--      read_only_reviewer/platform_admin keep org-wide read exactly as
--      before (their matrix row already says org-wide).
--
--   2. candidate_consents gains deletion_fulfilled_at/_by — a purely
--      structural addition (never invents consent/retention language) so
--      apps/web/lib/candidates/privacy-actions.ts's erasePersonalDataAction
--      can record that a previously-recorded deletion request was actually
--      fulfilled, distinct from deletion_requested (the request itself).

-- ---------------------------------------------------------------------------
-- 1. audit_events: recruiter narrowed to own actions.
-- ---------------------------------------------------------------------------

drop policy if exists audit_events_select_own_org on public.audit_events;

create policy audit_events_select_own_org
  on public.audit_events
  for select
  using (
    public.is_platform_admin()
    or (
      organization_id is not null
      and public.has_org_role(
        organization_id,
        array['agency_admin', 'read_only_reviewer']::public.app_role[]
      )
    )
    or (
      organization_id is not null
      and public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and actor_id = auth.uid()
    )
  );

comment on policy audit_events_select_own_org on public.audit_events is
  'Agency Admin/Read-Only Reviewer/Platform Admin: org-wide read. Recruiter: own actions only (docs/06-roles-permissions.md §6.2) — fixed in 0034 after docs/privacy-review.md found the original policy granted every org member org-wide read regardless of role, exposing candidate PII in before_json/after_json outside a recruiter''s assigned-project scope.';

-- ---------------------------------------------------------------------------
-- 2. candidate_consents: structural deletion-fulfillment columns.
-- ---------------------------------------------------------------------------

alter table public.candidate_consents
  add column if not exists deletion_fulfilled_at timestamptz,
  add column if not exists deletion_fulfilled_by uuid references auth.users (id);

comment on column public.candidate_consents.deletion_fulfilled_at is
  'When erasePersonalDataAction (apps/web/lib/candidates/privacy-actions.ts) actually redacted this candidate''s data, distinct from deletion_requested_at (the request). Null until fulfilled. Structural field only — does not by itself define a retention policy or consent language; see docs/privacy-review.md §1/§2 for the business decisions this still requires.';

comment on column public.candidate_consents.deletion_fulfilled_by is
  'auth.users id of the admin who ran erasePersonalDataAction, mirroring deletion_requested_by.';
