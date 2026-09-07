/**
 * Scene3D contract tests.
 *
 * The rules here are the ones a downstream consumer is entitled to assume:
 * a parsed plan has no cycles, no dangling parents, no out-of-range or
 * unsorted keyframes and no scene longer than the ceiling; an edit produces a
 * NEW revision without touching the input; a stale revision and a locked
 * object are refused rather than silently applied.
 */
import { describe, it, expect } from "vitest"
import {
  SCENE3D_LIMITS,
  scene3DColorSchema,
  SCENE3D_PLAN_TYPE,
  SCENE3D_SCHEMA_VERSION,
  applyScene3DEditOperations,
  isScene3DPlan,
  newScene3DRevisionId,
  scene3DDeepEqual,
  scene3DEditOperationSchema,
  scene3DPlanSchema,
  summarizeScene3DOperations,
  type Scene3DObject,
  type Scene3DPlan,
} from "../index.js"

const REV_A = "11111111-2222-4333-8444-555555555555"
const REV_B = "66666666-7777-4888-8999-aaaaaaaaaaaa"

function object(id: string, over: Partial<Scene3DObject> = {}): Scene3DObject {
  return {
    id,
    name: id,
    primitive: "box",
    dimensions: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#8899aa",
    ...over,
  }
}

function plan(over: Partial<Scene3DPlan> = {}): Scene3DPlan {
  return {
    planType: SCENE3D_PLAN_TYPE,
    schemaVersion: SCENE3D_SCHEMA_VERSION,
    revisionId: REV_A,
    width: 1280,
    height: 720,
    fps: 24,
    durationInFrames: 96,
    backgroundColor: "#101014",
    camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35, sensorWidthMm: 36 },
    objects: [object("ground", { primitive: "plane", dimensions: [10, 0.01, 10] })],
    lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
    ...over,
  }
}

describe("scene3DPlanSchema — structure", () => {
  it("accepts a minimal well-formed plan", () => {
    expect(scene3DPlanSchema.safeParse(plan()).success).toBe(true)
    expect(isScene3DPlan(plan())).toBe(true)
  })

  it("defaults sensorWidthMm to full frame", () => {
    const camera = { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35 }
    const parsed = scene3DPlanSchema.parse({ ...plan(), camera })
    expect(parsed.camera.sensorWidthMm).toBe(SCENE3D_LIMITS.defaultSensorWidthMm)
  })

  it("rejects an unknown top-level field rather than silently dropping it", () => {
    expect(scene3DPlanSchema.safeParse({ ...plan(), script: "rm -rf /" }).success).toBe(false)
  })

  it("rejects a non-finite coordinate", () => {
    const broken = plan({ objects: [object("a", { position: [Number.NaN, 0, 0] })] })
    expect(scene3DPlanSchema.safeParse(broken).success).toBe(false)
    const infinite = plan({ objects: [object("a", { position: [Number.POSITIVE_INFINITY, 0, 0] })] })
    expect(scene3DPlanSchema.safeParse(infinite).success).toBe(false)
  })

  it("rejects a scene longer than the duration ceiling", () => {
    const tooLong = plan({ fps: 24, durationInFrames: 24 * (SCENE3D_LIMITS.maxDurationSeconds + 1) })
    const result = scene3DPlanSchema.safeParse(tooLong)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("the limit is 60s")
  })

  it("rejects duplicate object ids", () => {
    const dup = plan({ objects: [object("a"), object("a")] })
    const result = scene3DPlanSchema.safeParse(dup)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("duplicate object id")
  })

  it("rejects a dangling parentId", () => {
    const orphan = plan({ objects: [object("a", { parentId: "ghost" })] })
    const result = scene3DPlanSchema.safeParse(orphan)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("unknown parent")
  })

  it("rejects a self-parent", () => {
    const self = plan({ objects: [object("a", { parentId: "a" })] })
    expect(scene3DPlanSchema.safeParse(self).success).toBe(false)
  })

  it("rejects a two-object parent cycle", () => {
    const cycle = plan({ objects: [object("a", { parentId: "b" }), object("b", { parentId: "a" })] })
    const result = scene3DPlanSchema.safeParse(cycle)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("parent cycle")
  })

  it("accepts a legal parent chain", () => {
    const chain = plan({
      objects: [object("root"), object("mid", { parentId: "root" }), object("leaf", { parentId: "mid" })],
    })
    expect(scene3DPlanSchema.safeParse(chain).success).toBe(true)
  })

  it("rejects a hierarchy deeper than the ceiling", () => {
    const objects = [object("n0")]
    for (let i = 1; i <= SCENE3D_LIMITS.maxHierarchyDepth + 1; i++) {
      objects.push(object(`n${i}`, { parentId: `n${i - 1}` }))
    }
    const result = scene3DPlanSchema.safeParse(plan({ objects }))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("deeper than")
  })

  it("rejects unsorted, duplicated and out-of-range keyframes", () => {
    const unsorted = plan({ objects: [object("a", { keyframes: [{ frame: 10 }, { frame: 2 }] })] })
    expect(JSON.stringify(scene3DPlanSchema.safeParse(unsorted).error?.issues)).toContain("sorted")

    const duplicated = plan({ objects: [object("a", { keyframes: [{ frame: 4 }, { frame: 4 }] })] })
    expect(JSON.stringify(scene3DPlanSchema.safeParse(duplicated).error?.issues)).toContain("duplicate keyframe")

    const past = plan({ durationInFrames: 10, objects: [object("a", { keyframes: [{ frame: 10 }] })] })
    expect(JSON.stringify(scene3DPlanSchema.safeParse(past).error?.issues)).toContain("past the scene's last frame")
  })

  it("applies the same keyframe rules to the camera track", () => {
    const camera = {
      position: [0, 2, 6] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      focalLengthMm: 35,
      sensorWidthMm: 36,
      keyframes: [{ frame: 30 }, { frame: 5 }],
    }
    expect(JSON.stringify(scene3DPlanSchema.safeParse(plan({ camera })).error?.issues)).toContain("sorted")
  })

  it("validates references: http(s) only, resolved objectId, sane window", () => {
    const base = plan({ objects: [object("hero")] })
    const good = {
      ...base,
      references: [
        { id: "r1", url: "https://cdn.example.com/a.png", kind: "image", role: "appearance", objectId: "hero" },
        { id: "r2", url: "https://cdn.example.com/b.mp4", kind: "video", role: "motion", startSeconds: 1, endSeconds: 3 },
      ],
    }
    expect(scene3DPlanSchema.safeParse(good).success).toBe(true)

    const badScheme = { ...base, references: [{ id: "r1", url: "file:///etc/passwd", kind: "image", role: "layout" }] }
    expect(scene3DPlanSchema.safeParse(badScheme).success).toBe(false)

    const ghostObject = {
      ...base,
      references: [{ id: "r1", url: "https://x.test/a.png", kind: "image", role: "layout", objectId: "nope" }],
    }
    expect(JSON.stringify(scene3DPlanSchema.safeParse(ghostObject).error?.issues)).toContain("unknown object")

    const backwards = {
      ...base,
      references: [{ id: "r1", url: "https://x.test/a.mp4", kind: "video", role: "motion", startSeconds: 5, endSeconds: 2 }],
    }
    expect(JSON.stringify(scene3DPlanSchema.safeParse(backwards).error?.issues)).toContain("before it starts")

    const windowedImage = {
      ...base,
      references: [{ id: "r1", url: "https://x.test/a.png", kind: "image", role: "layout", startSeconds: 1 }],
    }
    expect(scene3DPlanSchema.safeParse(windowedImage).success).toBe(false)
  })

  it("rejects duplicate reference ids", () => {
    const dup = {
      ...plan(),
      references: [
        { id: "r1", url: "https://x.test/a.png", kind: "image", role: "layout" },
        { id: "r1", url: "https://x.test/b.png", kind: "image", role: "layout" },
      ],
    }
    expect(JSON.stringify(scene3DPlanSchema.safeParse(dup).error?.issues)).toContain("duplicate reference id")
  })

  it("requires at least one object and caps the count", () => {
    expect(scene3DPlanSchema.safeParse(plan({ objects: [] })).success).toBe(false)
    const many = Array.from({ length: SCENE3D_LIMITS.maxObjects + 1 }, (_, i) => object(`o${i}`))
    expect(scene3DPlanSchema.safeParse(plan({ objects: many })).success).toBe(false)
  })

  it("bounds the render size and fps", () => {
    expect(scene3DPlanSchema.safeParse(plan({ width: 4096 })).success).toBe(false)
    expect(scene3DPlanSchema.safeParse(plan({ fps: 120 })).success).toBe(false)
    expect(scene3DPlanSchema.safeParse(plan({ fps: 24.5 })).success).toBe(false)
  })
})

describe("newScene3DRevisionId", () => {
  it("produces distinct v4 UUIDs the plan schema accepts", () => {
    const a = newScene3DRevisionId()
    const b = newScene3DRevisionId()
    expect(a).not.toBe(b)
    expect(scene3DPlanSchema.safeParse(plan({ revisionId: a })).success).toBe(true)
  })
})

describe("scene3DEditOperationSchema", () => {
  it("refuses to let an operation rename an object", () => {
    const sneaky = { op: "set-object", objectId: "a", changes: { id: "b" } }
    expect(scene3DEditOperationSchema.safeParse(sneaky).success).toBe(false)
  })

  it("accepts a null parentId as an explicit detach", () => {
    const detach = { op: "set-object", objectId: "a", changes: { parentId: null } }
    expect(scene3DEditOperationSchema.safeParse(detach).success).toBe(true)
  })

  it("rejects an unknown op", () => {
    expect(scene3DEditOperationSchema.safeParse({ op: "eval", code: "1" }).success).toBe(false)
  })
})

describe("applyScene3DEditOperations", () => {
  const base = plan({ objects: [object("ground", { primitive: "plane" }), object("hero")] })

  it("produces a new revision, records the parent, and never mutates the input", () => {
    const snapshot = JSON.parse(JSON.stringify(base))
    const result = applyScene3DEditOperations(base, [
      { op: "set-object", objectId: "hero", changes: { position: [1, 0, 2] } },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.revisionId).not.toBe(base.revisionId)
    expect(result.plan.parentRevisionId).toBe(base.revisionId)
    expect(result.plan.objects.find((o) => o.id === "hero")?.position).toEqual([1, 0, 2])
    expect(base).toEqual(snapshot)
    expect(result.changedObjectIds).toEqual(["hero"])
    expect(result.changeSummary).toContain("hero")
  })

  it("refuses a stale expectedRevisionId before applying anything", () => {
    const result = applyScene3DEditOperations(
      base,
      [{ op: "remove-object", objectId: "hero" }],
      { expectedRevisionId: REV_B },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("stale_revision")
  })

  it("accepts a matching expectedRevisionId", () => {
    const result = applyScene3DEditOperations(base, [{ op: "set-background", color: "#000000" }], {
      expectedRevisionId: REV_A,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.backgroundColor).toBe("#000000")
  })

  it("reports the failing operation index", () => {
    const result = applyScene3DEditOperations(base, [
      { op: "set-background", color: "#111111" },
      { op: "remove-object", objectId: "ghost" },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("unknown_object")
    expect(result.operationIndex).toBe(1)
  })

  it("rejects a duplicate add", () => {
    const result = applyScene3DEditOperations(base, [{ op: "add-object", object: object("hero") }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("duplicate_object")
  })

  it("refuses to modify a locked object", () => {
    const result = applyScene3DEditOperations(
      base,
      [{ op: "set-object", objectId: "hero", changes: { color: "#ff0000" } }],
      { lockedObjectIds: ["hero"] },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("locked_object")
    expect(result.message).toContain("cannot be modified")
  })

  it("refuses to remove a locked object", () => {
    const result = applyScene3DEditOperations(base, [{ op: "remove-object", objectId: "hero" }], {
      lockedObjectIds: ["hero"],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain("cannot be removed")
  })

  it("catches a remove-then-re-add that would smuggle a change past the lock", () => {
    const result = applyScene3DEditOperations(
      base,
      [
        { op: "remove-object", objectId: "hero" },
        { op: "add-object", object: object("hero", { color: "#00ff00" }) },
      ],
      { lockedObjectIds: ["hero"] },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("locked_object")
  })

  it("allows an unrelated edit while an object is locked", () => {
    const result = applyScene3DEditOperations(
      base,
      [{ op: "set-object", objectId: "ground", changes: { color: "#223344" } }],
      { lockedObjectIds: ["hero"] },
    )
    expect(result.ok).toBe(true)
  })

  it("refuses to orphan a child by removing its parent", () => {
    const nested = plan({ objects: [object("root"), object("child", { parentId: "root" })] })
    const result = applyScene3DEditOperations(nested, [{ op: "remove-object", objectId: "root" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_plan")
    expect(result.message).toContain("unknown parent")
  })

  it("refuses to remove an object a reference points at", () => {
    const referenced: Scene3DPlan = {
      ...plan({ objects: [object("hero"), object("prop")] }),
      references: [{ id: "r1", url: "https://x.test/a.png", kind: "image", role: "appearance", objectId: "prop" }],
    }
    const result = applyScene3DEditOperations(referenced, [{ op: "remove-object", objectId: "prop" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_plan")
  })

  it("removing a parent is fine once the child is detached in the same list", () => {
    const nested = plan({ objects: [object("root"), object("child", { parentId: "root" })] })
    const result = applyScene3DEditOperations(nested, [
      { op: "set-object", objectId: "child", changes: { parentId: null } },
      { op: "remove-object", objectId: "root" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.objects).toHaveLength(1)
    expect(result.plan.objects[0].parentId).toBeUndefined()
  })

  it("rejects an operation list that would leave the scene invalid", () => {
    const result = applyScene3DEditOperations(base, [
      { op: "remove-object", objectId: "hero" },
      { op: "remove-object", objectId: "ground" },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_plan")
  })

  it("rejects an invalid input plan without applying anything", () => {
    const result = applyScene3DEditOperations({ ...base, objects: [] } as Scene3DPlan, [
      { op: "set-background", color: "#000000" },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_plan")
  })

  it("caps the operation list", () => {
    const many = Array.from({ length: SCENE3D_LIMITS.maxOperations + 1 }, () => ({
      op: "set-background" as const,
      color: "#000000",
    }))
    const result = applyScene3DEditOperations(base, many)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_operations")
  })

  it("rejects a malformed operation without a partial apply", () => {
    const result = applyScene3DEditOperations(base, [{ op: "set-object", objectId: "hero", changes: { color: "red" } }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_operations")
    expect(result.operationIndex).toBe(0)
  })

  it("honours a pinned revisionId for deterministic replay", () => {
    const result = applyScene3DEditOperations(base, [{ op: "set-background", color: "#0a0a0a" }], {
      revisionId: REV_B,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.revisionId).toBe(REV_B)
  })

  it("edits camera and lighting without touching objects", () => {
    const result = applyScene3DEditOperations(base, [
      { op: "set-camera", changes: { focalLengthMm: 85, target: [0, 1, 0] } },
      { op: "set-lighting", changes: { keyIntensity: 2 } },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.camera.focalLengthMm).toBe(85)
    expect(result.plan.camera.position).toEqual(base.camera.position)
    expect(result.plan.lighting.keyIntensity).toBe(2)
    expect(result.plan.objects).toEqual(base.objects)
  })
})

describe("summarizeScene3DOperations", () => {
  it("names each change", () => {
    const summary = summarizeScene3DOperations([
      { op: "add-object", object: object("lamp", { primitive: "cone" }) },
      { op: "remove-object", objectId: "ground" },
      { op: "set-background", color: "#123456" },
    ])
    expect(summary).toContain("Added cone")
    expect(summary).toContain("Removed \"ground\"")
    expect(summary).toContain("#123456")
  })
})

describe("scene3DDeepEqual", () => {
  it("ignores key order but not values", () => {
    expect(scene3DDeepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
    expect(scene3DDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(scene3DDeepEqual([1, 2], [2, 1])).toBe(false)
  })
})

describe("colors are OPAQUE hex only", () => {
  // `new THREE.Color(hex)` understands #abc and #aabbcc and nothing else. It
  // does not REFUSE a 4- or 8-digit value — it warns and falls back to WHITE,
  // so an alpha the contract accepted would silently repaint an object in the
  // export while the plan looked perfectly valid.
  it("accepts 3- and 6-digit values", () => {
    expect(scene3DColorSchema.safeParse("#abc").success).toBe(true)
    expect(scene3DColorSchema.safeParse("#4f8ef7").success).toBe(true)
    expect(scene3DColorSchema.safeParse("#ABCDEF").success).toBe(true)
  })

  it("rejects the CSS alpha spellings", () => {
    expect(scene3DColorSchema.safeParse("#abcd").success).toBe(false)
    expect(scene3DColorSchema.safeParse("#aabbccdd").success).toBe(false)
  })

  it("rejects them everywhere a color appears, not just at the top level", () => {
    expect(scene3DPlanSchema.safeParse(plan({ backgroundColor: "#aabbccdd" })).success).toBe(false)
    expect(
      scene3DPlanSchema.safeParse(plan({ objects: [object("a", { color: "#abcd" })] })).success,
    ).toBe(false)
  })
})

describe("SCENE3D_LIMITS.minDurationSeconds", () => {
  it("is the frozen v1 floor of one second", () => {
    // Quoted by the route Zod and by the canvas path, so neither can accept a
    // scene shorter than the SDK/MCP surface and the public docs promise.
    expect(SCENE3D_LIMITS.minDurationSeconds).toBe(1)
  })
})
