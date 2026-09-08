import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), fetch: vi.fn(), retain: vi.fn(), read: vi.fn(),
  filters: [] as unknown[][], rows: [] as unknown[] } ))
vi.mock("../supabase.js", () => ({ supabase: { from: state.from, rpc: state.rpc } }))
vi.mock("../safe-fetch-bytes.js", () => ({ boundedPublicChunks: state.fetch }))
vi.mock("../retained-videos.js", () => ({ retainVideo: state.retain, readRetainedVideo: state.read }))
import { readRetainedJobVideos, retainJobVideo } from "../retained-job-videos.js"

const video = { assetId: "retained", contentHash: "a".repeat(64), url: "https://media.test/retained", width: 3, height: 2, durationMs: 1200, byteLength: 12 }
const record = { job_id: "job", user_id: "owner", workflow_id: "film", video_id: video.assetId, submission_context: { kind: "test" } }
const args = { userId: "owner", workflowId: "film", jobId: "job" }
beforeEach(() => {
  vi.resetAllMocks(); state.filters.length = 0; state.rows = []
  state.from.mockImplementation((table: string) => {
    const data = state.rows.shift()
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return chain },
      in: (key: string, value: unknown) => { state.filters.push([table, key, value]); return chain },
      maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
    }
    return chain
  })
  state.fetch.mockImplementation(async function* () { yield Buffer.from("source bytes") })
  state.retain.mockResolvedValue(video)
  state.read.mockResolvedValue(video)
  state.rpc.mockResolvedValue({ data: record, error: null })
})

describe("server-attested retained job videos", () => {
  it("proves job identity and completion before downloading and records the exact source", async () => {
    state.rows = [[], { id: "job", output_data: { videoUrl: "https://media.test/source" }, submission_context: { kind: "test" } }]
    expect(await retainJobVideo(args)).toEqual({ jobId: "job", submissionContext: record.submission_context, video })
    for (const [key, value] of [["id", "job"], ["user_id", "owner"], ["workflow_id", "film"], ["status", "completed"]]) {
      expect(state.filters).toContainEqual(["jobs", key, value])
    }
    expect(state.fetch).toHaveBeenCalledWith("https://media.test/source", { maxBytes: 500 * 1024 * 1024, timeoutMs: 120_000, label: "Video" })
    expect(state.retain).toHaveBeenCalledWith({ userId: "owner", workflowId: "film", body: Buffer.from("source bytes") })
    expect(state.rpc).toHaveBeenCalledWith("record_retained_job_video", {
      p_user_id: "owner", p_workflow_id: "film", p_job_id: "job", p_video_id: "retained", p_source_url: "https://media.test/source",
    })
  })
  it("reuses verified provenance without accessing a deleted source job", async () => {
    state.rows = [[record]]
    expect(await retainJobVideo(args)).toHaveProperty("jobId", "job")
    expect(state.from).toHaveBeenCalledTimes(1)
    expect(state.filters).toContainEqual(["retained_job_videos", "workflow_id", "film"])
    expect(state.read).toHaveBeenCalledWith("film", "retained")
    expect(state.fetch).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it.each([null, { output_data: { videoUrl: "https://media.test/source" }, submission_context: null },
    { output_data: { videoUrl: "file:///secret" }, submission_context: {} }])("does not fetch unavailable or unattested jobs", async (job) => {
    state.rows = [[], job]
    expect(await retainJobVideo(args)).toBeNull()
    expect(state.fetch).not.toHaveBeenCalled()
    expect(state.retain).not.toHaveBeenCalled()
  })
  it("uses the concurrent winner and verifies its bytes", async () => {
    state.rows = [[], { output_data: { videoUrl: "https://media.test/source" }, submission_context: {} }]
    state.rpc.mockResolvedValue({ data: { ...record, video_id: "winner" }, error: null })
    await retainJobVideo(args)
    expect(state.read).toHaveBeenCalledWith("film", "winner")
  })
  it("does not attest a capture if the source changed before the database recheck", async () => {
    state.rows = [[], { output_data: { videoUrl: "https://media.test/source" }, submission_context: {} }]
    state.rpc.mockResolvedValue({ data: null, error: null })
    expect(await retainJobVideo(args)).toBeNull()
    expect(state.read).not.toHaveBeenCalled()
  })
  it("refuses an unavailable retained video instead of trusting metadata", async () => {
    state.rows = [[record]]
    state.read.mockResolvedValue(null)
    await expect(readRetainedJobVideos("film", ["job"])).rejects.toThrow("unavailable")
  })
  it("empty lookups do not query storage", async () => {
    expect(await readRetainedJobVideos("film", [""])).toEqual([])
    expect(state.from).not.toHaveBeenCalled()
  })
})
