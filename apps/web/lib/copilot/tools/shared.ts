import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CopilotCitation, CopilotDataClassification, Role } from '@rqi/types'
import type { ResourceOwnershipValidated } from '../resource-ownership'

/**
 * Build Phase 11, Wave 2 — shared contract every `tools/*.ts` handler
 * implements. Kept in its own file (not tool-registry.ts) so the registry
 * can import handler modules without a circular dependency, and so each
 * tool file has one obvious place to import this shape from.
 */

/** Everything a tool handler needs about who is asking and under what conversation scope — assembled by wave 3's orchestration layer from a live permission re-check (never from the conversation's `role_at_creation` snapshot alone; see resource-ownership.ts's header note) and passed in whole. */
export interface CopilotToolContext {
  supabase: SupabaseClient
  organizationId: string
  userId: string
  /** The caller's CURRENT role, re-fetched this turn. */
  role: Role
  dataClassification: CopilotDataClassification
}

/**
 * Marks a string as candidate-/document-sourced, untrusted content that
 * must never be treated as instructions by any later prompt-construction
 * step (governing brief's prompt-injection defence; mirrors Phase 9's
 * `CandidateEvidenceBundleItem`/untrusted-framing convention named
 * explicitly in the task brief). This is a lightweight branded-string
 * marker, not a runtime wrapper class, so it composes cleanly inside Zod
 * output schemas and JSON — the brand only exists to make "this text came
 * from a CV/JD/candidate message, not from the system or the recruiter's
 * own typed instructions" visible in the TYPE, not just in a comment, so
 * wave 3's prompt-construction code cannot forget which parts of a tool's
 * output are data vs. safe-to-treat-as-authored-instructions.
 */
export type UntrustedText = string & { readonly __untrustedCopilotSource?: unique symbol }

/** Tags a plain string as UntrustedText at the one place each tool reads it off a DB row — never a validation, purely a type-level marker. */
export function markUntrusted(text: string): UntrustedText {
  return text as UntrustedText
}

/** Same for a nullable field. */
export function markUntrustedNullable(text: string | null): UntrustedText | null {
  return text === null ? null : markUntrusted(text)
}

/**
 * A tool handler's full result: its (already Zod-validated by the caller)
 * structured output, the citations into authorized records it grounds
 * itself in (the brief's "citations to authorized records" mechanism —
 * empty for a tool whose output is purely procedural, e.g.
 * suggest_next_workflow_action), and the ownership tokens proving every
 * resource it touched was validated via `assertResourceOwnership` — never
 * fabricated, since `ResourceOwnershipValidated` cannot be constructed any
 * other way (see resource-ownership.ts).
 */
export interface CopilotToolHandlerResult<TOutput> {
  output: TOutput
  citations: CopilotCitation[]
  ownership: ResourceOwnershipValidated[]
}

/** Thrown by a tool handler for an application-level denial that is not a resource-ownership failure (e.g. "no scorecard exists yet for this job") — distinct from ResourceOwnershipError so the caller can log a different denial_reason. */
export class CopilotToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CopilotToolInputError'
  }
}
