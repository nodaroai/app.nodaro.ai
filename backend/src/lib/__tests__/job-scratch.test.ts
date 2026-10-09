import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Temporary provider uploads (decided 2026-10-09, independent review of the
 * expiry walk): a copy of the user's media made only so a provider can fetch
 * it is stored under the job's own scratch folder and deleted when the job
 * ends, on success or failure, through the storage-delete funnel.
 */

const h = vi.hoisted(() => ({
  status: { data: { status: "completed" } as unknown, error: null as unknown },
  listed: [] as Array<{ key: string; size?: number }>,
  listError: null as Error | null,
  storageConfigured: true,
  configThrows: false,
  uploadBufferToR2: vi.fn(),
  uploadFileWithKeyToR2: vi.fn(),
  deleteKeysRecordingFailures: vi.fn(),
  listObjectsByPrefixWithMeta: vi.fn(),
  selectCalls: 0,
  jobId: undefined as string | undefined,
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            h.selectCalls++
            return h.status
          },
        }),
      }),
    }),
  },
}))
vi.mock("../storage.js", () => ({
  isStorageConfigured: () => {
    if (h.configThrows) throw new Error("config read failed")
    return h.storageConfigured
  },
  listObjectsByPrefixWithMeta: h.listObjectsByPrefixWithMeta,
  uploadBufferToR2: h.uploadBufferToR2,
  uploadFileWithKeyToR2: h.uploadFileWithKeyToR2,
}))
vi.mock("../storage-delete.js", () => ({ deleteKeysRecordingFailures: h.deleteKeysRecordingFailures }))
vi.mock("../job-cancellation.js", () => ({ getJobId: () => h.jobId }))

import {
  discardJobScratch,
  jobScratchKey,
  jobScratchPrefix,
  JOB_SCRATCH_ROOT,
  uploadJobScratchBuffer,
  uploadJobScratchFile,
} from "../job-scratch.js"
import { isOwnedObjectKey } from "../job-policy-outputs.js"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const OTHER = "00000000-0000-4000-8000-0000000000bb"

beforeEach(() => {
  vi.clearAllMocks()
  h.status = { data: { status: "completed" }, error: null }
  h.listed = []
  h.listError = null
  h.storageConfigured = true
  h.configThrows = false
  h.selectCalls = 0
  h.jobId = undefined
  h.listObjectsByPrefixWithMeta.mockImplementation(async (prefix: string) => {
    if (h.listError) throw h.listError
    return h.listed.filter((o) => o.key.startsWith(prefix))
  })
  h.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
  h.uploadFileWithKeyToR2.mockImplementation(async (_p: string, key: string) => `https://cdn.test/${key}`)
  h.deleteKeysRecordingFailures.mockImplementation(async (keys: string[]) => ({ deleted: keys.length, errors: 0, notDeleted: [], kept: [], failed: [] }))
})

describe("the scratch key", () => {
  it("lives in the job's own scratch folder", () => {
    const key = jobScratchKey(JOB, "extend-tail", "mp4")
    expect(jobScratchPrefix(JOB)).toBe(`${JOB_SCRATCH_ROOT}${JOB}/`)
    expect(key.startsWith(jobScratchPrefix(JOB))).toBe(true)
    expect(key).toMatch(new RegExp(`^tmp/provider-input/${JOB}/extend-tail-[0-9a-f]{8}\\.mp4$`))
  })

  it("is new on every call (objects are served immutable: a url is never written twice)", () => {
    expect(jobScratchKey(JOB, "mask", "png")).not.toBe(jobScratchKey(JOB, "mask", "png"))
  })

  it("is never one of the job's outputs (the expiry walk and the policy gate must not take it for a deliverable)", () => {
    expect(isOwnedObjectKey(JOB, jobScratchKey(JOB, "mask", "png"))).toBe(false)
  })

  it("refuses a name or extension that could leave the folder", () => {
    expect(() => jobScratchKey(JOB, "../x", "png")).toThrow()
    expect(() => jobScratchKey(JOB, "a/b", "png")).toThrow()
    expect(() => jobScratchKey(JOB, "mask", "p/ng")).toThrow()
    expect(() => jobScratchPrefix("")).toThrow()
    expect(() => jobScratchPrefix("not/a-job")).toThrow()
  })
})

describe("the scratch writers", () => {
  it("store a buffer under the given job's folder, counted against no one's quota", async () => {
    const url = await uploadJobScratchBuffer(Buffer.from("x"), "mask", "png", "image/png", JOB)
    const [, key, type, trackUserId] = h.uploadBufferToR2.mock.calls[0]!
    expect(key.startsWith(jobScratchPrefix(JOB))).toBe(true)
    expect(type).toBe("image/png")
    expect(trackUserId).toBeUndefined()
    expect(url).toBe(`https://cdn.test/${key}`)
  })

  it("store a file under the given job's folder, counted against no one's quota", async () => {
    await uploadJobScratchFile("/tmp/tail.mp4", "extend-tail", "mp4", "video/mp4", JOB)
    const [path, key, type, trackUserId] = h.uploadFileWithKeyToR2.mock.calls[0]!
    expect(path).toBe("/tmp/tail.mp4")
    expect(key.startsWith(jobScratchPrefix(JOB))).toBe(true)
    expect(type).toBe("video/mp4")
    expect(trackUserId).toBeUndefined()
  })

  it("default to the running job (a provider deep in a handler is handed no job id)", async () => {
    h.jobId = OTHER
    await uploadJobScratchBuffer(Buffer.from("x"), "lip-sync-trimmed", "mp3", "audio/mpeg")
    expect(h.uploadBufferToR2.mock.calls[0]![1].startsWith(jobScratchPrefix(OTHER))).toBe(true)
  })

  it("outside a job, keep today's flat key (no job's end can reach it)", async () => {
    await uploadJobScratchBuffer(Buffer.from("x"), "provider-converted", "jpg", "image/jpeg")
    const key: string = h.uploadBufferToR2.mock.calls[0]![1]
    expect(key).toMatch(/^tmp\/provider-input\/provider-converted-[0-9a-f]{8}\.jpg$/)
  })
})

describe("discardJobScratch: when the job ends", () => {
  const mine = () => [
    { key: `${jobScratchPrefix(JOB)}extend-tail-aaaaaaaa.mp4`, size: 10 },
    { key: `${jobScratchPrefix(JOB)}extend-last-frame-bbbbbbbb.png`, size: 5 },
  ]

  it.each(["completed", "failed", "cancelled", "pending_review"])(
    "deletes everything in the job's folder through the funnel once the job is %s",
    async (status) => {
      h.status = { data: { status }, error: null }
      h.listed = [...mine(), { key: `${jobScratchPrefix(OTHER)}mask-cccccccc.png` }, { key: "tmp/provider-input/flat-dddddddd.jpg" }]
      await discardJobScratch(JOB)
      expect(h.listObjectsByPrefixWithMeta).toHaveBeenCalledWith(jobScratchPrefix(JOB))
      expect(h.deleteKeysRecordingFailures).toHaveBeenCalledWith(
        mine().map((o) => o.key),
        "job-scratch",
        expect.objectContaining({ jobIdOf: expect.any(Function) }),
      )
      const opts = h.deleteKeysRecordingFailures.mock.calls[0]![2] as { jobIdOf: (k: string) => string | null }
      expect(opts.jobIdOf(mine()[0]!.key)).toBe(JOB)
    },
  )

  it.each(["pending", "queued", "processing"])(
    "leaves the folder while the job is still %s (a retry, or a provider task still running, may need it)",
    async (status) => {
      h.status = { data: { status }, error: null }
      h.listed = mine()
      await discardJobScratch(JOB)
      expect(h.deleteKeysRecordingFailures).not.toHaveBeenCalled()
    },
  )

  it("leaves the folder when the job's status cannot be read", async () => {
    h.status = { data: null, error: { code: "500", message: "boom" } }
    h.listed = mine()
    await discardJobScratch(JOB)
    expect(h.deleteKeysRecordingFailures).not.toHaveBeenCalled()
  })

  it("an empty folder costs one listing and no database read", async () => {
    await discardJobScratch(JOB)
    expect(h.listObjectsByPrefixWithMeta).toHaveBeenCalledTimes(1)
    expect(h.selectCalls).toBe(0)
    expect(h.deleteKeysRecordingFailures).not.toHaveBeenCalled()
  })

  it("never deletes a listed key outside the folder (re-asserted before the delete)", async () => {
    h.listObjectsByPrefixWithMeta.mockResolvedValue([...mine(), { key: `${jobScratchPrefix(JOB)}`.slice(0, -1) + "-x/evil.png" }, { key: "videos/x.mp4" }])
    await discardJobScratch(JOB)
    expect(h.deleteKeysRecordingFailures.mock.calls[0]![0]).toEqual(mine().map((o) => o.key))
  })

  it("never throws: a failed listing or delete is logged, and a failed delete is recorded by the funnel", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    h.listError = new Error("list failed")
    await expect(discardJobScratch(JOB)).resolves.toBeUndefined()
    h.listError = null
    h.listed = mine()
    h.deleteKeysRecordingFailures.mockRejectedValueOnce(new Error("record failed"))
    await expect(discardJobScratch(JOB)).resolves.toBeUndefined()
    err.mockRestore()
  })

  it("never throws even when the storage check itself throws (it runs in the worker's finally)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    h.configThrows = true
    await expect(discardJobScratch(JOB)).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("is a no-op without object storage, and for a malformed job id", async () => {
    h.storageConfigured = false
    await discardJobScratch(JOB)
    h.storageConfigured = true
    await discardJobScratch("")
    await discardJobScratch("../videos")
    expect(h.listObjectsByPrefixWithMeta).not.toHaveBeenCalled()
  })
})
