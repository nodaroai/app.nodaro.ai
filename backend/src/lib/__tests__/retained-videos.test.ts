import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
vi.mock("../retained-video-probe.js", () => ({ probeRetainedVideo: async () => ({ width: 3, height: 2, durationMs: 1200, contentType: "video/mp4" }) }))
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

const state = vi.hoisted(() => ({
  configured: true, credits: true, deploymentPayer: false,
  objects: new Map<string, Buffer>(),
  rpc: vi.fn(), send: vi.fn(), read: vi.fn(), queries: [] as Array<[string, unknown]>,
  row: {} as Record<string, unknown>,
}))
vi.mock("../config.js", () => ({ config: { R2_BUCKET_NAME: "media" }, hasCredits: () => state.credits }))
vi.mock("../deployment-payer.js", () => ({ deploymentPayerActive: () => state.deploymentPayer }))
vi.mock("../storage.js", () => ({
  isStorageConfigured: () => state.configured,
  withObjectAcl: (input: unknown) => input,
  r2Url: (key: string) => `https://media.test/${key}`,
  s3: { send: state.send }, readR2Object: state.read,
}))
vi.mock("../supabase.js", () => ({ supabase: {
  rpc: state.rpc,
  from: (table: string) => {
    state.queries.push(["from", table])
    const chain = { select: (columns: string) => { state.queries.push(["select", columns]); return chain },
      eq: (key: string, value: unknown) => { state.queries.push([key, value]); return chain },
      maybeSingle: async () => ({ data: state.row, error: null }),
    }
    return chain
  },
} }))
import { collectRetainedVideos, copyRetainedVideo, readRetainedVideo, retainVideo } from "../retained-videos.js"
import { clearUploadPolicies, registerUploadPolicy } from "../upload-policy.js"

const ID = "00000000-0000-4000-8000-000000000001"
const KEY = `retained-videos/${ID}`
let body: Buffer
beforeEach(async () => {
  clearUploadPolicies()
  vi.clearAllMocks()
  state.configured = true; state.credits = true; state.deploymentPayer = false
  state.objects.clear(); state.queries.length = 0
  body = Buffer.from("fixed video bytes")
  state.row = { id: ID, user_id: "owner", workflow_id: "film", width: 3, height: 2,
    sha256: createHash("sha256").update(body).digest("hex"), byte_length: body.length,
    duration_ms: 1200, content_type: "video/mp4", state: "creating", upload_until: new Date(Date.now() + 300_000).toISOString() }
  state.rpc.mockImplementation(async (name: string) => ({ data: name === "reserve_retained_video" ? state.row : true, error: null }))
  state.send.mockImplementation(async (command: PutObjectCommand | DeleteObjectCommand) => {
    if (command instanceof PutObjectCommand) state.objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer))
    else state.objects.delete(command.input.Key!)
    return {}
  })
  state.read.mockImplementation(async (key: string) => state.objects.has(key) ? { body: state.objects.get(key)! } : null)
})

describe("retained canonical video bytes", () => {
  it("copies verified source bytes into a separate workflow lifetime and quota reservation", async () => {
    state.row = { ...state.row, state: "ready" }
    state.objects.set(KEY, body)
    const targetId = "00000000-0000-4000-8000-000000000002", targetKey = `retained-videos/${targetId}`
    const target = { ...state.row, id: targetId, workflow_id: "copy", user_id: "copier", state: "creating" }
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "reserve_retained_video" ? target : true, error: null }))
    const copied = await copyRetainedVideo({ userId: "copier", sourceWorkflowId: "film", workflowId: "copy", assetId: ID })
    expect(copied).toEqual({ assetId: targetId, contentHash: state.row.sha256, width: 3, height: 2, durationMs: 1200, byteLength: body.length,
      url: `https://media.test/${targetKey}` })
    expect(state.queries).toContainEqual(["workflow_id", "film"])
    expect(state.queries).toContainEqual(["id", ID])
    expect(state.queries).toContainEqual(["state", "ready"])
    expect(state.rpc).toHaveBeenCalledWith("reserve_retained_video", expect.objectContaining({
      p_user_id: "copier", p_workflow_id: "copy", p_sha256: state.row.sha256, p_quota_mode: "enforce",
    }))
    expect(state.objects.get(targetKey)).toEqual(body)
    // Simulate source cleanup: reading the new snapshot uses only its own row
    // and bytes, with no reference back to the source workflow or object.
    state.objects.delete(KEY)
    state.row = { ...target, state: "ready" }
    expect(await readRetainedVideo("copy", targetId)).toEqual(copied)
  })

  it("reuses a verified source inside the same workflow without reserving or writing bytes", async () => {
    state.row = { ...state.row, state: "ready" }
    state.objects.set(KEY, body)
    expect(await copyRetainedVideo({ userId: "collaborator", sourceWorkflowId: "film", workflowId: "film", assetId: ID }))
      .toMatchObject({ assetId: ID, contentHash: state.row.sha256 })
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })

  it("does not create a destination reservation for changed or missing source bytes", async () => {
    state.row = { ...state.row, state: "ready" }
    for (const bytes of [undefined, Buffer.from("changed")]) {
      if (bytes) state.objects.set(KEY, bytes)
      await expect(copyRetainedVideo({ userId: "copier", sourceWorkflowId: "film", workflowId: "copy", assetId: ID }))
        .rejects.toThrow(/unavailable or changed/)
    }
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })

  it("refuses unrecognized source IDs without using them as object keys", async () => {
    expect(await copyRetainedVideo({ userId: "copier", sourceWorkflowId: "film", workflowId: "copy", assetId: "../secret" })).toBeNull()
    expect(state.queries).toEqual([])
    expect(state.read).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("applies destination upload policy before reserving a copied video", async () => {
    state.row = { ...state.row, state: "ready" }
    state.objects.set(KEY, body)
    const check = vi.fn(() => ({ allow: false, reason: "Video not allowed here" }))
    registerUploadPolicy({ id: "copy-policy", check })
    await expect(copyRetainedVideo({ userId: "copier", sourceWorkflowId: "film", workflowId: "copy", assetId: ID }))
      .rejects.toThrow("Video not allowed here")
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ userId: "copier", buffer: body, lane: "retained-video" }))
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })

  it("checks final bytes before reserving quota or writing an object", async () => {
    const check = vi.fn(() => ({ allow: false, reason: "Video not allowed" }))
    registerUploadPolicy({ id: "private-policy", check })
    await expect(retainVideo({ userId: "owner", workflowId: "film", body })).rejects.toThrow("Video not allowed")
    expect(check).toHaveBeenCalledWith({ kind: "video", lane: "retained-video", mime: "video/mp4",
      userId: "owner", sizeBytes: body.length, buffer: body })
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })
  it("copies the caller's bytes, conditionally writes them and verifies storage before publication", async () => {
    const input = Buffer.from(body)
    const pending = retainVideo({ userId: "owner", workflowId: "film", body: input })
    input.fill(0)
    const result = await pending
    expect(result).toEqual({ assetId: ID, contentHash: state.row.sha256, width: 3, height: 2, durationMs: 1200, byteLength: body.length, url: `https://media.test/${KEY}` })
    expect(state.objects.get(KEY)).toEqual(body)
    expect(state.rpc).toHaveBeenNthCalledWith(1, "reserve_retained_video", expect.objectContaining({
      p_user_id: "owner", p_workflow_id: "film", p_sha256: state.row.sha256, p_byte_length: body.length, p_quota_mode: "enforce",
    }))
    const [command, options] = state.send.mock.calls[0]!
    expect(command.input).toMatchObject({ Key: KEY, IfNoneMatch: "*", ContentType: "video/mp4" })
    expect(options.abortSignal).toBeInstanceOf(AbortSignal)
    expect(state.rpc).toHaveBeenLastCalledWith("complete_retained_video", { p_id: ID, p_sha256: state.row.sha256 })
  })
  it("reuses a ready snapshot after verifying its current bytes", async () => {
    state.row.state = "ready"; state.objects.set(KEY, body)
    await retainVideo({ userId: "owner", workflowId: "film", body })
    expect(state.send).not.toHaveBeenCalled()
    expect(state.rpc).toHaveBeenCalledTimes(1)
  })
  it("refuses damaged storage and never publishes its metadata", async () => {
    state.read.mockResolvedValue({ body: Buffer.from("wrong bytes") })
    await expect(retainVideo({ userId: "owner", workflowId: "film", body })).rejects.toThrow("bytes are unavailable or changed")
    expect(state.rpc).toHaveBeenCalledTimes(1)
  })
  it("accepts a concurrent identical write only after verifying the winning object", async () => {
    state.objects.set(KEY, body)
    state.send.mockRejectedValue({ $metadata: { httpStatusCode: 412 } })
    await expect(retainVideo({ userId: "owner", workflowId: "film", body })).resolves.toHaveProperty("assetId", ID)
    expect(state.rpc).toHaveBeenCalledTimes(2)
  })
  it("does not upload after the bounded upload window or without storage", async () => {
    state.row.upload_until = new Date(Date.now() + 10_000).toISOString()
    await expect(retainVideo({ userId: "owner", workflowId: "film", body })).rejects.toThrow("capture expired")
    expect(state.send).not.toHaveBeenCalled()
    state.configured = false
    await expect(retainVideo({ userId: "owner", workflowId: "film", body })).rejects.toThrow("not configured")
    expect(state.rpc).toHaveBeenCalledTimes(1)
  })
  it("uses the deployment's existing quota modes", async () => {
    state.credits = false
    await retainVideo({ userId: "owner", workflowId: "film", body })
    expect(state.rpc.mock.calls[0]![1]).toHaveProperty("p_quota_mode", "none")
    state.credits = true; state.deploymentPayer = true
    await retainVideo({ userId: "owner", workflowId: "film", body })
    expect(state.rpc.mock.calls[2]![1]).toHaveProperty("p_quota_mode", "track")
  })
  it("binds reads to the authorized workflow and verifies the hash", async () => {
    state.row.state = "ready"; state.objects.set(KEY, body)
    expect(await readRetainedVideo("film", ID)).toHaveProperty("assetId", ID)
    expect(state.queries).toContainEqual(["workflow_id", "film"])
    expect(state.queries).toContainEqual(["id", ID])
    expect(state.queries).toContainEqual(["state", "ready"])
    state.queries.length = 0
    expect(await readRetainedVideo("film", "invalid-id")).toBeNull()
    expect(state.queries).toEqual([])
  })
  it("keeps failed physical deletes queued and records successful cleanup once", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_retained_video_gc" ? [{ id: ID }] : true, error: null }))
    state.send.mockRejectedValueOnce(new Error("storage unavailable"))
    expect(await collectRetainedVideos()).toEqual({ deleted: 0, failed: 1 })
    expect(state.rpc).toHaveBeenCalledTimes(1)
    expect(await collectRetainedVideos()).toEqual({ deleted: 1, failed: 0 })
    expect(state.rpc).toHaveBeenLastCalledWith("complete_retained_video_gc", { p_id: ID })
  })
})
