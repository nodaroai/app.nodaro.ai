/**
 * One live turn per thread — the invariant behind #903.
 *
 * The route's `findLiveTurn` check is a check-then-act: the winner writes its
 * turn row 100-300 ms later, after the job insert and the credit reservation,
 * and a second request landing inside that window passed the same check and
 * reserved its own credits. Both were charged.
 *
 * The refusal itself is deliberate and pre-existing (the copilot edits the
 * canvas; two turns on one workflow means two models writing over each other).
 * What is tested here is that it is now a property of the DATA — the partial
 * unique index — and that the loser of the race learns it as a null claim
 * rather than an exception.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"

const insertResult = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown } }))

function makeChain() {
  const chain: Record<string, unknown> = {}
  for (const m of ["insert", "select", "eq", "order", "limit"]) {
    chain[m] = vi.fn(() => chain)
  }
  chain.single = vi.fn(() => Promise.resolve(insertResult.value))
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return chain
}

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: () => makeChain() } }))

const { createTurn } = await import("../store.js")

const input = {
  threadId: "th1",
  userId: "u1",
  modelId: "claude-sonnet-5",
  jobId: "job1",
  baseVersion: 3,
}

beforeEach(() => {
  insertResult.value = { data: null, error: null }
})

describe("createTurn — claiming the thread's live turn", () => {
  it("returns the row when the claim is won", async () => {
    insertResult.value = { data: { id: "turn1", thread_id: "th1", status: "running" }, error: null }
    await expect(createTurn(input)).resolves.toMatchObject({ id: "turn1" })
  })

  it("returns NULL on 23505 — the index refused a second live turn", async () => {
    insertResult.value = { data: null, error: { code: "23505", message: "duplicate key value" } }
    await expect(createTurn(input)).resolves.toBeNull()
  })

  it("still THROWS on any other insert failure", async () => {
    // A blanket catch here would report a broken insert as "someone else is
    // running" and quietly swallow every write fault the table can have.
    insertResult.value = { data: null, error: { code: "23503", message: "thread_id not present" } }
    await expect(createTurn(input)).rejects.toThrow(/createTurn/)
  })
})

describe("the invariant is in the database, not only in the request path", () => {
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "..", "..", "supabase/migrations/348_copilot_one_running_turn.sql"),
    "utf8",
  )

  it("migration 348 creates a UNIQUE index on copilot_turns, partial on status = 'running'", () => {
    const normalized = sql.replace(/\s+/g, " ")
    expect(normalized).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON public\.copilot_turns \(thread_id\) WHERE status = 'running'/i,
    )
  })

  it("demotes pre-existing duplicate running rows FIRST, so the index cannot fail the migrate job", () => {
    const update = sql.search(/^UPDATE public.copilot_turns/m)
    const index = sql.search(/^CREATE UNIQUE INDEX/im)
    expect(update).toBeGreaterThan(-1)
    expect(index).toBeGreaterThan(update)
    // The newest running row per thread is the one that survives.
    expect(sql.replace(/\s+/g, " ")).toMatch(/newer\.started_at, newer\.id\) > \(t\.started_at, t\.id\)/)
  })
})
