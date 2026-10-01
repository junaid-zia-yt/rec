-- 0035_matching_performance_indexes.sql
-- Build Phase 14 (Security Hardening and Release Candidate), Wave 4 —
-- Performance review (docs/performance-report.md). Adds the two indexes
-- that review's "DB query behavior" pass found missing, both backing real
-- query shapes already in application code, not speculative additions:
--
--   1. `apps/web/lib/shortlists/load.ts`'s `loadReviewQueue()` — the
--      Shortlists tab's quality-review queue — filters
--      `candidate_role_matches` by
--      `.eq('organization_id', organizationId).in('review_status', [...])`.
--      0027_candidate_matching.sql's three existing indexes on this table
--      all lead with `job_id`, `recruitment_project_id`, or `candidate_id`
--      — none is usable for a query whose only equality predicates are
--      `organization_id` and `review_status`, so this became a full-table
--      scan of `candidate_role_matches` (a large, ever-growing table: one
--      row per candidate x job pair) on every load of that screen.
--
--   2. The same file's `loadShortlistableJobs()` — the "start a shortlist"
--      prompt on the same screen — filters the same table by
--      `.eq('organization_id', organizationId).eq('eligibility', 'eligible')`,
--      an identical unindexed-leading-column shape for a different pair of
--      columns.
--
-- Both are additive, `if not exists`, and require no data backfill — same
-- shape as every prior wave's index additions (e.g. 0027 itself).

create index if not exists candidate_role_matches_org_review_status_idx
  on public.candidate_role_matches (organization_id, review_status);

create index if not exists candidate_role_matches_org_eligibility_idx
  on public.candidate_role_matches (organization_id, eligibility);
