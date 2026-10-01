'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card } from '@rqi/ui'
import type { NotificationEventType } from '@rqi/types'
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/notifications/notification-actions'

const EVENT_LABEL: Record<NotificationEventType, string> = {
  scorecard_awaiting_approval: 'Scorecard awaiting approval',
  candidate_awaiting_review: 'Candidate awaiting review',
  verification_requested: 'Verification requested',
  outreach_awaiting_approval: 'Outreach awaiting approval',
  candidate_responded: 'Candidate responded',
  shortlist_awaiting_client_decision: 'Shortlist awaiting client decision',
  integration_failed: 'Integration failed',
  poc_completed: 'POC completed',
}

export interface NotificationRowView {
  id: string
  eventType: NotificationEventType
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
  /** Resolved server-side, fresh, this render — `buildPermissionSafeDeepLink` (`lib/notifications/resource-link.ts`) is NEVER cached/precomputed; the page component calls it on every request and hands the result down as a plain prop. */
  path: string | null
}

/**
 * Build Phase 12, Wave 5 (Task D) — the real notification center list,
 * replacing the legacy `DEMO_NOTIFICATIONS` fixture this page previously
 * rendered (flagged by Wave 4 as needing exactly this rewire — a
 * data-source fix, not a redesign: the list/row layout is unchanged).
 */
export function NotificationCenterList({
  organizationId,
  notifications,
}: {
  organizationId: string
  notifications: NotificationRowView[]
}) {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function markRead(notificationId: string) {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('notificationId', notificationId)
    startTransition(async () => {
      await markNotificationReadAction(formData)
      router.refresh()
    })
  }

  function markAllRead() {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    startTransition(async () => {
      const result = await markAllNotificationsReadAction(formData)
      setMessage(result.message ?? null)
      router.refresh()
    })
  }

  const hasUnread = notifications.some((n) => !n.readAt)

  return (
    <div className="flex flex-col gap-4">
      {message && <Alert tone="success" title={message} />}
      {hasUnread && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={markAllRead} disabled={pending}>
            Mark all read
          </Button>
        </div>
      )}
      <Card>
        <ul className="divide-outline-cell divide-y">
          {notifications.map((notification) => {
            const isUnread = !notification.readAt
            const content = (
              <div className="flex-1">
                <p className="text-muted text-xs font-semibold uppercase tracking-wide">
                  {EVENT_LABEL[notification.eventType]}
                </p>
                <p className="text-tertiary text-sm font-medium">{notification.title}</p>
                {notification.body && <p className="text-tertiary text-sm">{notification.body}</p>}
                <p className="text-muted mt-0.5 text-xs">
                  {new Date(notification.createdAt).toLocaleString()}
                  {isUnread && <span className="text-secondary ml-2 font-medium">Unread</span>}
                  {!notification.path && (
                    <span className="text-muted ml-2">No longer accessible</span>
                  )}
                </p>
              </div>
            )

            return (
              <li key={notification.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={
                    isUnread
                      ? 'bg-secondary mt-1.5 h-2 w-2 shrink-0 rounded-full'
                      : 'bg-outline-cell mt-1.5 h-2 w-2 shrink-0 rounded-full'
                  }
                  aria-hidden="true"
                />
                {notification.path ? (
                  <Link
                    href={notification.path}
                    className="focus-visible:ring-secondary flex-1 rounded focus-visible:outline-none focus-visible:ring-2"
                    onClick={() => isUnread && markRead(notification.id)}
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
                {isUnread && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => markRead(notification.id)}
                    disabled={pending}
                  >
                    Mark read
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
