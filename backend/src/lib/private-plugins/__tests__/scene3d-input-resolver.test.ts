import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createScene3DInputResolver } from "../scene3d-input-resolver.js"
import type { authorizeScene3DInputArtifact } from "../scene3d-input-authority.js"

const cfg = { bucket: "scene-private", endpoint: "https://account.r2.cloudflarestorage.com", region: "auto",
  accessKeyId: "test-key", secretAccessKey: "test-secret", forcePathStyle: true }
const input = { userId: "261bc527-f2da-4d53-8d05-079745d44f46",
  revisionId: "e405b2e2-2fe2-4a9e-8a01-a8d5b160238a", assetId: "926e4f79-1c19-4fbd-bebf-2753f4c98d7e" }
function setup() {
  const allowed = { ok: true as const,
    revision: { revisionId: input.revisionId, userId: "source-owner", workflowId: "source-workflow",
      sourceJobId: "source-job", parentRevisionId: null, planSha256: "b".repeat(64), createdAt: "", plan: {} },
    artifact: { artifactId: input.assetId, userId: "source-owner", kind: "glb" as const, usage: "playback" as const,
      bucket: cfg.bucket, objectKey: "scene3d/source-owner/immutable.glb", sha256: "a".repeat(64),
      byteLength: 100, etag: "etag-1", expiresAt: null as string | null, createdAt: "" },
  }
  const authorize = vi.fn<typeof authorizeScene3DInputArtifact>(async () => structuredClone(allowed))
  const head = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ ContentLength: 100, ETag: '"etag-1"' } as never)
  return { allowed, authorize, head, resolve: createScene3DInputResolver(cfg, "public-media", authorize) }
}
afterEach(() => vi.restoreAllMocks())

describe("scene input resolution before admission", () => {
  it("returns only verified metadata and rechecks access after storage IO without creating a job or grant", async () => {
    const f = setup()
    expect(await f.resolve(input)).toEqual({ assetId: input.assetId, sourceRevisionId: input.revisionId,
      kind: "glb", sha256: "a".repeat(64), byteLength: 100 })
    expect(f.authorize).toHaveBeenCalledTimes(2)
    expect(f.authorize).toHaveBeenCalledWith(input.userId, input.revisionId, input.assetId)
    expect(f.head).toHaveBeenCalledOnce()
    expect(f.head.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand)
    expect((f.head.mock.calls[0]![0] as HeadObjectCommand).input).toEqual({ Bucket: cfg.bucket, Key: f.allowed.artifact.objectKey })
  })
  it.each(["not-found", "forbidden"] as const)("does not probe storage for a %s selector", async reason => {
    const f = setup()
    f.authorize.mockResolvedValue({ ok: false, reason })
    await expect(f.resolve(input)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(f.head).not.toHaveBeenCalled()
  })
  it("rejects caller receipts, URLs, job IDs and malformed selectors before authorization", async () => {
    const f = setup()
    for (const value of [{ ...input, sha256: "a".repeat(64) }, { ...input, url: "https://example.com/model.glb" },
      { ...input, revisionId: "../../other" }, { ...input, jobId: input.userId }]) {
      await expect(f.resolve(value as never)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.head).not.toHaveBeenCalled()
  })
  it("refuses invalid receipts and pins before storage access", async () => {
    const f = setup()
    for (const patch of [{ userId: "other-owner" }, { bucket: "public-media" }, { artifactId: input.userId },
      { kind: "source-json" as const }, { usage: "source" as const }, { sha256: "not-a-digest" },
      { byteLength: 11 }, { byteLength: 1.5 }, { byteLength: 64 * 1024 * 1024 + 1 },
      { etag: "" }, { etag: "bad\ntag" }, { expiresAt: "invalid" },
      { expiresAt: new Date(Date.now() + 60_000).toISOString() }]) {
      f.authorize.mockResolvedValue({ ...f.allowed, artifact: { ...f.allowed.artifact, ...patch } })
      await expect(f.resolve(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
    expect(f.head).not.toHaveBeenCalled()
  })
  it("accepts a retained private input only through its input authorizer", async () => {
    const f = setup()
    f.authorize.mockResolvedValue({ ...f.allowed, artifact: { ...f.allowed.artifact, kind: "input-glb", usage: "checkpoint" } })
    expect(await f.resolve(input)).toMatchObject({ kind: "glb", assetId: input.assetId })
  })
  it("refuses changed bytes and missing object metadata", async () => {
    const f = setup()
    for (const response of [{ ContentLength: 101, ETag: '"etag-1"' }, { ContentLength: 100, ETag: '"replacement"' },
      { ContentLength: 100 }, { ETag: '"etag-1"' }]) {
      f.head.mockResolvedValue(response as never)
      await expect(f.resolve(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
  })
  it("refuses revocation while storage is awaited", async () => {
    const f = setup()
    f.authorize.mockResolvedValueOnce(f.allowed).mockResolvedValueOnce({ ok: false, reason: "forbidden" })
    await expect(f.resolve(input)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
  })
  it("refuses source metadata changes after storage IO", async () => {
    const f = setup()
    for (const patch of [{ objectKey: "replacement" }, { sha256: "b".repeat(64) }, { byteLength: 101 }, { etag: "new" }]) {
      f.authorize.mockResolvedValueOnce(f.allowed).mockResolvedValueOnce({ ...f.allowed, artifact: { ...f.allowed.artifact, ...patch } })
      await expect(f.resolve(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
  })
  it("honors cancellation during IO and sanitizes storage failures", async () => {
    const f = setup(), controller = new AbortController()
    f.head.mockImplementationOnce(async () => {
      controller.abort(new Error("cancelled"))
      return { ContentLength: 100, ETag: '"etag-1"' } as never
    })
    await expect(f.resolve(input, { signal: controller.signal })).rejects.toThrow("cancelled")
    f.head.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
    await expect(f.resolve(input)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    f.head.mockRejectedValueOnce(new Error("private-key transport detail"))
    await expect(f.resolve(input)).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED", message: "Checking the scene input failed" })
  })
  it("refuses public bucket reuse", () => {
    const f = setup()
    expect(() => createScene3DInputResolver(cfg, cfg.bucket, f.authorize)).toThrow("separate private bucket")
  })
})
