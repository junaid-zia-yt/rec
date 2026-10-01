import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Build Phase 11, Wave 3 — a small, generic in-memory fake of the subset of
 * the Supabase query builder `run-copilot-turn.ts` (and, transitively,
 * `resource-ownership.ts` / `tool-registry.ts`'s handlers / `audit/log.ts`)
 * actually calls: `.from(table).select()/.insert()/.update()`, `.eq()`,
 * `.in()`, `.order()`, `.maybeSingle()`, `.single()`, and the bare thenable
 * form for a plain SELECT/INSERT. Same "no live Supabase project connected
 * in this environment" convention as `resource-ownership.test.ts`'s
 * `createFakeSupabase` — this is a superset covering insert/update/count,
 * which that file's narrower fake does not need.
 *
 * Imported ONLY by `.test.ts` files.
 */
export interface FakeSupabaseSeed {
  [table: string]: Record<string, unknown>[]
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

/**
 * Build Phase 12, Wave 4 addition — a UUID-shaped id generator, for the
 * (small but real) subset of tables whose id a Zod schema downstream
 * validates as a real `z.string().uuid()` (e.g. `NotificationEmailDeliveryPayloadSchema.notificationId`,
 * which carries a `notifications.id` value INSERTED by one job handler
 * into the PAYLOAD of a job it enqueues for another). `nextId`'s plain
 * `<table>-<n>` shape (unchanged above, still the default for every other
 * table) is not itself a valid UUID and fails that validation — this
 * generator is opt-in per table via `uuidTables` below rather than
 * changing every table's id shape, since several existing tests assert
 * against the CURRENT non-UUID shape's literal format.
 */
function nextUuid(): string {
  idCounter += 1
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, '0')}`
}

/** Tables whose inserted row id must be UUID-shaped for a downstream Zod `.uuid()` check to accept it — currently only `notifications`, added by Build Phase 12 Wave 4's `notification-dispatch-handler.test.ts` (its `email_delivery` follow-on job payload carries the freshly-inserted `notifications.id`). Extend this set only when a real, similar cross-job-payload id reference needs it — not a blanket switch. */
const UUID_ID_TABLES = new Set<string>(['notifications'])

class FakeQueryBuilder {
  private filters: { col: string; op: 'eq' | 'neq' | 'in' | 'not_in'; value: unknown }[] = []
  private orderCol: string | null = null
  private orderAsc = true
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private insertPayload: Record<string, unknown> | Record<string, unknown>[] | null = null
  private updatePayload: Record<string, unknown> | null = null
  private upsertOnConflictCols: string[] | null = null
  private countRequested = false

  constructor(
    private readonly tables: FakeSupabaseSeed,
    private readonly table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.mode === 'select') {
      if (opts?.count) this.countRequested = true
    }
    return this
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mode = 'insert'
    this.insertPayload = payload
    return this
  }

  update(payload: Record<string, unknown>): this {
    this.mode = 'update'
    this.updatePayload = payload
    return this
  }

  /** Minimal fake of Supabase's `.upsert(payload, { onConflict })` — added Build Phase 14, Wave 4b for `candidate-evaluation.ts`'s `candidate_role_matches` upsert. Matches an existing row by EVERY column named in `onConflict` (comma-separated, matching the real client's own string shape); updates it in place if found, else inserts a new row (mirroring `runInsert`'s id/created_at generation). */
  upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }): this {
    this.mode = 'upsert'
    this.insertPayload = payload
    this.upsertOnConflictCols = opts?.onConflict
      ? opts.onConflict.split(',').map((c) => c.trim())
      : null
    return this
  }

  /**
   * Minimal fake of Supabase's `.delete()` — added for Build Phase 17A
   * Wave 2's candidate-erasure integration tests
   * (`privacy-actions.test.ts`), the first test in this codebase to
   * exercise a real `'"use server"'` action end-to-end against seeded
   * rows. Removes every currently-matching row from the table in place
   * (mirroring `runUpdate`'s in-place mutation), returning the removed
   * rows as `data` — same shape the real client returns.
   */
  delete(): this {
    this.mode = 'delete'
    return this
  }

  eq(col: string, value: unknown): this {
    this.filters.push({ col, op: 'eq', value })
    return this
  }

  in(col: string, values: unknown[]): this {
    this.filters.push({ col, op: 'in', value: values })
    return this
  }

  /** Minimal fake of Supabase's `.neq()` — added Build Phase 17A Wave 2 for `privacy-actions.ts`'s `.neq('verification_status', 'edited')` (row must not equal, including rows where the column is null — matching Postgres `<>`'s real semantics is out of scope here; this codebase's one call site never relies on null handling). */
  neq(col: string, value: unknown): this {
    this.filters.push({ col, op: 'neq', value })
    return this
  }

  not(col: string, op: string, value: string): this {
    // Mirrors the single real call site's shape: .not('verification_status', 'in', '(verified,edited)').
    if (op === 'in') {
      const values = value.replace(/^\(|\)$/g, '').split(',')
      this.filters.push({ col, op: 'not_in', value: values })
    }
    return this
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col
    this.orderAsc = opts?.ascending ?? true
    return this
  }

  limit(_n: number): this {
    return this
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every((f) => {
      if (f.op === 'eq') return row[f.col] === f.value
      if (f.op === 'neq') return row[f.col] !== f.value
      if (f.op === 'in') return (f.value as unknown[]).includes(row[f.col])
      if (f.op === 'not_in') return !(f.value as unknown[]).includes(row[f.col])
      return true
    })
  }

  private ensureTable(): Record<string, unknown>[] {
    const existing = this.tables[this.table]
    if (existing) return existing
    const created: Record<string, unknown>[] = []
    this.tables[this.table] = created
    return created
  }

  private runSelect(): { data: Record<string, unknown>[]; count: number | null } {
    let rows = this.ensureTable().filter((row) => this.matches(row))
    if (this.orderCol) {
      const col = this.orderCol
      rows = [...rows].sort((a, b) => {
        const av = a[col] as string | number
        const bv = b[col] as string | number
        if (av < bv) return this.orderAsc ? -1 : 1
        if (av > bv) return this.orderAsc ? 1 : -1
        return 0
      })
    }
    return { data: rows, count: this.countRequested ? rows.length : null }
  }

  private runInsert(): { data: Record<string, unknown>[]; count: null } {
    const table = this.ensureTable()
    const payloads = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload!]
    const generateId = UUID_ID_TABLES.has(this.table) ? nextUuid : () => nextId(this.table)
    const inserted = payloads.map((payload) => {
      const row = { id: generateId(), created_at: new Date().toISOString(), ...payload }
      table.push(row)
      return row
    })
    return { data: inserted, count: null }
  }

  private runUpdate(): { data: Record<string, unknown>[]; count: null } {
    const table = this.ensureTable()
    const updated: Record<string, unknown>[] = []
    for (const row of table) {
      if (this.matches(row)) {
        Object.assign(row, this.updatePayload)
        updated.push(row)
      }
    }
    return { data: updated, count: null }
  }

  private runUpsert(): { data: Record<string, unknown>[]; count: null } {
    const table = this.ensureTable()
    const payload = this.insertPayload as Record<string, unknown>
    const conflictCols = this.upsertOnConflictCols
    const existing = conflictCols
      ? table.find((row) => conflictCols.every((col) => row[col] === payload[col]))
      : undefined

    if (existing) {
      Object.assign(existing, payload)
      return { data: [existing], count: null }
    }
    const generateId = UUID_ID_TABLES.has(this.table) ? nextUuid : () => nextId(this.table)
    const row = { id: generateId(), created_at: new Date().toISOString(), ...payload }
    table.push(row)
    return { data: [row], count: null }
  }

  private runDelete(): { data: Record<string, unknown>[]; count: null } {
    const table = this.ensureTable()
    const remaining: Record<string, unknown>[] = []
    const removed: Record<string, unknown>[] = []
    for (const row of table) {
      if (this.matches(row)) removed.push(row)
      else remaining.push(row)
    }
    table.length = 0
    table.push(...remaining)
    return { data: removed, count: null }
  }

  private exec(): { data: Record<string, unknown>[]; count: number | null } {
    if (this.mode === 'insert') return this.runInsert()
    if (this.mode === 'update') return this.runUpdate()
    if (this.mode === 'upsert') return this.runUpsert()
    if (this.mode === 'delete') return this.runDelete()
    return this.runSelect()
  }

  async maybeSingle() {
    const { data } = this.exec()
    return { data: data[0] ?? null, error: null }
  }

  async single() {
    const { data } = this.exec()
    return data[0]
      ? { data: data[0], error: null }
      : { data: null, error: { message: 'not found' } }
  }

  then<
    TResult1 = { data: Record<string, unknown>[]; error: null; count: number | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: Record<string, unknown>[]
          error: null
          count: number | null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const { data, count } = this.exec()
    return Promise.resolve({ data, error: null, count }).then(onfulfilled, onrejected ?? undefined)
  }
}

/** Creates a fake `SupabaseClient` seeded with `seed`'s rows, mutated in place by inserts/updates the code under test performs — a test can read `seed[table]` after the call to assert on what was written. */
export function createFakeSupabase(seed: FakeSupabaseSeed): SupabaseClient {
  return { from: (table: string) => new FakeQueryBuilder(seed, table) } as unknown as SupabaseClient
}
