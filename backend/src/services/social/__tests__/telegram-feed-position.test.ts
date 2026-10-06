/**
 * Where a Telegram Channel Feed node's position lives: under the workflow
 * owner's row, keyed by node AND channel; a row from before channels keyed
 * positions is carried over once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const owners = vi.hoisted(() => ({ byWorkflow: {} as Record<string, string | undefined>, fail: false }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            if (owners.fail) return { data: null, error: { message: "boom" } }
            const owner = owners.byWorkflow[id]
            return { data: owner ? { user_id: owner } : null, error: null }
          },
        }),
      }),
    }),
  },
}))

/** The mocked `node_cursors` store, keyed workflow:node:user. */
let cursors: Record<string, number> = {}
const key = (wf: string, node: string, user: string) => `${wf}:${node}:${user}`
const readNodeCursor = vi.fn(async (wf: string | undefined, node: string, user: string) => (wf ? cursors[key(wf, node, user)] : undefined))
const writeNodeCursor = vi.fn(async (wf: string | undefined, node: string, user: string, _kind: string, value: number) => {
  if (wf) cursors = { ...cursors, [key(wf, node, user)]: value }
})
const resetNodeCursor = vi.fn(async (wf: string, node: string, user: string) => {
  const k = key(wf, node, user)
  const had = k in cursors
  const next = { ...cursors }
  delete next[k]
  cursors = next
  return had
})
vi.mock("../../workflow-engine/node-cursor.js", () => ({
  readNodeCursor: (...a: [string | undefined, string, string]) => readNodeCursor(...a),
  writeNodeCursor: (...a: [string | undefined, string, string, string, number]) => writeNodeCursor(...a),
  resetNodeCursor: (...a: [string, string, string]) => resetNodeCursor(...a),
}))

import { FEED_CURSOR_KIND, feedPositionKey, feedPositionUser, readFeedPosition, workflowOwnerId } from "../telegram-feed-position.js"

const WF = "11111111-2222-4333-8444-555555555555"

beforeEach(() => {
  cursors = {}
  owners.byWorkflow = { [WF]: "owner-1" }
  owners.fail = false
  readNodeCursor.mockClear()
  writeNodeCursor.mockClear()
  resetNodeCursor.mockClear()
})

describe("feedPositionKey", () => {
  it("names the node and the channel, however the channel was typed", () => {
    expect(feedPositionKey("feed-1", "acme")).toBe("feed-1#acme")
    expect(feedPositionKey("feed-1", "@Acme")).toBe(feedPositionKey("feed-1", "https://t.me/s/acme"))
    expect(feedPositionKey("feed-1", "acme")).not.toBe(feedPositionKey("feed-1", "other"))
  })
})

describe("feedPositionUser — whose position a request may read and move", () => {
  it("the orchestrator's internal call moves the owner's position whoever runs the workflow (a published app's runner included)", () => {
    expect(feedPositionUser({ authKind: "internal" }, "runner-9", "owner-1")).toBe("owner-1")
  })

  it("the owner's own editor Run moves it; anyone else reads statelessly and cannot take the row over", () => {
    expect(feedPositionUser({ authKind: "jwt" }, "owner-1", "owner-1")).toBe("owner-1")
    expect(feedPositionUser({ authKind: "jwt" }, "collaborator-2", "owner-1")).toBeUndefined()
    expect(feedPositionUser({ authKind: "api_token" }, "stranger-3", "owner-1")).toBeUndefined()
  })

  it("no owner (an unknown workflow id) tracks nothing", () => {
    expect(feedPositionUser({ authKind: "internal" }, "runner-9", undefined)).toBeUndefined()
  })
})

describe("workflowOwnerId", () => {
  it("answers the workflow's owner, and nothing for an unknown workflow or a failed read", async () => {
    expect(await workflowOwnerId(WF)).toBe("owner-1")
    expect(await workflowOwnerId("22222222-2222-4333-8444-555555555555")).toBeUndefined()
    owners.fail = true
    expect(await workflowOwnerId(WF)).toBeUndefined()
  })
})

describe("readFeedPosition", () => {
  it("reads the channel's position", async () => {
    cursors = { [key(WF, "feed-1#acme", "owner-1")]: 130 }
    expect(await readFeedPosition(WF, "feed-1", "acme", "owner-1")).toBe(130)
    expect(writeNodeCursor).not.toHaveBeenCalled()
  })

  it("carries a position written before channels keyed them over to the channel's key — once — and removes the old row", async () => {
    cursors = { [key(WF, "feed-1", "owner-1")]: 110 }
    expect(await readFeedPosition(WF, "feed-1", "acme", "owner-1")).toBe(110)
    expect(writeNodeCursor).toHaveBeenCalledWith(WF, "feed-1#acme", "owner-1", FEED_CURSOR_KIND, 110)
    expect(resetNodeCursor).toHaveBeenCalledWith(WF, "feed-1", "owner-1")
    expect(cursors).toEqual({ [key(WF, "feed-1#acme", "owner-1")]: 110 })
    // A different channel on the same node starts fresh: the carried-over row is the first channel's.
    expect(await readFeedPosition(WF, "feed-1", "other", "owner-1")).toBeUndefined()
  })

  it("nothing stored is nothing", async () => {
    expect(await readFeedPosition(WF, "feed-1", "acme", "owner-1")).toBeUndefined()
    expect(writeNodeCursor).not.toHaveBeenCalled()
  })
})
