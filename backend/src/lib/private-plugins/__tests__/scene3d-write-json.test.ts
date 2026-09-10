import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { writeScene3DJson, writeScene3DPng, receiveScene3DPngIfPresent } from "../scene3d-write-json.js"
import { Scene3DArtifactError } from "../../../services/scene3d-artifacts/types.js"
import { SCENE3D_LIMITS } from "@nodaro/shared"
import type { PluginSceneArtifactToolkit } from "../scene3d-artifact-contract.js"

function fixture(status = 200) {
  const bytes = Buffer.from('{"version":1}')
  const input = { jobId: "job", userId: "owner", revisionId: "revision", artifactId: "artifact", kind: "source-json" as const, bytes }
  const receipt = { artifactId: "artifact", kind: "source-json" as const, objectKey: "owned/key", byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), etag: "tag" }
  const toolkit: Pick<PluginSceneArtifactToolkit, "grant" | "receive"> = {
    grant: vi.fn().mockResolvedValue({ key: "owned/key", url: "https://store.example/object?signature=secret",
      headers: { "If-None-Match": "*" }, method: "PUT", verifyUrl: "https://store.example/head", verifyHeaders: {}, expiresAt: 900 }),
    receive: vi.fn().mockResolvedValue(receipt),
  }
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status }))
  return { input, receipt, toolkit, fetch }
}

describe("owned scene JSON writes", () => {
  it.each([200, 412])("accepts status %i only after independent receipt verification", async (status) => {
    const f = fixture(status)
    await expect(writeScene3DJson(f.toolkit, f.input, { fetch: f.fetch })).resolves.toEqual(f.receipt)
    expect(f.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "PUT", redirect: "error",
      headers: { "If-None-Match": "*" }, body: f.input.bytes }))
    expect(f.toolkit.receive).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", jobId: "job", revisionId: "revision" }))
  })
  it.each(["sha256", "objectKey", "artifactId", "kind", "byteLength"])("rejects a conflicting immutable %s", async (field) => {
    const f = fixture(412)
    vi.mocked(f.toolkit.receive).mockResolvedValue({ ...f.receipt, [field]: field === "byteLength" ? 99 : "other" })
    await expect(writeScene3DJson(f.toolkit, f.input, { fetch: f.fetch })).rejects.toThrow("differs")
  })
  it("refuses invalid data and cancelled requests before granting", async () => {
    const f = fixture()
    for (const bytes of [Buffer.from("not json"), Buffer.from([0xff]), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
      await expect(writeScene3DJson(f.toolkit, { ...f.input, bytes }, { fetch: f.fetch })).rejects.toThrow()
    }
    await expect(writeScene3DJson(f.toolkit, f.input, { fetch: f.fetch, signal: AbortSignal.abort() })).rejects.toThrow()
    expect(f.toolkit.grant).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
  })
  it("does not publish transport errors or adopt a failed upload", async () => {
    const f = fixture(503)
    await expect(writeScene3DJson(f.toolkit, f.input, { fetch: f.fetch })).rejects.toThrow("upload failed")
    expect(f.toolkit.receive).not.toHaveBeenCalled()
    f.fetch.mockRejectedValue(new Error("failed https://store.example?signature=secret"))
    await expect(writeScene3DJson(f.toolkit, f.input, { fetch: f.fetch })).rejects.toThrow("could not be confirmed")
  })
  it("snapshots mutable input before awaiting a grant", async () => {
    const f = fixture()
    const original = Buffer.from(f.input.bytes)
    const grant = await f.toolkit.grant(f.input)
    vi.mocked(f.toolkit.grant).mockImplementation(async () => { f.input.bytes.fill(120); return grant })
    await writeScene3DJson(f.toolkit, f.input, { fetch: f.fetch })
    expect(f.fetch.mock.calls[0][1]?.body).toEqual(original)
  })
})

describe("owned scene still writes", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=", "base64")
  it("verifies a rendered PNG through the same immutable receipt path", async () => {
    const f = fixture(412)
    const receipt = { ...f.receipt, kind: "poster" as const, byteLength: png.length,
      sha256: createHash("sha256").update(png).digest("hex") }
    vi.mocked(f.toolkit.receive).mockResolvedValue(receipt)
    await expect(writeScene3DPng(f.toolkit, { ...f.input, kind: "poster", bytes: png }, { fetch: f.fetch })).resolves.toEqual(receipt)
  })
  it("adopts a previously rendered frame even if a retry encodes different PNG bytes", async () => {
    const f = fixture(412)
    const stored = { ...f.receipt, kind: "poster" as const, byteLength: png.length + 8, sha256: "b".repeat(64) }
    vi.mocked(f.toolkit.receive).mockResolvedValue(stored)
    await expect(writeScene3DPng(f.toolkit, { ...f.input, kind: "poster", bytes: png }, { fetch: f.fetch })).resolves.toEqual(stored)
    await expect(receiveScene3DPngIfPresent(f.toolkit, f.input)).resolves.toEqual(stored)
  })
  it("treats only a definite missing frame as permission to render again", async () => {
    const f = fixture()
    vi.mocked(f.toolkit.receive).mockRejectedValueOnce(new Scene3DArtifactError("SCENE_ASSET_MISSING", "Not found"))
    await expect(receiveScene3DPngIfPresent(f.toolkit, f.input)).resolves.toBeNull()
    vi.mocked(f.toolkit.receive).mockRejectedValueOnce(new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Read unavailable"))
    await expect(receiveScene3DPngIfPresent(f.toolkit, f.input)).rejects.toThrow("Read unavailable")
  })
  it("rejects invalid headers, oversize images and wrong kinds before granting", async () => {
    const f = fixture()
    // One past the CONTRACT's ceiling, not a literal — this guard exists to
    // track `SCENE3D_LIMITS.maxDimensionPx`, so the test must move with it.
    const wide = Buffer.from(png); wide.writeUInt32BE(SCENE3D_LIMITS.maxDimensionPx + 1, 16)
    for (const bytes of [Buffer.from("not a png"), wide, Buffer.alloc(8 * 1024 * 1024 + 1)]) {
      await expect(writeScene3DPng(f.toolkit, { ...f.input, kind: "poster", bytes }, { fetch: f.fetch })).rejects.toThrow("bounded PNG")
    }
    await expect(writeScene3DPng(f.toolkit, { ...f.input, bytes: png }, { fetch: f.fetch })).rejects.toThrow()
    expect(f.toolkit.grant).not.toHaveBeenCalled()
  })
})
