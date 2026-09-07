import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ job: vi.fn(), eq: vi.fn(), access: vi.fn(), config: vi.fn(), store: vi.fn(),
  reserve: vi.fn(), receive: vi.fn(), intent: vi.fn(), publish: vi.fn(), grant: vi.fn(), granter: vi.fn() }))
vi.mock("../../supabase.js", () => ({ supabase: { from: () => ({ select: () => {
  const q = { eq: (...args: unknown[]) => { mock.eq(...args); return q }, maybeSingle: mock.job }; return q
} }) } }))
vi.mock("../../config.js", () => ({ config: { R2_BUCKET_NAME: "public" } }))
vi.mock("../../workflow-access.js", () => ({ workflowAccess: mock.access, accessAtLeast: (level: string) => ["own", "edit"].includes(level) }))
vi.mock("../../../services/scene3d-artifacts/object-store.js", () => ({ resolveScene3DPrivateStorageConfig: mock.config }))
vi.mock("../scene3d-storage.js", () => ({ scene3DPrivateStore: mock.store }))
vi.mock("../scene3d-upload-grants.js", () => ({ createScene3DUploadGranter: mock.granter }))
vi.mock("../../../services/scene3d-artifacts/upload-intents.js", () => ({ reserveScene3DUploadIntent: mock.reserve,
  receiveScene3DUpload: mock.receive, scene3DUploadIntent: mock.intent }))
vi.mock("../../../services/scene3d-artifacts/publish.js", () => ({ publishScene3DRevision: mock.publish }))
import { createScene3DArtifactToolkit } from "../scene3d-artifact-toolkit.js"

const input = { jobId: "job", userId: "owner", revisionId: "revision", artifactId: "artifact" }
const bytes = Buffer.from('{"ok":true}')
const receipt = { sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, etag: "etag" }
const intent = { ...input, bucket: "private", objectKey: "owned/key", kind: "source-json", receipt }
const store = { bucket: "private", get: vi.fn(), delete: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  mock.config.mockReturnValue({ bucket: "private" })
  mock.store.mockReturnValue(store)
  mock.granter.mockReturnValue(mock.grant)
  mock.job.mockResolvedValue({ data: { status: "processing", workflow_id: "workflow" }, error: null })
  mock.access.mockResolvedValue("edit")
  mock.intent.mockResolvedValue(intent)
  mock.receive.mockResolvedValue(receipt)
  store.get.mockImplementation(async () => ({ body: Readable.from([bytes]), contentLength: bytes.length, etag: "etag" }))
})
describe("owned scene artifact toolkit", () => {
  it("is absent without private storage and reserves before granting", async () => {
    mock.config.mockReturnValueOnce(null)
    expect(createScene3DArtifactToolkit()).toBeUndefined()
    const toolkit = createScene3DArtifactToolkit()!
    const [, , authorize, reserve] = mock.granter.mock.calls[0]
    await authorize(input)
    await reserve({ ...input, kind: "source-json", objectKey: "owned/key", ttlSeconds: 900 })
    expect(mock.reserve).toHaveBeenCalledWith(store, expect.objectContaining({ ...input, ttlSeconds: 900 }))
    mock.grant.mockResolvedValue({ key: "owned/key", upload: { url: "signed", method: "PUT", headers: {} }, verifyUrl: "head", verifyHeaders: {}, expiresAt: 12 })
    expect(await toolkit.grant({ ...input, kind: "source-json" })).toEqual({ key: "owned/key", url: "signed", method: "PUT", headers: {}, verifyUrl: "head", verifyHeaders: {}, expiresAt: 12 })
  })
  it("binds receipts to the job, revision, owner and private bucket", async () => {
    const toolkit = createScene3DArtifactToolkit()!
    expect(await toolkit.receive(input)).toEqual({ artifactId: "artifact", kind: "source-json", objectKey: "owned/key", ...receipt })
    expect(mock.eq).toHaveBeenCalledWith("id", input.jobId)
    expect(mock.eq).toHaveBeenCalledWith("user_id", input.userId)
    for (const override of [{ jobId: "other" }, { revisionId: "other" }, { bucket: "public" }]) {
      mock.intent.mockResolvedValue({ ...intent, ...override })
      await expect(toolkit.receive(input)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    }
    expect(mock.receive).toHaveBeenCalledOnce()
  })
  it("refuses cancelled jobs and revoked workflow access before reading bytes", async () => {
    const toolkit = createScene3DArtifactToolkit()!
    mock.job.mockResolvedValueOnce({ data: { status: "cancelled" } })
    await expect(toolkit.read(input)).rejects.toMatchObject({ code: "SCENE_JOB_INVALID" })
    mock.access.mockResolvedValue("view")
    await expect(toolkit.read(input)).rejects.toMatchObject({ code: "SCENE_JOB_INVALID" })
    expect(store.get).not.toHaveBeenCalled()
  })
  it("hashes received bytes again and catches same-length substitution", async () => {
    const toolkit = createScene3DArtifactToolkit()!
    expect(Buffer.from(await toolkit.read(input))).toEqual(bytes)
    const changed = Buffer.from(bytes); changed[2] = 120
    store.get.mockResolvedValue({ body: Readable.from([changed]), contentLength: bytes.length })
    await expect(toolkit.read(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
  })
  it("stops a stream that exceeds its receipt and refuses unreceived or oversized bytes", async () => {
    const toolkit = createScene3DArtifactToolkit()!
    const body = Readable.from([bytes, bytes])
    store.get.mockResolvedValue({ body, contentLength: null })
    await expect(toolkit.read(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    expect(body.destroyed).toBe(true)
    for (const override of [{ receipt: null }, { receipt: { ...receipt, byteLength: 9 * 1024 * 1024 } }, { kind: "blend-source" }]) {
      mock.intent.mockResolvedValue({ ...intent, ...override })
      await expect(toolkit.read(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
    expect(store.get).toHaveBeenCalledOnce()
  })
  it("honors cancellation and a permission revocation after transfer", async () => {
    const toolkit = createScene3DArtifactToolkit()!
    await expect(toolkit.read(input, { signal: AbortSignal.abort(new Error("cancelled")) })).rejects.toThrow("cancelled")
    expect(store.get).not.toHaveBeenCalled()
    mock.access.mockResolvedValueOnce("edit").mockResolvedValue("none")
    await expect(toolkit.read(input)).rejects.toMatchObject({ code: "SCENE_JOB_INVALID" })
  })
  it("derives publication workflow from the parent and requires upload reservations", async () => {
    const toolkit = createScene3DArtifactToolkit()!
    await toolkit.publish({ ...input, plan: {}, artifacts: [] })
    expect(mock.publish).toHaveBeenCalledWith(expect.objectContaining({ workflowId: "workflow", sourceJobId: "job", requireIntents: true }), { store })
  })
})
