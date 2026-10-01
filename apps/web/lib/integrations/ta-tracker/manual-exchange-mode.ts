/**
 * TA Tracker — secure manual exchange mode. REAL, working logging
 * capability (Build Phase 12 Wave 3, docs/11-integration-plan.md §11.2): a
 * documented manual workflow where a recruiter exports/uploads a file to a
 * secure location and the platform records that a manual data handoff
 * occurred — no vendor API knowledge needed, so (like CSV mode) this CAN
 * legitimately reach `status = 'connected'`.
 *
 * STORAGE, DELIBERATELY NOT PERFORMED HERE: the approved stack's only
 * Storage bucket today (`documents`, `supabase/migrations/0014_document_
 * storage.sql`) is scoped by CHECK/RLS to `owner_type IN ('job_description',
 * 'candidate_document')` — a TA Tracker manual-exchange file is neither.
 * Adding a new bucket or widening that owner-type scope is a migration
 * change, which is out of this wave's scope (see this wave's brief:
 * "Do not touch the migration"). This module therefore takes an
 * already-uploaded file's `storagePath` as a plain string — a future wave
 * that owns the Storage/migration change decides where that upload
 * actually lands (documented as a judgment call in this wave's report).
 *
 * LOGGING, REAL AND WORKING: `recordManualExchange` writes a real,
 * queryable row via the existing `audit_events` table and the existing
 * `logAuditEvent` helper (`lib/audit/log.ts`) — the same durable,
 * RLS-scoped mechanism every other domain event in this codebase already
 * uses, not a new table this wave would need a migration for.
 * `integration.sync_completed` is reused deliberately: from the platform's
 * point of view, a completed manual exchange IS this mode's "sync"
 * (docs/07-data-model.md's audit action set already includes it, and
 * widening the closed `AuditAction` union is out of this wave's minimal-
 * footprint scope — a manual-exchange-specific action name is a fine
 * follow-up for whichever wave adds the Storage support above).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/lib/audit/log'

export type TaTrackerManualExchangeDirection = 'export_to_client' | 'import_from_client'

export interface ManualExchangeRecordInput {
  organizationId: string
  integrationConnectionId: string
  /** Who performed/logged the handoff, for audit attribution — never inferred. */
  recordedByUserId: string
  direction: TaTrackerManualExchangeDirection
  /** Free-text name/identifier of who the file was exchanged with (e.g. "Dave, TA Tracker admin") — never assumed. */
  exchangedWithName: string
  /** Where the exchanged file was actually stored, if it was (a Storage path once a future wave adds a supporting bucket) — nullable because some manual exchanges are a description of an out-of-band handoff (e.g. emailed directly) with no file the platform itself stored. */
  fileStoragePath: string | null
  fileName: string | null
  description: string
  occurredAt?: string
}

export interface ManualExchangeRecord {
  organizationId: string
  integrationConnectionId: string
  recordedByUserId: string
  direction: TaTrackerManualExchangeDirection
  exchangedWithName: string
  fileStoragePath: string | null
  fileName: string | null
  description: string
  occurredAt: string
}

/** Pure builder — no I/O. Lets a caller (or a test) inspect the exact record shape before it is logged. */
export function buildManualExchangeRecord(input: ManualExchangeRecordInput): ManualExchangeRecord {
  return {
    organizationId: input.organizationId,
    integrationConnectionId: input.integrationConnectionId,
    recordedByUserId: input.recordedByUserId,
    direction: input.direction,
    exchangedWithName: input.exchangedWithName,
    fileStoragePath: input.fileStoragePath,
    fileName: input.fileName,
    description: input.description,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  }
}

/**
 * Logs a manual TA Tracker data handoff as a real `audit_events` row.
 * Never throws (mirrors `logAuditEvent`'s own "an audit-log failure must
 * not block the user-facing action it is recording" contract) — a caller
 * that needs to know whether the write actually landed should inspect the
 * returned boolean rather than wrap this in try/catch.
 */
export async function recordManualExchange(
  supabase: SupabaseClient,
  input: ManualExchangeRecordInput,
): Promise<{ record: ManualExchangeRecord; logged: boolean }> {
  const record = buildManualExchangeRecord(input)

  try {
    await logAuditEvent(
      {
        organizationId: record.organizationId,
        actorId: record.recordedByUserId,
        action: 'integration.sync_completed',
        entityType: 'integration_connection',
        entityId: record.integrationConnectionId,
        after: {
          provider: 'ta_tracker',
          mode: 'secure_manual_exchange',
          direction: record.direction,
          exchangedWithName: record.exchangedWithName,
          fileStoragePath: record.fileStoragePath,
          fileName: record.fileName,
          description: record.description,
          occurredAt: record.occurredAt,
        },
      },
      supabase,
    )
    return { record, logged: true }
  } catch (error) {
    console.error('[ta-tracker:manual-exchange] failed to log manual exchange:', error)
    return { record, logged: false }
  }
}
