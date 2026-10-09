import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A run that fails after copying files into its own job's family discards
 * them (independent review round): only a completed job's output names them,
 * and expiry finds a job's files through its output, so nothing else would.
 */

const h = vi.hoisted(() => ({
  status: { data: { status: "processing" } as unknown, error: null as unknown },
  deleteKeysRecordingFailures: vi.fn(),
  getR2ObjectSize: vi.fn(),
  updateStorageUsage: vi.fn(),
  selectCalls: 0,
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
  getR2ObjectSize: h.getR2ObjectSize,
  r2KeyFromOurUrl: (url: string) => (url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null),
}))
vi.mock("../storage-delete.js", () => ({ deleteKeysRecordingFailures: h.deleteKeysRecordingFailures }))
vi.mock("../../utils/file-validation.js", () => ({ updateStorageUsage: h.updateStorageUsage }))

import { discardFailedRunCopies } from "../discard-job-copies.js"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const REF = `https://cdn.test/videos/${JOB}-raw-ref.mov`
const RAW = `https://cdn.test/videos/${JOB}-raw.mov`

beforeEach(() => {
  vi.clearAllMocks()
  h.status = { data: { status: "processing" }, error: null }
  h.selectCalls = 0
  h.getR2ObjectSize.mockResolvedValue(100)
  h.deleteKeysRecordingFailures.mockImplementation(async (keys: string[]) => ({ deleted: keys.length, errors: 0, notDeleted: [], failed: [] }))
  h.updateStorageUsage.mockResolvedValue(undefined)
})

describe("discardFailedRunCopies", () => {
  it("deletes the run's copies through the funnel, and gives their bytes back to the user's quota", async () => {
    await discardFailedRunCopies(JOB, "user-1", [REF, RAW])

    expect(h.deleteKeysRecordingFailures).toHaveBeenCalledWith(
      [`videos/${JOB}-raw-ref.mov`, `videos/${JOB}-raw.mov`],
      "job-output",
      expect.objectContaining({ jobIdOf: expect.any(Function) }),
    )
    expect(h.updateStorageUsage).toHaveBeenCalledWith("user-1", -200)
  })

  it("gives back only the bytes of what storage confirmed gone (a failure is recorded for the retry)", async () => {
    h.deleteKeysRecordingFailures.mockResolvedValue({
      deleted: 1,
      errors: 1,
      notDeleted: [`videos/${JOB}-raw.mov`],
      failed: [`videos/${JOB}-raw.mov`],
    })
    await discardFailedRunCopies(JOB, "user-1", [REF, RAW])
    expect(h.updateStorageUsage).toHaveBeenCalledWith("user-1", -100)
  })

  it("never takes a file from a job that completed (a re-run after its completion names the same keys)", async () => {
    h.status = { data: { status: "completed" }, error: null }
    await discardFailedRunCopies(JOB, "user-1", [REF, RAW])
    expect(h.deleteKeysRecordingFailures).not.toHaveBeenCalled()
  })

  it("deletes nothing when the job's state cannot be read", async () => {
    h.status = { data: null, error: { message: "boom" } }
    await discardFailedRunCopies(JOB, "user-1", [REF])
    expect(h.deleteKeysRecordingFailures).not.toHaveBeenCalled()
  })

  it("only ever touches the job's own family on our storage — never a foreign url or another job's file", async () => {
    await discardFailedRunCopies(JOB, "user-1", [
      undefined,
      "https://kie.example.com/x.mov",
      "https://cdn.test/videos/00000000-0000-4000-8000-0000000000bb-raw.mov",
      REF,
    ])
    expect(h.deleteKeysRecordingFailures).toHaveBeenCalledWith([`videos/${JOB}-raw-ref.mov`], "job-output", expect.anything())
  })

  it("asks nothing when there is nothing of its own to discard", async () => {
    await discardFailedRunCopies(JOB, "user-1", [undefined, "https://kie.example.com/x.mov"])
    expect(h.selectCalls).toBe(0)
    expect(h.deleteKeysRecordingFailures).not.toHaveBeenCalled()
  })

  it("never throws: the run's own error is what the caller rethrows", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    h.deleteKeysRecordingFailures.mockRejectedValue(new Error("R2 down"))
    await expect(discardFailedRunCopies(JOB, "user-1", [REF])).resolves.toBeUndefined()
    errorLog.mockRestore()
  })
})
