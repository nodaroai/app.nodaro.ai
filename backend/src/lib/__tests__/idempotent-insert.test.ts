import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocked Supabase client
// ---------------------------------------------------------------------------
//
// Three call shapes exercised by `insertWithIdempotencyKey`:
//
//   1. Plain insert (no idempotency key):
//        supabase.from(t).insert(data).select(cols).single()
//   2. Insert with idempotency key (upsert with onConflict + ignoreDuplicates):
//        supabase.from(t).upsert(data, opts).select(cols)
//        -> returns an array. Empty array = conflict (row pre-existed).
//   3. Post-conflict fallback SELECT:
//        supabase.from(t).select(cols).eq("user_id", x).eq("idempotency_key", y).single()
//
// The mock represents an in-memory table keyed by (user_id, idempotency_key)
// so the helper's race semantics are exercised end-to-end against a model
// of Postgres ON CONFLICT DO NOTHING, not a no-op mock.

interface FakeRow { id: string; user_id: string; idempotency_key: string | null }

const mocks = vi.hoisted(() => {
  const state = { rows: [] as FakeRow[], nextId: 1 }

  // Track each chain's pending query so .single() / await resolution can read
  // the accumulated filters / payloads.
  function fromBuilder(table: string) {
    const ctx: {
      table: string
      mode: "insert" | "upsert" | "select" | null
      payload: Record<string, unknown> | null
      upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | null
      selectFilters: Array<{ col: string; val: unknown }>
    } = { table, mode: null, payload: null, upsertOpts: null, selectFilters: [] }

    const builder: Record<string, unknown> = {}

    builder.insert = (payload: Record<string, unknown>) => {
      ctx.mode = "insert"
      ctx.payload = payload
      return builder
    }

    builder.upsert = (payload: Record<string, unknown>, opts: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      ctx.mode = "upsert"
      ctx.payload = payload
      ctx.upsertOpts = opts
      return builder
    }

    builder.select = (_cols?: string) => {
      // No-op for chaining — caller does .single() or awaits.
      if (ctx.mode === null) ctx.mode = "select"
      return builder
    }

    builder.eq = (col: string, val: unknown) => {
      ctx.selectFilters.push({ col, val })
      return builder
    }

    builder.single = async () => {
      if (ctx.mode === "insert") {
        const row: FakeRow = {
          id: `id-${state.nextId++}`,
          user_id: String(ctx.payload?.user_id ?? ""),
          idempotency_key: (ctx.payload?.idempotency_key as string | null | undefined) ?? null,
        }
        state.rows.push(row)
        return { data: row, error: null }
      }
      if (ctx.mode === "select") {
        const userId = ctx.selectFilters.find((f) => f.col === "user_id")?.val
        const key = ctx.selectFilters.find((f) => f.col === "idempotency_key")?.val
        const row = state.rows.find((r) => r.user_id === userId && r.idempotency_key === key)
        return row
          ? { data: row, error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows" } }
      }
      throw new Error(`unsupported chain for .single() in mode=${ctx.mode}`)
    }

    // `await builder` (no .single()) — upsert path returns the inserted rows.
    builder.then = (onResolve: (v: { data: FakeRow[] | null; error: unknown }) => unknown) => {
      if (ctx.mode === "upsert") {
        const userId = String(ctx.payload?.user_id ?? "")
        const key = (ctx.payload?.idempotency_key as string | null | undefined) ?? null
        const existing = state.rows.find((r) => r.user_id === userId && r.idempotency_key === key)
        if (existing && ctx.upsertOpts?.ignoreDuplicates) {
          // Conflict — ignoreDuplicates means we get an empty array, not the existing row.
          return Promise.resolve({ data: [], error: null }).then(onResolve)
        }
        const row: FakeRow = {
          id: `id-${state.nextId++}`,
          user_id: userId,
          idempotency_key: key,
        }
        state.rows.push(row)
        return Promise.resolve({ data: [row], error: null }).then(onResolve)
      }
      // For .select() without .single(), return all matching rows.
      if (ctx.mode === "select") {
        const userId = ctx.selectFilters.find((f) => f.col === "user_id")?.val
        const key = ctx.selectFilters.find((f) => f.col === "idempotency_key")?.val
        const rows = state.rows.filter((r) => r.user_id === userId && r.idempotency_key === key)
        return Promise.resolve({ data: rows, error: null }).then(onResolve)
      }
      throw new Error(`unsupported chain await in mode=${ctx.mode}`)
    }

    return builder
  }

  const fromMock = vi.fn((table: string) => fromBuilder(table))

  function reset() {
    state.rows = []
    state.nextId = 1
  }

  return { fromMock, reset, state }
})

vi.mock("../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))

import { insertWithIdempotencyKey } from "../idempotent-insert.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reset()
})

describe("insertWithIdempotencyKey", () => {
  it("performs a plain INSERT when no idempotency key is supplied", async () => {
    const result = await insertWithIdempotencyKey<{ id: string }>(
      "jobs",
      { user_id: "user-1", workflow_id: "wf-1", status: "pending" },
      undefined,
    )
    expect(result.created).toBe(true)
    expect(result.row.id).toMatch(/^id-/)
    expect(mocks.state.rows).toHaveLength(1)
    expect(mocks.state.rows[0].idempotency_key).toBe(null)
  })

  it("inserts with idempotency_key when no row exists for (user_id, key)", async () => {
    const result = await insertWithIdempotencyKey<{ id: string }>(
      "jobs",
      { user_id: "user-1", workflow_id: "wf-1", status: "pending" },
      "key-abc",
    )
    expect(result.created).toBe(true)
    expect(mocks.state.rows).toHaveLength(1)
    expect(mocks.state.rows[0].idempotency_key).toBe("key-abc")
  })

  it("returns the existing row WITHOUT a new INSERT when (user_id, key) already exists", async () => {
    // Seed: pretend a prior call already inserted this row.
    mocks.state.rows.push({ id: "id-pre-existing", user_id: "user-1", idempotency_key: "key-abc" })
    mocks.state.nextId = 2

    const result = await insertWithIdempotencyKey<{ id: string }>(
      "jobs",
      { user_id: "user-1", workflow_id: "wf-1", status: "pending" },
      "key-abc",
    )

    expect(result.created).toBe(false)
    expect(result.row.id).toBe("id-pre-existing")
    expect(mocks.state.rows).toHaveLength(1)  // no new row added
  })

  it("treats two concurrent calls with the same key as ONE logical insert", async () => {
    // Both callers race. The DB-level UNIQUE constraint (modeled here by the
    // fake `state.rows` index on (user_id, key)) means only one INSERT wins;
    // the other gets the existing row back.
    const userId = "user-race"
    const key = "key-race"
    const data = { user_id: userId, workflow_id: "wf-1", status: "pending" }

    const [a, b] = await Promise.all([
      insertWithIdempotencyKey<{ id: string }>("jobs", data, key),
      insertWithIdempotencyKey<{ id: string }>("jobs", data, key),
    ])

    expect(mocks.state.rows).toHaveLength(1)
    expect(a.row.id).toBe(b.row.id)
    // Exactly one caller observes created=true; the other sees created=false.
    expect(Number(a.created) + Number(b.created)).toBe(1)
  })

  it("different idempotency keys produce different rows for the same user", async () => {
    const a = await insertWithIdempotencyKey<{ id: string }>(
      "jobs",
      { user_id: "user-1", status: "pending" },
      "key-a",
    )
    const b = await insertWithIdempotencyKey<{ id: string }>(
      "jobs",
      { user_id: "user-1", status: "pending" },
      "key-b",
    )
    expect(a.row.id).not.toBe(b.row.id)
    expect(mocks.state.rows).toHaveLength(2)
  })

  it("same idempotency key but different users do NOT collide", async () => {
    const a = await insertWithIdempotencyKey<{ id: string }>(
      "jobs",
      { user_id: "user-1", status: "pending" },
      "key-shared",
    )
    const b = await insertWithIdempotencyKey<{ id: string }>(
      "jobs",
      { user_id: "user-2", status: "pending" },
      "key-shared",
    )
    expect(a.row.id).not.toBe(b.row.id)
    expect(mocks.state.rows).toHaveLength(2)
  })
})
