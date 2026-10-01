#!/usr/bin/env node
/**
 * check-migration-sequence.mjs — Build Phase 15 Wave 1.
 *
 * Confirms supabase/migrations/*.sql is a strictly sequential run of
 * 4-digit numeric prefixes starting at 0001, with no gaps and no
 * duplicates. Used by .github/workflows/migration-validation.yml (and
 * runnable locally: `node scripts/check-migration-sequence.mjs`) as a fast
 * check ahead of the much slower full migration-rebuild-and-verify job —
 * a gap or duplicate is a mistake worth catching before spinning up
 * Postgres at all.
 *
 * Exit code 0 on success, 1 on any problem found (all problems are
 * reported together, not just the first).
 */
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations')

const FILENAME_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/

function main() {
  const entries = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort()

  const problems = []
  const numbers = []

  for (const name of entries) {
    const match = FILENAME_RE.exec(name)
    if (!match) {
      problems.push(
        `${name}: does not match the required <4-digit-number>_<snake_case_name>.sql pattern`,
      )
      continue
    }
    numbers.push({ name, num: Number(match[1]) })
  }

  if (numbers.length === 0) {
    problems.push('No migration files found matching the expected pattern.')
  }

  // Duplicates: two files sharing the same leading number.
  const byNumber = new Map()
  for (const { name, num } of numbers) {
    if (!byNumber.has(num)) byNumber.set(num, [])
    byNumber.get(num).push(name)
  }
  for (const [num, names] of byNumber) {
    if (names.length > 1) {
      problems.push(
        `Duplicate migration number ${String(num).padStart(4, '0')}: ${names.join(', ')}`,
      )
    }
  }

  // Gaps: the sorted, de-duplicated set of numbers must be exactly
  // 1..max with no missing values, starting at 1.
  const uniqueSorted = [...new Set(numbers.map((n) => n.num))].sort((a, b) => a - b)
  if (uniqueSorted.length > 0) {
    if (uniqueSorted[0] !== 1) {
      problems.push(
        `Migration sequence must start at 0001; first number found is ${String(uniqueSorted[0]).padStart(4, '0')}`,
      )
    }
    for (let i = 1; i < uniqueSorted.length; i++) {
      const prev = uniqueSorted[i - 1]
      const curr = uniqueSorted[i]
      if (curr !== prev + 1) {
        for (let missing = prev + 1; missing < curr; missing++) {
          problems.push(`Gap in migration sequence: ${String(missing).padStart(4, '0')} is missing`)
        }
      }
    }
  }

  const max = uniqueSorted.length > 0 ? uniqueSorted[uniqueSorted.length - 1] : 0

  if (problems.length > 0) {
    console.error('[check-migration-sequence] FAILED:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  console.log(
    `[check-migration-sequence] OK: ${numbers.length} migrations, strictly sequential 0001-${String(max).padStart(4, '0')}, no gaps, no duplicates.`,
  )
}

main()
