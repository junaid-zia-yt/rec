/**
 * Build Phase 14 (Security Hardening / Release Candidate), Wave 2a — AI
 * evaluation fixture set. See docs/ai-evaluation-report.md for the full
 * writeup this dataset backs.
 *
 * VERSIONING CONVENTION: this dataset follows the exact same semantic-
 * version-string convention already established for prompts in this
 * codebase (`REQUIREMENT_EXTRACTION_PROMPT_VERSION`,
 * `CANDIDATE_EXTRACTION_PROMPT_VERSION`, `MATCHING_ASSESSMENT_PROMPT_VERSION`,
 * `OUTREACH_DRAFT_PROMPT_VERSION`, `COPILOT_PROMPT_VERSION` — all defined
 * next to their respective prompt text and bumped whenever that prompt's
 * wording changes, docs/09-ai-architecture.md §9.5). This dataset mirrors
 * that: bump EVAL_FIXTURE_SET_VERSION whenever a fixture's content changes
 * in a way that could change an existing assertion's expected result (a new
 * fixture that doesn't touch existing ones does not require a bump, exactly
 * as adding a new prompt does not require bumping an unrelated prompt's
 * version). Record this version in any future eval-run report so a scoring
 * drift is traceable to a specific fixture-set version, the same way
 * ai_runs.prompt_version makes a model-output drift traceable to a specific
 * prompt version.
 */
export const EVAL_FIXTURE_SET_VERSION = '1.0.0'
