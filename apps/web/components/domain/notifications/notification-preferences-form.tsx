'use client'

import { useState, useTransition } from 'react'
import { Alert, Card, Switch } from '@rqi/ui'
import type { NotificationEventType, NotificationPreference } from '@rqi/types'
import { updateNotificationPreferenceAction } from '@/lib/notifications/notification-actions'

const EVENT_LABEL: Record<NotificationEventType, string> = {
  scorecard_awaiting_approval: 'Scorecard awaiting approval',
  candidate_awaiting_review: 'Candidate awaiting review',
  verification_requested: 'Verification requested',
  outreach_awaiting_approval: 'Outreach draft awaiting approval',
  candidate_responded: 'Candidate responded',
  shortlist_awaiting_client_decision: 'Shortlist awaiting client decision',
  integration_failed: 'Integration sync failed',
  poc_completed: 'POC benchmark completed',
}

type PreferenceRow = Pick<NotificationPreference, 'eventType' | 'inAppEnabled' | 'emailEnabled'> & {
  id: string | null
}

export function NotificationPreferencesForm({
  organizationId,
  preferences,
}: {
  organizationId: string
  preferences: PreferenceRow[]
}) {
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [local, setLocal] = useState(preferences)

  function update(
    eventType: NotificationEventType,
    field: 'inAppEnabled' | 'emailEnabled',
    value: boolean,
  ) {
    const next = local.map((p) => (p.eventType === eventType ? { ...p, [field]: value } : p))
    setLocal(next)
    const row = next.find((p) => p.eventType === eventType)!

    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('eventType', eventType)
    formData.set('inAppEnabled', String(row.inAppEnabled))
    formData.set('emailEnabled', String(row.emailEnabled))

    startTransition(async () => {
      const result = await updateNotificationPreferenceAction(formData)
      setMessage(
        result.message
          ? { tone: result.success ? 'success' : 'danger', text: result.message }
          : null,
      )
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
      )}
      <Card>
        <ul className="divide-outline-cell divide-y">
          {local.map((pref) => (
            <li
              key={pref.eventType}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-tertiary text-sm font-semibold">{EVENT_LABEL[pref.eventType]}</p>
              <div className="flex items-center gap-6">
                <label className="text-muted flex items-center gap-2 text-xs">
                  In-app
                  <Switch
                    checked={pref.inAppEnabled}
                    onCheckedChange={(checked) => update(pref.eventType, 'inAppEnabled', checked)}
                    disabled={pending}
                  />
                </label>
                <label className="text-muted flex items-center gap-2 text-xs">
                  Email
                  <Switch
                    checked={pref.emailEnabled}
                    onCheckedChange={(checked) => update(pref.eventType, 'emailEnabled', checked)}
                    disabled={pending}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-muted text-xs">
        Email is off by default for every event — turn it on per event to also receive an email when
        it fires.
      </p>
    </div>
  )
}
