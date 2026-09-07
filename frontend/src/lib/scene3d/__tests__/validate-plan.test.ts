import { describe, it, expect } from "vitest"
import { SCENE3D_LIMITS, SCENE3D_V2_LIMITS } from "@nodaro/shared"
import { validateScene3DAnyPlan, validateScene3DPlan } from "../validate-plan"
import { FAKE_DIGEST, makePlan, makeV2Plan } from "./fixture"

/** One object the schema accepts, cloneable into a huge array. */
function obj(id: string, parentId?: string) {
  return {
    id,
    name: id,
    primitive: "box",
    dimensions: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffffff",
    ...(parentId ? { parentId } : {}),
  }
}

describe("validateScene3DPlan", () => {
  it("accepts a plan the shared schema accepts, and hands back the PARSED plan", () => {
    const result = validateScene3DPlan(makePlan())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.objects).toHaveLength(2)
    // Parsed, not the raw record: schema defaults are applied.
    expect(result.plan.camera.sensorWidthMm).toBe(36)
  })

  it("rejects a non-plan without throwing", () => {
    for (const value of [undefined, null, "a scene", 42, []]) {
      const result = validateScene3DPlan(value)
      expect(result.ok).toBe(false)
    }
  })

  /**
   * The size checks answer in O(1) instead of letting zod walk every element
   * to report a `.max()` breach — an imported/agent-authored plan is exactly
   * where a 200k-object array comes from, and the GPU allocation the viewport
   * would then do is per object.
   */
  it("rejects an oversized object array immediately, and says the count", () => {
    const objects = Array.from({ length: SCENE3D_LIMITS.maxObjects + 500 }, (_, i) => obj(`o${i}`))
    const started = Date.now()
    const result = validateScene3DPlan(makePlan({ objects }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue).toContain(String(SCENE3D_LIMITS.maxObjects))
    expect(Date.now() - started).toBeLessThan(500)
  })

  it("rejects an over-long keyframe track (object and camera)", () => {
    const keyframes = Array.from({ length: SCENE3D_LIMITS.maxKeyframes + 2 }, (_, i) => ({ frame: i, position: [0, 0, 0] }))
    expect(validateScene3DPlan(makePlan({ objects: [{ ...obj("a"), keyframes }] })).ok).toBe(false)
    const camera = { position: [0, 2, 6], target: [0, 1, 0], focalLengthMm: 50, sensorWidthMm: 36, keyframes }
    expect(validateScene3DPlan(makePlan({ camera })).ok).toBe(false)
  })

  it("rejects an out-of-range canvas rather than sizing a viewport to it", () => {
    expect(validateScene3DPlan(makePlan({ width: 40000, height: 40000 })).ok).toBe(false)
  })

  /**
   * A parent cycle is what turns the renderer's transform walk into a hang.
   * The shared schema is the guard; this pins that it actually is one, because
   * the frontend deliberately does NOT keep its own cycle walker.
   */
  it("rejects a parent cycle", () => {
    const cyclic = validateScene3DPlan(makePlan({ objects: [obj("a", "b"), obj("b", "a")] }))
    expect(cyclic.ok).toBe(false)
    const selfParent = validateScene3DPlan(makePlan({ objects: [obj("a", "a")] }))
    expect(selfParent.ok).toBe(false)
  })

  it("memoizes per plan object so the viewport and the editors share one parse", () => {
    const plan = makePlan()
    expect(validateScene3DPlan(plan)).toBe(validateScene3DPlan(plan))
  })

  it("leaves an invalid plan's DATA intact — validation never mutates", () => {
    const plan = makePlan({ backgroundColor: "not-a-colour" })
    const before = JSON.stringify(plan)
    expect(validateScene3DPlan(plan).ok).toBe(false)
    expect(JSON.stringify(plan)).toBe(before)
  })
})

describe("validateScene3DAnyPlan — the v1|v2 union", () => {
  it("accepts a v2 plan and NARROWS it, without any cast", () => {
    const result = validateScene3DAnyPlan(makeV2Plan())
    expect(result.ok).toBe(true)
    if (!result.ok || result.version !== 2) throw new Error("expected a v2 plan")
    // v2 fields are reachable because `version` discriminated the result.
    expect(result.plan.shots).toHaveLength(2)
    expect(result.plan.cameraTrackAssetId).toBe("cam")
    expect(result.plan.objects.map((e) => e.id)).toEqual(["hero", "car"])
  })

  it("still narrows a v1 plan to v1", () => {
    const result = validateScene3DAnyPlan(makePlan())
    if (!result.ok || result.version !== 1) throw new Error("expected a v1 plan")
    expect(result.plan.camera.focalLengthMm).toBe(50)
  })

  it("says which version it cannot open, rather than 'invalid scene'", () => {
    const result = validateScene3DAnyPlan(makeV2Plan({ schemaVersion: 7 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue).toMatch(/schema version 7/)
  })

  it("rejects something that is not a scene plan at all", () => {
    const result = validateScene3DAnyPlan({ planType: "video", schemaVersion: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue).toMatch(/not a 3D scene plan/)
  })

  /**
   * The v2 size guards are the browser's only defence BEFORE it starts
   * downloading: a manifest is a promise about bytes, and a plan that promises
   * more than the renderer budget must be refused before the first request, not
   * after the tab has allocated from a number nobody checked.
   */
  it("rejects a declared asset budget over the renderer limit, without fetching", () => {
    const result = validateScene3DAnyPlan(
      makeV2Plan({
        assets: [
          {
            assetId: "geo",
            kind: "glb",
            role: "entity-geometry",
            byteLength: SCENE3D_V2_LIMITS.maxRendererAssetBytes + 1,
            sha256: FAKE_DIGEST,
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue).toMatch(/assets: this scene declares/)
  })

  it("does NOT count the .blend source against the renderer budget", () => {
    // The native file is a separately authorized download the renderer never
    // fetches, so a big one must not make a playable scene unopenable.
    const plan = makeV2Plan()
    const assets = [
      ...(plan.assets as unknown[]),
      {
        assetId: "src",
        kind: "blend-source",
        role: "source",
        byteLength: SCENE3D_V2_LIMITS.maxRendererAssetBytes * 2,
        sha256: FAKE_DIGEST,
      },
    ]
    expect(validateScene3DAnyPlan(makeV2Plan({ assets })).ok).toBe(true)
  })

  it("rejects an oversized entity list in O(1)", () => {
    const objects = Array.from({ length: SCENE3D_V2_LIMITS.maxEntities + 200 }, (_, i) => ({
      id: `e${i}`,
      name: `e${i}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visual: { kind: "primitive", primitive: "box", dimensions: [1, 1, 1], color: "#ffffff" },
    }))
    const started = Date.now()
    const result = validateScene3DAnyPlan(makeV2Plan({ objects }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue).toContain(String(SCENE3D_V2_LIMITS.maxEntities))
    expect(Date.now() - started).toBeLessThan(500)
  })

  it("keeps the v1-only entry point v1-only, so v1 consumers stay narrowed", () => {
    const v2 = makeV2Plan()
    const result = validateScene3DPlan(v2)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue).toMatch(/schema version 2/)
    // …while the union entry point opens the very same object.
    expect(validateScene3DAnyPlan(v2).ok).toBe(true)
  })

  it("memoizes both entry points per plan object", () => {
    const plan = makeV2Plan()
    expect(validateScene3DAnyPlan(plan)).toBe(validateScene3DAnyPlan(plan))
    expect(validateScene3DPlan(plan)).toBe(validateScene3DPlan(plan))
  })
})
