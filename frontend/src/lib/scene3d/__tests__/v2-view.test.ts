import { describe, it, expect } from "vitest"
import type { Scene3DPlanV2 } from "@nodaro/shared"
import { validateScene3DAnyPlan } from "../validate-plan"
import {
  buildEntityColorOperation,
  buildEntityTransformOperation,
  buildEntityVisibilityOperation,
  entityViews,
  shotIndexAtFrame,
  shotViews,
} from "../v2-view"
import { FAKE_DIGEST, REV_V2, makeV2Plan } from "./fixture"

function plan(overrides: Record<string, unknown> = {}): Scene3DPlanV2 {
  const result = validateScene3DAnyPlan(makeV2Plan(overrides))
  if (!result.ok || result.version !== 2) throw new Error(result.ok ? "not v2" : result.issue)
  return result.plan
}

function transformOverride(entityId: string, fields: Record<string, unknown>) {
  return {
    id: `ov-${entityId}`,
    kind: "entity-transform",
    entityId,
    space: "local",
    sourceRevisionId: REV_V2,
    sourceContentHash: FAKE_DIGEST,
    operationVersion: 1,
    ...fields,
  }
}

describe("shots", () => {
  it("lists the shots and finds the one owning a frame", () => {
    const p = plan()
    expect(shotViews(p).map((s) => s.label)).toEqual(["Wide", "Close"])
    expect(shotIndexAtFrame(p, 0)).toBe(0)
    expect(shotIndexAtFrame(p, 47)).toBe(0)
    // The cut is exclusive at the end, so frame 48 belongs to the NEXT shot —
    // the frame→shot answer must match the renderer's, or the strip highlights
    // one shot while the viewport draws the other.
    expect(shotIndexAtFrame(p, 48)).toBe(1)
  })
})

describe("entityViews", () => {
  it("reads identity, roles and material bindings off the manifest", () => {
    const [hero, car] = entityViews(plan())
    expect(hero.kind).toBe("primitive")
    expect(hero.color).toBe("#f4a261")
    expect(hero.transform?.position).toEqual([0, 0.5, 0])
    expect(hero.placementFromAsset).toBe(false)

    expect(car.kind).toBe("asset")
    // The GLB node transform is authoritative for an asset entity, and this one
    // declares no manifest snapshot — so there is nothing truthful to show.
    expect(car.transform).toBeNull()
    expect(car.placementFromAsset).toBe(true)
    expect(car.materials).toEqual([{ role: "body", color: "#2a9d8f", overridden: false }])
  })

  it("shows overridden values as the effective ones, and marks them", () => {
    const p = plan({
      overrides: [
        transformOverride("hero", { position: [2, 0.5, 0] }),
        {
          id: "ov-color",
          kind: "entity-color",
          entityId: "car",
          materialRole: "body",
          color: "#ff0073",
          sourceRevisionId: REV_V2,
          sourceContentHash: FAKE_DIGEST,
          operationVersion: 1,
        },
        {
          id: "ov-vis",
          kind: "entity-visibility",
          entityId: "car",
          visible: false,
          sourceRevisionId: REV_V2,
          sourceContentHash: FAKE_DIGEST,
          operationVersion: 1,
        },
      ],
    })
    const [hero, car] = entityViews(p)
    expect(hero.transform?.position).toEqual([2, 0.5, 0])
    // Untouched channels still read from the manifest, because the renderer
    // applies only the channels the override names.
    expect(hero.transform?.scale).toEqual([1, 1, 1])
    expect(hero.transformOverridden).toBe(true)
    expect(car.materials[0]).toEqual({ role: "body", color: "#ff0073", overridden: true })
    expect(car.visible).toBe(false)
    expect(car.visibilityOverridden).toBe(true)
  })

  it("honours the entity's capabilities, its own locks, and the node's lock list", () => {
    const p = plan({
      objects: [
        {
          id: "hero",
          name: "Hero",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          capabilities: ["color"],
          visual: { kind: "primitive", primitive: "box", dimensions: [1, 1, 1], color: "#ffffff" },
        },
        {
          id: "frozen",
          name: "Frozen",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          locks: ["transform"],
          visual: { kind: "primitive", primitive: "box", dimensions: [1, 1, 1], color: "#ffffff" },
        },
        {
          id: "held",
          name: "Held",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          visual: { kind: "primitive", primitive: "box", dimensions: [1, 1, 1], color: "#ffffff" },
        },
      ],
      assets: [{ assetId: "cam", kind: "camera-track-json", role: "camera-track", byteLength: 2, sha256: FAKE_DIGEST }],
    })
    const [hero, frozen, held] = entityViews(p, { lockedObjectIds: ["held"] })

    // Advertised capabilities are a whitelist: an entity that only offers
    // colour cannot be moved, even though the control exists.
    expect(hero.can).toEqual({ transform: false, color: true, visibility: false })
    expect(frozen.can.transform).toBe(false)
    // The node's own lock list holds the CANVAS to the same rule the model is
    // held to — a locked entity is not hand-editable either.
    expect(held.can).toEqual({ transform: false, color: false, visibility: false })
  })
})

describe("edit operations", () => {
  it("names only the edited channel, and carries forward the ones already overridden", () => {
    const p = plan({ overrides: [transformOverride("hero", { rotation: [0, 1, 0] })] })
    const [hero] = entityViews(p)
    const op = buildEntityTransformOperation(p, hero, "position", "x", 3)
    expect(op).toEqual({
      op: "set-override",
      override: {
        kind: "entity-transform",
        entityId: "hero",
        space: "local",
        // Kept: dropping it would silently reset a rotation the user set.
        rotation: [0, 1, 0],
        position: [3, 0.5, 0],
      },
    })
    // Scale is NOT named — the renderer would otherwise replace the baked value
    // with whatever the panel happened to be displaying.
    if (!op || op.op !== "set-override") throw new Error("expected a set-override")
    expect("scale" in op.override).toBe(false)
  })

  it("clamps to the bounds the shared schema accepts", () => {
    const p = plan()
    const [hero] = entityViews(p)
    const op = buildEntityTransformOperation(p, hero, "position", "y", 1e12)
    if (!op || op.op !== "set-override" || op.override.kind !== "entity-transform") throw new Error("expected a transform")
    expect(op.override.position?.[1]).toBeLessThan(1e12)
  })

  it("returns null rather than an empty edit", () => {
    const p = plan()
    const [hero, car] = entityViews(p)
    // Same value → nothing to do.
    expect(buildEntityTransformOperation(p, hero, "position", "x", 0)).toBeNull()
    expect(buildEntityColorOperation(hero, "identity", "#F4A261")).toBeNull()
    expect(buildEntityVisibilityOperation(hero, true)).toBeNull()
    // An asset entity with no transform to show cannot be nudged blind.
    expect(buildEntityTransformOperation(p, car, "position", "x", 1)).toBeNull()
  })

  it("refuses an edit the entity does not accept", () => {
    const p = plan({
      objects: [
        {
          id: "hero",
          name: "Hero",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          locks: ["transform", "color", "visibility"],
          visual: { kind: "primitive", primitive: "box", dimensions: [1, 1, 1], color: "#ffffff" },
        },
      ],
      assets: [{ assetId: "cam", kind: "camera-track-json", role: "camera-track", byteLength: 2, sha256: FAKE_DIGEST }],
    })
    const [hero] = entityViews(p)
    expect(buildEntityTransformOperation(p, hero, "position", "x", 5)).toBeNull()
    expect(buildEntityColorOperation(hero, "identity", "#000000")).toBeNull()
    expect(buildEntityVisibilityOperation(hero, false)).toBeNull()
  })

  it("builds colour and visibility overrides for a real change", () => {
    const p = plan()
    const [, car] = entityViews(p)
    expect(buildEntityColorOperation(car, "body", "#ff0073")).toEqual({
      op: "set-override",
      override: { kind: "entity-color", entityId: "car", materialRole: "body", color: "#ff0073" },
    })
    expect(buildEntityVisibilityOperation(car, false)).toEqual({
      op: "set-override",
      override: { kind: "entity-visibility", entityId: "car", visible: false },
    })
  })
})
