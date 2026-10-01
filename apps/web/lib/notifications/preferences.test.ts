import { describe, expect, it } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { getNotificationPreferences, upsertNotificationPreference } from './preferences'

const ORG = '00000000-0000-0000-0000-00000000000a'
const USER = '00000000-0000-0000-0000-000000000001'

describe('getNotificationPreferences', () => {
  it('fills in the documented default (in_app: true, email: false) for every event type with no row yet', async () => {
    const supabase = createFakeSupabase({ notification_preferences: [] })
    const prefs = await getNotificationPreferences(ORG, USER, supabase)

    expect(prefs).toHaveLength(8)
    expect(
      prefs.every((p) => p.inAppEnabled === true && p.emailEnabled === false && p.id === null),
    ).toBe(true)
  })

  it('uses the real row for an event type that has one, and the default for the rest', async () => {
    const tables: FakeSupabaseSeed = {
      notification_preferences: [
        {
          id: 'pref-1',
          organization_id: ORG,
          user_id: USER,
          event_type: 'poc_completed',
          in_app_enabled: false,
          email_enabled: true,
        },
      ],
    }
    const supabase = createFakeSupabase(tables)
    const prefs = await getNotificationPreferences(ORG, USER, supabase)

    const pocPref = prefs.find((p) => p.eventType === 'poc_completed')
    expect(pocPref).toEqual({
      id: 'pref-1',
      eventType: 'poc_completed',
      inAppEnabled: false,
      emailEnabled: true,
    })

    const otherPref = prefs.find((p) => p.eventType === 'candidate_responded')
    expect(otherPref).toEqual({
      id: null,
      eventType: 'candidate_responded',
      inAppEnabled: true,
      emailEnabled: false,
    })
  })
})

describe('upsertNotificationPreference', () => {
  it('creates a new row when none exists yet', async () => {
    const tables: FakeSupabaseSeed = { notification_preferences: [], audit_events: [] }
    const supabase = createFakeSupabase(tables)

    const result = await upsertNotificationPreference({
      organizationId: ORG,
      userId: USER,
      eventType: 'poc_completed',
      inAppEnabled: false,
      emailEnabled: true,
      supabase,
    })

    expect(result.inAppEnabled).toBe(false)
    expect(result.emailEnabled).toBe(true)
    expect(tables.notification_preferences).toHaveLength(1)
    expect(
      tables.audit_events?.some((row) => row.action === 'notification.preferences_updated'),
    ).toBe(true)
  })

  it('updates the existing row in place rather than inserting a second one', async () => {
    const tables: FakeSupabaseSeed = {
      notification_preferences: [
        {
          id: 'pref-1',
          organization_id: ORG,
          user_id: USER,
          event_type: 'poc_completed',
          in_app_enabled: true,
          email_enabled: false,
        },
      ],
      audit_events: [],
    }
    const supabase = createFakeSupabase(tables)

    await upsertNotificationPreference({
      organizationId: ORG,
      userId: USER,
      eventType: 'poc_completed',
      inAppEnabled: true,
      emailEnabled: true,
      supabase,
    })

    expect(tables.notification_preferences).toHaveLength(1)
    expect(tables.notification_preferences![0]!.email_enabled).toBe(true)
  })
})
