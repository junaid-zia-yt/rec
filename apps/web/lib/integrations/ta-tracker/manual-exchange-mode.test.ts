import { describe, expect, it } from 'vitest'
import { buildManualExchangeRecord } from './manual-exchange-mode'

describe('buildManualExchangeRecord', () => {
  it('builds a record with all supplied fields and a default occurredAt', () => {
    const record = buildManualExchangeRecord({
      organizationId: 'org-1',
      integrationConnectionId: 'conn-1',
      recordedByUserId: 'user-1',
      direction: 'export_to_client',
      exchangedWithName: 'Dave, TA Tracker admin',
      fileStoragePath: null,
      fileName: null,
      description: 'Emailed a candidate CSV export directly to Dave.',
    })

    expect(record.organizationId).toBe('org-1')
    expect(record.direction).toBe('export_to_client')
    expect(record.exchangedWithName).toBe('Dave, TA Tracker admin')
    expect(typeof record.occurredAt).toBe('string')
    expect(() => new Date(record.occurredAt).toISOString()).not.toThrow()
  })

  it('honors an explicit occurredAt rather than overwriting it', () => {
    const record = buildManualExchangeRecord({
      organizationId: 'org-1',
      integrationConnectionId: 'conn-1',
      recordedByUserId: 'user-1',
      direction: 'import_from_client',
      exchangedWithName: 'Dave',
      fileStoragePath: 'some/path.csv',
      fileName: 'export.csv',
      description: 'Imported a file Dave sent.',
      occurredAt: '2026-01-01T00:00:00.000Z',
    })

    expect(record.occurredAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
