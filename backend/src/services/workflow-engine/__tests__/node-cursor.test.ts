import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The durable polling cursor (migration 267).
 *
 * The bug it closes: only the EDITOR could persist a feed's position (via
 * updateNodeData + autosave). A scheduled run has no editor, so the orchestrator
 * re-read the same starting point every tick and reprocessed the same items —
 * for Telegram Channel Feed, republishing the same posts to a real audience on
 * every interval.
 */

/** Rows the mocked `node_cursors` table holds, keyed workflow:node. */
let rows: Readonly<Record<string, { cursor_value: number }>> = {}
let upserts: ReadonlyArray<Record<string, unknown>> = []
let failReads = false
let failWrites = false

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const chain = {
          _wf: "",
          _node: "",
          eq(col: string, val: string) {
            if (col === "workflow_id") chain._wf = val
            if (col === "node_id") chain._node = val
            return chain
          },
          async maybeSingle() {
            if (failReads) return { data: null, error: { message: "boom" } }
            const row = rows[`${chain._wf}:${chain._node}`]
            return { data: row ?? null, error: null }
          },
        }
        return chain
      },
      async upsert(payload: Record<string, unknown>) {
        if (failWrites) throw new Error("write failed")
        upserts = [...upserts, payload]
        return { error: null }
      },
    }),
  },
}))

import { readNodeCursor, writeNodeCursor } from "../node-cursor.js"

beforeEach(() => {
  rows = {}
  upserts = []
  failReads = false
  failWrites = false
})

describe("readNodeCursor", () => {
  it("returns the stored position", async () => {
    rows = { "wf-1:node-a": { cursor_value: 42 } }
    expect(await readNodeCursor("wf-1", "node-a")).toBe(42)
  })

  it("returns undefined on first run", async () => {
    expect(await readNodeCursor("wf-1", "node-a")).toBeUndefined()
  })

  it("degrades to undefined instead of throwing when the read fails", async () => {
    failReads = true
    // Reprocessing is the OLD behavior; failing the user's workflow is not.
    await expect(readNodeCursor("wf-1", "node-a")).resolves.toBeUndefined()
  })

  it("returns undefined for a run with no workflow id (single-node Run)", async () => {
    expect(await readNodeCursor(undefined, "node-a")).toBeUndefined()
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
    rows = { "wf-1:node-a": { cursor_value: 100 } }

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

describe("the scheduled-run scenario the cursor exists for", () => {
  it("a second tick resumes past the first tick's posts", async () => {
    // Tick 1: first run, nothing stored -> the feed starts from the beginning.
    expect(await readNodeCursor("wf-1", "feed")).toBeUndefined()
    await writeNodeCursor("wf-1", "feed", "user-1", "telegram-channel-feed", 20)
    rows = { "wf-1:feed": { cursor_value: 20 } }

    // Tick 2: resumes at 20 instead of replaying posts 1-20 and republishing
    // them to the user's real audience.
    expect(await readNodeCursor("wf-1", "feed")).toBe(20)
  })
})
