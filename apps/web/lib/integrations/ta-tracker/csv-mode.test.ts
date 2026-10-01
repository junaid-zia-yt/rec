import { describe, expect, it } from 'vitest'
import {
  generateTaTrackerCandidateCsvExport,
  generateTaTrackerJobCsvExport,
  parseTaTrackerCsvImport,
} from './csv-mode'

describe('parseTaTrackerCsvImport', () => {
  it('maps known column aliases to canonical fields', () => {
    const csv = [
      'Full Name,Email Address,Phone Number,Current Title,YOE,Source',
      'Jane Doe,jane@example.com,555-1234,Store Manager,5,linkedin',
    ].join('\n')
    const result = parseTaTrackerCsvImport(csv)

    expect(result.totalDataRows).toBe(1)
    expect(result.unrecognizedColumns).toEqual([])
    expect(result.ambiguousColumns).toEqual([])
    expect(result.rows[0]!.fields).toEqual({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      current_title: 'Store Manager',
      years_experience: '5',
      source: 'linkedin',
    })
  })

  it('flags unrecognized columns without dropping their raw values', () => {
    const csv = ['Full Name,Favorite Color', 'Jane Doe,Blue'].join('\n')
    const result = parseTaTrackerCsvImport(csv)

    expect(result.unrecognizedColumns).toEqual(['Favorite Color'])
    expect(result.recognizedColumns).toEqual(['Full Name'])
    expect(result.rows[0]!.rawRow['Favorite Color']).toBe('Blue')
    expect(result.rows[0]!.fields).not.toHaveProperty('Favorite Color')
  })

  it('flags colliding headers as ambiguous and maps neither', () => {
    const csv = ['Name,name', 'Jane Doe,Jane D.'].join('\n')
    const result = parseTaTrackerCsvImport(csv)

    expect(result.ambiguousColumns).toEqual(['Name', 'name'])
    expect(result.recognizedColumns).toEqual([])
    expect(result.rows[0]!.fields).toEqual({})
    // Raw values are still preserved even though nothing was mapped.
    expect(result.rows[0]!.rawRow.Name).toBe('Jane Doe')
  })

  it('flags an implausible email without dropping the row', () => {
    const csv = ['Full Name,Email', 'Jane Doe,not-an-email'].join('\n')
    const result = parseTaTrackerCsvImport(csv)

    expect(result.rows).toHaveLength(1)
    expect(result.rowIssues).toContainEqual(
      expect.objectContaining({ rowNumber: 1, message: expect.stringContaining('not-an-email') }),
    )
  })

  it('flags a missing full_name value', () => {
    const csv = ['Full Name,Email', ',jane@example.com'].join('\n')
    const result = parseTaTrackerCsvImport(csv)

    expect(result.rowIssues).toContainEqual(
      expect.objectContaining({ rowNumber: 1, message: expect.stringContaining('no full_name') }),
    )
  })

  it('handles quoted fields containing commas and escaped quotes', () => {
    const csv = ['Full Name,Notes', '"Doe, Jane","Said ""hello"" on call"'].join('\n')
    const result = parseTaTrackerCsvImport(csv)

    expect(result.rows[0]!.fields.full_name).toBe('Doe, Jane')
    expect(result.rows[0]!.fields.notes).toBe('Said "hello" on call')
  })

  it('returns an empty result for an empty file', () => {
    const result = parseTaTrackerCsvImport('')
    expect(result.rows).toEqual([])
    expect(result.totalDataRows).toBe(0)
  })
})

describe('generateTaTrackerCandidateCsvExport', () => {
  it('produces a header row followed by one row per candidate', () => {
    const csv = generateTaTrackerCandidateCsvExport([
      {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: null,
        currentTitle: 'Store Manager',
        yearsExperience: 5,
        source: 'linkedin',
        linkedinUrl: null,
        notes: null,
      },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'full_name,email,phone,current_title,years_experience,source,linkedin_url,notes',
    )
    expect(lines[1]).toBe('Jane Doe,jane@example.com,,Store Manager,5,linkedin,,')
  })

  it('escapes fields containing commas or quotes', () => {
    const csv = generateTaTrackerCandidateCsvExport([
      {
        fullName: 'Doe, Jane "JD"',
        email: null,
        phone: null,
        currentTitle: null,
        yearsExperience: null,
        source: null,
        linkedinUrl: null,
        notes: null,
      },
    ])
    expect(csv.split('\r\n')[1]).toBe('"Doe, Jane ""JD""",,,,,,,')
  })

  it('round-trips through parseTaTrackerCsvImport', () => {
    const csv = generateTaTrackerCandidateCsvExport([
      {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '555-1234',
        currentTitle: 'Store Manager',
        yearsExperience: 5,
        source: 'linkedin',
        linkedinUrl: 'https://linkedin.com/in/janedoe',
        notes: 'Strong candidate',
      },
    ])
    const parsed = parseTaTrackerCsvImport(csv)
    expect(parsed.unrecognizedColumns).toEqual([])
    expect(parsed.rows[0]!.fields.full_name).toBe('Jane Doe')
    expect(parsed.rows[0]!.fields.email).toBe('jane@example.com')
  })
})

describe('generateTaTrackerJobCsvExport', () => {
  it('produces the documented generic job CSV header', () => {
    const csv = generateTaTrackerJobCsvExport([
      {
        jobTitle: 'Store Manager',
        department: 'Retail',
        location: 'Riyadh',
        employmentType: 'full_time',
        status: 'open',
        targetStartDate: null,
      },
    ])
    expect(csv.split('\r\n')[0]).toBe(
      'job_title,department,location,employment_type,status,target_start_date',
    )
  })
})
