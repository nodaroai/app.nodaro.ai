import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { retainScene3DInput } from "../scene3d-retain-input.js"
import { verifyScene3DArtifactBytes } from "../../../services/scene3d-artifacts/receipt.js"
import type { authorizeScene3DInputArtifact } from "../scene3d-input-authority.js"
import type { PluginSceneArtifactToolkit } from "../scene3d-artifact-contract.js"

const id = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`
const bytes = Buffer.alloc(32, 1)
bytes.write("glTF", 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8)
const sha256 = createHash("sha256").update(bytes).digest("hex")
const input = { jobId: id(1), userId: id(2), revisionId: id(3), artifactId: id(4), sourceRevisionId: id(5),
  asset: { assetId: id(6), kind: "glb" as const, sha256, byteLength: bytes.length } }
function setup() {
  let stored: Buffer | undefined
  const authorizeSource = vi.fn<typeof authorizeScene3DInputArtifact>(async () => ({ ok: true,
    revision: { revisionId: input.sourceRevisionId, userId: id(7), workflowId: id(8), sourceJobId: null,
      parentRevisionId: null, planSha256: sha256, createdAt: "", plan: {} },
    artifact: { artifactId: input.asset.assetId, userId: id(7), kind: "glb", usage: "playback", bucket: "private",
      objectKey: "original", sha256, byteLength: bytes.length, etag: "tag", expiresAt: null, createdAt: "" },
  }))
  const grantInput = vi.fn(async () => ({ ...input.asset, fetch: { method: "GET" as const, url: "https://store.example/original", headers: { "If-Match": '"tag"' } } }))
  const grant = vi.fn(async () => ({ key: "copy", method: "PUT" as const, url: "https://store.example/copy",
    headers: { "If-None-Match": "*" }, verifyUrl: "head", verifyHeaders: {}, expiresAt: Date.now() + 900000 }))
  const receive = vi.fn<PluginSceneArtifactToolkit["receive"]>(async () => {
    const store = { bucket: "private", delete: vi.fn(), get: async () => ({ body: Readable.from([stored!]), contentLength: stored!.length, etag: "copy-tag" }) }
    const receipt = await verifyScene3DArtifactBytes(store, "copy", { kind: "input-glb", sha256, byteLength: bytes.length })
    return { artifactId: input.artifactId, kind: "input-glb", sha256, byteLength: stored!.length, objectKey: "copy", etag: receipt.etag }
  })
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.method === "GET") return new Response(bytes)
    if (stored) return new Response(null, { status: 412 })
    stored = Buffer.from(options!.body as Uint8Array)
    return new Response(null, { status: 200 })
  })
  const authorizeJob = vi.fn(async () => {})
  const toolkit = { grantInput, grant, receive }
  const options = { authorizeSource, authorizeJob, fetch: fetcher }
  const run = () => retainScene3DInput(toolkit, input, options)
  return { authorizeSource, authorizeJob, fetcher, toolkit, options, grant, receive, run }
}
describe("owned scene input copies", () => {
  it("copies a collaborator's exact bytes into an owned reservation and independently verifies receipt", async () => {
    const f = setup()
    expect(await f.run()).toMatchObject({ artifactId: input.artifactId, kind: "input-glb", sha256, byteLength: bytes.length })
    expect(f.grant).toHaveBeenCalledWith(expect.objectContaining({ userId: input.userId, revisionId: input.revisionId, kind: "input-glb" }))
    expect(f.authorizeSource).toHaveBeenCalledTimes(3)
    expect(f.fetcher).toHaveBeenNthCalledWith(1, "https://store.example/original", expect.objectContaining({ redirect: "error", headers: { "If-Match": '"tag"' } }))
    expect(f.receive).toHaveBeenCalledOnce()
    expect(await f.run()).toMatchObject({ sha256 })
  })
  it("refuses source revocation before transfer and after transfer without reserving a copy", async () => {
    const f = setup()
    f.authorizeSource.mockResolvedValueOnce({ ok: false, reason: "not-found" })
    await expect(f.run()).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(f.fetcher).not.toHaveBeenCalled()
    const g = setup()
    g.authorizeSource.mockResolvedValueOnce(await g.authorizeSource(input.userId, input.sourceRevisionId, input.asset.assetId))
      .mockResolvedValueOnce({ ok: false, reason: "forbidden" })
    await expect(g.run()).rejects.toMatchObject({ code: "SCENE_ASSET_MISSING" })
    expect(g.grant).not.toHaveBeenCalled()
  })
  it.each(["digest", "overflow", "truncated"])("refuses %s before any output write", async mode => {
    const f = setup(), changed = Buffer.from(bytes)
    changed[20] = 9
    f.fetcher.mockResolvedValueOnce(new Response(mode === "digest" ? changed : mode === "overflow" ? Buffer.concat([bytes, bytes]) : bytes.subarray(0, 16)))
    await expect(f.run()).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    expect(f.grant).not.toHaveBeenCalled()
  })
  it("honors transfer cancellation and rejects malformed input without IO", async () => {
    const f = setup(), controller = new AbortController()
    f.fetcher.mockImplementationOnce(async () => { controller.abort(new Error("cancelled")); return new Response(bytes) })
    await expect(retainScene3DInput(f.toolkit, input, { ...f.options, signal: controller.signal })).rejects.toThrow("cancelled")
    expect(f.grant).not.toHaveBeenCalled()
    const g = setup()
    await expect(retainScene3DInput(g.toolkit, { ...input, artifactId: "../../key" }, g.options)).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
    expect(g.authorizeJob).not.toHaveBeenCalled()
  })
})
