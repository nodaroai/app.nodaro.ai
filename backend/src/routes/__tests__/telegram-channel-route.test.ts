import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The feed route owns the position (PR 2, decided 2026-10-05). These pin:
 *   - the output_data contract — a sync-HTTP route that returns a `jobId` sends
 *     the orchestrator down its job-POLLING branch, where the node's output is
 *     rebuilt from the jobs row, so the posts (json / listResults) and the
 *     digest (text / generatedText) must live in `output_data`;
 *   - the cursor rule end to end: a stateless call, the editor's legacy seed,
 *     the first stateful run (bootstrap), a drain, a peek that never writes,
 *     a second page, and the user-scoped reset;
 *   - nothing new is not charged; posts are.
 */

/** Every `.update()` payload written to `jobs`, in order. */
let jobUpdates: ReadonlyArray<Record<string, unknown>> = []

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        jobUpdates = [...jobUpdates, patch]
        const chain = { eq: () => chain, then: undefined }
        return Object.assign(Promise.resolve({ error: null }), chain)
      },
    }),
  },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: async () => ({ usageLogId: "usage-1" }),
}))

const commitReservedCreditsForJob = vi.fn(async (_jobId: string) => {})
const refundReservedCreditsForJob = vi.fn(async (_jobId: string) => 0)
vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: (jobId: string) => commitReservedCreditsForJob(jobId),
  refundReservedCreditsForJob: (jobId: string) => refundReservedCreditsForJob(jobId),
}))

/** The mocked `node_cursors` store, keyed workflow:node:user. */
let cursors: Record<string, { value: number; updatedAt: string }> = {}
const cursorKey = (wf: string | undefined, node: string, user: string) => `${wf}:${node}:${user}`
const readNodeCursor = vi.fn(async (wf: string | undefined, node: string, user: string) => cursors[cursorKey(wf, node, user)]?.value)
const readNodeCursorRow = vi.fn(async (wf: string | undefined, node: string, user: string) => cursors[cursorKey(wf, node, user)])
const writeNodeCursor = vi.fn(async (wf: string | undefined, node: string, user: string, _kind: string, value: number) => {
  cursors = { ...cursors, [cursorKey(wf, node, user)]: { value, updatedAt: "2026-10-06T12:00:00Z" } }
})
const resetNodeCursor = vi.fn(async (wf: string, node: string, user: string) => {
  const key = cursorKey(wf, node, user)
  const had = key in cursors
  const next = { ...cursors }
  delete next[key]
  cursors = next
  return had
})
vi.mock("../../services/workflow-engine/node-cursor.js", () => ({
  readNodeCursor: (...a: [string | undefined, string, string]) => readNodeCursor(...a),
  readNodeCursorRow: (...a: [string | undefined, string, string]) => readNodeCursorRow(...a),
  writeNodeCursor: (...a: [string | undefined, string, string, string, number]) => writeNodeCursor(...a),
  resetNodeCursor: (...a: [string, string, string]) => resetNodeCursor(...a),
}))

type Post = { id: number; channel: string; postUrl: string; text: string; media: unknown[] }
const post = (id: number, text = `post ${id}`): Post => ({ id, channel: "acme", postUrl: `https://t.me/acme/${id}`, text, media: [] })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => post(from + i))

/** What the channel holds (ids ascending); `fetchChannelPosts(channel, { after })` pages over it like t.me/s does (20 per page). */
let channelPosts: Post[] = [post(10, "first post"), post(11, "second post")]
const fetchCalls: Array<{ channel: string; after?: number }> = []
const fetchChannelPosts = vi.fn(async (channel: string, opts: { after?: number } = {}) => {
  fetchCalls.push({ channel, ...(opts.after !== undefined ? { after: opts.after } : {}) })
  const sorted = [...channelPosts].sort((a, b) => a.id - b.id)
  if (opts.after === undefined) return sorted.slice(-20)
  return sorted.filter((p) => p.id > opts.after!).slice(0, 20)
})
/** The highest id the fetched page rendered (unreadable posts included); undefined = the last post returned. */
const pageMaxId = { value: undefined as number | undefined }
vi.mock("../../services/social/telegram-channel.js", () => ({
  fetchChannelPosts: (channel: string, opts?: { after?: number }) => fetchChannelPosts(channel, opts),
  fetchChannelPage: async (channel: string, opts?: { after?: number }) => {
    const posts = await fetchChannelPosts(channel, opts)
    return { posts, maxSeenId: pageMaxId.value ?? (posts.length > 0 ? posts[posts.length - 1]!.id : undefined) }
  },
  normalizeChannel: (c: string) => (c.startsWith("@") || /^[a-z0-9_]+$/i.test(c) ? c.replace("@", "") : null),
}))

/** The workflow's owner (the position's row) and who is calling. */
const owner = { id: "user-1" as string | undefined }
const caller = { id: "user-1", authKind: "jwt" }
vi.mock("../../services/social/telegram-feed-position.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/social/telegram-feed-position.js")>()),
  workflowOwnerId: async () => owner.id,
}))

import { telegramChannelRoutes } from "../telegram-channel.js"
import { clearJobPolicies, registerJobPolicy } from "../../lib/job-policy.js"

let app: FastifyInstance
const WF = "11111111-1111-4111-8111-111111111111"

beforeEach(async () => {
  jobUpdates = []
  cursors = {}
  channelPosts = [post(10, "first post"), post(11, "second post")]
  fetchCalls.length = 0
  commitReservedCreditsForJob.mockClear()
  refundReservedCreditsForJob.mockClear()
  writeNodeCursor.mockClear()
  resetNodeCursor.mockClear()
  fetchChannelPosts.mockClear()
  pageMaxId.value = undefined
  owner.id = "user-1"
  caller.id = "user-1"
  caller.authKind = "jwt"
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    ;(req as { userId?: string }).userId = caller.id
    ;(req as { authKind?: string }).authKind = caller.authKind
  })
  await app.register(telegramChannelRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const fetch = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/telegram-channel/fetch", payload })
const completion = () => jobUpdates.find((u) => u.status === "completed")?.output_data as Record<string, unknown> | undefined

describe("POST /v1/telegram-channel/fetch", () => {
  it("writes the posts, their digest and one item per post into output_data, and returns a jobId (the poll branch)", async () => {
    const res = await fetch({ channel: "@somechannel", limit: 5 })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.count).toBe(2)
    const out = completion()
    expect(out).toBeDefined()
    expect(out!.text).toBe("first post\n\n---\n\nsecond post")
    expect(out!.generatedText).toBe(out!.text)
    expect(out!.json).toEqual([post(10, "first post"), post(11, "second post")])
    expect(out!.listResults).toEqual([JSON.stringify(post(10, "first post")), JSON.stringify(post(11, "second post"))])
    expect(out!.count).toBe(2)
  })

  it("a stateless call (no workflowId / nodeId): the newest N, nothing stored, the editor keeps its own seed", async () => {
    channelPosts = range(100, 130)
    const res = await fetch({ channel: "acme", limit: 5 })
    const body = res.json()
    expect(body.posts.map((p: Post) => p.id)).toEqual([126, 127, 128, 129, 130])
    expect(body.latestId).toBe(130)
    expect(body.cursor).toEqual({ lastSeenId: null, advanced: true, mode: "poll", stateful: false })
    expect(writeNodeCursor).not.toHaveBeenCalled()
  })

  it("a stateless call with the editor's legacy seed pages forward from it", async () => {
    channelPosts = range(100, 130)
    const res = await fetch({ channel: "acme", limit: 5, sinceId: 120 })
    expect(fetchCalls).toEqual([{ channel: "acme", after: 120 }])
    expect(res.json().posts.map((p: Post) => p.id)).toEqual([121, 122, 123, 124, 125])
    expect(res.json().latestId).toBe(125)
  })

  it("first stateful run (nothing stored): the newest N, and the position jumps to the newest post", async () => {
    channelPosts = range(100, 130)
    const res = await fetch({ channel: "acme", limit: 5, workflowId: WF, nodeId: "feed-1" })
    expect(res.json().posts.map((p: Post) => p.id)).toEqual([126, 127, 128, 129, 130])
    // Under the owner's row, keyed by node AND channel.
    expect(writeNodeCursor).toHaveBeenCalledWith(WF, "feed-1#acme", "user-1", "telegram-channel-feed", 130)
    expect(res.json().cursor).toEqual({ lastSeenId: 130, advanced: true, mode: "poll", stateful: true })
    expect(completion()!.cursor).toEqual(res.json().cursor)
  })

  it("a stored position wins over the body's seed: the OLDEST N above it, and the position is the highest post emitted (a backlog drains N per run)", async () => {
    channelPosts = range(100, 130)
    cursors = { [cursorKey(WF, "feed-1", "user-1")]: { value: 110, updatedAt: "2026-10-06T10:00:00Z" } }
    const res = await fetch({ channel: "acme", limit: 5, workflowId: WF, nodeId: "feed-1", sinceId: 125 })
    expect(fetchCalls[0]).toEqual({ channel: "acme", after: 110 })
    expect(res.json().posts.map((p: Post) => p.id)).toEqual([111, 112, 113, 114, 115])
    // The stored position was written before channels keyed them: it is carried over to the channel's key, then moved.
    expect(writeNodeCursor).toHaveBeenCalledWith(WF, "feed-1#acme", "user-1", "telegram-channel-feed", 110)
    expect(writeNodeCursor).toHaveBeenCalledWith(WF, "feed-1#acme", "user-1", "telegram-channel-feed", 115)
    expect(resetNodeCursor).toHaveBeenCalledWith(WF, "feed-1", "user-1")
    expect(res.json().cursor).toMatchObject({ lastSeenId: 115, advanced: true })
    // The next run continues where this one stopped.
    const next = await fetch({ channel: "acme", limit: 5, workflowId: WF, nodeId: "feed-1" })
    expect(next.json().posts.map((p: Post) => p.id)).toEqual([116, 117, 118, 119, 120])
  })

  it("a full first page short of the limit fetches a second page — two pages at most", async () => {
    channelPosts = range(100, 160)
    cursors = { [cursorKey(WF, "feed-1", "user-1")]: { value: 100, updatedAt: "x" } }
    const res = await fetch({ channel: "acme", limit: 25, workflowId: WF, nodeId: "feed-1" })
    expect(fetchCalls).toEqual([{ channel: "acme", after: 100 }, { channel: "acme", after: 120 }])
    expect(res.json().count).toBe(25)
    expect(res.json().latestId).toBe(125)
  })

  it("nothing new: an empty page, count 0, the position stays, the reservation is refunded and nothing is committed", async () => {
    channelPosts = range(100, 110)
    cursors = { [cursorKey(WF, "feed-1#acme", "user-1")]: { value: 110, updatedAt: "x" } }
    const res = await fetch({ channel: "acme", limit: 5, workflowId: WF, nodeId: "feed-1" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ count: 0, text: "", latestId: 110, cursor: { lastSeenId: 110, advanced: false } })
    expect(completion()).toMatchObject({ count: 0, text: "", json: [] })
    expect(writeNodeCursor).not.toHaveBeenCalled()
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a fetch with posts commits the reservation", async () => {
    await fetch({ channel: "@somechannel", limit: 5 })
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("peek: the newest N, never reads or moves the position, still charged", async () => {
    channelPosts = range(100, 130)
    cursors = { [cursorKey(WF, "feed-1", "user-1")]: { value: 110, updatedAt: "x" } }
    const res = await fetch({ channel: "acme", limit: 3, mode: "peek", workflowId: WF, nodeId: "feed-1" })
    expect(fetchCalls).toEqual([{ channel: "acme" }])
    expect(res.json().posts.map((p: Post) => p.id)).toEqual([128, 129, 130])
    expect(res.json().cursor).toEqual({ lastSeenId: null, advanced: false, mode: "peek", stateful: true })
    expect(res.json().latestId).toBeNull()
    expect(writeNodeCursor).not.toHaveBeenCalled()
    expect(cursors[cursorKey(WF, "feed-1", "user-1")]!.value).toBe(110)
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  it("rejects an invalid channel before creating a job, and a limit above the cap", async () => {
    const bad = await fetch({ channel: "bad name!" })
    expect(bad.statusCode).toBe(400)
    expect(jobUpdates).toHaveLength(0)
    expect(fetchChannelPosts).not.toHaveBeenCalled()
    const tooMany = await fetch({ channel: "acme", limit: 31 })
    expect(tooMany.statusCode).toBe(400)
  })

  it("a channel error is a 400 with the scraper's message, the job fails and the reservation is refunded", async () => {
    fetchChannelPosts.mockRejectedValueOnce(new Error('Channel "acme" is private, doesn\'t exist, or has its web preview disabled'))
    const res = await fetch({ channel: "acme" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("channel_error")
    expect(jobUpdates.find((u) => u.status === "failed")).toBeDefined()
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  it("answers 422 job_blocked and never fetches the channel", async () => {
    registerJobPolicy({
      id: "test-deny-all",
      checkRequest: () => ({ verdict: "block", reason: "test:denied", userMessage: "Not allowed here" }),
    })
    try {
      const res = await fetch({ channel: "@somechannel" })
      expect(res.statusCode).toBe(422)
      expect(res.json()).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })
      expect(fetchChannelPosts).not.toHaveBeenCalled()
    } finally {
      clearJobPolicies()
    }
  })
})

describe("whose position a fetch reads and moves", () => {
  it("a collaborator's editor Run reads the feed statelessly — the owner's position is neither read nor moved", async () => {
    channelPosts = range(100, 130)
    cursors = { [cursorKey(WF, "feed-1#acme", "user-1")]: { value: 110, updatedAt: "x" } }
    caller.id = "user-2"
    const res = await fetch({ channel: "acme", limit: 5, workflowId: WF, nodeId: "feed-1" })
    expect(res.statusCode).toBe(200)
    expect(res.json().posts.map((p: Post) => p.id)).toEqual([126, 127, 128, 129, 130])
    expect(writeNodeCursor).not.toHaveBeenCalled()
    expect(res.json().cursor).toMatchObject({ stateful: false, lastSeenId: null })
    expect(cursors[cursorKey(WF, "feed-1#acme", "user-1")]?.value).toBe(110)
  })

  it("the orchestrator's call moves the OWNER's position whoever runs the workflow (a published app's runner)", async () => {
    channelPosts = range(100, 130)
    cursors = { [cursorKey(WF, "feed-1#acme", "user-1")]: { value: 110, updatedAt: "x" } }
    caller.id = "runner-7"
    caller.authKind = "internal"
    const res = await fetch({ channel: "acme", limit: 5, workflowId: WF, nodeId: "feed-1" })
    expect(res.json().posts.map((p: Post) => p.id)).toEqual([111, 112, 113, 114, 115])
    expect(writeNodeCursor).toHaveBeenCalledWith(WF, "feed-1#acme", "user-1", "telegram-channel-feed", 115)
  })

  it("the position is per channel: another channel on the same node starts fresh, and the first channel's stays", async () => {
    channelPosts = range(100, 130)
    cursors = { [cursorKey(WF, "feed-1#acme", "user-1")]: { value: 110, updatedAt: "x" } }
    await fetch({ channel: "other", limit: 5, workflowId: WF, nodeId: "feed-1" })
    expect(fetchCalls[0]).toEqual({ channel: "other" })
    expect(writeNodeCursor).toHaveBeenCalledWith(WF, "feed-1#other", "user-1", "telegram-channel-feed", 130)
    expect(cursors[cursorKey(WF, "feed-1#acme", "user-1")]?.value).toBe(110)
  })

  it("posts with nothing to read above the position move it past them — uncharged, and the next tick is not stuck on them", async () => {
    channelPosts = range(100, 110)
    pageMaxId.value = 130
    cursors = { [cursorKey(WF, "feed-1#acme", "user-1")]: { value: 110, updatedAt: "x" } }
    const res = await fetch({ channel: "acme", limit: 5, workflowId: WF, nodeId: "feed-1" })
    expect(res.json().count).toBe(0)
    expect(writeNodeCursor).toHaveBeenCalledWith(WF, "feed-1#acme", "user-1", "telegram-channel-feed", 130)
    expect(refundReservedCreditsForJob).toHaveBeenCalled()
  })
})

describe("the position routes (UI only)", () => {
  it("GET /cursor with the channel reads the channel's position, else the one from before channels keyed positions", async () => {
    cursors = {
      [cursorKey(WF, "feed-1", "user-1")]: { value: 90, updatedAt: "legacy" },
      [cursorKey(WF, "feed-1#acme", "user-1")]: { value: 130, updatedAt: "keyed" },
    }
    const keyed = await app.inject({ method: "GET", url: `/v1/telegram-channel/cursor?workflowId=${WF}&nodeId=feed-1&channel=acme` })
    expect(keyed.json()).toEqual({ data: { lastSeenId: 130, updatedAt: "keyed" } })
    const other = await app.inject({ method: "GET", url: `/v1/telegram-channel/cursor?workflowId=${WF}&nodeId=feed-1&channel=other` })
    expect(other.json()).toEqual({ data: { lastSeenId: 90, updatedAt: "legacy" } })
  })

  it("POST /cursor/reset with the channel forgets that channel's position and the legacy one", async () => {
    cursors = {
      [cursorKey(WF, "feed-1", "user-1")]: { value: 90, updatedAt: "x" },
      [cursorKey(WF, "feed-1#acme", "user-1")]: { value: 130, updatedAt: "x" },
    }
    const res = await app.inject({ method: "POST", url: "/v1/telegram-channel/cursor/reset", payload: { workflowId: WF, nodeId: "feed-1", channel: "acme" } })
    expect(res.json()).toEqual({ data: { ok: true, deleted: true } })
    expect(cursors).toEqual({})
  })

  it("GET /cursor returns the user's stored position, or null", async () => {
    const none = await app.inject({ method: "GET", url: `/v1/telegram-channel/cursor?workflowId=${WF}&nodeId=feed-1` })
    expect(none.json()).toEqual({ data: { lastSeenId: null, updatedAt: null } })
    cursors = { [cursorKey(WF, "feed-1", "user-1")]: { value: 130, updatedAt: "2026-10-06T10:00:00Z" } }
    const some = await app.inject({ method: "GET", url: `/v1/telegram-channel/cursor?workflowId=${WF}&nodeId=feed-1` })
    expect(some.json()).toEqual({ data: { lastSeenId: 130, updatedAt: "2026-10-06T10:00:00Z" } })
    const bad = await app.inject({ method: "GET", url: `/v1/telegram-channel/cursor?workflowId=not-a-uuid&nodeId=feed-1` })
    expect(bad.statusCode).toBe(400)
  })

  it("POST /cursor/reset forgets the user's own position and says whether there was one", async () => {
    cursors = { [cursorKey(WF, "feed-1", "user-1")]: { value: 130, updatedAt: "x" } }
    const res = await app.inject({ method: "POST", url: "/v1/telegram-channel/cursor/reset", payload: { workflowId: WF, nodeId: "feed-1" } })
    expect(res.json()).toEqual({ data: { ok: true, deleted: true } })
    expect(resetNodeCursor).toHaveBeenCalledWith(WF, "feed-1", "user-1")
    const again = await app.inject({ method: "POST", url: "/v1/telegram-channel/cursor/reset", payload: { workflowId: WF, nodeId: "feed-1" } })
    expect(again.json()).toEqual({ data: { ok: true, deleted: false } })
  })
})
