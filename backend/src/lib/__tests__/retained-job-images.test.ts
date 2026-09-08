import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), fetch: vi.fn(), retain: vi.fn(), read: vi.fn(),
  filters: [] as unknown[][], rows: [] as unknown[] } ))
vi.mock("../supabase.js", () => ({ supabase: { from: state.from, rpc: state.rpc } }))
vi.mock("../safe-fetch-bytes.js", () => ({ safeFetchBytes: state.fetch }))
vi.mock("../retained-images.js", () => ({ retainImage: state.retain, readRetainedImage: state.read }))
import { readRetainedJobImages, retainJobImage } from "../retained-job-images.js"

const image = { assetId: "retained", contentHash: "a".repeat(64), url: "https://media.test/retained", width: 3, height: 2 }
const record = { job_id: "job", user_id: "owner", workflow_id: "film", image_id: image.assetId, submission_context: { kind: "test" } }
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
  state.fetch.mockResolvedValue(Buffer.from("source bytes"))
  state.retain.mockResolvedValue(image)
  state.read.mockResolvedValue(image)
  state.rpc.mockResolvedValue({ data: record, error: null })
})

describe("server-attested retained job images", () => {
  it("proves job identity and completion before downloading and records the exact source", async () => {
    state.rows = [[], { id: "job", output_data: { imageUrl: "https://media.test/source" }, submission_context: { kind: "test" } }]
    expect(await retainJobImage(args)).toEqual({ jobId: "job", submissionContext: record.submission_context, image })
    for (const [key, value] of [["id", "job"], ["user_id", "owner"], ["workflow_id", "film"], ["status", "completed"]]) {
      expect(state.filters).toContainEqual(["jobs", key, value])
    }
    expect(state.fetch).toHaveBeenCalledWith("https://media.test/source", 25 * 1024 * 1024)
    expect(state.retain).toHaveBeenCalledWith({ userId: "owner", workflowId: "film", body: Buffer.from("source bytes") })
    expect(state.rpc).toHaveBeenCalledWith("record_retained_job_image", {
      p_user_id: "owner", p_workflow_id: "film", p_job_id: "job", p_image_id: "retained", p_source_url: "https://media.test/source",
    })
  })
  it("reuses verified provenance without accessing a deleted source job", async () => {
    state.rows = [[record]]
    expect(await retainJobImage(args)).toHaveProperty("jobId", "job")
    expect(state.from).toHaveBeenCalledTimes(1)
    expect(state.filters).toContainEqual(["retained_job_images", "workflow_id", "film"])
    expect(state.read).toHaveBeenCalledWith("film", "retained")
    expect(state.fetch).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it.each([null, { output_data: { imageUrl: "https://media.test/source" }, submission_context: null },
    { output_data: { imageUrl: "file:///secret" }, submission_context: {} }])("does not fetch unavailable or unattested jobs", async (job) => {
    state.rows = [[], job]
    expect(await retainJobImage(args)).toBeNull()
    expect(state.fetch).not.toHaveBeenCalled()
    expect(state.retain).not.toHaveBeenCalled()
  })
  it("uses the concurrent winner and verifies its bytes", async () => {
    state.rows = [[], { output_data: { imageUrl: "https://media.test/source" }, submission_context: {} }]
    state.rpc.mockResolvedValue({ data: { ...record, image_id: "winner" }, error: null })
    await retainJobImage(args)
    expect(state.read).toHaveBeenCalledWith("film", "winner")
  })
  it("does not attest a capture if the source changed before the database recheck", async () => {
    state.rows = [[], { output_data: { imageUrl: "https://media.test/source" }, submission_context: {} }]
    state.rpc.mockResolvedValue({ data: null, error: null })
    expect(await retainJobImage(args)).toBeNull()
    expect(state.read).not.toHaveBeenCalled()
  })
  it("refuses an unavailable retained image instead of trusting metadata", async () => {
    state.rows = [[record]]
    state.read.mockResolvedValue(null)
    await expect(readRetainedJobImages("film", ["job"])).rejects.toThrow("unavailable")
  })
  it("empty lookups do not query storage", async () => {
    expect(await readRetainedJobImages("film", [""])).toEqual([])
    expect(state.from).not.toHaveBeenCalled()
  })
})
