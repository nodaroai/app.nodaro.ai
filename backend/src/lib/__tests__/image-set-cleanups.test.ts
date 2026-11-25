// @test-watches backend/src/lib/job-finalize.ts backend/src/lib/cancel-job.ts backend/src/routes/cancel-jobs.ts backend/src/workers/video-worker.ts backend/src/lib/mcp/tasks.ts backend/src/services/workflow-engine/node-executor.ts backend/src/lib/reconcile/cancel-inflight-jobs.ts
/**
 * A SET job's stored pictures (Kling Image 4.0) leave nothing behind when it
 * ends without a completion, and every clean-up of them gives each object's
 * bytes back once in all. The storage service does not honour a condition on
 * a delete (it answers success whoever deleted), so the one clean-up is
 * decided on the job row (`claim_job_set_discard`, migration 704): only its
 * winner deletes and gives back; a loser does nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const mocks = vi.hoisted(() => ({
  objects: new Map<string, number>(),
  usage: [] as number[],
  row: { value: null as null | Record<string, unknown> },
  // The row's clean-up mark, as the claim function keeps it.
  mark: { value: null as null | { claimedAt: number; doneAt?: number } },
  now: { ms: 1_000_000 },
  claimMissing: { on: false },
  claimError: { on: false },
  finishError: { on: false },
  // Called on every read of a key (to make a store happen mid-clean-up).
  onHead: { fn: null as null | ((key: string) => void) },
  rowUnreadable: { on: false },
  selects: [] as string[],
  deleted: [] as string[],
  recorded: [] as string[],
}))
vi.mock("../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage.js")>()),
  getR2ObjectSize: async (key: string) => mocks.objects.get(key) ?? 0,
  headR2Object: async (key: string) => {
    await Promise.resolve()
    const size = mocks.objects.get(key)
    mocks.onHead.fn?.(key)
    return size !== undefined ? { exists: true, sizeBytes: size, etag: "e" } : { exists: false }
  },
}))
// The real service: a delete always answers success, whoever deleted the object.
vi.mock("../storage-delete.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage-delete.js")>()),
  deleteKeysRecordingFailures: async (keys: readonly string[]) => {
    await Promise.resolve()
    for (const key of keys) {
      mocks.objects.delete(key)
      mocks.deleted.push(key)
    }
    return { deleted: keys.length, notDeleted: [], failed: [] }
  },
  recordFailedDeletes: async (files: ReadonlyArray<{ key: string }>) => {
    for (const f of files) mocks.recorded.push(f.key)
    return { recorded: files.length, unavailable: false }
  },
}))
vi.mock("../../utils/file-validation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/file-validation.js")>()),
  updateStorageUsage: async (_u: string, delta: number) => { mocks.usage.push(delta) },
}))
const STALE_MS = 15 * 60_000
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        mocks.selects.push(cols)
        const answer = async () => (mocks.rowUnreadable.on ? { data: null, error: { code: "57014", message: "statement timeout" } } : { data: mocks.row.value, error: null })
        return { eq: () => ({ maybeSingle: answer, single: answer }) }
      },
    }),
    // The claim, as migration 704 decides it: one winner while a claim is live.
    rpc: async (fn: string, args: { p_statuses?: string[]; p_claimed_at?: string }) => {
      await Promise.resolve()
      if (mocks.claimMissing.on) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
      if (mocks.claimError.on) return { data: null, error: { code: "57014", message: "statement timeout" } }
      if (fn === "claim_job_set_discard") {
        const status = String(mocks.row.value?.status)
        if (!args.p_statuses?.includes(status)) return { data: null, error: null }
        const m = mocks.mark.value
        if (m && m.doneAt === undefined && m.claimedAt >= mocks.now.ms - STALE_MS) return { data: null, error: null }
        mocks.mark.value = { claimedAt: mocks.now.ms }
        return { data: String(mocks.now.ms), error: null }
      }
      if (fn === "finish_job_set_discard" && mocks.finishError.on) return { data: null, error: { code: "57014", message: "statement timeout" } }
      if (fn === "finish_job_set_discard") {
        if (mocks.mark.value && String(mocks.mark.value.claimedAt) === args.p_claimed_at) {
          mocks.mark.value = { ...mocks.mark.value, doneAt: mocks.now.ms }
          return { data: true, error: null }
        }
        return { data: false, error: null }
      }
      return { data: null, error: null }
    },
  },
}))

import { discardEndedSetImages, discardSetKeys, resetMissingClaimLogForTests, setStoreLimit, SET_DISCARD_DEADLINE, SET_DISCARD_RETRY } from "../image-set-storage.js"
import { deleteOwnedObjects } from "../job-policy-outputs.js"
import { discardOwnedKeys } from "../discard-job-copies.js"

const SET_ROW = { user_id: "u1", setHoldCreditId: "kling-image-4:2K:x2" }
const stored = () => {
  mocks.objects.set(`images/${JOB}.png`, 100)
  mocks.objects.set(`images/${JOB}-v1.png`, 50)
}
const given = () => 0 - mocks.usage.reduce((n, x) => n + x, 0) || 0

beforeEach(() => {
  mocks.objects.clear()
  mocks.usage.length = 0
  mocks.selects.length = 0
  mocks.deleted.length = 0
  mocks.recorded.length = 0
  mocks.mark.value = null
  mocks.claimMissing.on = false
  mocks.claimError.on = false
  mocks.finishError.on = false
  SET_DISCARD_DEADLINE.ms = 5 * 60_000
  resetMissingClaimLogForTests()
  mocks.onHead.fn = null
  // Short waits for a loser's retries.
  SET_DISCARD_RETRY.waitMs = 1
  mocks.rowUnreadable.on = false
  mocks.now.ms = 1_000_000
})

describe("one clean-up per set, decided on the job row", () => {
  it("three clean-ups racing on one set (funnel, gate block, fence) give each key back once", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "failed" }
    const objects = [{ key: `images/${JOB}.png` }, { key: `images/${JOB}-v1.png` }]
    await Promise.all([
      discardEndedSetImages(JOB),
      deleteOwnedObjects(JOB, objects as never, { refundOwner: true }),
      discardOwnedKeys(JOB, "u1", objects.map((o) => o.key)),
    ])
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(150)
    expect(mocks.mark.value?.doneAt).toBeDefined()
  })

  it("a loser deletes nothing and gives nothing back; on an ended row it leaves its keys to the retry pass", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "failed" }
    mocks.mark.value = { claimedAt: mocks.now.ms }
    expect(await discardSetKeys(JOB, "u1", [`images/${JOB}.png`])).toBe(0)
    expect(mocks.deleted).toEqual([])
    expect(given()).toBe(0)
    expect(mocks.recorded).toContain(`images/${JOB}.png`)
  })

  it("a clean 'not the winner' on a row that has not ended does nothing at all", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "completed" }
    mocks.mark.value = { claimedAt: mocks.now.ms }
    expect(await discardSetKeys(JOB, "u1", [`images/${JOB}-v1.png`], { statuses: ["completed"] })).toBe(0)
    expect(mocks.deleted).toEqual([])
    expect(mocks.recorded).toEqual([])
  })

  it("an ended-statuses call on a row that has not ended (completed) records nothing and deletes nothing", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "completed" }
    expect(await discardSetKeys(JOB, "u1", [`images/${JOB}.png`])).toBe(0)
    expect(mocks.deleted).toEqual([])
    expect(mocks.recorded).toEqual([])
    expect(mocks.objects.size).toBe(2)
  })

  it("a clean-up past its deadline stops: claim left unfinished, nothing given back, the rest left to the retry pass", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "failed" }
    SET_DISCARD_DEADLINE.ms = -1
    await discardEndedSetImages(JOB)
    expect(given()).toBe(0)
    expect(mocks.mark.value?.doneAt).toBeUndefined()
    expect(mocks.recorded.length).toBeGreaterThan(0)
    expect(mocks.recorded).toContain(`images/${JOB}.png`)
  })

  it("a finish that errors gives nothing back", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "failed" }
    mocks.finishError.on = true
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await discardEndedSetImages(JOB)
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(0)
  })

  it("a claim error deletes the pictures with nothing given back", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "failed" }
    mocks.claimError.on = true
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await discardEndedSetImages(JOB)
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(0)
  })

  it("a winner whose claim was taken over (it ran past the stale window) gives nothing back", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "failed" }
    // While it reads, another clean-up takes the claim over.
    mocks.onHead.fn = () => { mocks.mark.value = { claimedAt: mocks.now.ms + 1 } }
    await discardEndedSetImages(JOB)
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(0)
  })

  it("a cancel racing a finalize: the still the canceller read as absent ends deleted, given back at most once", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "cancelled" }
    const still = `images/${JOB}-still.png`
    // The canceller's clean-up reads the still as absent; the finalize stores it right after.
    mocks.onHead.fn = (key) => {
      if (key === still && !mocks.objects.has(still)) {
        mocks.onHead.fn = null
        setTimeout(() => mocks.objects.set(still, 30), 0)
      }
    }
    const canceller = discardEndedSetImages(JOB)
    await new Promise((r) => setTimeout(r, 5))
    // The finalize's own clean-up (its fence) runs while the canceller's holds the claim.
    const finalize = discardSetKeys(JOB, "u1", [still])
    await Promise.all([canceller, finalize])
    expect(mocks.objects.has(still)).toBe(false)
    expect(given()).toBeLessThanOrEqual(180)
    expect(given()).toBeGreaterThanOrEqual(150)
  })

  it("a claim never finished and past the stale window is taken over", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "cancelled" }
    mocks.mark.value = { claimedAt: mocks.now.ms - STALE_MS - 1 }
    await discardEndedSetImages(JOB)
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(150)
  })

  it("without the claim function (staging ahead of the database): pictures deleted, nothing given back", { timeout: 60_000 }, async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "failed" }
    mocks.claimMissing.on = true
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await discardEndedSetImages(JOB)
    await deleteOwnedObjects(JOB, [{ key: `images/${JOB}.png` }] as never, { refundOwner: true })
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(0)
    // The missing function is said once (the log flag was reset before this test).
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("not on this database yet")).length).toBe(1)
  })

  it("a row that cannot be read: another job's files are handled as always (given back)", { timeout: 60_000 }, async () => {
    mocks.objects.set(`videos/${JOB}.mp4`, 70)
    mocks.rowUnreadable.on = true
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await discardOwnedKeys(JOB, "u1", [`videos/${JOB}.mp4`])
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(70)
  })

  it("a row that cannot be read: what may be a set's pictures goes, nothing is given back", { timeout: 60_000 }, async () => {
    stored()
    mocks.rowUnreadable.on = true
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await deleteOwnedObjects(JOB, [{ key: `images/${JOB}.png` }] as never, { refundOwner: true })
    await discardOwnedKeys(JOB, "u1", [`images/${JOB}-v1.png`])
    expect(mocks.objects.size).toBe(0)
    expect(given()).toBe(0)
  })

  it("a completed set, or a job that is not a set, is left alone", async () => {
    stored()
    mocks.row.value = { ...SET_ROW, status: "completed" }
    await discardEndedSetImages(JOB)
    mocks.row.value = { user_id: "u1", status: "failed", setHoldCreditId: null }
    await discardEndedSetImages(JOB)
    expect(mocks.objects.size).toBe(2)
    expect(given()).toBe(0)
  })

  it("reads only the fields it needs", async () => {
    mocks.row.value = { ...SET_ROW, status: "completed" }
    await discardEndedSetImages(JOB)
    expect(mocks.selects[0]).toBe("status, user_id, setHoldCreditId:input_data->>setHoldCreditId")
  })
})

describe("a set stores at most the pictures its hold was taken for", () => {
  it("the limit is the hold's count, the largest set when it does not say", () => {
    expect(setStoreLimit("kling-image-4:2K:x2")).toBe(2)
    expect(setStoreLimit("kling-image-4-i2i:2K:1ref:x6")).toBe(6)
    expect(setStoreLimit("kling-image-4:2K")).toBe(10)
    expect(setStoreLimit(undefined)).toBe(10)
  })

  it("the finalize stores only that many of what the provider returned", () => {
    const src = readFileSync(join(__dirname, "..", "job-finalize.ts"), "utf8")
    expect(src).toContain("returned.slice(0, setStoreLimit(job.input_data?.setHoldCreditId))")
  })
})

describe("every cancel writer and the worker's missed failure write clean a set up", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8")
  it.each([
    ["lib/cancel-job.ts", /discardEndedSetImages\(jobId\)/],
    ["routes/cancel-jobs.ts", /discardEndedSetImages\(id\)/],
    ["lib/mcp/tasks.ts", /discardEndedSetImages\(jobId\)/],
    ["services/workflow-engine/node-executor.ts", /discardEndedSetImages\(jobId\)/],
    ["lib/reconcile/cancel-inflight-jobs.ts", /discardEndedSetImages\(id\)/],
    ["workers/video-worker.ts", /if \(!flipped\) await \(await import\("\.\.\/lib\/image-set-storage\.js"\)\)\.discardEndedSetImages\(jobId\)/],
    ["lib/job-failure.ts", /discardEndedSetImages\(jobId\)/],
  ])("%s", (file, call) => {
    expect(read(file)).toMatch(call)
  })
})
