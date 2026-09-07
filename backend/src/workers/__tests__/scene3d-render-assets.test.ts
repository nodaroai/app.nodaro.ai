import { afterEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { computeScene3DPlanV2ContentHash, type Scene3DPlanV2 } from "@nodaro/shared"
const auth = vi.hoisted(() => ({ revision: vi.fn(), asset: vi.fn() }))
vi.mock("../../services/scene3d-artifacts/authorize.js", () => ({ authorizeScene3DRevision: auth.revision, authorizeScene3DArtifact: auth.asset }))
import { authorizeScene3DRenderPlan, prepareScene3DRenderAssets } from "../scene3d-render-assets.js"

const dirs: string[] = []
const closers: Array<() => void> = []
afterEach(async () => { closers.splice(0).forEach((close) => close()); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); vi.resetAllMocks() })
async function setup() {
  // This suite tests the authorized transport. The receipt/renderer suites own format parsing.
  const data = { geometry: Buffer.from("glb"), camera: Buffer.from("{}"), source: Buffer.from("native source") }
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
  const plan: Scene3DPlanV2 = { planType: "3d-scene", schemaVersion: 2,
    revisionId: "7d5b0b64-2b6c-4d4a-9e4f-2f4b7f6a1c01", width: 320, height: 180, fps: 24, durationInFrames: 24,
    units: "meters", upAxis: "Y", handedness: "right", backgroundColor: "#111111",
    objects: [{ id: "cube", name: "Cube", visual: { kind: "asset", assetId: "geometry", rootNodeId: "cube" } }],
    assets: [
      { assetId: "geometry", kind: "glb", role: "scene-geometry", byteLength: data.geometry.length, sha256: hash(data.geometry) },
      { assetId: "camera", kind: "camera-track-json", role: "camera-track", byteLength: data.camera.length, sha256: hash(data.camera) },
      { assetId: "source", kind: "blend-source", role: "source", byteLength: data.source.length, sha256: hash(data.source) },
    ], cameraTrackAssetId: "camera", shots: [{ id: "shot", startFrame: 0, endFrameExclusive: 24 }],
    lighting: { preset: "clay-studio-v1", ambientIntensity: 1, keyIntensity: 1, keyPosition: [2,4,5] },
    provenance: { engine: "blender-cloud", engineVersion: "1", compilerVersion: "1", exporterVersion: "1", recipeVersion: "1", rendererVersion: "2", sourceArtifactId: "source", contentHash: "0".repeat(64) },
  }
  plan.provenance.contentHash = await computeScene3DPlanV2ContentHash(plan)
  auth.revision.mockResolvedValue({ ok: true, revision: { plan } })
  auth.asset.mockImplementation(async (_user, _revision, id) => ({ ok: true, artifact: {
    ...plan.assets.find((a) => a.assetId === id), bucket: "private", objectKey: id,
  } }))
  const store = { bucket: "private", get: vi.fn(async (key: string) => ({ body: Readable.from([data[key as keyof typeof data]]), contentLength: data[key as keyof typeof data].length, etag: "tag" })), delete: vi.fn() }
  const workDir = await mkdtemp(join(tmpdir(), "scene-render-test-")); dirs.push(workDir)
  return { plan, store, workDir, userId: "owner", signal: new AbortController().signal }
}
describe("private scene assets for Remotion", () => {
  it("serves only verified playback bytes behind a loopback token, with no source download", async () => {
    const input = await setup()
    const server = await prepareScene3DRenderAssets(input); closers.push(server.close)
    expect(Object.keys(server.assetUrls)).toEqual(["geometry", "camera"])
    const response = await fetch(server.assetUrls.geometry)
    expect(await response.text()).toBe("glb")
    expect(response.headers.get("content-type")).toBe("model/gltf-binary")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    const url = new URL(server.assetUrls.geometry)
    expect((await fetch(`${url.origin}/geometry`)).status).toBe(404)
    expect((await fetch(server.assetUrls.geometry.replace(/geometry$/, "source"))).status).toBe(404)
    expect(input.store.get.mock.calls.map(([key]) => key)).toEqual(["geometry", "camera"])
  })
  it("rejects a changed manifest, inaccessible revision, or substituted same-length bytes", async () => {
    const input = await setup()
    await expect(authorizeScene3DRenderPlan(input.userId, { ...input.plan, backgroundColor: "#ffffff" })).rejects.toThrow("exact retained")
    input.store.get.mockImplementation(async () => ({ body: Readable.from([Buffer.from("bad")]), contentLength: 3, etag: "tag" }))
    await expect(prepareScene3DRenderAssets(input)).rejects.toThrow("digest")
    auth.revision.mockResolvedValue({ ok: false })
    await expect(prepareScene3DRenderAssets(input)).rejects.toThrow("unavailable")
  })
  it("rechecks access for every new asset read and refuses cancellation", async () => {
    const input = await setup()
    auth.asset.mockResolvedValue({ ok: false })
    await expect(prepareScene3DRenderAssets(input)).rejects.toThrow("unavailable")
    expect(input.store.get).not.toHaveBeenCalled()
    const controller = new AbortController(); controller.abort(new Error("cancelled"))
    await expect(prepareScene3DRenderAssets({ ...input, signal: controller.signal })).rejects.toThrow("cancelled")
  })
})
