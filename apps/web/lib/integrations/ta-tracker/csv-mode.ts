/**
 * TA Tracker — CSV import/export mode. REAL, working logic (Build Phase 12
 * Wave 3, docs/11-integration-plan.md §11.2): a generic file-format
 * capability that needs no TA Tracker vendor documentation, only this
 * platform's own already-known candidate/job schema. This is the mode the
 * 0032 CHECK constraint allows to legitimately reach `status = 'connected'`
 * ("this mode is set up and usable").
 *
 * Import: parses a TA-Tracker-style CSV export a recruiter uploads. Column
 * headers are matched against `KNOWN_COLUMN_ALIASES` (case/whitespace/
 * punctuation-insensitive) to this platform's own canonical field names
 * (`TA_TRACKER_CANDIDATE_CSV_COLUMNS`) — a header that matches no known
 * alias is left UNRECOGNIZED (never guessed at), and a header whose
 * normalized form collides with another header in the same file is left
 * AMBIGUOUS (neither is mapped) rather than picking one arbitrarily.
 *
 * Export: produces a CSV in this platform's own documented, generic column
 * format (`TA_TRACKER_CANDIDATE_CSV_COLUMNS`/`TA_TRACKER_JOB_CSV_COLUMNS`)
 * — not a TA Tracker vendor format (none is known) — that a recruiter can
 * hand to their TA Tracker admin for manual import.
 *
 * This module does no DB I/O and no Storage I/O — it is pure parsing/
 * formatting, exactly like `lib/outreach/channels/linkedin.ts`'s "this
 * module only shapes the input" pattern. A caller (a future wave's server
 * action) is responsible for turning `TaTrackerCsvImportResult.rows` into
 * real `candidates`/`jobs` writes (through the platform's own existing
 * validated candidate/job creation path, not a bespoke one here) and for
 * uploading/downloading the raw file bytes via `lib/files/storage.ts`'s
 * pattern.
 */
import {
  TA_TRACKER_CANDIDATE_CSV_COLUMNS,
  TA_TRACKER_JOB_CSV_COLUMNS,
  type TaTrackerCandidateCsvColumn,
  type TaTrackerJobCsvColumn,
} from './types'

/**
 * Alias -> canonical column. Every alias is written already-normalized
 * (see `normalizeHeader`) so lookups never need a second pass. Extending
 * this list with a new synonym is safe and additive; it never changes an
 * already-mapped column's meaning.
 */
const KNOWN_CANDIDATE_COLUMN_ALIASES: Record<string, TaTrackerCandidateCsvColumn> = {
  fullname: 'full_name',
  name: 'full_name',
  candidatename: 'full_name',
  email: 'email',
  emailaddress: 'email',
  phone: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  currenttitle: 'current_title',
  title: 'current_title',
  jobtitle: 'current_title', // ambiguous with TA_TRACKER_JOB_CSV_COLUMNS's own 'job_title' in a combined import — resolved per-row-type by the caller, not here.
  yearsexperience: 'years_experience',
  experience: 'years_experience',
  yoe: 'years_experience',
  source: 'source',
  candidatesource: 'source',
  linkedin: 'linkedin_url',
  linkedinurl: 'linkedin_url',
  linkedinprofile: 'linkedin_url',
  notes: 'notes',
  comments: 'notes',
}

const KNOWN_JOB_COLUMN_ALIASES: Record<string, TaTrackerJobCsvColumn> = {
  jobtitle: 'job_title',
  role: 'job_title',
  position: 'job_title',
  department: 'department',
  location: 'location',
  employmenttype: 'employment_type',
  employment: 'employment_type',
  status: 'status',
  jobstatus: 'status',
  targetstartdate: 'target_start_date',
  startdate: 'target_start_date',
}

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Minimal RFC 4180 CSV line-splitter: handles quoted fields, escaped `""`
 * inside quotes, and commas/newlines inside quoted fields. No dependency
 * added — this codebase's dependency tree does not include a CSV library,
 * and this task's brief scopes new dependencies out.
 */
function parseCsvRows(fileContent: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  // Normalize line endings first so \r\n inside/outside quotes behaves consistently.
  const text = fileContent.replace(/\r\n/g, '\n')

  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i)
    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  // Final field/row (files without a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && (r[0] ?? '').trim() === ''))
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toCsvLine(fields: string[]): string {
  return fields.map(escapeCsvField).join(',')
}

export interface TaTrackerCsvRowIssue {
  rowNumber: number // 1-based, counting the header row as row 0 (so row 1 is the first data row)
  message: string
}

export interface TaTrackerImportedCandidateRow {
  rowNumber: number
  fields: Partial<Record<TaTrackerCandidateCsvColumn, string>>
  /** The row's original, unmapped values, keyed by the RAW (not normalized) header text — nothing is ever discarded, so a reviewer can inspect what an unrecognized column actually contained. */
  rawRow: Record<string, string>
}

export interface TaTrackerCsvImportResult {
  rows: TaTrackerImportedCandidateRow[]
  totalDataRows: number
  /** Original header text for columns that were successfully mapped to a canonical field. */
  recognizedColumns: string[]
  /** Original header text for columns whose normalized form matched a known alias, but which collided with another column in this same file — neither side of a collision is mapped. */
  ambiguousColumns: string[]
  /** Original header text for columns that matched no known alias at all — left in each row's `rawRow`, never guessed at. */
  unrecognizedColumns: string[]
  /** Per-row validation issues (e.g. an `email` column present but not a plausible email shape) — the row is still included in `rows`, flagged rather than silently dropped or silently trusted. */
  rowIssues: TaTrackerCsvRowIssue[]
}

const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Parses a TA-Tracker-style candidate CSV export. Never throws on
 * malformed data — a structurally unreadable file (no header row) reports
 * zero rows and zero recognized columns rather than throwing, so a caller
 * can surface that as an ordinary "nothing recognized" result.
 */
export function parseTaTrackerCsvImport(fileContent: string): TaTrackerCsvImportResult {
  const parsedRows = parseCsvRows(fileContent)
  if (parsedRows.length === 0) {
    return {
      rows: [],
      totalDataRows: 0,
      recognizedColumns: [],
      ambiguousColumns: [],
      unrecognizedColumns: [],
      rowIssues: [],
    }
  }

  const headerRow = parsedRows[0] ?? []
  const dataRows = parsedRows.slice(1)

  // First pass: normalize every header and detect collisions before mapping anything.
  const normalizedByIndex = headerRow.map(normalizeHeader)
  const countByNormalized = new Map<string, number>()
  for (const norm of normalizedByIndex) {
    countByNormalized.set(norm, (countByNormalized.get(norm) ?? 0) + 1)
  }

  const recognizedColumns: string[] = []
  const ambiguousColumns: string[] = []
  const unrecognizedColumns: string[] = []
  const canonicalByIndex: (TaTrackerCandidateCsvColumn | null)[] = headerRow.map(
    (rawHeader, idx) => {
      const norm = normalizedByIndex[idx] ?? ''
      const isCollision = (countByNormalized.get(norm) ?? 0) > 1
      const canonical = KNOWN_CANDIDATE_COLUMN_ALIASES[norm]
      if (!canonical) {
        unrecognizedColumns.push(rawHeader)
        return null
      }
      if (isCollision) {
        ambiguousColumns.push(rawHeader)
        return null
      }
      recognizedColumns.push(rawHeader)
      return canonical
    },
  )

  const rows: TaTrackerImportedCandidateRow[] = []
  const rowIssues: TaTrackerCsvRowIssue[] = []

  dataRows.forEach((dataRow, rowIdx) => {
    const rowNumber = rowIdx + 1
    const rawRow: Record<string, string> = {}
    const fields: Partial<Record<TaTrackerCandidateCsvColumn, string>> = {}

    headerRow.forEach((rawHeader, colIdx) => {
      const value = (dataRow[colIdx] ?? '').trim()
      rawRow[rawHeader] = value
      const canonical = canonicalByIndex[colIdx]
      if (canonical && value !== '') {
        fields[canonical] = value
      }
    })

    if (fields.email && !PLAUSIBLE_EMAIL.test(fields.email)) {
      rowIssues.push({
        rowNumber,
        message: `Row ${rowNumber}: "${fields.email}" does not look like a valid email address.`,
      })
    }
    if (fields.years_experience && !/^\d+(\.\d+)?$/.test(fields.years_experience)) {
      rowIssues.push({
        rowNumber,
        message: `Row ${rowNumber}: "${fields.years_experience}" is not a plausible numeric years-of-experience value.`,
      })
    }
    if (!fields.full_name) {
      rowIssues.push({
        rowNumber,
        message: `Row ${rowNumber}: no full_name column value — this row cannot be matched to a candidate without a name.`,
      })
    }

    rows.push({ rowNumber, fields, rawRow })
  })

  return {
    rows,
    totalDataRows: dataRows.length,
    recognizedColumns,
    ambiguousColumns,
    unrecognizedColumns,
    rowIssues,
  }
}

/** The minimal, already-platform-sourced candidate shape `generateTaTrackerCsvExport` needs — deliberately not the full `Candidate` DB row, so this module never depends on fields outside its own concern (mirrors `OutreachMessageForSend`'s narrowing convention). */
export interface TaTrackerExportCandidateRow {
  fullName: string
  email: string | null
  phone: string | null
  currentTitle: string | null
  yearsExperience: number | null
  source: string | null
  linkedinUrl: string | null
  notes: string | null
}

export interface TaTrackerExportJobRow {
  jobTitle: string
  department: string | null
  location: string
  employmentType: string
  status: string
  targetStartDate: string | null
}

/**
 * Produces a CSV of this platform's own candidate data, in the documented,
 * generic `TA_TRACKER_CANDIDATE_CSV_COLUMNS` format — for a recruiter to
 * hand to their TA Tracker admin for manual import. Not a TA Tracker
 * vendor format (none is known to exist).
 */
export function generateTaTrackerCandidateCsvExport(
  candidates: TaTrackerExportCandidateRow[],
): string {
  const lines = [toCsvLine([...TA_TRACKER_CANDIDATE_CSV_COLUMNS])]
  for (const c of candidates) {
    lines.push(
      toCsvLine([
        c.fullName,
        c.email ?? '',
        c.phone ?? '',
        c.currentTitle ?? '',
        c.yearsExperience != null ? String(c.yearsExperience) : '',
        c.source ?? '',
        c.linkedinUrl ?? '',
        c.notes ?? '',
      ]),
    )
  }
  return lines.join('\r\n')
}

/** Same pattern as `generateTaTrackerCandidateCsvExport`, for `jobs`. */
export function generateTaTrackerJobCsvExport(jobs: TaTrackerExportJobRow[]): string {
  const lines = [toCsvLine([...TA_TRACKER_JOB_CSV_COLUMNS])]
  for (const j of jobs) {
    lines.push(
      toCsvLine([
        j.jobTitle,
        j.department ?? '',
        j.location,
        j.employmentType,
        j.status,
        j.targetStartDate ?? '',
      ]),
    )
  }
  return lines.join('\r\n')
}

// Job-column alias map exported for a future wave's combined-file import,
// if it ever wants one — not wired into `parseTaTrackerCsvImport` itself,
// which is scoped to the candidate shape only for this wave.
export { KNOWN_JOB_COLUMN_ALIASES }
