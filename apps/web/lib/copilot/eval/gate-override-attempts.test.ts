import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  EXPECTED_COPILOT_TOOL_NAMES,
  FORBIDDEN_COPILOT_WRITE_TARGETS,
  isReadOnlyCopilotTool,
} from '../gate-override-guard'
import { TOOL_REGISTRY } from '../tool-registry'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 8 (governing brief: "gate-
 * override attempts"). `gate-override-guard.ts`'s own header note explicitly
 * defers this: "What this file DOES provide, for wave 4's [now wave 5's]
 * adversarial tests to assert against mechanically (grep/import-graph
 * checks), not just by code review". This file is that automated check.
 *
 * Two independent, mechanical assertions:
 *  1. No `tools/*.ts` handler file contains a Supabase write call
 *     (`.update(`/`.insert(`/`.upsert(`/`.delete(`) at all — a static source
 *     grep, run against every handler file in the directory, not a hand-
 *     picked subset — so a future tool added to this directory without
 *     updating this test still gets checked (the `readdirSync` walk below
 *     is over the directory, not a fixed list of filenames).
 *  2. `EXPECTED_COPILOT_TOOL_NAMES` (wave 2's independently-hand-maintained
 *     allowlist mirror) matches `TOOL_REGISTRY`'s actual keys exactly —
 *     catches silent tool-registry drift (a tool added to the registry but
 *     never reconciled against the guard's own list, or vice versa).
 */

const TOOLS_DIR = path.resolve(__dirname, '../tools')

function toolHandlerFiles(): string[] {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'shared.ts')
    .map((f) => path.join(TOOLS_DIR, f))
}

describe('EVALUATION — gate-override attempts: no copilot tool can write to a gate/eligibility/mutation table', () => {
  it('every tools/*.ts handler file exists and is non-empty (sanity check the grep below is scanning real files, not an empty directory)', () => {
    const files = toolHandlerFiles()
    expect(files.length).toBeGreaterThanOrEqual(7) // project, candidate, shortlist, drafting, responses, poc, workflow
    for (const file of files) {
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(100)
    }
  })

  it('no tools/*.ts handler file contains a Supabase write call (.update(/.insert(/.upsert(/.delete() — read-only by construction', () => {
    const writeCallPattern = /\.(update|insert|upsert|delete)\s*\(/
    const offenders: { file: string; line: number; text: string }[] = []
    for (const file of toolHandlerFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (writeCallPattern.test(line))
          offenders.push({ file: path.basename(file), line: index + 1, text: line.trim() })
      })
    }
    expect(offenders).toEqual([])
  })

  it('no tools/*.ts handler file chains a write call (.update(/.insert(/.upsert(/.delete() directly off a FORBIDDEN_COPILOT_WRITE_TARGETS table name (defense in depth beyond the line-level write-call grep above, scoped to genuine write attempts — several tools legitimately READ these same tables, e.g. mandatory_gate_results/candidate_role_matches for displaying already-computed eligibility/scores, which must NOT be flagged as an offense)', () => {
    const writeChainPattern =
      /\.from\(\s*['"](\w+)['"]\s*\)(?:\s*\.\w+\([^)]*\))*\s*\.(update|insert|upsert|delete)\s*\(/g
    const forbiddenTables = new Set<string>(
      FORBIDDEN_COPILOT_WRITE_TARGETS.map((t): string => t.table),
    )
    const offenders: { file: string; table: string }[] = []
    for (const file of toolHandlerFiles()) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(writeChainPattern)) {
        const table = match[1]!
        if (forbiddenTables.has(table)) offenders.push({ file: path.basename(file), table })
      }
    }
    expect(offenders).toEqual([])
  })

  it("EXPECTED_COPILOT_TOOL_NAMES (wave 2's independently-maintained mirror) matches TOOL_REGISTRY's actual keys exactly — no silent drift either direction", () => {
    const registryKeys = Object.keys(TOOL_REGISTRY).sort()
    const expectedNames = [...EXPECTED_COPILOT_TOOL_NAMES].sort()
    expect(registryKeys).toEqual(expectedNames)
  })

  it('every registry tool has requiresConfirmation: false — no tool proposes a mutation a human would need to confirm, because none of them can mutate anything', () => {
    for (const key of Object.keys(TOOL_REGISTRY) as (keyof typeof TOOL_REGISTRY)[]) {
      expect(TOOL_REGISTRY[key].requiresConfirmation).toBe(false)
    }
  })

  it('isReadOnlyCopilotTool holds for every one of the 13 allowlisted tool names', () => {
    for (const name of EXPECTED_COPILOT_TOOL_NAMES) {
      expect(isReadOnlyCopilotTool(name)).toBe(true)
    }
  })
})
