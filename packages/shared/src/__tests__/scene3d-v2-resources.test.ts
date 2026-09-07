import { describe, expect, it } from "vitest"
import { SCENE3D_V2_LIMITS, type Scene3DEntityV2 } from "../scene3d-v2.js"
import {
  SCENE3D_V2_CONTENT_HASH_EXCLUDED,
  canonicalScene3DPlanV2Json,
  computeScene3DPlanV2ContentHash,
  parseScene3DPlanV2Json,
  scene3DV2AdmissionIssues,
  scene3DV2HierarchyDepth,
  scene3DV2NormalizationIssues,
  scene3DV2ResourceUsage,
  verifyScene3DPlanV2ContentHash,
  type Scene3DNormalizedAssetStats,
} from "../scene3d-v2-resources.js"
import { FIXTURE_FRAMES, planV2 } from "./scene3d-v2-fixtures.js"

function stats(overrides: Partial<Scene3DNormalizedAssetStats>[] = []): Scene3DNormalizedAssetStats[] {
  const plan = planV2()
  const base: Scene3DNormalizedAssetStats[] = plan.assets.map((asset) => ({
    assetId: asset.assetId,
    kind: asset.kind,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    ...(asset.kind === "glb" ? { meshNodes: 40, triangles: 12_000, maxNodeDepth: 4 } : {}),
    ...(asset.kind === "poster" ? { imageWidth: 1680, imageHeight: 720 } : {}),
  }))
  overrides.forEach((patch, index) => {
    if (base[index]) base[index] = { ...base[index], ...patch }
  })
  return base
}

describe("scene3d v2 resources — declared usage", () => {
  it("reports what the manifest claims", () => {
    const usage = scene3DV2ResourceUsage(planV2())
    expect(usage.entities).toBe(3)
    expect(usage.assets).toBe(4)
    expect(usage.shots).toBe(4)
    expect(usage.overrides).toBe(3)
    expect(usage.frames).toBe(FIXTURE_FRAMES)
    expect(usage.durationSeconds).toBe(30)
    expect(usage.hierarchyDepth).toBe(2)
    // The native source is excluded from the renderer budget.
    expect(usage.rendererAssetBytes).toBe(1_200_000 + 640_000 + 90_000)
    expect(usage.blendSourceBytes).toBe(40_000_000)
    expect(usage.cameraTrackBytes).toBe(640_000)
  })

  it("measures hierarchy depth without looping on a cyclic plan", () => {
    const cyclic: Scene3DEntityV2[] = [
      { id: "a", name: "a", parentId: "b", visual: { kind: "group" }, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: "b", name: "b", parentId: "a", visual: { kind: "group" }, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ]
    expect(scene3DV2HierarchyDepth(cyclic)).toBe(2)
  })
})

describe("scene3d v2 resources — pre-allocation gate", () => {
  it("passes the fixture", () => {
    expect(scene3DV2AdmissionIssues(planV2())).toEqual([])
    expect(scene3DV2AdmissionIssues(planV2(), 40_000)).toEqual([])
  })

  it("refuses an oversized manifest", () => {
    const issues = scene3DV2AdmissionIssues(planV2(), SCENE3D_V2_LIMITS.maxManifestBytes + 1)
    expect(issues.map((issue) => issue.message).join(" ")).toContain("manifest is")
  })

  it("refuses a scene past either duration ceiling", () => {
    expect(
      scene3DV2AdmissionIssues(planV2({ durationInFrames: 3601 })).map((issue) => issue.message).join(" "),
    ).toContain("3601 frames")
    expect(
      scene3DV2AdmissionIssues(planV2({ fps: 15, durationInFrames: 3000 })).map((issue) => issue.message).join(" "),
    ).toContain("the limit is 60s")
  })

  it("refuses declared asset bytes past the download budget", () => {
    const plan = planV2()
    plan.assets[0] = { ...plan.assets[0], byteLength: SCENE3D_V2_LIMITS.maxRendererAssetBytes }
    expect(scene3DV2AdmissionIssues(plan).map((issue) => issue.message).join(" ")).toContain(
      "downloaded scene assets total",
    )
  })

  it("refuses too many entities or shots", () => {
    const many = Array.from({ length: 101 }, (_unused, index) => ({
      id: `n${index}`,
      name: `n${index}`,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      visual: { kind: "group" as const },
    }))
    expect(scene3DV2AdmissionIssues(planV2({ objects: many })).map((i) => i.message).join(" ")).toContain(
      "101 entities",
    )
  })
})

describe("scene3d v2 resources — post-decode gate", () => {
  it("passes matching stats", () => {
    expect(scene3DV2NormalizationIssues(planV2(), stats())).toEqual([])
  })

  it("catches bytes that do not match the manifest", () => {
    const issues = scene3DV2NormalizationIssues(planV2(), stats([{ byteLength: 999 }]))
    expect(issues.map((issue) => issue.message).join(" ")).toContain("is 999 bytes; the manifest declares")
  })

  it("catches a digest that does not match", () => {
    const issues = scene3DV2NormalizationIssues(planV2(), stats([{ sha256: "9".repeat(64) }]))
    expect(issues.map((issue) => issue.message).join(" ")).toContain("digest does not match")
  })

  it("catches an undeclared asset and a kind that changed after decode", () => {
    const foreign = scene3DV2NormalizationIssues(planV2(), [
      { assetId: "asset-ghost", kind: "glb", byteLength: 10 },
    ])
    expect(foreign.map((issue) => issue.message).join(" ")).toContain("is not declared in the manifest")

    const wrongKind = scene3DV2NormalizationIssues(planV2(), stats([{ kind: "poster" }]))
    expect(wrongKind.map((issue) => issue.message).join(" ")).toContain("decoded as")
  })

  it("sums triangles and mesh nodes across assets — compression waives nothing", () => {
    // A small file that decodes past the geometry budget is still refused.
    const overTriangles = scene3DV2NormalizationIssues(
      planV2(),
      stats([{ triangles: SCENE3D_V2_LIMITS.maxTriangles + 1 }]),
    )
    expect(overTriangles.map((issue) => issue.message).join(" ")).toContain("triangles; the limit is 200000")

    const overNodes = scene3DV2NormalizationIssues(planV2(), stats([{ meshNodes: 2001 }]))
    expect(overNodes.map((issue) => issue.message).join(" ")).toContain("2001 mesh nodes")
  })

  it("bounds node depth and image dimensions", () => {
    const deep = scene3DV2NormalizationIssues(planV2(), stats([{ maxNodeDepth: 17 }]))
    expect(deep.map((issue) => issue.message).join(" ")).toContain("nests 17 levels")

    const huge = scene3DV2NormalizationIssues(planV2(), stats([{}, {}, { imageWidth: 9000 }]))
    expect(huge.map((issue) => issue.message).join(" ")).toContain("imageWidth is 9000")
  })

  it("bounds decoded renderer bytes even when the manifest lied consistently", () => {
    const plan = planV2()
    plan.assets[0] = { ...plan.assets[0], byteLength: 70 * 1024 * 1024 }
    const issues = scene3DV2NormalizationIssues(plan, stats([{ byteLength: 70 * 1024 * 1024 }]))
    expect(issues.map((issue) => issue.message).join(" ")).toContain("decoded to")
  })
})

describe("scene3d v2 resources — manifest admission", () => {
  it("accepts a valid manifest payload", () => {
    const result = parseScene3DPlanV2Json(JSON.stringify(planV2()))
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.schemaVersion).toBe(2)
  })

  it("refuses an oversized manifest before parsing", () => {
    const result = parseScene3DPlanV2Json("x".repeat(SCENE3D_V2_LIMITS.maxManifestBytes + 1))
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.issues[0].message).toContain("manifest is")
  })

  it("reports malformed JSON and schema failures as issues", () => {
    expect(parseScene3DPlanV2Json("{{").ok).toBe(false)
    const broken = parseScene3DPlanV2Json(JSON.stringify(planV2({ shots: [] })))
    expect(broken.ok).toBe(false)
    expect(broken.ok ? [] : broken.issues.length).toBeGreaterThan(0)
  })
})

describe("scene3d v2 resources — content hash", () => {
  it("excludes identity, includes content", () => {
    expect([...SCENE3D_V2_CONTENT_HASH_EXCLUDED]).toEqual(["revisionId", "parentRevisionId"])
    const canonical = canonicalScene3DPlanV2Json(planV2())
    expect(canonical).not.toContain("revisionId")
    expect(canonical).not.toContain("contentHash")
    expect(canonical).toContain("bodyPaint")
    expect(canonical).toContain("shot-2")
  })

  it("is stable under key reordering and identity changes", async () => {
    const a = planV2()
    const reordered = JSON.parse(JSON.stringify({ ...a })) as typeof a
    // Rebuild the top level in reverse key order.
    const shuffled = Object.fromEntries(
      Object.entries(reordered).reverse(),
    ) as unknown as typeof a
    expect(canonicalScene3DPlanV2Json(shuffled)).toBe(canonicalScene3DPlanV2Json(a))

    const otherRevision = planV2({ revisionId: "7d5b0b64-2b6c-4d4a-9e4f-2f4b7f6a1c99" })
    expect(await computeScene3DPlanV2ContentHash(otherRevision)).toBe(
      await computeScene3DPlanV2ContentHash(a),
    )
  })

  it("changes when any content changes", async () => {
    const base = await computeScene3DPlanV2ContentHash(planV2())
    const recoloured = planV2()
    recoloured.objects[1].materialBindings = [
      { role: "bodyPaint", materialName: "Body Paint", color: "#00ff00" },
      { role: "tires", materialName: "Rubber", roughness: 0.9 },
    ]
    expect(await computeScene3DPlanV2ContentHash(recoloured)).not.toBe(base)

    const withoutOverride = planV2({ overrides: [] })
    expect(await computeScene3DPlanV2ContentHash(withoutOverride)).not.toBe(base)

    const differentDigest = planV2()
    differentDigest.assets[0] = { ...differentDigest.assets[0], sha256: "1".repeat(64) }
    expect(await computeScene3DPlanV2ContentHash(differentDigest)).not.toBe(base)
  })

  it("normalizes -0 so it cannot fork the hash", () => {
    const zero = planV2()
    zero.objects[2].position = [0, 0, 0]
    const negativeZero = planV2()
    negativeZero.objects[2].position = [-0, 0, 0]
    expect(canonicalScene3DPlanV2Json(negativeZero)).toBe(canonicalScene3DPlanV2Json(zero))
  })

  it("produces 64 lowercase hex characters, and verifies a declared hash", async () => {
    const plan = planV2()
    const hash = await computeScene3DPlanV2ContentHash(plan)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await verifyScene3DPlanV2ContentHash(plan)).toBe(false)
    expect(
      await verifyScene3DPlanV2ContentHash({ ...plan, provenance: { ...plan.provenance, contentHash: hash } }),
    ).toBe(true)
  })

  it("omits undefined-valued keys instead of emitting them", () => {
    const withUndefined = { ...planV2(), parentRevisionId: undefined }
    expect(canonicalScene3DPlanV2Json(withUndefined)).toBe(canonicalScene3DPlanV2Json(planV2()))
  })
})
