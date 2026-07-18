import { describe, it, expect, vi, beforeEach } from "vitest"

let dueRows: Array<{ id: string }> = []
let claimWins = new Set<string>()
const claimAttempts: string[] = []
const reverts: string[] = []
vi.mock("../supabase.js", () => ({
  supabase: {
    from() {
      const b: Record<string, unknown> = {}
      let mode: "select" | "claim" | "revert" = "select"
      let targetId = ""
      let patchStatus = ""
      Object.assign(b, {
        select: () => b,
        eq: (col: string, val: string) => {
          if (col === "id") targetId = val
          return b
        },
        lte: () => b,
        order: () => b,
        limit: () => b,
        update: (patch: { status: string }) => {
          patchStatus = patch.status
          mode = patch.status === "publishing" ? "claim" : "revert"
          return b
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (mode === "claim") {
            claimAttempts.push(targetId)
            const won = claimWins.has(targetId)
            return Promise.resolve({ data: won ? [{ id: targetId }] : [] }).then(resolve)
          }
          if (mode === "revert") {
            if (patchStatus === "queued") reverts.push(targetId)
            return Promise.resolve({ data: [] }).then(resolve)
          }
          return Promise.resolve({ data: dueRows, error: null }).then(resolve)
        },
      })
      return b
    },
  },
}))

const addMock = vi.fn(async (..._args: unknown[]) => ({}))
vi.mock("../social-queue.js", () => ({
  socialPublishQueue: { add: (...args: unknown[]) => addMock(...args) },
}))

import { scanDueScheduledPosts } from "../scheduled-posts-cron.js"

beforeEach(() => {
  dueRows = []
  claimWins = new Set()
  claimAttempts.length = 0
  reverts.length = 0
  addMock.mockClear()
  addMock.mockResolvedValue({})
})

describe("scanDueScheduledPosts", () => {
  it("enqueues only rows whose claim CAS was won (no double-enqueue)", async () => {
    dueRows = [{ id: "a" }, { id: "b" }]
    claimWins = new Set(["a"]) // "b" was claimed by another instance

    const n = await scanDueScheduledPosts()
    expect(n).toBe(1)
    expect(claimAttempts).toEqual(["a", "b"])
    expect(addMock).toHaveBeenCalledTimes(1)
    expect(addMock).toHaveBeenCalledWith("publish", { scheduledPostId: "a" })
  })

  it("reverts the claim when enqueue fails — fail-closed, retried next tick", async () => {
    dueRows = [{ id: "a" }]
    claimWins = new Set(["a"])
    addMock.mockRejectedValue(new Error("redis down"))

    const n = await scanDueScheduledPosts()
    expect(n).toBe(0)
    expect(reverts).toEqual(["a"])
  })

  it("no due rows -> no work", async () => {
    expect(await scanDueScheduledPosts()).toBe(0)
    expect(addMock).not.toHaveBeenCalled()
  })
})
