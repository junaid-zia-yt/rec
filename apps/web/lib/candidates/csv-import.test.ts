import { describe, expect, it } from 'vitest'
import { parseCandidateCsv } from './csv-import'

describe('parseCandidateCsv — Build Phase 5 brief §"CSV import"', () => {
  it('parses a well-formed CSV with all recognized columns', () => {
    const csv = [
      'full_name,email,phone,current_title,current_company,location',
      'Jane Doe,jane@example.com,555-1234,Assistant Manager,Acme,Austin TX',
    ].join('\n')

    const result = parseCandidateCsv(csv)
    expect(result.headerError).toBeNull()
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({
      row: {
        rowNumber: 2,
        fullName: 'Jane Doe',
        primaryEmail: 'jane@example.com',
        primaryPhone: '555-1234',
        currentTitle: 'Assistant Manager',
        currentCompany: 'Acme',
        location: 'Austin TX',
      },
      valid: true,
      errors: [],
    })
  })

  it('is header-order-independent', () => {
    const csv = ['email,full_name', 'jane@x.com,Jane Doe'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows[0]?.row.fullName).toBe('Jane Doe')
    expect(result.rows[0]?.row.primaryEmail).toBe('jane@x.com')
  })

  it('is header-case/whitespace-insensitive', () => {
    const csv = [' Full Name , Email ', 'Jane Doe,jane@x.com'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.headerError).toBeNull()
    expect(result.rows[0]?.valid).toBe(true)
  })

  it('ignores unrecognized extra columns rather than erroring', () => {
    const csv = ['full_name,favorite_color', 'Jane Doe,blue'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.headerError).toBeNull()
    expect(result.recognizedColumns).toEqual(['full_name'])
  })

  it('reports a header error when full_name is missing entirely', () => {
    const csv = ['email,phone', 'jane@x.com,555-1234'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.headerError).toMatch(/full_name/)
    expect(result.rows).toHaveLength(0)
  })

  it('reports a header error for a completely empty file', () => {
    expect(parseCandidateCsv('').headerError).toMatch(/empty/i)
  })

  it('flags a row with a missing required full_name as invalid, with a row-level error', () => {
    const csv = ['full_name,email', ',jane@x.com'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows[0]?.valid).toBe(false)
    expect(result.rows[0]?.errors.length).toBeGreaterThan(0)
  })

  it('flags a row with an invalid email as invalid but keeps the row for review', () => {
    const csv = ['full_name,email', 'Jane Doe,not-an-email'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows[0]?.valid).toBe(false)
    expect(result.rows[0]?.row.fullName).toBe('Jane Doe')
  })

  it('handles quoted fields containing commas', () => {
    const csv = ['full_name,location', '"Doe, Jane","Austin, TX"'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows[0]?.row.fullName).toBe('Doe, Jane')
    expect(result.rows[0]?.row.location).toBe('Austin, TX')
  })

  it('handles an escaped double-quote inside a quoted field', () => {
    const csv = ['full_name', '"Jane ""JD"" Doe"'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows[0]?.row.fullName).toBe('Jane "JD" Doe')
  })

  it('assigns 1-indexed row numbers that account for the header row', () => {
    const csv = ['full_name', 'A', 'B', 'C'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows.map((r) => r.row.rowNumber)).toEqual([2, 3, 4])
  })

  it('skips blank lines rather than treating them as empty rows', () => {
    const csv = ['full_name', 'Jane Doe', '', 'John Smith'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows).toHaveLength(2)
  })

  it('treats an empty optional field as null, not an empty string', () => {
    const csv = ['full_name,email', 'Jane Doe,'].join('\n')
    const result = parseCandidateCsv(csv)
    expect(result.rows[0]?.row.primaryEmail).toBeNull()
  })
})
