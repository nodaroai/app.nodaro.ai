import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The durable polling cursor (migration 267).
 *
 * The bug it closes: only the EDITOR could persist a feed's position (via
 * updateNodeData + autosave). A scheduled run has no editor, so the orchestrator
 * re-read the same starting point every tick and reprocessed the same items —
 * for Telegram Channel Feed, republishing the same posts to a real audience on
 * every interval. Since PR 2 the feed's route is the one owner of the position,
 * and every call is scoped to the user whose run it is.
 */

/** Rows the mocked `node_cursors` table holds, keyed workflow:node:user. */
let rows: Readonly<Record<string, { cursor_value: number; updated_at?: string }>> = {}
let upserts: ReadonlyArray<Record<string, unknown>> = []
let deletes: ReadonlyArray<{ wf: string; node: string; user: string }> = []
let failReads = false
let failWrites = false
let failDeletes = false

function filterChain(onDone: (f: { wf: string; node: string; user: string }) => unknown) {
  const f = { wf: "", node: "", user: "" }
  const chain = {
    eq(col: string, val: string) {
      if (col === "workflow_id") f.wf = val
      if (col === "node_id") f.node = val
      if (col === "user_id") f.user = val
      return chain
    },
    async maybeSingle() {
      return onDone(f)
    },
    async select() {
      return onDone(f)
    },
  }
  return chain
}

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () =>
        filterChain((f) => {
          if (failReads) return { data: null, error: { message: "boom" } }
          const row = rows[`${f.wf}:${f.node}:${f.user}`]
          return { data: row ?? null, error: null }
        }),
      delete: () =>
        filterChain((f) => {
          if (failDeletes) return { data: null, error: { message: "nope" } }
          const key = `${f.wf}:${f.node}:${f.user}`
          const had = key in rows
          deletes = [...deletes, f]
          if (had) {
            const next = { ...rows }
            delete next[key]
            rows = next
          }
          return { data: had ? [{ node_id: f.node }] : [], error: null }
        }),
      async upsert(payload: Record<string, unknown>) {
        if (failWrites) throw new Error("write failed")
        upserts = [...upserts, payload]
        rows = { ...rows, [`${payload.workflow_id}:${payload.node_id}:${payload.user_id}`]: { cursor_value: payload.cursor_value as number } }
        return { error: null }
      },
    }),
  },
}))

import { readNodeCursor, readNodeCursorRow, resetNodeCursor, writeNodeCursor } from "../node-cursor.js"

beforeEach(() => {
  rows = {}
  upserts = []
  deletes = []
  failReads = false
  failWrites = false
  failDeletes = false
})

describe("readNodeCursor", () => {
  it("returns the stored position — the user's own", async () => {
    rows = { "wf-1:node-a:user-1": { cursor_value: 42, updated_at: "2026-10-06T10:00:00Z" } }
    expect(await readNodeCursor("wf-1", "node-a", "user-1")).toBe(42)
    expect(await readNodeCursorRow("wf-1", "node-a", "user-1")).toEqual({ value: 42, updatedAt: "2026-10-06T10:00:00Z" })
    // Another account sees no position: a collaborator never reads the owner's, nor the other way round.
    expect(await readNodeCursor("wf-1", "node-a", "user-2")).toBeUndefined()
  })

  it("returns undefined on first run", async () => {
    expect(await readNodeCursor("wf-1", "node-a", "user-1")).toBeUndefined()
  })

  it("degrades to undefined instead of throwing when the read fails", async () => {
    failReads = true
    // Reprocessing is the OLD behavior; failing the user's workflow is not.
    await expect(readNodeCursor("wf-1", "node-a", "user-1")).resolves.toBeUndefined()
  })

  it("returns undefined for a run with no workflow id (an unsaved canvas)", async () => {
    expect(await readNodeCursor(undefined, "node-a", "user-1")).toBeUndefined()
  })
})

describe("writeNodeCursor", () => {
  it("stores the new position", async () => {
    await writeNodeCursor("wf-1", "node-a", "user-1", "telegram-channel-feed", 100)

    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      workflow_id: "wf-1",
      node_id: "node-a",
      user_id: "user-1",
      kind: "telegram-channel-feed",
      cursor_value: 100,
    })
  })

  it("never moves the cursor BACKWARDS", async () => {
    rows = { "wf-1:node-a:user-1": { cursor_value: 100 } }

    // A deleted post, a partial fetch, or an out-of-order retry can report an
    // older high-water mark. Rewinding would reprocess everything since.
    await writeNodeCursor("wf-1", "node-a", "user-1", "telegram-channel-feed", 90)
    expect(upserts).toHaveLength(0)

    await writeNodeCursor("wf-1", "node-a", "user-1", "telegram-channel-feed", 100)
    expect(upserts, "equal is not forward either").toHaveLength(0)

    await writeNodeCursor("wf-1", "node-a", "user-1", "telegram-channel-feed", 101)
    expect(upserts).toHaveLength(1)
  })

  it("swallows a write failure rather than failing the run", async () => {
    failWrites = true
    await expect(
      writeNodeCursor("wf-1", "node-a", "user-1", "telegram-channel-feed", 5),
    ).resolves.toBeUndefined()
  })

  it("ignores a non-finite cursor and a missing workflow id", async () => {
    await writeNodeCursor("wf-1", "node-a", "user-1", "telegram-channel-feed", Number.NaN)
    await writeNodeCursor(undefined, "node-a", "user-1", "telegram-channel-feed", 5)
    expect(upserts).toHaveLength(0)
  })
})

describe("resetNodeCursor — the node's Reset button", () => {
  it("removes the user's own row and says so; a second reset removes nothing", async () => {
    rows = { "wf-1:node-a:user-1": { cursor_value: 100 } }
    expect(await resetNodeCursor("wf-1", "node-a", "user-1")).toBe(true)
    expect(deletes).toEqual([{ wf: "wf-1", node: "node-a", user: "user-1" }])
    expect(await readNodeCursor("wf-1", "node-a", "user-1")).toBeUndefined()
    expect(await resetNodeCursor("wf-1", "node-a", "user-1")).toBe(false)
  })

  it("is scoped to the user: another account's reset leaves the owner's position", async () => {
    rows = { "wf-1:node-a:user-1": { cursor_value: 100 } }
    expect(await resetNodeCursor("wf-1", "node-a", "user-2")).toBe(false)
    expect(await readNodeCursor("wf-1", "node-a", "user-1")).toBe(100)
  })

  it("throws on a failed delete — a person asked, so they are told", async () => {
    failDeletes = true
    await expect(resetNodeCursor("wf-1", "node-a", "user-1")).rejects.toThrow(/reset failed/)
  })
})

describe("the scheduled-run scenario the cursor exists for", () => {
  it("a second tick resumes past the first tick's posts", async () => {
    // Tick 1: first run, nothing stored -> the feed starts from the newest posts.
    expect(await readNodeCursor("wf-1", "feed", "user-1")).toBeUndefined()
    await writeNodeCursor("wf-1", "feed", "user-1", "telegram-channel-feed", 20)
    // Tick 2: the stored position is what the route pages forward from.
    expect(await readNodeCursor("wf-1", "feed", "user-1")).toBe(20)
    await writeNodeCursor("wf-1", "feed", "user-1", "telegram-channel-feed", 25)
    expect(await readNodeCursor("wf-1", "feed", "user-1")).toBe(25)
    // Reset: the next tick bootstraps again.
    await resetNodeCursor("wf-1", "feed", "user-1")
    expect(await readNodeCursor("wf-1", "feed", "user-1")).toBeUndefined()
  })
})
