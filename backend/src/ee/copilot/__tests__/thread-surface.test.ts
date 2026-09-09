/**
 * A workflow can carry TWO live threads — the canvas assistant's and the
 * studio editor's — and the store has to tell them apart.
 *
 * Three things are pinned here, each of which used to be a way to lose a
 * thread or mint a duplicate:
 *
 *  - the lookup picks its surface FROM A PAGE OF ROWS, in code. A single-row
 *    read over a workflow that now holds two live threads errors, and an error
 *    that is discarded reads as "no thread at all" — the caller then creates a
 *    second thread of its own surface and the unique index refuses the insert.
 *  - it never filters on the column. A `surface = …` filter is an undefined
 *    column on a database that has not taken the migration yet, which would
 *    take the canvas assistant down for the whole pre-promotion window.
 *  - the INSERT names the column only when the surface is not the default, and
 *    a database without the column is an honest, named refusal — never a retry
 *    that strips it, which would file a studio thread as a canvas one.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  /** Live rows the paged read returns, newest first. */
  rows: [] as Array<Record<string, unknown>>,
  readError: null as unknown,
  /** Every filter the paged read applied, so surface-blindness is provable. */
  filters: [] as Array<[string, unknown]>,
  /** …and the filters of the counting read, which is a different query. */
  countFilters: [] as Array<[string, unknown]>,
  pageSize: 0,
  count: 0,
  inserts: [] as Array<Record<string, unknown>>,
  /** Columns this database does not have — an insert naming one is refused. */
  missingColumns: [] as string[],
  /**
   * HOW the database refuses it, because there are two spellings and they are
   * not interchangeable. Raw Postgres answers an undefined column in a FILTER
   * with 42703; PostgREST answers an unknown column in a WRITE PAYLOAD from
   * its schema cache with PGRST204 — and this insert is a payload, so PGRST204
   * is the one a hosted database actually sends.
   */
  missingColumnCode: "42703",
  missingColumnMessage: null as string | null,
}))

function readResult() {
  return state.readError ? { data: null, error: state.readError } : { data: state.rows, error: null }
}

function insertResult(row: Record<string, unknown>) {
  const missing = Object.keys(row).find((column) => state.missingColumns.includes(column))
  if (missing) {
    return {
      data: null,
      error: {
        code: state.missingColumnCode,
        message:
          state.missingColumnMessage ??
          `column "${missing}" of relation "copilot_threads" does not exist`,
      },
    }
  }
  return { data: { id: "th-new", ...row }, error: null }
}

function makeChain() {
  const chain: Record<string, unknown> = {}
  let head = false
  let insertRow: Record<string, unknown> = {}
  chain.select = vi.fn((_columns?: unknown, opts?: { head?: boolean }) => {
    if (opts?.head) head = true
    return chain
  })
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    insertRow = row
    state.inserts.push(row)
    return chain
  })
  chain.eq = vi.fn((column: string, value: unknown) => {
    ;(head ? state.countFilters : state.filters).push([column, value])
    return chain
  })
  chain.is = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn((size: number) => {
    state.pageSize = size
    return chain
  })
  chain.maybeSingle = vi.fn(() => Promise.resolve(readResult()))
  chain.single = vi.fn(() => Promise.resolve(insertResult(insertRow)))
  // The counting read awaits the chain itself; so does any paged read that
  // ends at `.limit(...)`.
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(head ? { count: state.count, error: null } : readResult()).then(resolve)
  return chain
}

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: () => makeChain() } }))

const { countActiveThreads, createThread, findActiveThread, threadSurface, ThreadSurfaceNotPromotedError } =
  await import("../store.js")

const canvasRow = { id: "th-canvas", user_id: "u1", workflow_id: "wf1", surface: "workflow", archived_at: null }
const studioRow = { id: "th-studio", user_id: "u1", workflow_id: "wf1", surface: "studio", archived_at: null }
/** Written before the column existed: no surface at all. */
const legacyRow = { id: "th-legacy", user_id: "u1", workflow_id: "wf1", archived_at: null }

beforeEach(() => {
  state.rows = []
  state.readError = null
  state.filters = []
  state.countFilters = []
  state.pageSize = 0
  state.count = 0
  state.inserts = []
  state.missingColumns = []
  state.missingColumnCode = "42703"
  state.missingColumnMessage = null
})

describe("findActiveThread — one live thread per surface", () => {
  it("gives each surface its own row when both are live on one workflow", async () => {
    state.rows = [studioRow, canvasRow]
    await expect(findActiveThread("u1", "wf1", "workflow")).resolves.toMatchObject({ id: "th-canvas" })
    await expect(findActiveThread("u1", "wf1", "studio")).resolves.toMatchObject({ id: "th-studio" })
  })

  it("reads a row that predates the column as the canvas thread, and only that", async () => {
    state.rows = [legacyRow]
    await expect(findActiveThread("u1", "wf1", "workflow")).resolves.toMatchObject({ id: "th-legacy" })
    await expect(findActiveThread("u1", "wf1", "studio")).resolves.toBeNull()
  })

  it("never filters on the column — the read must survive a database without it", async () => {
    state.rows = [canvasRow]
    await findActiveThread("u1", "wf1", "workflow")
    expect(state.filters.map(([column]) => column)).toEqual(["user_id", "workflow_id"])
    // A page, not a single row and not the user's whole history.
    expect(state.pageSize).toBeGreaterThan(1)
  })

  it("throws a store error instead of reading it as 'no thread at all'", async () => {
    // The discarded error is the whole bug: it reads as no thread, the caller
    // mints a duplicate, and the unique index then refuses the insert.
    state.readError = { message: "multiple rows returned" }
    await expect(findActiveThread("u1", "wf1", "workflow")).rejects.toThrow(/findActiveThread/)
  })
})

describe("threadSurface", () => {
  it("defaults an absent or unknown value to the canvas surface", () => {
    expect(threadSurface({})).toBe("workflow")
    expect(threadSurface({ surface: "studio" })).toBe("studio")
    expect(threadSurface({ surface: "nonsense" })).toBe("workflow")
  })
})

describe("createThread — the column is named only when it has to be", () => {
  it("a canvas thread never names it, so a pre-migration database still works", async () => {
    state.missingColumns = ["surface"]
    await expect(createThread("u1", "wf1")).resolves.toMatchObject({ id: "th-new" })
    expect(state.inserts).toEqual([{ user_id: "u1", workflow_id: "wf1" }])
  })

  it("a studio thread names it — a row that silently defaulted would be a canvas thread", async () => {
    await createThread("u1", "wf1", { surface: "studio" })
    expect(state.inserts).toEqual([{ user_id: "u1", workflow_id: "wf1", surface: "studio" }])
  })

  it("throws the named error when the database has no such column yet", async () => {
    state.missingColumns = ["surface"]
    await expect(createThread("u1", "wf1", { surface: "studio" })).rejects.toBeInstanceOf(
      ThreadSurfaceNotPromotedError,
    )
  })

  it("keeps the older retry strictly to the column it always stripped", async () => {
    state.missingColumns = ["created_workflow"]
    await expect(
      createThread("u1", "wf1", { surface: "studio", createdWorkflow: true }),
    ).resolves.toMatchObject({ id: "th-new" })
    expect(state.inserts).toEqual([
      { user_id: "u1", workflow_id: "wf1", surface: "studio", created_workflow: true },
      { user_id: "u1", workflow_id: "wf1", surface: "studio" },
    ])
  })
})

describe("countActiveThreads stays surface-blind", () => {
  it("counts a user's live threads, whichever assistant they belong to", async () => {
    state.count = 7
    await expect(countActiveThreads("u1")).resolves.toBe(7)
    // The cap counts conversations, not kinds: a surface filter here would let
    // a user hold one cap's worth of each.
    expect(state.countFilters.map(([column]) => column)).toEqual(["user_id"])
  })
})

/**
 * The SAME refusal, in the spelling a hosted database actually uses.
 *
 * `createThread` names its columns in an INSERT PAYLOAD, and PostgREST answers
 * a payload column its schema cache has never heard of with PGRST204 — not the
 * raw-Postgres 42703, which is what an undefined column in a FILTER returns.
 * Recognising only the filter code left the whole pre-promotion refusal
 * unreachable on a real deployment: the typed error never fired, so the route
 * answered a sanitized 500 where the honest "not promoted yet" belongs.
 */
describe("createThread — the schema-cache code means the same thing", () => {
  const SCHEMA_CACHE_MISS = "Could not find the 'surface' column of 'copilot_threads' in the schema cache"

  beforeEach(() => {
    state.missingColumnCode = "PGRST204"
  })

  it("throws the named error when PostgREST refuses the column from its schema cache", async () => {
    state.missingColumns = ["surface"]
    state.missingColumnMessage = SCHEMA_CACHE_MISS
    await expect(createThread("u1", "wf1", { surface: "studio" })).rejects.toBeInstanceOf(
      ThreadSurfaceNotPromotedError,
    )
  })

  it("still strips the older column and retries under this code too", async () => {
    // The inherited retry keys on the same recognition, so a code it does not
    // know leaves the retry unreachable as well — a thread creation that used
    // to survive a pre-promotion database would simply fail.
    state.missingColumns = ["created_workflow"]
    await expect(createThread("u1", "wf1", { createdWorkflow: true })).resolves.toMatchObject({
      id: "th-new",
    })
    expect(state.inserts).toEqual([
      { user_id: "u1", workflow_id: "wf1", created_workflow: true },
      { user_id: "u1", workflow_id: "wf1" },
    ])
  })

  it("still lets a canvas thread through on a database without the column", async () => {
    state.missingColumns = ["surface"]
    state.missingColumnMessage = SCHEMA_CACHE_MISS
    await expect(createThread("u1", "wf1")).resolves.toMatchObject({ id: "th-new" })
    expect(state.inserts).toEqual([{ user_id: "u1", workflow_id: "wf1" }])
  })
})
