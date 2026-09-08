import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createScene3DInputGranter } from "../scene3d-input-grants.js"
import type { authorizeScene3DArtifact } from "../../../services/scene3d-artifacts/authorize.js"

const cfg = { bucket: "scene-private", endpoint: "https://account.r2.cloudflarestorage.com", region: "auto",
  accessKeyId: "test-key", secretAccessKey: "test-secret", forcePathStyle: true }
const input = { jobId: "fccc8459-372f-4a9b-a28a-f795b5711c5d", userId: "261bc527-f2da-4d53-8d05-079745d44f46",
  sourceRevisionId: "e405b2e2-2fe2-4a9e-8a01-a8d5b160238a", expiresInSeconds: 900,
  asset: { assetId: "926e4f79-1c19-4fbd-bebf-2753f4c98d7e", kind: "glb" as const, sha256: "a".repeat(64), byteLength: 100 } }
function setup() {
  const allowed = { ok: true as const,
    revision: { revisionId: input.sourceRevisionId, userId: "source-owner", workflowId: "source-workflow",
      sourceJobId: "source-job", parentRevisionId: null, planSha256: "b".repeat(64), createdAt: "", plan: {} },
    artifact: { artifactId: input.asset.assetId, userId: "source-owner", kind: "glb" as const, usage: "playback" as const,
      bucket: cfg.bucket, objectKey: "scene3d/source-owner/immutable.glb", sha256: input.asset.sha256,
      byteLength: input.asset.byteLength, etag: "etag-1", expiresAt: null as string | null, createdAt: "" },
  }
  const authorize = vi.fn<typeof authorizeScene3DArtifact>(async () => structuredClone(allowed))
  const active = vi.fn(async () => {})
  const head = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ ContentLength: 100, ETag: '"etag-1"' } as never)
  const grant = createScene3DInputGranter(cfg, "public-media", active, authorize)
  return { allowed, authorize, active, head, grant }
}
afterEach(() => vi.restoreAllMocks())

describe("private scene input grants", () => {
  it("reauthorizes an exact pinned source and signs a conditional GET without credentials", async () => {
    const f = setup()
    const result = await f.grant(input)
    expect(f.authorize).toHaveBeenCalledTimes(2)
    expect(f.authorize).toHaveBeenCalledWith(input.userId, input.sourceRevisionId, input.asset.assetId, "playback")
    expect(f.active).toHaveBeenCalledTimes(2)
    expect(f.active).toHaveBeenCalledWith({ jobId: input.jobId, userId: input.userId })
    const command = f.head.mock.calls[0]![0] as HeadObjectCommand
    expect(command).toBeInstanceOf(HeadObjectCommand)
    expect(command.input).toEqual({ Bucket: cfg.bucket, Key: f.allowed.artifact.objectKey })
    expect(result).toMatchObject({ ...input.asset, fetch: { method: "GET", headers: { "If-Match": '"etag-1"' } } })
    const url = new URL(result.fetch.url)
    expect(url.pathname).toBe(`/scene-private/${f.allowed.artifact.objectKey}`)
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("if-match")
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900")
    expect(url.searchParams.get("response-cache-control")).toBe("no-store")
    expect(JSON.stringify(result)).not.toContain("test-secret")
    expect(result).not.toHaveProperty("objectKey")
  })
  it.each(["not-found", "forbidden"] as const)("does not probe storage for a %s source", async reason => {
    const f = setup()
    f.authorize.mockResolvedValue({ ok: false, reason })
    await expect(f.grant(input)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING", message: "Scene input is unavailable" })
    expect(f.head).not.toHaveBeenCalled()
  })
  it("does not trust receipt fields, another bucket, another artifact, or private source kinds", async () => {
    const f = setup()
    for (const patch of [{ sha256: "c".repeat(64) }, { byteLength: 101 }, { bucket: "public-media" },
      { artifactId: input.jobId }, { kind: "source-json" as const }, { usage: "source" as const },
      { expiresAt: new Date(Date.now() + 1000).toISOString() }]) {
      f.authorize.mockResolvedValue({ ...f.allowed, artifact: { ...f.allowed.artifact, ...patch } })
      await expect(f.grant(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
    expect(f.head).not.toHaveBeenCalled()
  })
  it("refuses object replacement or a missing ETag before issuing a URL", async () => {
    const f = setup()
    for (const response of [{ ContentLength: 101, ETag: '"etag-1"' }, { ContentLength: 100, ETag: '"etag-2"' },
      { ContentLength: 100 }]) {
      f.head.mockResolvedValue(response as never)
      await expect(f.grant(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
  })
  it("rechecks revocation and the active job after asynchronous storage access", async () => {
    const f = setup()
    f.authorize.mockResolvedValueOnce(f.allowed).mockResolvedValueOnce({ ok: false, reason: "not-found" })
    await expect(f.grant(input)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    f.authorize.mockResolvedValue(f.allowed)
    f.active.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("job cancelled"))
    await expect(f.grant(input)).rejects.toThrow("job cancelled")
  })
  it("honors cancellation while storage is awaited", async () => {
    const f = setup(), controller = new AbortController()
    f.head.mockImplementation(async () => {
      controller.abort(new Error("stopped"))
      return { ContentLength: 100, ETag: '"etag-1"' } as never
    })
    await expect(f.grant(input, { signal: controller.signal })).rejects.toThrow("stopped")
    expect(f.authorize).toHaveBeenCalledOnce()
  })
  it("distinguishes a missing object from a storage outage without leaking transport details", async () => {
    const f = setup()
    f.head.mockRejectedValueOnce({ name: "NotFound", message: "private-key" })
    await expect(f.grant(input)).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING", message: "Scene input is unavailable" })
    f.head.mockRejectedValueOnce({ $metadata: { httpStatusCode: 503 }, message: "private-key" })
    await expect(f.grant(input)).rejects.toMatchObject({ code: "SCENE_STORAGE_FAILED", message: "Checking the scene input failed" })
  })
  it("refuses a changed source locator after the object check", async () => {
    const f = setup()
    f.authorize.mockResolvedValueOnce(f.allowed).mockResolvedValueOnce({ ...f.allowed,
      artifact: { ...f.allowed.artifact, objectKey: "other/key" } })
    await expect(f.grant(input)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
  })
  it("rejects caller URLs, malformed identities, excessive lifetime and public bucket reuse", async () => {
    const f = setup()
    for (const value of [{ ...input, sourceRevisionId: "../../other" }, { ...input, expiresInSeconds: 3600 },
      { ...input, asset: { ...input.asset, url: "https://other.example/object" } }]) {
      await expect(f.grant(value as never)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    }
    expect(f.active).not.toHaveBeenCalled()
    expect(() => createScene3DInputGranter(cfg, cfg.bucket, f.active, f.authorize)).toThrow("separate private bucket")
  })
})
