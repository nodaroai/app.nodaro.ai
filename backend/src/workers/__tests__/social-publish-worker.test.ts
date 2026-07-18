import { describe, it, expect, vi, beforeEach } from "vitest"
import { DelayedError, UnrecoverableError } from "bullmq"

// ---- mocks ------------------------------------------------------------------
let scheduledRow: Record<string, unknown> | null = null
const rowUpdates: Array<Record<string, unknown>> = []
const jobUpdates: Array<Record<string, unknown>> = []
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from(table: string) {
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        single: () =>
          Promise.resolve(
            table === "scheduled_posts" ? { data: scheduledRow } : { data: { id: "job-1" } },
          ),
        insert: () => b,
        update: (patch: Record<string, unknown>) => {
          if (table === "scheduled_posts") rowUpdates.push(patch)
          if (table === "jobs") jobUpdates.push(patch)
          return b
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      })
      return b
    },
  },
}))

let lockAvailable = true
const releaseMock = vi.fn()
vi.mock("../../services/social/connection-lock.js", () => ({
  acquireConnectionLock: async () => (lockAvailable ? "lock-token" : null),
  releaseConnectionLock: (...args: unknown[]) => releaseMock(...args),
}))

const executeMock = vi.fn()
vi.mock("../../services/social/execute-publish.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../services/social/execute-publish.js")>()
  return {
    NotConnectedError: orig.NotConnectedError,
    UnknownOutcomeError: orig.UnknownOutcomeError,
    executePublish: (...args: unknown[]) => executeMock(...args),
  }
})

vi.mock("../../services/social/media-refs.js", () => ({
  resolveMediaRefs: (refs: Array<{ type: string; r2Key: string }>) =>
    refs.map((r) => ({ type: r.type, url: `https://cdn.test/${r.r2Key}` })),
}))

const commitMock = vi.fn()
const refundMock = vi.fn()
vi.mock("../shared.js", () => ({
  commitJobCredits: (...args: unknown[]) => commitMock(...args),
  refundJobCredits: (...args: unknown[]) => refundMock(...args),
  isFinalJobAttempt: (job: { attemptsMade: number; opts?: { attempts?: number } }) =>
    job.attemptsMade + 1 >= (job.opts?.attempts ?? 1),
}))

vi.mock("../../lib/config.js", () => ({
  hasCredits: () => false, // keep the ee reserve path out of unit tests
  config: {},
}))

import { processScheduledPost } from "../social-publish-worker.js"
import { UnknownOutcomeError } from "../../services/social/execute-publish.js"
import { BadBodyError } from "../../services/social/providers/types.js"

function fakeJob(attemptsMade = 0) {
  return {
    data: { scheduledPostId: "sp-1" },
    attemptsMade,
    opts: { attempts: 3 },
    moveToDelayed: vi.fn(async () => {}),
  } as unknown as Parameters<typeof processScheduledPost>[0]
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sp-1",
    user_id: "u1",
    connection_id: "c1",
    platform: "prov",
    action: "post-image",
    payload: { caption: "hi" },
    media: [{ type: "photo", r2Key: "images/a.png" }],
    status: "queued",
    attempts: 0,
    job_id: null,
    ...overrides,
  }
}

beforeEach(() => {
  scheduledRow = null
  rowUpdates.length = 0
  jobUpdates.length = 0
  lockAvailable = true
  releaseMock.mockClear()
  executeMock.mockReset()
  commitMock.mockClear()
  refundMock.mockClear()
})

describe("processScheduledPost", () => {
  it("drops silently when the row is gone or no longer publishable", async () => {
    scheduledRow = null
    await processScheduledPost(fakeJob())
    scheduledRow = baseRow({ status: "canceled" })
    await processScheduledPost(fakeJob())
    expect(executeMock).not.toHaveBeenCalled()
    expect(rowUpdates).toHaveLength(0)
  })

  it("delays (no attempt consumed) when the connection lock is busy", async () => {
    scheduledRow = baseRow()
    lockAvailable = false
    const job = fakeJob()
    await expect(processScheduledPost(job, "tok")).rejects.toBeInstanceOf(DelayedError)
    expect((job as unknown as { moveToDelayed: ReturnType<typeof vi.fn> }).moveToDelayed).toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
  })

  it("publishes: resolves media refs, marks published, commits credits, releases lock", async () => {
    scheduledRow = baseRow()
    executeMock.mockResolvedValue({ connectionId: "c1", platformPostId: "pp", platformPostUrl: "https://x/pp" })

    await processScheduledPost(fakeJob())

    const req = (executeMock.mock.calls[0]![0] as { request: Record<string, unknown> }).request
    expect(req.mediaUrl).toBe("https://cdn.test/images/a.png")
    expect(rowUpdates.some((u) => u.status === "publishing")).toBe(true)
    expect(rowUpdates.some((u) => u.status === "published" && u.platform_post_id === "pp")).toBe(true)
    expect(commitMock).toHaveBeenCalled()
    expect(releaseMock).toHaveBeenCalledWith("c1", "lock-token")
  })

  it("BadBody -> row error, refund, UnrecoverableError (no BullMQ retry)", async () => {
    scheduledRow = baseRow()
    executeMock.mockRejectedValue(new BadBodyError("caption too long"))

    await expect(processScheduledPost(fakeJob())).rejects.toBeInstanceOf(UnrecoverableError)
    expect(rowUpdates.some((u) => u.status === "error" && u.last_error === "caption too long")).toBe(true)
    expect(refundMock).toHaveBeenCalled()
    expect(releaseMock).toHaveBeenCalled()
  })

  it("UnknownOutcome -> row error 'may have published', refund, NO retry", async () => {
    scheduledRow = baseRow()
    executeMock.mockRejectedValue(new UnknownOutcomeError("Publish outcome unknown — the post MAY have been published: timeout"))

    await expect(processScheduledPost(fakeJob())).rejects.toBeInstanceOf(UnrecoverableError)
    const errUpdate = rowUpdates.find((u) => u.status === "error")
    expect(String(errUpdate?.last_error)).toContain("MAY have been published")
  })

  it("generic pre-call failure -> refund attempt, row back to queued, rethrow for backoff", async () => {
    scheduledRow = baseRow()
    const boom = new Error("db hiccup")
    executeMock.mockRejectedValue(boom)

    await expect(processScheduledPost(fakeJob(0))).rejects.toBe(boom)
    expect(rowUpdates.some((u) => u.status === "queued" && u.last_error === "db hiccup")).toBe(true)
    expect(refundMock).toHaveBeenCalled()
  })

  it("generic failure on the FINAL attempt -> row error (not queued)", async () => {
    scheduledRow = baseRow()
    executeMock.mockRejectedValue(new Error("still down"))

    await expect(processScheduledPost(fakeJob(2))).rejects.toThrow("still down")
    expect(rowUpdates.some((u) => u.status === "error")).toBe(true)
    expect(rowUpdates.some((u) => u.status === "queued")).toBe(false)
  })
})
