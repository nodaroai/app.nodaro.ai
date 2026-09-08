import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as THREE from "three"
import { inspectGlb } from "../glb-inspect"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DCameraTrackV1, Scene3DEntityV2 } from "../plan-shape"
import { makeLoadableScene, override } from "./v2-fixtures"

/**
 * Bytes from a REAL Blender export of a NESTED scene, plus the world matrices
 * the compiler says every entity has on every frame.
 *
 * Both come from `services/scene3d-builder/scripts/export-nested-fixture.py`
 * run against `fixtures/nested-hierarchy-recipe.json` in the private builder
 * repo — one animated rig, a static arm parented to it and a static tip
 * parented to the arm, one material each:
 *
 *   rig        extras{nodaroEntityId: rig}   ← animated: translate + rotate
 *     ├── rig/body
 *     └── arm    extras{nodaroEntityId: arm} ← its transform is rig-relative
 *           ├── arm/body
 *           └── tip  extras{nodaroEntityId: tip}
 *                 └── tip/body
 *
 * The comparison is the point: three's sampled world matrix for every entity on
 * every frame against the compiler's own, in the same public Y-up basis. A
 * renderer that mounted the child under the parent's WRAPPER instead of inside
 * its baked node would pass every synthetic test and fail here from frame 1.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

interface ExpectedWorld {
  fps: number
  frameCount: number
  entities: string[]
  parents: Record<string, string | null>
  /** publicFrame → entityId → 4 ROWS of 4, public (Y-up) space. */
  worldByFrame: Record<string, Record<string, number[][]>>
}

function fixture(name: string): Buffer {
  return readFileSync(join(HERE, "fixtures", name))
}

function nestedGlb(): ArrayBuffer {
  const buffer = fixture("blender-nested-scene.glb")
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

const EXPECTED = JSON.parse(fixture("blender-nested-expected-world.json").toString("utf8")) as ExpectedWorld
const CAMERA_TRACK = JSON.parse(fixture("blender-nested-camera.json").toString("utf8")) as Scene3DCameraTrackV1

/** The plan `normalize-build` projects from this build's manifest. */
function entity(id: string, parentId: string | undefined, materialName: string, role: string): Scene3DEntityV2 {
  return {
    id,
    name: id,
    role: id === "rig" ? "vehicle" : "prop",
    ...(parentId ? { parentId } : {}),
    materialBindings: [{ role, materialName }],
    visual: {
      kind: "asset",
      assetId: "glb",
      rootNodeId: id,
      animation: { clipName: "Scene", startFrame: 0, endFrameExclusive: EXPECTED.frameCount },
    },
  } as Scene3DEntityV2
}

const OBJECTS: Scene3DEntityV2[] = [
  entity("rig", undefined, "mat.paint", "bodyPaint"),
  entity("arm", "rig", "mat.accent", "accent"),
  entity("tip", "arm", "mat.neutral", "neutral"),
]

const signal = () => new AbortController().signal

async function build(options: { objects?: Scene3DEntityV2[]; overrides?: ReturnType<typeof override>[] } = {}) {
  const { plan, resolver } = makeLoadableScene({
    glb: nestedGlb(),
    glbRole: "scene-geometry",
    objects: options.objects ?? OBJECTS,
    overrides: options.overrides,
    track: CAMERA_TRACK,
    durationInFrames: EXPECTED.frameCount,
    fps: EXPECTED.fps,
    width: 320,
    height: 180,
  })
  const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
  return { plan, loaded, handle: buildScene3DV2Scene(loaded) }
}

/** The mounted EXPORTED root of an entity — the node the compiler has matrices for. */
function exportedRoot(wrapper: THREE.Object3D, rootNodeId: string): THREE.Object3D {
  let found: THREE.Object3D | null = null
  wrapper.traverse((object) => {
    if (!found && object.userData?.name === rootNodeId) found = object
  })
  if (!found) throw new Error(`no mounted node named ${rootNodeId}`)
  return found
}

function expectedMatrix(frame: number, id: string): THREE.Matrix4 {
  const rows = EXPECTED.worldByFrame[String(frame)][id]
  return new THREE.Matrix4().set(
    rows[0][0], rows[0][1], rows[0][2], rows[0][3],
    rows[1][0], rows[1][1], rows[1][2], rows[1][3],
    rows[2][0], rows[2][1], rows[2][2], rows[2][3],
    rows[3][0], rows[3][1], rows[3][2], rows[3][3],
  )
}

/** Float32 accessors and a float32 GLB quaternion — compared, not matched. */
function expectMatrixClose(actual: THREE.Matrix4, expected: THREE.Matrix4, subject: string): void {
  for (let i = 0; i < 16; i++) {
    expect(actual.elements[i], `${subject}[${i}]`).toBeCloseTo(expected.elements[i], 4)
  }
}

describe("real nested Blender export — inspection", () => {
  const inspection = inspectGlb(nestedGlb(), "nested")

  it("reads the three semantic roots and the containment between them", () => {
    expect([...inspection.entityRootsByNodeName.keys()].sort()).toEqual(["arm", "rig", "tip"])
    expect(inspection.entityRootsByNodeName.get("rig")?.parentEntityId).toBeNull()
    expect(inspection.entityRootsByNodeName.get("arm")?.parentEntityId).toBe("rig")
    expect(inspection.entityRootsByNodeName.get("tip")?.parentEntityId).toBe("arm")
  })

  it("gives every entity exactly its own mesh and material", () => {
    const owned = (name: string) => {
      const root = inspection.entityRootsByNodeName.get(name)
      return { names: [...(root?.subtreeNodeNames ?? [])].sort(), materials: root?.materialNames, meshes: root?.meshNodeCount }
    }
    expect(owned("rig")).toEqual({ names: ["rig", "rig/body"], materials: ["mat.paint"], meshes: 1 })
    expect(owned("arm")).toEqual({ names: ["arm", "arm/body"], materials: ["mat.accent"], meshes: 1 })
    expect(owned("tip")).toEqual({ names: ["tip", "tip/body"], materials: ["mat.neutral"], meshes: 1 })
    // The file-wide counts still see all three; only OWNERSHIP is partitioned.
    expect(inspection.meshNodeCount).toBe(3)
  })

  it("exports one scene clip that animates the rig only", () => {
    expect(inspection.animationNames).toEqual(["Scene"])
    expect([...inspection.animatedNodeNames]).toEqual(["rig"])
  })
})

describe("real nested Blender export — sampled frames match the compiler", () => {
  it("agrees on every entity's world matrix on every frame", async () => {
    const { handle } = await build()
    const roots = new Map(
      OBJECTS.map((object) => [object.id, exportedRoot(handle.entities.get(object.id) as THREE.Object3D, object.id)]),
    )
    for (let frame = 0; frame < EXPECTED.frameCount; frame++) {
      handle.applyFrame(frame)
      for (const id of EXPECTED.entities) {
        expectMatrixClose(
          (roots.get(id) as THREE.Object3D).matrixWorld,
          expectedMatrix(frame, id),
          `${id}@${frame}`,
        )
      }
    }
    handle.dispose()
  })

  it("still agrees when frames are drawn out of order", async () => {
    const { handle } = await build()
    const tip = exportedRoot(handle.entities.get("tip") as THREE.Object3D, "tip")
    for (const frame of [11, 3, 0, 7, 11, 1]) {
      handle.applyFrame(frame)
      expectMatrixClose(tip.matrixWorld, expectedMatrix(frame, "tip"), `tip@${frame}`)
    }
    handle.dispose()
  })

  it("carries a manual move of the rig through both descendants", async () => {
    // The edit is a constant pre-transform in the entity's parent frame, which
    // is where the compiler composes a materialized overlay too.
    const shift = new THREE.Matrix4().makeTranslation(0, 0, 3)
    const { handle } = await build({
      overrides: [override({ kind: "entity-transform", entityId: "rig", space: "local", position: [0, 0, 3] })],
    })
    for (const frame of [0, 5, 11]) {
      handle.applyFrame(frame)
      for (const id of EXPECTED.entities) {
        const root = exportedRoot(handle.entities.get(id) as THREE.Object3D, id)
        expectMatrixClose(root.matrixWorld, shift.clone().multiply(expectedMatrix(frame, id)), `${id}@${frame}`)
      }
    }
    handle.dispose()
  })

  it("keeps a manual move of a nested child inside its animated parent's frame", async () => {
    const nudge = new THREE.Matrix4().makeTranslation(0.25, 0, 0)
    const { handle } = await build({
      overrides: [override({ kind: "entity-transform", entityId: "tip", space: "local", position: [0.25, 0, 0] })],
    })
    for (const frame of [0, 5, 11]) {
      handle.applyFrame(frame)
      const arm = expectedMatrix(frame, "arm")
      const tipLocal = arm.clone().invert().multiply(expectedMatrix(frame, "tip"))
      // arm world · edit · tip's own baked local — the ancestor's rotation is
      // applied to the edit, which is what "in the parent's frame" means.
      const expected = arm.clone().multiply(nudge).multiply(tipLocal)
      const root = exportedRoot(handle.entities.get("tip") as THREE.Object3D, "tip")
      expectMatrixClose(root.matrixWorld, expected, `tip@${frame}`)
      // Untouched siblings and ancestors stay exactly where the compiler put them.
      expectMatrixClose(
        exportedRoot(handle.entities.get("arm") as THREE.Object3D, "arm").matrixWorld,
        arm,
        `arm@${frame}`,
      )
    }
    handle.dispose()
  })

  it("recolours one entity without touching the entities nested inside it", async () => {
    const { handle } = await build({
      overrides: [override({ kind: "entity-color", entityId: "rig", materialRole: "bodyPaint", color: "#00ff00" })],
    })
    handle.applyFrame(0)
    const materialsOf = (id: string): Array<[string, string]> => {
      const out: Array<[string, string]> = []
      ;(handle.entities.get(id) as THREE.Object3D).traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh || mesh.userData.objectId !== id) return
        const material = mesh.material as THREE.MeshStandardMaterial
        out.push([material.name, material.color.getHexString()])
      })
      return out
    }
    expect(materialsOf("rig")).toEqual([["mat.paint", new THREE.Color("#00ff00").getHexString()]])
    expect(materialsOf("arm")).toEqual([["mat.accent", new THREE.Color("#8a8a8a").getHexString()]])
    expect(materialsOf("tip")).toEqual([["mat.neutral", new THREE.Color("#cc7722").getHexString()]])
    handle.dispose()
  })

  it("draws the SAME scene once the edit is materialized into the source", async () => {
    // The round trip the contract requires: a manual edit on a retained revision is written
    // into the authoring source and rebuilt, and the rebuilt revision - carrying no override at
    // all - must draw what the edited one drew.
    //
    // `blender-nested-edited-scene.glb` is Blender's build of
    // `fixtures/nested-hierarchy-edited-recipe.json`, whose overlay is the one the private
    // materializer writes for exactly this override (asserted in `retained-overlays.test.ts`).
    const edited = fixture("blender-nested-edited-scene.glb")
    const { plan, resolver } = makeLoadableScene({
      glb: edited.buffer.slice(edited.byteOffset, edited.byteOffset + edited.byteLength) as ArrayBuffer,
      glbRole: "scene-geometry",
      objects: OBJECTS,
      track: CAMERA_TRACK,
      durationInFrames: EXPECTED.frameCount,
      fps: EXPECTED.fps,
      width: 320,
      height: 180,
    })
    const rebuilt = buildScene3DV2Scene(await loadScene3DV2(plan, { resolver, signal: signal() }))
    const { handle: overridden } = await build({
      overrides: [override({ kind: "entity-transform", entityId: "arm", space: "local", position: [0, 0.25, 0] })],
    })

    for (let frame = 0; frame < EXPECTED.frameCount; frame++) {
      rebuilt.applyFrame(frame)
      overridden.applyFrame(frame)
      for (const id of EXPECTED.entities) {
        expectMatrixClose(
          exportedRoot(rebuilt.entities.get(id) as THREE.Object3D, id).matrixWorld,
          exportedRoot(overridden.entities.get(id) as THREE.Object3D, id).matrixWorld,
          `${id}@${frame}`,
        )
      }
    }
    // …and it is not vacuous: both differ from the unedited build.
    const { handle: plainHandle } = await build()
    plainHandle.applyFrame(0)
    rebuilt.applyFrame(0)
    expect(
      exportedRoot(rebuilt.entities.get("tip") as THREE.Object3D, "tip").matrixWorld.elements,
    ).not.toEqual(exportedRoot(plainHandle.entities.get("tip") as THREE.Object3D, "tip").matrixWorld.elements)
    rebuilt.dispose()
    overridden.dispose()
    plainHandle.dispose()
  })

  it("loads the export with no readiness warnings", async () => {
    const { loaded } = await build()
    expect(loaded.warnings).toEqual([])
  })
})
