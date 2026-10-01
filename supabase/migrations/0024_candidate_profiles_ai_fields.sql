-- Build Phase 6: three candidate_profiles columns the AI CV-parsing
-- §EXTRACT list needs a real home for once a human accepts them, none of
-- which Build Phase 5's schema had a field for:
--
--   leadership_scope    — brief §EXTRACT: "Leadership scope" (free text,
--                          e.g. "led a team of 22 across 3 departments" —
--                          not a number Build Phase 5 anticipated).
--   pnl_responsibility   — brief §EXTRACT: "P&L responsibility" (free text
--                          for the same reason).
--   compensation_notes   — brief §EXTRACT: "Compensation only when
--                          explicitly stated" — the CV's own free-text
--                          compensation statement (e.g. "currently on
--                          52,000 GBP") is never auto-converted into the
--                          existing structured compensation_min/max/
--                          currency/period columns, which represent a
--                          recruiter's own deliberate range entry, not a
--                          parsed statement; mirrors the existing
--                          availability_notes/availability_date split
--                          (a free-text AI-sourced note next to the
--                          structured field a human sets separately).
--
-- Populated ONLY via the human "accept" action in
-- apps/web/lib/candidates/document-processing-actions.ts, after a
-- reviewer has verified or edited the corresponding
-- candidate_extracted_fields row (Build Phase 6 brief §HUMAN CONTROL).

alter table public.candidate_profiles
  add column if not exists leadership_scope text,
  add column if not exists pnl_responsibility text,
  add column if not exists compensation_notes text;
