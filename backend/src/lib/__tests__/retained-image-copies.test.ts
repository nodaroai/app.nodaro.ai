import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), read: vi.fn(), filters: [] as unknown[][] }))
vi.mock("../supabase.js", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock("../retained-images.js", () => ({ readRetainedImage: mocks.read }))
import { readRetainedImageCopies, recordRetainedImageCopy } from "../retained-image-copies.js"

const image = { assetId: "target-image", contentHash: "a".repeat(64), url: "https://media.test/copied", width: 2, height: 3 }
const row = { id: "copy", workflow_id: "target", image_id: image.assetId, source_workflow_id: "source",
  source_job_id: "real-job", source_copy_id: null, source_context: { original: true }, origin_workflow_id: "original",
  origin_job_id: "real-job", origin_submission_context: { original: true }, context: { mappedFrame: "new-frame" } }
const args = { id: "copy", userId: "copier", workflowId: "target", imageId: image.assetId,
  source: { workflowId: "source", jobId: "real-job" }, context: row.context }
beforeEach(() => {
  vi.resetAllMocks(); mocks.filters.length = 0
  mocks.rpc.mockResolvedValue({ data: row, error: null })
  mocks.read.mockResolvedValue(image)
  mocks.from.mockImplementation(() => {
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return chain },
      in: (key: string, value: unknown) => { mocks.filters.push([key, value]); return chain },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [row], error: null }).then(resolve) }
    return chain
  })
})
describe("retained image copy proofs", () => {
  it("records mapped context while reading original provenance from the server's result", async () => {
    const copy = await recordRetainedImageCopy(args)
    expect(mocks.rpc).toHaveBeenCalledWith("record_retained_image_copy", {
      p_id: "copy", p_user_id: "copier", p_workflow_id: "target", p_image_id: image.assetId,
      p_source_workflow_id: "source", p_source_job_id: "real-job", p_source_copy_id: null, p_context: row.context,
    })
    expect(copy).toEqual({ id: "copy", source: { workflowId: "source", jobId: "real-job" }, sourceContext: row.source_context,
      origin: { workflowId: "original", jobId: "real-job", submissionContext: { original: true } }, context: row.context, image })
    expect(mocks.read).toHaveBeenCalledWith("target", image.assetId)
  })
  it("addresses a copied source by proof ID without inventing another job", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...row, source_job_id: null, source_copy_id: "prior-copy" }, error: null })
    const copy = await recordRetainedImageCopy({ ...args, source: { workflowId: "source", copyId: "prior-copy" } })
    expect(mocks.rpc).toHaveBeenCalledWith("record_retained_image_copy", expect.objectContaining({
      p_source_job_id: null, p_source_copy_id: "prior-copy",
    }))
    expect(copy?.source).toEqual({ workflowId: "source", copyId: "prior-copy" })
    expect(copy?.origin.jobId).toBe("real-job")
  })
  it("reads only destination proofs and bytes after source deletion", async () => {
    expect(await readRetainedImageCopies("target", ["copy", "copy", ""])).toHaveLength(1)
    expect(mocks.from).toHaveBeenCalledOnce()
    expect(mocks.from).toHaveBeenCalledWith("retained_image_copies")
    expect(mocks.filters).toEqual([["workflow_id", "target"], ["id", ["copy"]]])
    expect(mocks.read).toHaveBeenCalledWith("target", image.assetId)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("does not read an empty set", async () => {
    expect(await readRetainedImageCopies("target", [])).toEqual([])
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("does not return proof when destination bytes are unavailable", async () => {
    mocks.read.mockResolvedValue(null)
    await expect(recordRetainedImageCopy(args)).rejects.toThrow("The copied image is unavailable")
    await expect(readRetainedImageCopies("target", ["copy"])).rejects.toThrow("The copied image is unavailable")
  })
  it("preserves database refusal and hides internal database details", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await recordRetainedImageCopy(args)).toBeNull()
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "private detail" } })
    await expect(recordRetainedImageCopy(args)).rejects.toThrow("Failed to record copied image proof")
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
