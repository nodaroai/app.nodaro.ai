import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computeScene3DPlanV2ContentHash } from "@nodaro/shared"
import { planV2 } from "../../../../../packages/shared/src/__tests__/scene3d-v2-fixtures.js"

const mock = vi.hoisted(() => ({ job: vi.fn(), access: vi.fn(), config: vi.fn(), store: vi.fn(),
  revision: vi.fn(), pins: vi.fn(), granter: vi.fn() }))
vi.mock("../../supabase.js", () => ({ supabase: { from: () => ({ select: () => {
  const q = { eq: () => q, maybeSingle: mock.job }; return q
} }) } }))
vi.mock("../../config.js", () => ({ config: { R2_BUCKET_NAME: "public" } }))
const RANK = { none: 0, view: 1, edit: 2, own: 3 } as const
vi.mock("../../workflow-access.js", () => ({ workflowAccess: mock.access,
  accessAtLeast: (actual: keyof typeof RANK, required: keyof typeof RANK) => RANK[actual] >= RANK[required] }))
vi.mock("../../../services/scene3d-artifacts/db.js", () => ({ loadScene3DRevision: mock.revision,
  loadScene3DRevisionArtifacts: mock.pins, loadScene3DPinnedArtifact: vi.fn() }))
vi.mock("../../../services/scene3d-artifacts/object-store.js", () => ({ resolveScene3DPrivateStorageConfig: mock.config }))
vi.mock("../scene3d-storage.js", () => ({ scene3DPrivateStore: mock.store }))
vi.mock("../scene3d-upload-grants.js", () => ({ createScene3DUploadGranter: mock.granter }))
vi.mock("../../../services/scene3d-artifacts/upload-intents.js", () => ({ reserveScene3DUploadIntent: vi.fn(),
  receiveScene3DUpload: vi.fn(), scene3DUploadIntent: vi.fn() }))
vi.mock("../../../services/scene3d-artifacts/publish.js", () => ({ publishScene3DRevision: vi.fn() }))
import { createScene3DArtifactToolkit } from "../scene3d-artifact-toolkit.js"

const JOB_ID = "0f7c9a2c-8f45-4a0f-9d31-2b7c5f9a1d10"
const OWNER = "0f7c9a2c-8f45-4a0f-9d31-2b7c5f9a1d11"
const COLLABORATOR = "0f7c9a2c-8f45-4a0f-9d31-2b7c5f9a1d12"
/** The pinned recipe was written by the ORIGINAL job, under the ORIGINAL owner. */
const SOURCE_ARTIFACT = "0f7c9a2c-8f45-4a0f-9d31-2b7c5f9a1d13"
const REVISION_ID = planV2().revisionId

const recipe = Buffer.from(JSON.stringify({ recipe: "private", steps: [1, 2, 3] }))
const sha256 = createHash("sha256").update(recipe).digest("hex")
const sourcePin = {
  artifactId: SOURCE_ARTIFACT, userId: OWNER, kind: "source-json" as const, usage: "checkpoint" as const,
  bucket: "private", objectKey: `scene3d/${OWNER}/${REVISION_ID}/${SOURCE_ARTIFACT}.source.json`,
  sha256, byteLength: recipe.length, etag: "etag", expiresAt: null, createdAt: "2026-01-01T00:00:00Z",
}
const blendPin = { ...sourcePin, artifactId: "0f7c9a2c-8f45-4a0f-9d31-2b7c5f9a1d14",
  kind: "blend-source" as const, usage: "source" as const, objectKey: "scene3d/blend", byteLength: 40_000_000 }
const glbPin = { ...sourcePin, artifactId: "0f7c9a2c-8f45-4a0f-9d31-2b7c5f9a1d15",
  kind: "glb" as const, usage: "playback" as const, objectKey: "scene3d/glb" }

const store = { bucket: "private", get: vi.fn(), delete: vi.fn() }
let contentHash: string
let request: { jobId: string; userId: string; revisionId: string; expectedContentHash: string }

/** The published plan, hashed for real by the shared implementation. */
async function published(overrides: Record<string, unknown> = {}) {
  const base = planV2(overrides as never)
  return { ...base, provenance: { ...base.provenance, contentHash: await computeScene3DPlanV2ContentHash(base) } }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mock.config.mockReturnValue({ bucket: "private" })
  mock.store.mockReturnValue(store)
  mock.granter.mockReturnValue(vi.fn())
  // The parent job is personal; the revision is the thing the workflow seam guards.
  mock.job.mockResolvedValue({ data: { status: "processing", workflow_id: null }, error: null })
  mock.access.mockResolvedValue("edit")
  const plan = await published()
  contentHash = plan.provenance.contentHash
  request = { jobId: JOB_ID, userId: COLLABORATOR, revisionId: REVISION_ID, expectedContentHash: contentHash }
  mock.revision.mockResolvedValue({ revisionId: REVISION_ID, userId: OWNER, workflowId: "workflow",
    sourceJobId: "another-job", parentRevisionId: null, planSha256: sha256, createdAt: "2026-01-01T00:00:00Z", plan })
  mock.pins.mockResolvedValue([glbPin, blendPin, sourcePin])
  store.get.mockImplementation(async () => ({ body: Readable.from([recipe]), contentLength: recipe.length, etag: "etag" }))
})

function toolkit() {
  return createScene3DArtifactToolkit()!
}

describe("private authoring source read", () => {
  it("serves an authorized collaborator the reused pinned recipe and nothing private", async () => {
    const result = await toolkit().readAuthoringSource!(request)
    expect(Object.keys(result).sort()).toEqual(["inputArtifacts", "plan", "source", "sourceArtifactId", "sourceSha256"])
    expect(result.inputArtifacts).toEqual([])
    expect(Buffer.from(result.source)).toEqual(recipe)
    expect(result).toMatchObject({ sourceArtifactId: SOURCE_ARTIFACT, sourceSha256: sha256 })
    expect((result.plan as { revisionId: string }).revisionId).toBe(REVISION_ID)
    // The pin is the authority: another owner's artifact from another job is fine.
    expect(store.get).toHaveBeenCalledWith(sourcePin.objectKey)
    const serialized = JSON.stringify({ ...result, source: undefined })
    for (const secret of [sourcePin.objectKey, sourcePin.bucket, sourcePin.etag, "scene3d/", "http"]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it("returns only opaque private input receipts and rechecks their pins", async () => {
    const inputPin = { ...glbPin, kind: "input-glb", usage: "checkpoint" }
    mock.pins.mockResolvedValue([sourcePin, inputPin])
    const result = await toolkit().readAuthoringSource!(request)
    expect(result.inputArtifacts).toEqual([{ assetId: inputPin.artifactId, kind: "glb", sha256, byteLength: recipe.length }])
    expect(store.get).toHaveBeenCalledTimes(1)
    mock.pins.mockResolvedValueOnce([sourcePin, inputPin]).mockResolvedValueOnce([sourcePin])
    await expect(toolkit().readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
  })

  it("does no IO for malformed input, an inactive job, a stale hash or a corrupt plan", async () => {
    const api = toolkit()
    for (const bad of [{ jobId: "job" }, { userId: "owner" }, { revisionId: "revision" },
      { expectedContentHash: "nope" }, { expectedContentHash: "A".repeat(64) }]) {
      await expect(api.readAuthoringSource!({ ...request, ...bad })).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
    expect(mock.revision).not.toHaveBeenCalled()

    mock.job.mockResolvedValueOnce({ data: { status: "cancelled", workflow_id: null }, error: null })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_JOB_INVALID" })
    expect(mock.revision).not.toHaveBeenCalled()

    await expect(api.readAuthoringSource!({ ...request, expectedContentHash: "b".repeat(64) }))
      .rejects.toMatchObject({ code: "SCENE_REVISION_CONFLICT" })

    // Declared hash agrees with the request but the stored content does not.
    const tampered = await published()
    mock.revision.mockResolvedValue({ revisionId: REVISION_ID, userId: OWNER, workflowId: "workflow",
      plan: { ...tampered, backgroundColor: "#ffffff" } })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_PLAN_INVALID" })

    mock.revision.mockResolvedValue({ revisionId: REVISION_ID, userId: OWNER, workflowId: "workflow", plan: { nope: true } })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_PLAN_INVALID" })
    expect(mock.pins).not.toHaveBeenCalled()
    expect(store.get).not.toHaveBeenCalled()
  })

  it("refuses a plan that does not carry the requested revision identity", async () => {
    const other = await published({ revisionId: "6d5b0b64-2b6c-4d4a-9e4f-2f4b7f6a1c09" })
    mock.revision.mockResolvedValue({ revisionId: REVISION_ID, userId: OWNER, workflowId: "workflow", plan: other })
    await expect(toolkit().readAuthoringSource!({ ...request, expectedContentHash: other.provenance.contentHash }))
      .rejects.toMatchObject({ code: "SCENE_PLAN_INVALID" })
    expect(store.get).not.toHaveBeenCalled()
  })

  it("denies a viewer and an unreachable revision", async () => {
    const api = toolkit()
    mock.access.mockResolvedValue("view")
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_JOB_INVALID" })
    mock.access.mockResolvedValue("edit")
    mock.revision.mockResolvedValue(null)
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    // A personal revision belongs to its owner alone, whatever the workflow seam says.
    mock.revision.mockResolvedValue({ revisionId: REVISION_ID, userId: OWNER, workflowId: null, plan: await published() })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(store.get).not.toHaveBeenCalled()
  })

  it("requires exactly one pinned source-json and ignores every other pin", async () => {
    const api = toolkit()
    mock.pins.mockResolvedValue([glbPin, blendPin])
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    // A source-json pinned under another usage is not this revision's recipe.
    mock.pins.mockResolvedValue([{ ...sourcePin, usage: "playback" }])
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    mock.pins.mockResolvedValue([sourcePin, { ...sourcePin, artifactId: blendPin.artifactId }])
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    expect(store.get).not.toHaveBeenCalled()
  })

  it("refuses another bucket, an expired pin and an oversized recipe before reading", async () => {
    const api = toolkit()
    mock.pins.mockResolvedValue([{ ...sourcePin, bucket: "public" }])
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED" })
    mock.pins.mockResolvedValue([{ ...sourcePin, expiresAt: "2020-01-01T00:00:00Z" }])
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    for (const override of [{ byteLength: 8 * 1024 * 1024 + 1 }, { byteLength: 0 }, { sha256: "zz" }]) {
      mock.pins.mockResolvedValue([{ ...sourcePin, ...override }])
      await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
    expect(store.get).not.toHaveBeenCalled()
  })

  it("caps, digests and length-checks the stream itself", async () => {
    const api = toolkit()
    const long = Readable.from([recipe, recipe])
    store.get.mockResolvedValueOnce({ body: long, contentLength: null, etag: "etag" })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    expect(long.destroyed).toBe(true)

    const swapped = Buffer.from(recipe); swapped[2] = 120
    store.get.mockResolvedValueOnce({ body: Readable.from([swapped]), contentLength: recipe.length, etag: "etag" })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })

    store.get.mockResolvedValueOnce({ body: Readable.from([recipe.subarray(0, 4)]), contentLength: null, etag: "etag" })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })

    store.get.mockResolvedValueOnce({ body: Readable.from([recipe]), contentLength: recipe.length + 1, etag: "etag" })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
  })

  it("refuses a recipe whose header claims more than the cap", async () => {
    // 8 MiB + 1 recorded is refused above; a store that then streams more is refused here too.
    mock.pins.mockResolvedValue([{ ...sourcePin, byteLength: 8 * 1024 * 1024 }])
    const flood = Readable.from(Array.from({ length: 9 }, () => Buffer.alloc(1024 * 1024)))
    store.get.mockResolvedValueOnce({ body: flood, contentLength: null, etag: "etag" })
    await expect(toolkit().readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    expect(flood.destroyed).toBe(true)
  })

  it("calls a store outage a failure and only an affirmative miss missing", async () => {
    const api = toolkit()
    store.get.mockRejectedValueOnce(new Error("connection reset"))
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED" })
    store.get.mockRejectedValueOnce(Object.assign(new Error("timeout"), { $metadata: { httpStatusCode: 503 } }))
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED" })
    store.get.mockRejectedValueOnce(Object.assign(new Error("gone"), { name: "NoSuchKey" }))
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    store.get.mockRejectedValueOnce(Object.assign(new Error("gone"), { $metadata: { httpStatusCode: 404 } }))
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })

  it("destroys the stream on cancellation and refuses to answer after a revocation", async () => {
    const api = toolkit()
    await expect(api.readAuthoringSource!(request, { signal: AbortSignal.abort(new Error("cancelled")) }))
      .rejects.toThrow("cancelled")
    expect(store.get).not.toHaveBeenCalled()

    const controller = new AbortController()
    const body = Readable.from((async function* () {
      yield recipe.subarray(0, 4)
      controller.abort(new Error("cancelled mid-read"))
      yield recipe.subarray(4)
    })())
    store.get.mockResolvedValueOnce({ body, contentLength: recipe.length, etag: "etag" })
    await expect(api.readAuthoringSource!(request, { signal: controller.signal })).rejects.toThrow()
    expect(body.destroyed).toBe(true)

    // Revision access revoked while the bytes were moving.
    mock.access.mockResolvedValueOnce("edit").mockResolvedValue("none")
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(store.get).toHaveBeenCalledTimes(2)

    // Parent job cancelled while the bytes were moving.
    mock.access.mockResolvedValue("edit")
    mock.job.mockResolvedValueOnce({ data: { status: "processing", workflow_id: null }, error: null })
      .mockResolvedValue({ data: { status: "failed", workflow_id: null }, error: null })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_JOB_INVALID" })
    expect(store.get).toHaveBeenCalledTimes(3)
  })
  it("classifies a mid-stream outage and checks cancellation after final authorization", async () => {
    const api = toolkit()
    const broken = Readable.from((async function* () {
      yield recipe.subarray(0, 4)
      throw new Error("upstream socket reset")
    })())
    store.get.mockResolvedValueOnce({ body: broken, contentLength: recipe.length, etag: "etag" })
    await expect(api.readAuthoringSource!(request)).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED" })
    expect(broken.destroyed).toBe(true)

    const controller = new AbortController()
    mock.access.mockResolvedValueOnce("edit").mockImplementationOnce(async () => {
      controller.abort(new Error("cancelled during final authorization"))
      return "edit"
    })
    await expect(api.readAuthoringSource!(request, { signal: controller.signal }))
      .rejects.toThrow("cancelled during final authorization")
  })

})
