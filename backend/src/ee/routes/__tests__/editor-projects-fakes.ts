import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { refuse } from "../../lib/editor-projects/errors.js"

/**
 * Stand-ins for the editor-project routes' tests: the two tables and three
 * functions of migration 703 (the functions as the migration writes them,
 * raises by name included), and the object store the project files live in.
 */

export interface ProjectRow {
  id: string
  user_id: string
  name: string
  content_hash: string | null
  blob_key: string | null
  size_bytes: number | null
  revision: number
  holder_id: string | null
  holder_seen_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface VersionRow {
  id: string
  project_id: string
  number: number
  label: string
  author: string
  kind: "full" | "patch"
  base_number: number | null
  content_hash: string
  size_bytes: number
  blob_key: string
  created_at: string
}

type PgError = { code: string; message: string }

export const db = {
  projects: [] as ProjectRow[],
  versions: [] as VersionRow[],
  /** When set, every table read and function call answers this error (a database without migration 703). */
  missing: null as PgError | null,
  /**
   * Runs once inside the next `editor_project_save`, before it locks the row:
   * whatever happens meanwhile (another tab's whole save, a takeover). It is
   * cleared before it runs, so a save it makes does not run it again.
   */
  beforeSave: null as (() => void | Promise<void>) | null,
  /** When set, `editor_project_save` answers this error before changing anything (a save that did not land). */
  saveError: null as PgError | null,
  /** When set, `editor_project_save` commits the save, then answers this error (an answer lost after the commit). */
  saveErrorAfterCommit: null as PgError | null,
  /** When set, every read of `editor_projects` answers this error. */
  readError: null as PgError | null,
  /** Runs once after `editor_project_save` committed (for example, to make the next read fail). */
  afterSave: null as (() => void) | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  /** Runs once before the next version insert checks anything (another cut landing meanwhile). */
  beforeVersionInsert: null as (() => void | Promise<void>) | null,
  /** When set, the next version insert answers this error and stores nothing. */
  versionInsertError: null as PgError | null,
  /** When set, the next version insert stores the row, then answers this error (an answer lost after the commit). */
  versionInsertErrorAfterCommit: null as PgError | null,
  /** When set, every delete from `editor_project_versions` answers this error. */
  versionDeleteError: null as PgError | null,
  /** Asked before each read of `editor_project_versions` (its selected columns): an error to answer, or null. */
  onVersionRead: null as ((columns: string | null) => PgError | null) | null,
  /** `editor_project_storage_bytes` (migration 711): present, or a database without it yet (PGRST202). */
  storageFunction: "present" as "present" | "missing",
  /** Bytes added to what `editor_project_storage_bytes` sums (a person already near the ceiling). */
  storageBytesExtra: 0,
  /** When set, `editor_project_storage_bytes` answers this error. */
  storageBytesError: null as PgError | null,
  /** Every insert and delete of a version row, in order (`insert 3`, `delete 1`). */
  versionWrites: [] as string[],
  reset() {
    this.projects = []
    this.versions = []
    this.missing = null
    this.beforeSave = null
    this.saveError = null
    this.saveErrorAfterCommit = null
    this.readError = null
    this.afterSave = null
    this.rpcCalls = []
    this.beforeVersionInsert = null
    this.versionInsertError = null
    this.versionInsertErrorAfterCommit = null
    this.versionDeleteError = null
    this.onVersionRead = null
    this.storageFunction = "present"
    this.storageBytesExtra = 0
    this.storageBytesError = null
    this.versionWrites = []
  },
}

const iso = (ms = Date.now()) => new Date(ms).toISOString()

/** A project row with sensible defaults. */
export function seedProject(partial: Partial<ProjectRow> & { user_id: string }): ProjectRow {
  const row: ProjectRow = {
    id: randomUUID(),
    name: "My cut",
    content_hash: null,
    blob_key: null,
    size_bytes: null,
    revision: 0,
    holder_id: null,
    holder_seen_at: null,
    created_at: iso(),
    updated_at: iso(),
    deleted_at: null,
    ...partial,
  }
  db.projects.push(row)
  return row
}

type Filter = { column: string; value: unknown }

function tableRows(table: string): Array<Record<string, unknown>> {
  if (table === "editor_projects") return db.projects as unknown as Array<Record<string, unknown>>
  if (table === "editor_project_versions") return db.versions as unknown as Array<Record<string, unknown>>
  throw new Error(`fake supabase: no table ${table}`)
}

function pick(row: Record<string, unknown>, columns: string | null): Record<string, unknown> {
  if (!columns || columns.trim() === "*") return { ...row }
  return Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c]]))
}

function from(table: string) {
  const state = {
    op: "select" as "select" | "insert" | "update" | "delete",
    columns: null as string | null,
    filters: [] as Filter[],
    order: null as { column: string; ascending: boolean } | null,
    limit: null as number | null,
    values: null as Record<string, unknown> | null,
    /** `select(…, { count: "exact", head: true })`: the count, and no rows. */
    count: false,
    head: false,
  }
  const run = async (): Promise<{ data: Array<Record<string, unknown>> | null; error: PgError | null; count?: number }> => {
    if (db.missing) return { data: null, error: db.missing }
    if (db.readError && state.op === "select" && table === "editor_projects") return { data: null, error: db.readError }
    if (state.op === "select" && table === "editor_project_versions") {
      const failure = db.onVersionRead?.(state.columns) ?? null
      if (failure) return { data: null, error: failure }
    }
    const rows = tableRows(table)
    const matches = (row: Record<string, unknown>) => state.filters.every((f) => (f.value === null ? row[f.column] == null : row[f.column] === f.value))
    if (state.op === "insert" && table === "editor_project_versions") return insertVersion(state.values!, state.columns)
    if (state.op === "insert") {
      const values = state.values!
      if (typeof values.name === "string" && (values.name.length < 1 || values.name.length > 120)) {
        return { data: null, error: { code: "23514", message: "check constraint" } }
      }
      const row = seedProject(values as Partial<ProjectRow> & { user_id: string })
      return { data: [pick(row as unknown as Record<string, unknown>, state.columns)], error: null }
    }
    let hit = rows.filter(matches)
    if (state.op === "update") {
      for (const row of hit) Object.assign(row, state.values)
    }
    if (state.op === "delete") {
      if (table === "editor_project_versions" && db.versionDeleteError) return { data: null, error: db.versionDeleteError }
      const gone = new Set(hit)
      if (table === "editor_project_versions") {
        db.versions = db.versions.filter((v) => !gone.has(v as unknown as Record<string, unknown>))
        for (const row of hit) db.versionWrites.push(`delete ${row.number}`)
      } else {
        db.projects = db.projects.filter((p) => !gone.has(p as unknown as Record<string, unknown>))
      }
    }
    if (state.order) {
      const { column, ascending } = state.order
      const compare = (a: unknown, b: unknown) =>
        typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
      hit = [...hit].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1))
    }
    if (state.limit !== null) hit = hit.slice(0, state.limit)
    if (state.count) return { data: state.head ? null : hit.map((r) => pick(r, state.columns)), error: null, count: hit.length }
    return { data: hit.map((r) => pick(r, state.columns)), error: null }
  }
  const builder = {
    select(columns?: string, options?: { count?: string; head?: boolean }) {
      state.columns = columns ?? null
      state.count = options?.count === "exact"
      state.head = options?.head === true
      return builder
    },
    insert(values: Record<string, unknown>) {
      state.op = "insert"
      state.values = values
      return builder
    },
    update(values: Record<string, unknown>) {
      state.op = "update"
      state.values = values
      return builder
    },
    delete() {
      state.op = "delete"
      return builder
    },
    eq(column: string, value: unknown) {
      state.filters.push({ column, value })
      return builder
    },
    is(column: string, value: unknown) {
      state.filters.push({ column, value })
      return builder
    },
    order(column: string, opts: { ascending?: boolean } = {}) {
      state.order = { column, ascending: opts.ascending ?? true }
      return builder
    },
    limit(n: number) {
      state.limit = n
      return builder
    },
    async maybeSingle() {
      const r = await run()
      return r.error ? { data: null, error: r.error } : { data: r.data![0] ?? null, error: null }
    },
    async single() {
      const r = await run()
      if (r.error) return { data: null, error: r.error }
      return r.data!.length === 1 ? { data: r.data![0], error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } }
    },
    then<A, B>(resolve: (v: Awaited<ReturnType<typeof run>>) => A, reject?: (e: unknown) => B) {
      return run().then(resolve, reject)
    },
  }
  return builder
}

/** A version insert, with the table's checks and its unique (project_id, number). */
async function insertVersion(values: Record<string, unknown>, columns: string | null) {
  const hook = db.beforeVersionInsert
  db.beforeVersionInsert = null
  await hook?.()
  const failure = db.versionInsertError
  db.versionInsertError = null
  if (failure) return { data: null, error: failure }
  const check = { data: null, error: { code: "23514", message: "check constraint" } }
  const text = (v: unknown, min: number, max: number) => typeof v === "string" && v.length >= min && v.length <= max
  if (!text(values.label, 1, 120) || !text(values.author, 1, 60) || !text(values.blob_key, 1, 512)) return check
  if (typeof values.content_hash !== "string" || !/^[0-9a-f]{64}$/.test(values.content_hash)) return check
  if (typeof values.size_bytes !== "number" || values.size_bytes < 0 || !Number.isInteger(values.number)) return check
  if (!((values.kind === "full" && values.base_number == null) || (values.kind === "patch" && typeof values.base_number === "number"))) return check
  if (!db.projects.some((p) => p.id === values.project_id)) return { data: null, error: { code: "23503", message: "foreign key" } }
  if (db.versions.some((v) => v.project_id === values.project_id && v.number === values.number)) {
    return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
  }
  const row: VersionRow = {
    id: randomUUID(),
    created_at: iso(),
    ...(values as Omit<VersionRow, "id" | "created_at">),
    base_number: (values.base_number as number | null | undefined) ?? null,
  }
  db.versions.push(row)
  db.versionWrites.push(`insert ${row.number}`)
  const lost = db.versionInsertErrorAfterCommit
  db.versionInsertErrorAfterCommit = null
  if (lost) return { data: null, error: lost }
  return { data: [pick(row as unknown as Record<string, unknown>, columns)], error: null }
}

const raise = (message: string) => ({ data: null, error: { code: "P0001", message } })

function liveRow(id: unknown, user: unknown): ProjectRow | undefined {
  return db.projects.find((p) => p.id === id && p.user_id === user && p.deleted_at === null)
}

async function rpc(name: string, args: Record<string, unknown>) {
  db.rpcCalls.push({ name, args })
  if (db.missing) return { data: null, error: db.missing }
  if (name === "editor_project_save") {
    const hash = args.p_hash
    const size = args.p_size
    const key = args.p_blob_key
    if (
      typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) || typeof size !== "number" || size < 0 ||
      typeof key !== "string" || key.length < 1 || key.length > 512
    ) return raise("invalid_content")
    const hook = db.beforeSave
    db.beforeSave = null
    await hook?.()
    if (db.saveError) return { data: null, error: db.saveError }
    const row = liveRow(args.p_id, args.p_user)
    if (!row) return raise("not_found")
    if (args.p_holder == null || row.holder_id !== args.p_holder) return raise("not_holder")
    if (args.p_base != null && row.content_hash !== args.p_base) return raise("base_mismatch")
    if (row.content_hash === hash) {
      row.holder_seen_at = iso()
      return { data: [{ revision: row.revision, saved: false, previous_blob_key: null }], error: null }
    }
    const previous = row.blob_key
    Object.assign(row, { content_hash: hash, size_bytes: size, blob_key: key, revision: row.revision + 1, updated_at: iso(), holder_seen_at: iso() })
    const after = db.afterSave
    db.afterSave = null
    after?.()
    if (db.saveErrorAfterCommit) return { data: null, error: db.saveErrorAfterCommit }
    return { data: [{ revision: row.revision, saved: true, previous_blob_key: previous }], error: null }
  }
  if (name === "editor_project_storage_bytes") {
    if (db.storageFunction === "missing") return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } }
    if (db.storageBytesError) return { data: null, error: db.storageBytesError }
    // As the migration sums: live projects' current files plus their versions.
    const live = db.projects.filter((p) => p.user_id === args.p_user && p.deleted_at === null)
    const ids = new Set(live.map((p) => p.id))
    const total = live.reduce((n, p) => n + (p.size_bytes ?? 0), 0) + db.versions.filter((v) => ids.has(v.project_id)).reduce((n, v) => n + v.size_bytes, 0)
    return { data: total + db.storageBytesExtra, error: null }
  }
  if (name === "editor_project_claim") {
    const row = liveRow(args.p_id, args.p_user)
    if (!row) return raise("not_found")
    if (args.p_holder == null || args.p_holder === "") return raise("invalid_holder")
    const stale = row.holder_seen_at === null || Date.parse(row.holder_seen_at) < Date.now() - 90_000
    if (row.holder_id === null || stale || row.holder_id === args.p_holder || args.p_takeover === true) {
      row.holder_id = args.p_holder as string
      row.holder_seen_at = iso()
      return { data: true, error: null }
    }
    return { data: false, error: null }
  }
  if (name === "editor_project_release") {
    const row = liveRow(args.p_id, args.p_user)
    if (!row) return raise("not_found")
    if (args.p_holder == null || row.holder_id !== args.p_holder) return { data: false, error: null }
    row.holder_id = null
    row.holder_seen_at = null
    return { data: true, error: null }
  }
  return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } }
}

export const fakeSupabase = { from, rpc }

// ── The private bucket ──────────────────────────────────────────────────────

export interface StoredObject {
  body: Buffer
}

export const storage = {
  /** Null stands for a deployment with no private bucket. */
  configured: true,
  objects: new Map<string, StoredObject>(),
  puts: [] as string[],
  deleted: [] as string[],
  /** Puts to a key this predicate accepts fail (storage refusing a write). */
  failPut: null as ((key: string) => boolean) | null,
  /** Deletes of a key this predicate accepts fail. */
  failDelete: null as ((key: string) => boolean) | null,
  /** Run once before the next read or stream looks the key up (another request acting meanwhile). */
  beforeRead: null as (() => void | Promise<void>) | null,
  beforeStream: null as (() => void | Promise<void>) | null,
  reset() {
    this.configured = true
    this.objects = new Map()
    this.puts = []
    this.deleted = []
    this.failPut = null
    this.failDelete = null
    this.beforeRead = null
    this.beforeStream = null
  },
}

const privateStore = {
  async put(key: string, body: Buffer) {
    if (storage.failPut?.(key)) throw Object.assign(new Error("storage refused the write"), { name: "InternalError" })
    storage.puts.push(key)
    storage.objects.set(key, { body: Buffer.from(body) })
  },
  async exists(key: string) {
    return storage.objects.has(key)
  },
  async read(key: string, maxBytes: number) {
    const hook = storage.beforeRead
    storage.beforeRead = null
    await hook?.()
    const object = storage.objects.get(key)
    if (!object) return null
    // As the real store refuses an object over the cap.
    if (object.body.length > maxBytes) throw refuse(413, "too_large")
    return Buffer.from(object.body)
  },
  async stream(key: string) {
    const hook = storage.beforeStream
    storage.beforeStream = null
    await hook?.()
    const object = storage.objects.get(key)
    return object ? { body: Readable.from([object.body]), contentLength: object.body.length } : null
  },
  async delete(key: string): Promise<"deleted" | "skipped"> {
    if (storage.failDelete?.(key)) throw Object.assign(new Error("storage refused the delete"), { name: "InternalError" })
    storage.objects.delete(key)
    storage.deleted.push(key)
    return "deleted"
  },
}

/** Stands in for `editorProjectsStore()`. */
export function fakeEditorProjectsStore() {
  return storage.configured ? privateStore : null
}
