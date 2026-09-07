import { describe, expect, it } from "vitest"
import {
  SCENE3D_ASSET_ROLE_KINDS,
  SCENE3D_GLB_EXTRAS_ALLOWLIST,
  SCENE3D_GLB_EXTRAS_ENTITY_ID,
  SCENE3D_RENDERER_ASSET_KINDS,
  SCENE3D_SCHEMA_VERSION_V2,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
  SCENE3D_V2_LIMITS,
  SCENE3D_V2_PRIMITIVES,
  type Scene3DEntityV2,
  type Scene3DOverride,
  type Scene3DPlanV2,
} from "../scene3d-v2.js"
import {
  isKnownScene3DEngine,
  isScene3DPlan,
  isScene3DPlanV2,
  isScene3DSchemaVersionSupported,
  scene3DAcceptedSchemaVersionsSchema,
  scene3DAnyPlanSchema,
  scene3DEntityAcceptsOverlay,
  scene3DPlanSchemaVersion,
  scene3DPlanV2Issues,
  scene3DPlanV2Schema,
  scene3DShotForFrame,
  scene3DShotIndexForFrame,
} from "../scene3d-v2-plan.js"
import {
  SCENE3D_LIMITS,
  SCENE3D_SCHEMA_VERSION,
  isScene3DPlanV1,
  scene3DPlanSchema,
  scene3DPlanV1Schema,
  type Scene3DPlanV1,
} from "../scene3d.js"
import { FIXTURE_CUTS, FIXTURE_FRAMES, planV2 } from "./scene3d-v2-fixtures.js"

function messages(plan: Scene3DPlanV2): string[] {
  return scene3DPlanV2Issues(plan).map((issue) => issue.message)
}

function expectRejects(plan: Scene3DPlanV2, fragment: string): void {
  const result = scene3DPlanV2Schema.safeParse(plan)
  expect(result.success).toBe(false)
  const all = result.success ? [] : result.error.issues.map((issue) => issue.message).join(" | ")
  expect(all).toContain(fragment)
}

/** A v1 plan, built the way the existing v1 fixtures do. */
function planV1(over: Partial<Scene3DPlanV1> = {}): Scene3DPlanV1 {
  return {
    planType: "3d-scene",
    schemaVersion: SCENE3D_SCHEMA_VERSION,
    revisionId: "11111111-2222-4333-8444-555555555555",
    width: 1280,
    height: 720,
    fps: 24,
    durationInFrames: 96,
    backgroundColor: "#101014",
    camera: { position: [0, 2, 6], target: [0, 1, 0], focalLengthMm: 35, sensorWidthMm: 36 },
    objects: [
      {
        id: "box",
        name: "Box",
        primitive: "box",
        dimensions: [1, 1, 1],
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#4f8ef7",
      },
    ],
    lighting: { ambientIntensity: 0.5, keyIntensity: 2, keyPosition: [4, 6, 3] },
    ...over,
  }
}

describe("scene3d v2 — the happy path", () => {
  it("accepts the fixture manifest", () => {
    const result = scene3DPlanV2Schema.safeParse(planV2())
    expect(result.success).toBe(true)
  })

  it("parse() returns the input unchanged — no defaults may be injected", () => {
    // A `.default()` anywhere would make a producer hashing raw JSON and a
    // consumer hashing parsed output disagree about the same revision.
    const fixture = planV2()
    expect(scene3DPlanV2Schema.parse(fixture)).toEqual(fixture)
  })

  it("narrows through the version predicates", () => {
    expect(isScene3DPlanV2(planV2())).toBe(true)
    expect(isScene3DPlanV1(planV2())).toBe(false)
    expect(isScene3DPlan(planV2())).toBe(true)
    expect(isScene3DPlan(planV1())).toBe(true)
  })
})

describe("scene3d v2 — v1 is untouched", () => {
  it("still validates v1 plans, and scene3DPlanSchema is still v1-only", () => {
    expect(scene3DPlanV1Schema.safeParse(planV1()).success).toBe(true)
    expect(scene3DPlanSchema.safeParse(planV1()).success).toBe(true)
    expect(scene3DPlanSchema.safeParse(planV2()).success).toBe(false)
  })

  it("keeps every v1 limit at its frozen value", () => {
    expect(SCENE3D_LIMITS.maxObjects).toBe(100)
    expect(SCENE3D_LIMITS.maxKeyframes).toBe(240)
    expect(SCENE3D_LIMITS.maxHierarchyDepth).toBe(8)
    expect(SCENE3D_LIMITS.maxDimensionPx).toBe(1920)
    expect(SCENE3D_LIMITS.maxReferences).toBe(8)
  })

  it("does not let v2's raised ceilings leak into v1", () => {
    // v2 nests 16 deep; a v1 plan 9 deep is still refused.
    const chained = Array.from({ length: 9 }, (_unused, index) => ({
      id: `n${index}`,
      name: `n${index}`,
      primitive: "box" as const,
      parentId: index === 0 ? undefined : `n${index - 1}`,
      dimensions: [1, 1, 1] as [number, number, number],
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: "#ffffff",
    }))
    const result = scene3DPlanV1Schema.safeParse(planV1({ objects: chained }))
    expect(result.success).toBe(false)
    expect(result.success ? "" : result.error.issues.map((i) => i.message).join(" ")).toContain(
      "hierarchy deeper than 8 levels",
    )
  })
})

describe("scene3d v2 — the discriminator", () => {
  it("routes each version to its own branch", () => {
    expect(scene3DAnyPlanSchema.safeParse(planV1()).success).toBe(true)
    expect(scene3DAnyPlanSchema.safeParse(planV2()).success).toBe(true)
  })

  it("reports an unknown version as a discriminator failure, not a pile of key errors", () => {
    const result = scene3DAnyPlanSchema.safeParse({ ...planV2(), schemaVersion: 3 })
    expect(result.success).toBe(false)
    const issues = result.success ? [] : result.error.issues
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain("Invalid discriminator value")
    expect(issues[0].path).toEqual(["schemaVersion"])
  })

  it("runs the RIGHT semantic pass per branch", () => {
    // A v2 shot-coverage failure must surface through the union too.
    const broken = planV2({ shots: [{ id: "only", startFrame: 0, endFrameExclusive: 100 }] })
    const result = scene3DAnyPlanSchema.safeParse(broken)
    expect(result.success).toBe(false)
    expect(result.success ? "" : result.error.issues.map((i) => i.message).join(" ")).toContain(
      "must be covered completely",
    )
  })

  it("identifies the claimed version without validating the rest", () => {
    expect(scene3DPlanSchemaVersion(planV1())).toBe(1)
    expect(scene3DPlanSchemaVersion(planV2())).toBe(2)
    // A future version reports its number so an SDK can say "upgrade to render".
    expect(scene3DPlanSchemaVersion({ planType: "3d-scene", schemaVersion: 7 })).toBe(7)
    expect(isScene3DSchemaVersionSupported(7)).toBe(false)
    expect(SCENE3D_SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2])
    // Not a scene plan at all.
    expect(scene3DPlanSchemaVersion({ planType: "video", schemaVersion: 1 })).toBeNull()
    expect(scene3DPlanSchemaVersion(null)).toBeNull()
    expect(scene3DPlanSchemaVersion("3d-scene")).toBeNull()
    expect(scene3DPlanSchemaVersion({ planType: "3d-scene", schemaVersion: 1.5 })).toBeNull()
  })

  it("validates a client's accepted-version list", () => {
    expect(scene3DAcceptedSchemaVersionsSchema.safeParse([1, 2]).success).toBe(true)
    expect(scene3DAcceptedSchemaVersionsSchema.safeParse([2]).success).toBe(true)
    expect(scene3DAcceptedSchemaVersionsSchema.safeParse([]).success).toBe(false)
    expect(scene3DAcceptedSchemaVersionsSchema.safeParse([3]).success).toBe(false)
  })
})

describe("scene3d v2 — hostile and malformed input", () => {
  it("rejects a prototype-pollution key through .strict()", () => {
    for (const key of ["__proto__", "constructor", "toString", "objectsExtra"]) {
      const hostile = JSON.parse(JSON.stringify(planV2())) as Record<string, unknown>
      hostile[key] = { polluted: true }
      expect(scene3DPlanV2Schema.safeParse(hostile).success).toBe(false)
    }
  })

  it("rejects unknown keys on nested objects too", () => {
    const plan = planV2()
    ;(plan.objects[0] as unknown as Record<string, unknown>).script = "alert(1)"
    expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(false)
  })

  it("rejects non-finite numbers everywhere they could reach the renderer", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const plan = planV2()
      plan.objects[2].position = [bad, 0, 0]
      expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(false)
    }
  })

  it("rejects a path or a URL smuggled into an asset id", () => {
    for (const bad of ["../secrets", "a/b", "https://example.com/x.glb", "/etc/passwd", ""]) {
      expect(scene3DPlanV2Schema.safeParse(planV2({ cameraTrackAssetId: bad })).success).toBe(false)
    }
  })

  it("rejects a native path or prose in a provenance version", () => {
    const plan = planV2()
    for (const bad of [
      "/home/example/project.blend",
      "C:\\\\Program Files\\\\Blender",
      "built by the engine",
      "1.0.0:secret",
      "a".repeat(65),
    ]) {
      expect(
        scene3DPlanV2Schema.safeParse({ ...plan, provenance: { ...plan.provenance, exporterVersion: bad } }).success,
      ).toBe(false)
    }
  })

  it("rejects a malformed digest", () => {
    const plan = planV2()
    for (const bad of ["A".repeat(64), "abc", `sha256:${"a".repeat(64)}`, "a".repeat(63)]) {
      plan.assets[0].sha256 = bad
      expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(false)
    }
  })

  it("rejects a control character in a material name", () => {
    const plan = planV2()
    const entity = plan.objects[1]
    if (entity.visual.kind !== "asset") throw new Error("fixture changed")
    entity.materialBindings = [{ role: "bodyPaint", materialName: "Body\nPaint", color: "#ffffff" }]
    expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(false)
  })

  it("rejects a completely foreign object", () => {
    for (const bad of [null, 42, "plan", [], { hello: "world" }]) {
      expect(scene3DPlanV2Schema.safeParse(bad).success).toBe(false)
      expect(isScene3DPlan(bad)).toBe(false)
    }
  })
})

describe("scene3d v2 — world conventions and output shape", () => {
  it("requires the coordinate literals", () => {
    expect(scene3DPlanV2Schema.safeParse(planV2({ upAxis: "Z" as never })).success).toBe(false)
    expect(scene3DPlanV2Schema.safeParse(planV2({ handedness: "left" as never })).success).toBe(false)
    expect(scene3DPlanV2Schema.safeParse(planV2({ units: "centimeters" as never })).success).toBe(false)
  })

  it("requires even output dimensions", () => {
    expectRejects(planV2({ width: 1681 }), "width must be an even number of pixels")
    expectRejects(planV2({ height: 721 }), "height must be an even number of pixels")
    expect(scene3DPlanV2Schema.safeParse(planV2({ width: 1680, height: 720 })).success).toBe(true)
  })

  it("applies BOTH the frame ceiling and the seconds ceiling", () => {
    // 3600 frames at 15 fps is 240s — inside the frame cap, past the time cap.
    expectRejects(planV2({ fps: 15, durationInFrames: 3600 }), "the limit is 60s")
    expect(
      scene3DPlanV2Schema.safeParse(planV2({ durationInFrames: 3601 })).success,
    ).toBe(false)
    expect(SCENE3D_V2_LIMITS.maxDurationInFrames).toBe(3600)
    expect(SCENE3D_V2_LIMITS.maxDurationSeconds).toBe(60)
  })
})

describe("scene3d v2 — entities", () => {
  it("rejects duplicate ids", () => {
    const plan = planV2()
    plan.objects[2] = { ...plan.objects[2], id: "e1" }
    expectRejects(plan, 'duplicate entity id "e1"')
  })

  it("requires a base transform on group and primitive entities", () => {
    const plan = planV2()
    delete plan.objects[2].position
    expectRejects(plan, 'entity "e3" is a primitive and must declare position')
  })

  it("lets an asset entity omit its transform — the GLB node owns it", () => {
    const plan = planV2()
    delete plan.objects[1].position
    delete plan.objects[1].rotation
    delete plan.objects[1].scale
    expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(true)
  })

  it("rejects a self-parent, an unknown parent and a cycle", () => {
    const selfParent = planV2()
    selfParent.objects[2].parentId = "e3"
    expectRejects(selfParent, 'entity "e3" cannot parent itself')

    const unknown = planV2()
    unknown.objects[2].parentId = "nope"
    expectRejects(unknown, 'references unknown parent "nope"')

    const cycle = planV2()
    cycle.objects[0].parentId = "e2"
    expect(messages(cycle).some((message) => message.startsWith("parent cycle"))).toBe(true)
  })

  it("bounds the hierarchy at 16, not v1's 8", () => {
    const chain = (length: number): Scene3DEntityV2[] =>
      Array.from({ length }, (_unused, index) => ({
        id: `n${index}`,
        name: `n${index}`,
        parentId: index === 0 ? undefined : `n${index - 1}`,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        visual: { kind: "group" as const },
      }))
    const shallowShots = [{ id: "shot-1", startFrame: 0, endFrameExclusive: FIXTURE_FRAMES }]
    const okPlan = planV2({ objects: chain(16), shots: shallowShots })
    expect(messages(okPlan).some((message) => message.includes("hierarchy deeper"))).toBe(false)
    const deepPlan = planV2({ objects: chain(17), shots: shallowShots })
    expect(messages(deepPlan).some((message) => message.includes("hierarchy deeper than 16 levels"))).toBe(true)
  })

  it("gives each exported root node exactly one owner", () => {
    const plan = planV2()
    plan.objects.push({
      id: "e4",
      name: "Twin",
      visual: { kind: "asset", assetId: "asset-vehicle", rootNodeId: "vehicle_root" },
    })
    expectRejects(plan, 'is already the root of entity "e2"')
  })

  it("keeps `group` out of the primitive vocabulary", () => {
    expect(SCENE3D_V2_PRIMITIVES).not.toContain("group")
    const plan = planV2()
    plan.objects[2].visual = { kind: "primitive", primitive: "group" as never, dimensions: [1, 1, 1], color: "#fff" }
    expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(false)
  })

  it("keeps material bindings to asset entities and to unique roles", () => {
    const onPrimitive = planV2()
    onPrimitive.objects[2].materialBindings = [{ role: "identity", materialName: "Clay" }]
    expectRejects(onPrimitive, "material bindings name materials in an asset root")

    const duplicated = planV2()
    duplicated.objects[1].materialBindings = [
      { role: "bodyPaint", materialName: "A" },
      { role: "bodyPaint", materialName: "B" },
    ]
    expectRejects(duplicated, 'binds material role "bodyPaint" twice')
  })

  it("rejects duplicate anchor names", () => {
    const plan = planV2()
    plan.objects[1].anchors = [
      { name: "roof", position: [0, 1, 0] },
      { name: "roof", position: [0, 2, 0] },
    ]
    expectRejects(plan, 'declares anchor "roof" twice')
  })

  it("bounds an animation binding to the timeline", () => {
    const past = planV2()
    past.objects[1].visual = {
      kind: "asset",
      assetId: "asset-vehicle",
      rootNodeId: "vehicle_root",
      animation: { clipName: "drive", startFrame: 0, endFrameExclusive: 721 },
    }
    expectRejects(past, "animation runs past the scene (720 frames)")

    const inverted = planV2()
    inverted.objects[1].visual = {
      kind: "asset",
      assetId: "asset-vehicle",
      rootNodeId: "vehicle_root",
      animation: { clipName: "drive", startFrame: 300, endFrameExclusive: 300 },
    }
    expect(scene3DPlanV2Schema.safeParse(inverted).success).toBe(false)
  })

  it("exports the GLB extras allowlist both ends must agree on", () => {
    expect(SCENE3D_GLB_EXTRAS_ENTITY_ID).toBe("nodaroEntityId")
    expect(SCENE3D_GLB_EXTRAS_ALLOWLIST).toContain(SCENE3D_GLB_EXTRAS_ENTITY_ID)
    expect(SCENE3D_GLB_EXTRAS_ALLOWLIST).toHaveLength(3)
  })
})

describe("scene3d v2 — assets", () => {
  it("rejects duplicate asset ids", () => {
    const plan = planV2()
    plan.assets[2] = { ...plan.assets[2], assetId: "asset-track" }
    expectRejects(plan, 'duplicate asset id "asset-track"')
  })

  it("enforces the kind↔role matrix", () => {
    const plan = planV2()
    plan.assets[0] = { ...plan.assets[0], role: "camera-track" }
    expectRejects(plan, 'requires kind "camera-track-json"')
    for (const [role, kind] of Object.entries(SCENE3D_ASSET_ROLE_KINDS)) {
      expect(typeof kind).toBe("string")
      expect(typeof role).toBe("string")
    }
  })

  it("requires cameraTrackAssetId to resolve to a camera track", () => {
    expectRejects(planV2({ cameraTrackAssetId: "asset-missing" }), "is not in assets")
    const wrongKind = planV2({ cameraTrackAssetId: "asset-poster" })
    expectRejects(wrongKind, "a camera track must be camera-track-json")
  })

  it("rejects an entity pointing at a non-GLB or missing asset", () => {
    const missing = planV2()
    missing.objects[1].visual = { kind: "asset", assetId: "asset-nope", rootNodeId: "vehicle_root" }
    expectRejects(missing, 'references unknown asset "asset-nope"')

    const wrongKind = planV2()
    wrongKind.objects[1].visual = { kind: "asset", assetId: "asset-poster", rootNodeId: "vehicle_root" }
    expectRejects(wrongKind, "geometry must be glb")
  })

  it("rejects a GLB no entity uses", () => {
    const plan = planV2()
    plan.assets.push({
      assetId: "asset-orphan",
      kind: "glb",
      role: "scene-geometry",
      byteLength: 1000,
      sha256: "e".repeat(64),
    })
    expectRejects(plan, 'glb asset "asset-orphan" is not referenced by any entity')
  })

  it("counts renderer-visible bytes against 64 MiB and excludes the native source", () => {
    expect(SCENE3D_RENDERER_ASSET_KINDS).not.toContain("blend-source")

    // A 200 MiB source alone is fine — the browser never downloads it.
    const bigSource = planV2()
    bigSource.assets[3] = { ...bigSource.assets[3], byteLength: 200 * 1024 * 1024 }
    expect(scene3DPlanV2Schema.safeParse(bigSource).success).toBe(true)

    // Two GLBs that together cross the budget are not.
    const overBudget = planV2()
    overBudget.assets[0] = { ...overBudget.assets[0], byteLength: 40 * 1024 * 1024 }
    overBudget.assets[1] = { ...overBudget.assets[1], byteLength: 8 * 1024 * 1024 }
    overBudget.assets[2] = { ...overBudget.assets[2], byteLength: 20 * 1024 * 1024 }
    expectRejects(overBudget, "downloaded scene assets total")
  })

  it("caps the camera track at 8 MiB", () => {
    const plan = planV2()
    plan.assets[1] = { ...plan.assets[1], byteLength: 8 * 1024 * 1024 + 1 }
    expectRejects(plan, "camera track")
  })

  it("retains at most one native source, and requires sourceArtifactId to be one", () => {
    const twoSources = planV2()
    twoSources.assets.push({
      assetId: "asset-source-2",
      kind: "blend-source",
      role: "source",
      byteLength: 10,
      sha256: "f".repeat(64),
    })
    expectRejects(twoSources, "at most one blend-source asset")

    const wrongSource = planV2()
    wrongSource.provenance = { ...wrongSource.provenance, sourceArtifactId: "asset-poster" }
    expectRejects(wrongSource, "a retained source must be blend-source")
  })
})

describe("scene3d v2 — shots", () => {
  it("accepts the exact fixture cut ranges", () => {
    const plan = planV2()
    expect(plan.shots.map((shot) => [shot.startFrame, shot.endFrameExclusive])).toEqual(
      FIXTURE_CUTS.map((cut) => [...cut]),
    )
    expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(true)
  })

  it("assigns every frame to exactly one shot", () => {
    const shots = planV2().shots
    for (const frame of [0, 359, 360, 431, 432, 491, 492, 719]) {
      const owning = shots.filter((shot) => frame >= shot.startFrame && frame < shot.endFrameExclusive)
      expect(owning).toHaveLength(1)
    }
    expect(scene3DShotForFrame(shots, 0)?.id).toBe("shot-1")
    expect(scene3DShotForFrame(shots, 359)?.id).toBe("shot-1")
    expect(scene3DShotForFrame(shots, 360)?.id).toBe("shot-2")
    expect(scene3DShotForFrame(shots, 431)?.id).toBe("shot-2")
    expect(scene3DShotForFrame(shots, 432)?.id).toBe("shot-3")
    expect(scene3DShotForFrame(shots, 492)?.id).toBe("shot-4")
    expect(scene3DShotForFrame(shots, 719)?.id).toBe("shot-4")
    expect(scene3DShotForFrame(shots, 720)).toBeUndefined()
    expect(scene3DShotIndexForFrame(shots, -1)).toBe(-1)
  })

  it("rejects a one-frame gap", () => {
    const plan = planV2()
    plan.shots[1] = { ...plan.shots[1], startFrame: 361 }
    expectRejects(plan, "every frame belongs to exactly one shot")
  })

  it("rejects an overlap", () => {
    const plan = planV2()
    plan.shots[1] = { ...plan.shots[1], startFrame: 359 }
    expectRejects(plan, "every frame belongs to exactly one shot")
  })

  it("rejects shots that do not start at 0", () => {
    const plan = planV2()
    plan.shots[0] = { ...plan.shots[0], startFrame: 1 }
    expectRejects(plan, "shots must start at frame 0")
  })

  it("rejects shots that stop short of the timeline", () => {
    const plan = planV2()
    plan.shots[3] = { ...plan.shots[3], endFrameExclusive: 700 }
    expectRejects(plan, "must be covered completely")
  })

  it("rejects an unsorted shot list", () => {
    const plan = planV2()
    plan.shots = [plan.shots[1], plan.shots[0], plan.shots[2], plan.shots[3]]
    expect(scene3DPlanV2Schema.safeParse(plan).success).toBe(false)
  })

  it("rejects an empty or inverted range", () => {
    const plan = planV2()
    plan.shots[1] = { ...plan.shots[1], endFrameExclusive: 360 }
    expectRejects(plan, "ends at or before it starts")
  })

  it("rejects duplicate shot ids and unknown subject entities", () => {
    const duplicate = planV2()
    duplicate.shots[1] = { ...duplicate.shots[1], id: "shot-1" }
    expectRejects(duplicate, 'duplicate shot id "shot-1"')

    const unknown = planV2()
    unknown.shots[0] = { ...unknown.shots[0], subjectEntityIds: ["ghost"] }
    expectRejects(unknown, 'references unknown entity "ghost"')
  })

  it("caps the shot count", () => {
    expect(SCENE3D_V2_LIMITS.maxShots).toBe(32)
    const many = Array.from({ length: 33 }, (_unused, index) => ({
      id: `s${index}`,
      startFrame: index * 20,
      endFrameExclusive: index === 32 ? FIXTURE_FRAMES : (index + 1) * 20,
    }))
    expect(scene3DPlanV2Schema.safeParse(planV2({ shots: many })).success).toBe(false)
  })
})

describe("scene3d v2 — overlays", () => {
  const provenanceFields = {
    sourceRevisionId: "6d5b0b64-2b6c-4d4a-9e4f-2f4b7f6a1c00",
    sourceContentHash: "a".repeat(64),
    operationVersion: 1,
  }

  it("requires each override to name its source revision, hash and operation version", () => {
    const plan = planV2()
    const stripped = { ...plan.overrides![0] } as Record<string, unknown>
    delete stripped.sourceContentHash
    expect(scene3DPlanV2Schema.safeParse(planV2({ overrides: [stripped as never] })).success).toBe(false)
  })

  it("rejects an override written by a newer operation vocabulary", () => {
    const plan = planV2()
    plan.overrides = [{ ...plan.overrides![0], operationVersion: 2 }]
    expectRejects(plan, "this reader understands up to 1")
  })

  it("allows one owner per channel", () => {
    const twoTransforms = planV2()
    twoTransforms.overrides = [
      { ...provenanceFields, id: "a", kind: "entity-transform", entityId: "e2", space: "local", position: [1, 0, 0] },
      { ...provenanceFields, id: "b", kind: "entity-transform", entityId: "e2", space: "local", position: [2, 0, 0] },
    ]
    expectRejects(twoTransforms, "already has a transform override")

    const twoOffsets = planV2()
    twoOffsets.overrides = [
      { ...provenanceFields, id: "a", kind: "camera-shot-offset", shotId: "shot-1", positionOffset: [0, 1, 0] },
      { ...provenanceFields, id: "b", kind: "camera-shot-offset", shotId: "shot-1", positionOffset: [0, 2, 0] },
    ]
    expectRejects(twoOffsets, "already has a camera offset")

    const twoColors = planV2()
    twoColors.overrides = [
      { ...provenanceFields, id: "a", kind: "entity-color", entityId: "e2", materialRole: "bodyPaint", color: "#111111" },
      { ...provenanceFields, id: "b", kind: "entity-color", entityId: "e2", materialRole: "bodyPaint", color: "#222222" },
    ]
    expectRejects(twoColors, 'already recolours material role "bodyPaint"')
  })

  it("rejects duplicate override ids", () => {
    const plan = planV2()
    plan.overrides = [
      { ...provenanceFields, id: "same", kind: "entity-visibility", entityId: "e2", visible: false },
      { ...provenanceFields, id: "same", kind: "entity-visibility", entityId: "e3", visible: false },
    ]
    expectRejects(plan, 'duplicate override id "same"')
  })

  it("requires a declared material role, so recolouring one entity cannot reach another", () => {
    const foreign = planV2()
    foreign.overrides = [
      { ...provenanceFields, id: "a", kind: "entity-color", entityId: "e2", materialRole: "seatFabric", color: "#111111" },
    ]
    expectRejects(foreign, 'declares no material role "seatFabric"')
  })

  it("gives a primitive exactly one role and a group none", () => {
    const primitiveWrongRole = planV2()
    primitiveWrongRole.overrides = [
      { ...provenanceFields, id: "a", kind: "entity-color", entityId: "e3", materialRole: "bodyPaint", color: "#111111" },
    ]
    expectRejects(primitiveWrongRole, 'its only material role is "identity"')

    const primitiveOk = planV2()
    primitiveOk.overrides = [
      { ...provenanceFields, id: "a", kind: "entity-color", entityId: "e3", materialRole: "identity", color: "#111111" },
    ]
    expect(scene3DPlanV2Schema.safeParse(primitiveOk).success).toBe(true)

    const group = planV2()
    group.overrides = [
      { ...provenanceFields, id: "a", kind: "entity-color", entityId: "e1", materialRole: "identity", color: "#111111" },
    ]
    expectRejects(group, "is a group and has no geometry to recolour")
  })

  it("honours locks and undeclared capabilities", () => {
    const locked = planV2()
    locked.objects[1] = { ...locked.objects[1], locks: ["transform"] }
    expectRejects(locked, "does not accept a transform overlay")

    const notAdvertised = planV2()
    notAdvertised.objects[1] = { ...notAdvertised.objects[1], capabilities: ["visibility"] }
    expectRejects(notAdvertised, "does not accept a transform overlay")
  })

  it("defaults an entity with no declared capabilities to accepting all three", () => {
    const entity: Scene3DEntityV2 = {
      id: "x",
      name: "x",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visual: { kind: "group" },
    }
    expect(scene3DEntityAcceptsOverlay(entity, "transform")).toBe(true)
    expect(scene3DEntityAcceptsOverlay({ ...entity, locks: ["color"] }, "color")).toBe(false)
    expect(scene3DEntityAcceptsOverlay({ ...entity, capabilities: [] }, "visibility")).toBe(false)
  })

  it("rejects an override that changes nothing and one that targets a ghost", () => {
    const empty = planV2()
    empty.overrides = [{ ...provenanceFields, id: "a", kind: "entity-transform", entityId: "e2", space: "local" }]
    expectRejects(empty, "changes nothing")

    const ghost = planV2()
    ghost.overrides = [
      { ...provenanceFields, id: "a", kind: "entity-visibility", entityId: "nobody", visible: false },
    ]
    expectRejects(ghost, 'targets unknown entity "nobody"')

    const ghostShot = planV2()
    ghostShot.overrides = [
      { ...provenanceFields, id: "a", kind: "camera-shot-offset", shotId: "nope", positionOffset: [0, 1, 0] },
    ]
    expectRejects(ghostShot, 'targets unknown shot "nope"')
  })

  it("has no camera-track-replacement kind — a replaced track is a new revision", () => {
    const replacement = {
      ...provenanceFields,
      id: "a",
      kind: "camera-track-replacement",
      cameraTrackAssetId: "asset-track",
    } as unknown as Scene3DOverride
    expect(scene3DPlanV2Schema.safeParse(planV2({ overrides: [replacement] })).success).toBe(false)
  })
})

describe("scene3d v2 — references and engines", () => {
  it("resolves a reference's entity id against v2 entities", () => {
    const ok = planV2({
      references: [{ id: "r1", url: "https://example.com/a.png", kind: "image", role: "appearance", objectId: "e2" }],
    })
    expect(scene3DPlanV2Schema.safeParse(ok).success).toBe(true)

    const bad = planV2({
      references: [{ id: "r1", url: "https://example.com/a.png", kind: "image", role: "appearance", objectId: "e9" }],
    })
    expectRejects(bad, 'points at unknown entity "e9"')
  })

  it("keeps v1's reference limit", () => {
    expect(SCENE3D_V2_LIMITS.maxReferences).toBe(SCENE3D_LIMITS.maxReferences)
    const nine = Array.from({ length: 9 }, (_unused, index) => ({
      id: `r${index}`,
      url: "https://example.com/a.png",
      kind: "image" as const,
      role: "appearance" as const,
    }))
    expect(scene3DPlanV2Schema.safeParse(planV2({ references: nine })).success).toBe(false)
  })

  it("names the shipped engines without closing the field", () => {
    expect(isKnownScene3DEngine("blender-cloud")).toBe(true)
    expect(isKnownScene3DEngine("blender-local")).toBe(true)
    expect(isKnownScene3DEngine("something-else")).toBe(false)
    // ...but an unknown slug still parses, so a new engine needs no release.
    const plan = planV2()
    expect(
      scene3DPlanV2Schema.safeParse({ ...plan, provenance: { ...plan.provenance, engine: "future-engine" } }).success,
    ).toBe(true)
    expect(
      scene3DPlanV2Schema.safeParse({ ...plan, provenance: { ...plan.provenance, engine: "Blender Cloud" } }).success,
    ).toBe(false)
  })

  it("pins the clay lighting preset", () => {
    expect(scene3DPlanV2Schema.safeParse(planV2({ lighting: { ...planV2().lighting, preset: "neon" as never } })).success).toBe(
      false,
    )
  })

  it("exposes the v2 schema version as 2", () => {
    expect(SCENE3D_SCHEMA_VERSION_V2).toBe(2)
    expect(SCENE3D_SCHEMA_VERSION).toBe(1)
  })
})
