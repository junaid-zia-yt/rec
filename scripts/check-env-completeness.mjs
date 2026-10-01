#!/usr/bin/env node
/**
 * check-env-completeness.mjs — Build Phase 15 Wave 1.
 *
 * Catches drift between apps/web/lib/env.ts's Zod schema (the vars the app
 * actually reads through the validated accessor) and .env.example (the
 * vars documented for a human setting up their own .env.local). Every var
 * in one must appear in the other, in both directions.
 *
 * This is a deliberately simple, dependency-free parser (no TypeScript
 * compiler API, no zod import — this script must run standalone in CI with
 * only Node) — it extracts:
 *   - from env.ts: every `SOME_NAME: z.string()...` key inside the
 *     `z.object({ ... })` schema block (matched by the
 *     `UPPER_SNAKE_CASE:` pattern, which nothing else in that file's
 *     schema literal collides with) plus every
 *     `process.env.SOME_NAME` reference elsewhere in the file (so a var
 *     read outside the Zod schema, if one is ever added, still counts).
 *   - from .env.example: every `SOME_NAME=` line at the start of a line
 *     (ignoring comments).
 *
 * Exit code 0 when the two sets match exactly, 1 otherwise (both
 * directions of drift are reported together).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const envTsPath = path.join(repoRoot, 'apps', 'web', 'lib', 'env.ts')
const envExamplePath = path.join(repoRoot, '.env.example')

function extractFromEnvTs(source) {
  const names = new Set()

  // Zod schema keys: lines like `  NEXT_PUBLIC_APP_URL: z.string()...`
  const schemaKeyRe = /^\s{2,}([A-Z][A-Z0-9_]*)\s*:\s*z\./gm
  for (const m of source.matchAll(schemaKeyRe)) {
    names.add(m[1])
  }

  // Any process.env.SOME_NAME reference, as a safety net for vars read
  // outside the Zod object literal.
  const processEnvRe = /process\.env\.([A-Z][A-Z0-9_]*)/g
  for (const m of source.matchAll(processEnvRe)) {
    names.add(m[1])
  }

  return names
}

function extractFromEnvExample(source) {
  const names = new Set()
  const lineRe = /^([A-Z][A-Z0-9_]*)=/
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = lineRe.exec(line)
    if (m) names.add(m[1])
  }
  return names
}

function main() {
  let envTsSource
  let envExampleSource
  try {
    envTsSource = readFileSync(envTsPath, 'utf8')
  } catch (err) {
    console.error(`[check-env-completeness] Could not read ${envTsPath}: ${err.message}`)
    process.exit(1)
  }
  try {
    envExampleSource = readFileSync(envExamplePath, 'utf8')
  } catch (err) {
    console.error(`[check-env-completeness] Could not read ${envExamplePath}: ${err.message}`)
    process.exit(1)
  }

  const fromEnvTs = extractFromEnvTs(envTsSource)
  const fromEnvExample = extractFromEnvExample(envExampleSource)

  const missingFromExample = [...fromEnvTs].filter((n) => !fromEnvExample.has(n)).sort()
  const missingFromEnvTs = [...fromEnvExample].filter((n) => !fromEnvTs.has(n)).sort()

  if (missingFromExample.length === 0 && missingFromEnvTs.length === 0) {
    console.log(
      `[check-env-completeness] OK: ${fromEnvTs.size} variables in apps/web/lib/env.ts all documented in .env.example, and vice versa.`,
    )
    return
  }

  console.error('[check-env-completeness] FAILED: env.ts and .env.example have drifted apart.')
  if (missingFromExample.length > 0) {
    console.error(
      `  Read by apps/web/lib/env.ts but not documented in .env.example:\n    ${missingFromExample.join('\n    ')}`,
    )
  }
  if (missingFromEnvTs.length > 0) {
    console.error(
      `  Documented in .env.example but never read by apps/web/lib/env.ts:\n    ${missingFromEnvTs.join('\n    ')}`,
    )
  }
  process.exit(1)
}

main()
