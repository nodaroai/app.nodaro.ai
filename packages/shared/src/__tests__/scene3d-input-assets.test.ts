import { describe, expect, it } from "vitest"
import { scene3DInputAssetsForEngine, scene3DInputAssetsSchema } from "../scene3d-input-assets.js"
import { buildPro3DRenderSource } from "../pro-3d-render.js"

const asset = { id: "vehicle", revisionId: "00000000-0000-4000-8000-000000000010",
  assetId: "00000000-0000-4000-8000-000000000011", label: "Vehicle" }

describe("immutable scene input selectors", () => {
  it("requires unique bounded selectors and excludes receipts and URLs", () => {
    expect(scene3DInputAssetsSchema.parse([asset])).toEqual([asset])
    for (const value of [[{ ...asset, url: "https://example.com/model.glb" }], [{ ...asset, sha256: "a".repeat(64) }],
      [{ ...asset, revisionId: "../other" }], [{ ...asset, label: "bad\nlabel" }],
      [asset, { ...asset, id: "another" }], [asset, { ...asset, assetId: asset.revisionId }], Array(9).fill(asset)]) {
      expect(scene3DInputAssetsSchema.safeParse(value).success).toBe(false)
    }
  })
  it("refuses Basic imports instead of silently ignoring geometry", () => {
    for (const engine of [undefined, "basic", "unknown"]) {
      expect(() => scene3DInputAssetsForEngine([asset], engine)).toThrow("advanced scene engine")
    }
    expect(scene3DInputAssetsForEngine(undefined, undefined)).toEqual([])
    expect(scene3DInputAssetsForEngine([asset], "blender-cloud")).toEqual([asset])
  })
  it("carries inputs on new Pro scenes while export keeps its existing revision", () => {
    expect(buildPro3DRenderSource({ prompt: "Drive past the camera", inputAssets: [asset] }))
      .toEqual({ ok: true, source: { kind: "prompt", prompt: "Drive past the camera", inputAssets: [asset] } })
    expect(buildPro3DRenderSource({ sourceMode: "scene", revisionId: asset.revisionId, inputAssets: [asset] }))
      .toEqual({ ok: true, source: { kind: "scene", revisionId: asset.revisionId } })
    expect(buildPro3DRenderSource({ prompt: "Drive", inputAssets: [{ ...asset, url: "https://example.com" } as never] }).ok).toBe(false)
  })
})
