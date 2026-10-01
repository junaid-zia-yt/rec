import { CsvCandidateRowSchema, type CsvRowValidation } from '@rqi/types'

/**
 * Deterministic CSV import parsing + validation — Build Phase 5 brief
 * §"Candidate creation": "CSV import" + §UI "CSV import review". Pure,
 * dependency-free (no external CSV library, no Supabase) so every row's
 * validation is unit-testable and reviewable before anything is written —
 * nothing here commits a row; apps/web/lib/candidates/actions.ts's
 * importCandidatesFromCsvAction does that, and only for rows the recruiter
 * has reviewed and confirmed.
 *
 * Expected header row (case/whitespace-insensitive, any order):
 *   full_name, email, phone, current_title, current_company, location
 * `full_name` is the only required column; every other recognized column is
 * optional. An unrecognized column is ignored, not an error — a recruiter's
 * export from another tool may carry extra columns this import doesn't use.
 */

const RECOGNIZED_HEADERS = [
  'full_name',
  'email',
  'phone',
  'current_title',
  'current_company',
  'location',
] as const

/** Accepts a handful of common spellings for each recognized column, normalized to snake_case for comparison. */
function normalizeHeaderName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
}

/**
 * Minimal RFC4180-ish CSV line splitter: handles double-quoted fields
 * (including an embedded comma or an escaped `""`), but not multi-line
 * quoted fields — sufficient for a flat candidate-row export and simpler to
 * audit than pulling in a parsing library for this one form.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

export interface CsvParseResult {
  rows: CsvRowValidation[]
  /** Recognized columns actually found in the header row, in header order. */
  recognizedColumns: string[]
  /** Header-row problems that stop parsing entirely (e.g. no full_name column at all) — distinct from per-row validation errors. */
  headerError: string | null
}

/** Parses and validates a candidate CSV. Never throws — a malformed file produces a headerError or per-row errors, always in a shape the CSV-import-review screen can render. */
export function parseCandidateCsv(csvText: string): CsvParseResult {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    return { rows: [], recognizedColumns: [], headerError: 'The file is empty.' }
  }

  const headerFields = splitCsvLine(lines[0]!).map(normalizeHeaderName)
  const columnIndex = new Map<string, number>()
  for (const [index, header] of headerFields.entries()) {
    if ((RECOGNIZED_HEADERS as readonly string[]).includes(header) && !columnIndex.has(header)) {
      columnIndex.set(header, index)
    }
  }

  if (!columnIndex.has('full_name')) {
    return {
      rows: [],
      recognizedColumns: [...columnIndex.keys()],
      headerError: 'The file must have a "full_name" column.',
    }
  }

  const rows: CsvRowValidation[] = []
  for (let lineNumber = 1; lineNumber < lines.length; lineNumber++) {
    const fields = splitCsvLine(lines[lineNumber]!)
    const get = (col: string): string | null => {
      const index = columnIndex.get(col)
      if (index === undefined) return null
      const value = fields[index]?.trim() ?? ''
      return value.length > 0 ? value : null
    }

    const candidateRow = {
      rowNumber: lineNumber + 1, // 1-indexed, includes the header row for a spreadsheet-familiar row number
      fullName: get('full_name') ?? '',
      primaryEmail: get('email'),
      primaryPhone: get('phone'),
      currentTitle: get('current_title'),
      currentCompany: get('current_company'),
      location: get('location'),
    }

    const parsed = CsvCandidateRowSchema.safeParse(candidateRow)
    if (parsed.success) {
      rows.push({ row: parsed.data, valid: true, errors: [] })
    } else {
      rows.push({
        row: candidateRow,
        valid: false,
        errors: parsed.error.issues.map((issue) => issue.message),
      })
    }
  }

  return { rows, recognizedColumns: [...columnIndex.keys()], headerError: null }
}
