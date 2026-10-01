#!/usr/bin/env node
/**
 * check-bundle-size.mjs — Build Phase 15 Wave 1, optional/soft check.
 *
 * A genuine bundle-size *budget* tool (size-limit, @next/bundle-analyzer,
 * bundlesize, ...) is not installed anywhere in this repo, and this wave is
 * additive-only pipeline code — it deliberately does not add a new
 * dependency just for this. What Next.js 16's Turbopack build already
 * produces without any extra tooling is the compiled output on disk
 * (apps/web/.next/static/chunks/**), so this script sums that up and
 * prints it as a CI job summary line.
 *
 * This is intentionally a SANITY check, not a real budget: there is no
 * established historical baseline in this repo to regress against (this is
 * the first time this number has ever been captured), so the only hard
 * failure condition is a generous, deliberately-loose ceiling
 * (`MAX_TOTAL_BYTES` below) meant to catch something egregious (an
 * accidentally-bundled multi-megabyte dependency), not to enforce a real
 * performance budget. Tightening this into a real budget — comparing
 * against a committed baseline number, or failing a PR that grows the
 * bundle by more than X% — is future work once a few builds' worth of real
 * numbers exist to set a sane baseline from.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const MAX_TOTAL_BYTES = 15 * 1024 * 1024 // 15 MB — loose, see header comment.

const chunksDir = path.join(process.cwd(), 'apps', 'web', '.next', 'static', 'chunks')

function walk(dir) {
  let total = 0
  let count = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return { total, count }
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = walk(full)
      total += sub.total
      count += sub.count
    } else if (entry.name.endsWith('.js')) {
      total += statSync(full).size
      count += 1
    }
  }
  return { total, count }
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function main() {
  const { total, count } = walk(chunksDir)

  if (count === 0) {
    console.error(
      `[check-bundle-size] No .js chunks found under ${chunksDir} — run "pnpm --filter web build" first.`,
    )
    process.exit(1)
  }

  console.log(
    `[check-bundle-size] ${count} JS chunk file(s), ${formatBytes(total)} total under apps/web/.next/static/chunks (sanity ceiling: ${formatBytes(MAX_TOTAL_BYTES)}).`,
  )

  if (total > MAX_TOTAL_BYTES) {
    console.error(
      `[check-bundle-size] FAILED: total chunk size ${formatBytes(total)} exceeds the ${formatBytes(MAX_TOTAL_BYTES)} sanity ceiling.`,
    )
    process.exit(1)
  }
}

main()
