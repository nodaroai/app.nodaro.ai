/**
 * The memories STORAGE module against a scripted supabase: the duplicate
 * no-op, the per-user cap, missing-table tolerance, and — the guard that must
 * die loudly if someone drops it — owner scoping on every query.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

interface Call {
  method: string
  args: unknown[]
}

interface ChainResult {
  data?: unknown
  count?: number | null
  error?: { code?: string } | null
}

const calls: Call[] = []
let listResult: ChainResult = { data: [], count: 0 }
let insertResult: ChainResult = { data: null }
/** The row the 23505 re-read finds — the concurrent writer's. */
let raceRow: unknown = null

function makeChain() {
  const chain: Record<string, unknown> = {}
  let inserting = false
  for (const m of ["select", "eq", "order", "limit", "insert", "delete", "single", "maybeSingle"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args })
      if (m === "insert") inserting = true
      if (m === "single") {
        return Promise.resolve({ data: insertResult.data, error: insertResult.error ?? null })
      }
      if (m === "maybeSingle") {
        return Promise.resolve({ data: raceRow, error: null })
      }
      return chain
    })
  }
  ;(chain as { then: unknown }).then = (onResolve: (v: unknown) => unknown) => {
    const r = inserting ? insertResult : listResult
    return Promise.resolve({ data: r.data ?? [], count: r.count ?? null, error: r.error ?? null }).then(onResolve)
  }
  return chain
}

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: () => makeChain() } }))

const { listMemories, insertMemory, deleteMemory } = await import("../memories.js")

beforeEach(() => {
  calls.length = 0
  listResult = { data: [], count: 0 }
  insertResult = { data: null }
  raceRow = null
})

describe("the memories storage module", () => {
  it("every query is owner-scoped — dropping the user_id filter dies here", async () => {
    await listMemories("owner-1")
    await deleteMemory("owner-1", "5f0e8f6a-1111-2222-3333-444455556666")
    await insertMemory("owner-1", "always 9:16", null)

    const userScopes = calls.filter((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "owner-1")
    // The list, the delete, AND the insert's pre-read must each carry it.
    expect(userScopes.length).toBeGreaterThanOrEqual(3)
  })

  it("an exact duplicate returns the existing row and never inserts", async () => {
    listResult = { data: [{ id: "m1", content: "always 9:16", created_at: "t" }], count: 1 }
    const outcome = await insertMemory("u1", "always 9:16", null)
    expect(outcome.kind).toBe("duplicate")
    expect(calls.some((c) => c.method === "insert")).toBe(false)
  })

  it("the cap refuses the write once maxPerUser rows exist", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, content: `rule ${i}`, created_at: "t" }))
    listResult = { data: rows, count: rows.length }
    const outcome = await insertMemory("u1", "the 51st", null)
    expect(outcome.kind).toBe("full")
    expect(calls.some((c) => c.method === "insert")).toBe(false)
  })

  it("a missing table (42P01) reads as empty and writes as unavailable — never a throw", async () => {
    listResult = { data: null, error: { code: "42P01" } }
    insertResult = { data: null, error: { code: "42P01" } }
    expect(await listMemories("u1")).toEqual([])
    expect((await insertMemory("u1", "always 9:16", null)).kind).toBe("unavailable")
    expect(await deleteMemory("u1", "5f0e8f6a-1111-2222-3333-444455556666")).toBe(false)
  })

  it("a 23505 from the unique index is a DUPLICATE, not a failure — the race the read cannot see", async () => {
    // Two concurrent turns both pass the read (zero rows), both insert; the
    // loser gets 23505 from copilot_memories_user_content_uniq and must
    // resolve to the row the winner wrote — never to an error the model
    // would relay as "memory failed".
    listResult = { data: [], count: 0 }
    insertResult = { data: null, error: { code: "23505" } }
    raceRow = { id: "m-winner", content: "always 9:16", created_at: "t" }
    const outcome = await insertMemory("u1", "always 9:16", null)
    expect(outcome.kind).toBe("duplicate")
    if (outcome.kind === "duplicate") expect(outcome.memory.id).toBe("m-winner")
  })

  it("a successful save returns the inserted row", async () => {
    listResult = { data: [], count: 0 }
    insertResult = { data: { id: "m-new", content: "always 9:16", created_at: "t" } }
    const outcome = await insertMemory("u1", "always 9:16", "thread-1")
    expect(outcome.kind).toBe("saved")
    if (outcome.kind === "saved") expect(outcome.memory.id).toBe("m-new")
    const inserted = calls.find((c) => c.method === "insert")
    expect(inserted).toBeTruthy()
    expect((inserted!.args[0] as Record<string, unknown>).user_id).toBe("u1")
    expect((inserted!.args[0] as Record<string, unknown>).source_thread_id).toBe("thread-1")
  })
})
