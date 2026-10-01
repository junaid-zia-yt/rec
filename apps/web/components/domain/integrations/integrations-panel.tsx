'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Card,
  CardBody,
  ConfirmationDialog,
  FormField,
  Input,
  SectionHeader,
  Select,
  StatusBadge,
} from '@rqi/ui'
import type { IntegrationConnectionStatus, IntegrationProvider } from '@rqi/types'
import type { IntegrationConnectionSummary } from '@/lib/integrations/load'
import {
  connectIntegrationAction,
  disconnectIntegrationAction,
  recordAccountOwnerAction,
  triggerIntegrationSyncAction,
} from '@/lib/integrations/integration-actions'

/**
 * Build Phase 12, Wave 5 (Task D) — Integration settings screen. Mirrors
 * the useTransition + FormData action-call pattern from
 * outreach-sequence-workspace.tsx. One card per provider (TA Tracker,
 * Apollo, Google Calendar, Microsoft Calendar, SMS), each showing
 * connection status, account owner, last sync, sync error, and a
 * disconnect confirmation — per the brief's exact list.
 */

const STATUS_BADGE: Record<
  IntegrationConnectionStatus,
  'passed' | 'pending' | 'failed' | 'neutral'
> = {
  connected: 'passed',
  not_connected: 'neutral',
  pending_documentation: 'pending',
  sync_error: 'failed',
  disconnected: 'neutral',
}

const STATUS_LABEL: Record<IntegrationConnectionStatus, string> = {
  connected: 'Connected',
  not_connected: 'Not connected',
  pending_documentation: 'Pending documentation',
  sync_error: 'Sync error',
  disconnected: 'Disconnected',
}

type Tone = 'success' | 'danger'

export function IntegrationsPanel({
  organizationId,
  connections,
  visible,
  canManage,
}: {
  organizationId: string
  connections: IntegrationConnectionSummary[]
  visible: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null)

  function onDone(outcome: { success: boolean; message?: string }) {
    setMessage(
      outcome.message
        ? { tone: outcome.success ? 'success' : 'danger', text: outcome.message }
        : null,
    )
    if (outcome.success) router.refresh()
  }

  if (!visible) {
    return (
      <Card>
        <CardBody className="text-muted text-sm">
          Integration connection status is visible to agency admins only. Ask an agency admin to
          view or manage connections.
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
      )}
      {connections.map((connection) => (
        <ProviderCard
          key={connection.provider}
          organizationId={organizationId}
          connection={connection}
          canManage={canManage}
          onDone={onDone}
        />
      ))}
    </div>
  )
}

function ProviderCard({
  organizationId,
  connection,
  canManage,
  onDone,
}: {
  organizationId: string
  connection: IntegrationConnectionSummary
  canManage: boolean
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [showDisconnect, setShowDisconnect] = useState(false)
  const [mode, setMode] = useState<'csv_import_export' | 'secure_manual_exchange'>(
    'csv_import_export',
  )
  const [accountOwnerDraft, setAccountOwnerDraft] = useState(connection.accountOwnerLabel ?? '')
  const isConnected = connection.status === 'connected'

  function connect() {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('provider', connection.provider)
    if (connection.provider === 'ta_tracker') formData.set('mode', mode)
    startTransition(async () => onDone(await connectIntegrationAction(formData)))
  }

  function disconnect(reason: string) {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('provider', connection.provider)
    formData.set('confirmed', 'true')
    if (reason) formData.set('reason', reason)
    startTransition(async () => onDone(await disconnectIntegrationAction(formData)))
    setShowDisconnect(false)
  }

  function sync() {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('provider', connection.provider)
    startTransition(async () => onDone(await triggerIntegrationSyncAction(formData)))
  }

  function saveAccountOwner() {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('provider', connection.provider)
    if (accountOwnerDraft.trim()) formData.set('accountOwnerLabel', accountOwnerDraft.trim())
    startTransition(async () => onDone(await recordAccountOwnerAction(formData)))
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title={connection.label} />
          <StatusBadge status={STATUS_BADGE[connection.status]}>
            {STATUS_LABEL[connection.status]}
          </StatusBadge>
        </div>

        {connection.provider === 'ta_tracker' && (
          <p className="text-muted text-xs">
            <span className="font-medium">Deferred.</span> TA Tracker has no available API in this
            environment — no vendor documentation or credentials exist for API mode, and it can
            never be selected here. Only CSV import/export and secure manual exchange can be
            connected.
          </p>
        )}
        {connection.provider === 'sms' && (
          <p className="text-muted text-xs">
            <span className="font-medium">Deferred.</span> No SMS provider has been chosen for this
            platform yet.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted">Mode</dt>
            <dd className="text-tertiary">{connection.mode ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Account owner</dt>
            <dd className="text-tertiary">{connection.accountOwnerLabel ?? 'Unset'}</dd>
          </div>
          <div>
            <dt className="text-muted">Last sync</dt>
            <dd className="text-tertiary">
              {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : 'Never'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Sync status</dt>
            <dd className="text-tertiary">{connection.lastSyncStatus ?? '—'}</dd>
          </div>
        </dl>
        {connection.lastSyncError && (
          <p className="text-danger bg-danger-bg border-danger-border rounded-control border p-2 text-xs">
            {connection.lastSyncError}
          </p>
        )}

        {canManage && (
          <div className="border-outline-cell flex flex-wrap items-end gap-3 border-t pt-3">
            {!isConnected && connection.provider === 'ta_tracker' && (
              <FormField label="Mode" htmlFor={`mode-${connection.provider}`}>
                <Select
                  value={mode}
                  onValueChange={(v) => setMode(v as typeof mode)}
                  options={[
                    { value: 'csv_import_export', label: 'CSV import/export' },
                    { value: 'secure_manual_exchange', label: 'Secure manual exchange' },
                  ]}
                />
              </FormField>
            )}

            {!isConnected ? (
              <Button type="button" onClick={connect} disabled={pending}>
                Connect
              </Button>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={sync} disabled={pending}>
                  Sync now
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDisconnect(true)}
                  disabled={pending}
                >
                  Disconnect
                </Button>
              </>
            )}

            <FormField label="Account owner" htmlFor={`owner-${connection.provider}`}>
              <div className="flex min-w-48 gap-2">
                <Input
                  id={`owner-${connection.provider}`}
                  value={accountOwnerDraft}
                  onChange={(e) => setAccountOwnerDraft(e.target.value)}
                  placeholder="e.g. Client-owned"
                  disabled={!isConnected}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={saveAccountOwner}
                  disabled={pending || !isConnected}
                >
                  Save
                </Button>
              </div>
            </FormField>
          </div>
        )}

        <ConfirmationDialog
          open={showDisconnect}
          onOpenChange={setShowDisconnect}
          title={`Disconnect ${connection.label}?`}
          description="This stops syncing and clears the connection's status. You can reconnect it later."
          confirmLabel="Disconnect"
          destructive
          onConfirm={() => disconnect('')}
        />
      </CardBody>
    </Card>
  )
}

export type { IntegrationProvider }
