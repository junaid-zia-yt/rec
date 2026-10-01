import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'

/**
 * Verb-first audit action names actually used by Build Phase 2 (Build Phase
 * 2 brief §10). Kept as a closed union so a typo in a call site is a
 * typecheck failure, not a silently-uncategorized audit row.
 */
export type AuditAction =
  | 'auth.sign_in'
  | 'auth.sign_in_failed'
  | 'auth.sign_out'
  | 'auth.password_reset_requested'
  | 'auth.password_updated'
  | 'invitation.created'
  | 'invitation.accepted'
  | 'membership.role_changed'
  | 'membership.disabled'
  | 'client.created'
  | 'client.updated'
  | 'client.archived'
  | 'project.created'
  | 'project.updated'
  | 'project.archived'
  | 'project.assignment_changed'
  | 'job.created'
  | 'job.updated'
  | 'job_description.uploaded'
  | 'job_description.superseded'
  | 'document.rejected'
  | 'requirement.extracted'
  | 'requirement.extraction_failed'
  | 'requirement.created'
  | 'requirement.updated'
  | 'requirement.deleted'
  | 'requirement.reclassified'
  | 'scorecard.draft_created'
  | 'scorecard.submitted_for_approval'
  | 'scorecard.approved'
  | 'scorecard.rejected'
  | 'scorecard.changes_requested'
  | 'scorecard.client_approval_permission_changed'
  | 'candidate.created'
  | 'candidate.csv_imported'
  | 'candidate.csv_import_row_failed'
  | 'candidate.updated'
  | 'candidate.archived'
  | 'candidate.deletion_requested'
  | 'candidate.pii_erased'
  | 'candidate.data_exported'
  | 'candidate.document_uploaded'
  | 'candidate.document_rejected'
  | 'candidate.experience_added'
  | 'candidate.experience_deleted'
  | 'candidate.education_added'
  | 'candidate.education_deleted'
  | 'candidate.certification_added'
  | 'candidate.certification_deleted'
  | 'candidate.skill_added'
  | 'candidate.skill_deleted'
  | 'candidate.assigned_to_project'
  | 'candidate.stage_transitioned'
  | 'candidate.merged'
  | 'candidate.document_processing_started'
  | 'candidate.document_processing_completed'
  | 'candidate.document_processing_needs_ocr'
  | 'candidate.document_processing_failed'
  | 'candidate.document_reprocessed'
  | 'candidate.extracted_field_verified'
  | 'candidate.extracted_field_rejected'
  | 'candidate.extracted_field_edited'
  | 'candidate.extracted_fields_applied'
  | 'candidate_match.evaluation_started'
  | 'candidate_match.evaluation_completed'
  | 'candidate_match.evaluation_failed'
  | 'candidate_match.gate_verification_requested'
  | 'candidate_match.gate_overridden'
  | 'candidate_match.review_decided'
  | 'candidate_match.verification_requested'
  | 'candidate_match.verification_resolved'
  | 'candidate_match.interest_confirmed'
  | 'shortlist.created'
  | 'shortlist.candidate_added'
  | 'shortlist.candidate_removed'
  | 'shortlist.submitted_for_internal_approval'
  | 'shortlist.internally_approved'
  | 'shortlist.sent_to_client'
  | 'shortlist.client_decided'
  | 'shortlist.rebuilt_new_version'
  | 'outreach.sequence_started'
  | 'outreach.sequence_cancelled'
  | 'outreach.draft_generated'
  | 'outreach.draft_edited'
  | 'outreach.approved'
  | 'outreach.rejected'
  | 'outreach.changes_requested'
  | 'outreach.sent'
  | 'outreach.delivery_event_recorded'
  | 'outreach.failed'
  | 'outreach.cancelled'
  | 'outreach.response_recorded'
  | 'outreach.response_classified'
  | 'outreach.opt_out_recorded'
  | 'outreach.communication_preference_updated'
  | 'outreach.contact_point_verified'
  | 'poc.benchmark_created'
  | 'poc.benchmark_updated'
  | 'poc.role_added'
  | 'poc.role_removed'
  | 'poc.benchmark_activated'
  | 'poc.participant_linked_to_shortlist'
  | 'poc.baseline_recorded'
  | 'poc.metric_recorded'
  | 'poc.exclusion_recorded'
  | 'poc.result_computed'
  | 'poc.metric_definition_published'
  | 'poc.decision_recorded'
  | 'copilot.conversation_started'
  | 'copilot.conversation_archived'
  | 'copilot.conversation_ended'
  | 'copilot.message_sent'
  | 'copilot.tool_called'
  | 'copilot.tool_denied'
  | 'copilot.mutation_proposed'
  | 'copilot.mutation_confirmed'
  | 'copilot.rate_limited'
  | 'copilot.unauthorized_tool_attempt'
  | 'copilot.citation_missing'
  // Build Phase 11 Wave 4 additions — not logged inside runCopilotTurn()
  // itself (wave 3 only logs message_sent/rate_limited/
  // unauthorized_tool_attempt/citation_missing), so the wave 4 server
  // action layer logs these two: one generic action for every
  // CopilotTurnOutcome failure variant wave 3 does NOT already audit
  // (not_configured/permission_narrowed_since_conversation_start/timeout/
  // cancelled/provider_error/validation_rejected — see copilot-actions.ts's
  // AUDIT ACTION MAPPING comment for why one shared literal was chosen
  // over six granular ones), and one for the thumbs-up/down feedback
  // control (no copilot_message_feedback table exists yet this wave — see
  // recordCopilotFeedbackAction's own comment — so the decision itself is
  // the durable record, same pattern as every other audit_events use).
  | 'copilot.turn_failed'
  | 'copilot.feedback_recorded'
  // Build Phase 12 Wave 1 additions — schema/types foundation only; no
  // orchestration code in this wave actually calls logAuditEvent with
  // these yet (that is the job-engine/integration-adapter/notification
  // waves' work). Listed here now so those waves extend behavior against
  // an already-closed action set, never widen this union ad hoc.
  | 'job.enqueued'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.retried'
  | 'job.dead_lettered'
  | 'job.manually_retried'
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.sync_started'
  | 'integration.sync_failed'
  | 'integration.sync_completed'
  | 'notification.created'
  | 'notification.read'
  | 'notification.preferences_updated'
  | 'webhook.received'
  | 'webhook.rejected_invalid_signature'
  | 'webhook.duplicate_ignored'

export interface AuditEventInput {
  organizationId: string | null
  actorId: string
  action: AuditAction
  entityType: string
  entityId?: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

/**
 * Writes one audit_events row via the caller's own RLS-scoped session (not
 * the service role) — the insert policy (`actor_id = auth.uid()`) is what
 * guarantees actor_id can never be spoofed to attribute an action to
 * someone else. docs/07-data-model.md §7.7 requires the business write and
 * its audit row to share one transaction; a single-table insert like sign-
 * in/sign-out has no separate business write to wrap, but any future
 * multi-statement action (invitation accept + membership insert, say) must
 * call this from inside the same Postgres function/RPC as its business
 * write, not as a second, separately-committed client call — flagged here
 * so that rule isn't lost by the time a later phase adds one.
 *
 * Never throws: an audit-log failure must not block the user-facing action
 * it is recording (a failed sign-in must still show a generic error even if
 * the audit insert itself fails) — it logs to the server console instead.
 * This is a deliberate availability-over-strict-atomicity tradeoff for
 * these single-statement auth events specifically; it does not apply to the
 * transactional multi-statement case described above.
 */
export async function logAuditEvent(
  input: AuditEventInput,
  client?: SupabaseClient | null,
): Promise<void> {
  const supabase = client ?? (await createServerSupabaseClient())
  if (!supabase) return

  const { error } = await supabase.from('audit_events').insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    before_json: input.before ?? null,
    after_json: input.after ?? null,
    metadata: input.metadata ?? {},
  })

  if (error) {
    console.error(`[audit] failed to log ${input.action}:`, error.message)
    // Build Phase 15 Wave 3 addition: an audit_events INSERT failure means
    // the audit trail itself silently dropped an event — distinct from,
    // and compliance-relevant on top of, whatever business action it was
    // recording (which this function's own never-throw contract, above,
    // deliberately still allows to have succeeded). Worth a monitoring
    // event in its own right, not just a console line no one is watching.
    captureMonitoringMessage(`Audit event write failed: ${input.action}`, 'error', {
      category: 'audit',
      organizationId: input.organizationId,
      extra: { action: input.action, entityType: input.entityType, dbErrorMessage: error.message },
    })
  }
}
