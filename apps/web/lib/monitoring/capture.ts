/**
 * Shared monitoring/error-tracking helper (Build Phase 15 Wave 3,
 * docs/monitoring-runbook.md). Every wired failure surface in this codebase
 * calls through here rather than `Sentry.captureException`/`captureMessage`
 * directly, for three reasons:
 *
 *  1. NEVER-CRASH, NO CALL-SITE GUARD NEEDED — mirrors this file's own
 *     `sentryConfigured` convention (lib/env.ts): when no `SENTRY_DSN` is
 *     configured (true everywhere in this environment today), every export
 *     below is a safe no-op. A call site never needs its own
 *     `if (sentryConfigured)` check, exactly like `resendConfigured`/
 *     `anthropicConfigured` call sites never re-check env directly.
 *  2. CONSISTENT TAGGING — every event gets a `category` tag (one of the 9
 *     failure-surface categories docs/monitoring-runbook.md documents) and,
 *     where available, an `organizationId` tag, so a Sentry project (once
 *     one exists) can be filtered/alerted on by surface without every call
 *     site re-deriving the same tag shape.
 *  3. NO SENSITIVE PAYLOADS — per docs/security-review.md's "no sensitive
 *     payloads in logs" discipline (Phase 14), which applies equally to
 *     anything sent to a third-party error-tracking service: a call site
 *     passes only short, structured `extra` fields (ids, counts, error
 *     classes, messages already produced by this codebase's own
 *     `summarizeError`-style truncation) — NEVER candidate PII, document/CV
 *     text, or a full request/response body. This file does not scrub its
 *     input for that; each call site is responsible for only ever handing it
 *     safe data, the same discipline `executor.ts`'s `summarizeError`
 *     already applies to `last_error`.
 *
 * HONEST LIMITATION: no Sentry project has been created and no DSN has ever
 * been set in this environment (see docs/monitoring-runbook.md's "Sentry
 * project setup" section) — every code path here is wired correctly against
 * the `@sentry/nextjs` SDK's documented API but has never actually sent an
 * event to a real Sentry project. Treat this as code-complete, operationally
 * unverified.
 */
import * as Sentry from '@sentry/nextjs'
import { sentryConfigured } from '@/lib/env'

/**
 * The 9 monitoring surfaces this build phase wires (docs/monitoring-runbook.md).
 * A closed union so a typo in a call site's category is a typecheck failure,
 * not a silently-uncategorized event — mirrors `AuditAction`'s own closed-
 * union convention (lib/audit/log.ts).
 */
export type MonitoringCategory =
  | 'application'
  | 'api'
  | 'background_job'
  | 'ai_provider'
  | 'ai_cost'
  | 'auth'
  | 'integration'
  | 'audit'

export type MonitoringSeverity = 'debug' | 'info' | 'warning' | 'error' | 'fatal'

export interface MonitoringContext {
  category: MonitoringCategory
  /** Omit when no organization context exists yet (e.g. a pre-auth failure). Never a candidate id, document id, or anything PII-bearing. */
  organizationId?: string | null
  /** Short, structured, non-sensitive key/value pairs only — see this file's header note. */
  extra?: Record<string, string | number | boolean | null>
}

function applyContext(scope: Sentry.Scope, context: MonitoringContext): void {
  scope.setTag('category', context.category)
  if (context.organizationId) {
    scope.setTag('organizationId', context.organizationId)
  }
  if (context.extra) {
    scope.setContext('monitoring_extra', context.extra)
  }
}

/**
 * Reports a caught exception. No-op when Sentry is not configured — never
 * throws either way, so a call site can always `await` (or fire-and-forget)
 * this without its own try/catch.
 */
export function captureError(error: unknown, context: MonitoringContext): void {
  if (!sentryConfigured) return
  try {
    Sentry.withScope((scope) => {
      applyContext(scope, context)
      Sentry.captureException(error)
    })
  } catch {
    // Monitoring must never be the reason a real failure path throws a
    // second, unrelated error — see this file's header note.
  }
}

/**
 * Reports a non-exception event (a business-rule failure recorded as a
 * value, not a thrown error — e.g. a job's `dead_lettered` outcome, a
 * `webhook.rejected_invalid_signature`). No-op when Sentry is not
 * configured.
 */
export function captureMonitoringMessage(
  message: string,
  severity: MonitoringSeverity,
  context: MonitoringContext,
): void {
  if (!sentryConfigured) return
  try {
    Sentry.withScope((scope) => {
      applyContext(scope, context)
      scope.setLevel(severity)
      Sentry.captureMessage(message, severity)
    })
  } catch {
    // See captureError's header note — monitoring is best-effort.
  }
}

/**
 * AI-cost business-metric helper (docs/monitoring-runbook.md "AI cost"
 * section) — flags a `copilot_usage_counters` day approaching or exceeding
 * its configured `copilotDailyCostLimitUsd` limit (lib/env.ts). Deliberately
 * a thin wrapper over `captureMonitoringMessage` rather than a bespoke
 * Sentry metrics API call: this codebase has no existing metrics-ingestion
 * pattern to extend, and a tagged message is enough for an alert rule to key
 * off in Sentry once a real project exists.
 */
export function captureBusinessMetric(params: {
  metric: 'copilot_daily_cost_usd'
  organizationId: string
  value: number
  limit: number
  windowDate: string
}): void {
  const ratio = params.limit > 0 ? params.value / params.limit : 0
  if (ratio < 0.8) return // Below the alert threshold — nothing to report.

  const severity: MonitoringSeverity = ratio >= 1 ? 'error' : 'warning'
  captureMonitoringMessage(
    ratio >= 1
      ? `Copilot daily cost limit exceeded: $${params.value.toFixed(2)} / $${params.limit.toFixed(2)} on ${params.windowDate}`
      : `Copilot daily cost approaching limit: $${params.value.toFixed(2)} / $${params.limit.toFixed(2)} (${Math.round(ratio * 100)}%) on ${params.windowDate}`,
    severity,
    {
      category: 'ai_cost',
      organizationId: params.organizationId,
      extra: {
        metric: params.metric,
        value: params.value,
        limit: params.limit,
        windowDate: params.windowDate,
      },
    },
  )
}
