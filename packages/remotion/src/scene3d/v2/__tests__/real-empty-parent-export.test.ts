import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as THREE from "three"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DCameraTrackV1, Scene3DEntityV2 } from "../plan-shape"
import { makeLoadableScene, override } from "./v2-fixtures"

/**
 * Bytes from a REAL Blender 5.2 export whose parent entity owns no geometry at
 * all, plus what the file itself hides, read back out of the `.blend`.
 *
 * `services/scene3d-builder/scripts/export-nested-fixture.py` against
 * `fixtures/nested-empty-parent-recipe.json` in the private builder repo. The
 * rig is an EMPTY carrying the only animation in the scene — it translates AND
 * turns a quarter turn about +Z — and every triangle belongs to entities nested
 * inside it:
 *
 *   rig  extras{nodaroEntityId: rig}   EMPTY, animated, no mesh of its own
 *     └── arm  extras{nodaroEntityId: arm}
 *           ├── arm/body
 *           └── tip  extras{nodaroEntityId: tip}
 *                 └── tip/body
 *
 * Three things are checked against that file, none of which a synthetic GLB can
 * settle:
 *
 *  1. A compiled organizational parent LOADS. Ownership stops at a nested root,
 *     so the rig's own mesh count is zero, and requiring a mesh there refused
 *     the exact shape the nesting rule exists to support.
 *  2. Its baked transform reaches the geometry on every frame — checked against
 *     an oracle written out below from the recipe's declared numbers, not
 *     against the compiler's own answer.
 *  3. `world`-space edit fidelity end to end: the file rebuilt from the
 *     materialized edit draws the same frames as this file plus that edit.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

interface ExpectedWorld {
  fps: number
  frameCount: number
  entities: string[]
  worldByFrame: Record<string, Record<string, number[][]>>
}

interface VisibilityReport {
  blender: string
  depsgraphProbe: {
    measured: boolean
    instances: number
    instancesWithEyeHidden: number
    instancesWithRenderHidden: number
  }
  objects: Array<{
    name: string
    entityId: string | null
    isMesh: boolean
    hideRender: boolean
    hideViewport: boolean
    hiddenInViewLayer: boolean
    ownHidden: boolean
  }>
}

function fixture(name: string): Buffer {
  return readFileSync(join(HERE, "fixtures", name))
}

function glbOf(name: string): ArrayBuffer {
  const buffer = fixture(name)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

const EXPECTED = JSON.parse(fixture("blender-empty-parent-expected-world.json").toString("utf8")) as ExpectedWorld
const CAMERA_TRACK = JSON.parse(fixture("blender-empty-parent-camera.json").toString("utf8")) as Scene3DCameraTrackV1
const VISIBILITY = JSON.parse(
  fixture("blender-empty-parent-edited-visibility.json").toString("utf8"),
) as VisibilityReport

/**
 * The plan `normalize-build` projects from this build's manifest — copied from what the real
 * normalizer emitted for this exact build, not simplified.
 *
 * Two details matter for a mesh-less parent and were checked against it: the capability list
 * is the same for EVERY entity, `color` included, and the rig's `materialBindings` is an empty
 * array rather than an absent key. That combination is what actually reaches the loader.
 */
function entity(id: string, parentId: string | undefined, binding?: [string, string]): Scene3DEntityV2 {
  return {
    id, name: id, role: id === "rig" ? "vehicle" : "prop",
    ...(parentId ? { parentId } : {}),
    capabilities: ["transform", "color", "visibility"],
    materialBindings: binding ? [{ role: binding[1], materialName: binding[0] }] : [],
    visual: {
      kind: "asset", assetId: "glb", rootNodeId: id,
      animation: { clipName: "Scene", startFrame: 0, endFrameExclusive: EXPECTED.frameCount },
    },
  } as Scene3DEntityV2
}

const OBJECTS: Scene3DEntityV2[] = [
  // The rig binds no material: it owns no mesh to bind one to, and still advertises `color`.
  entity("rig", undefined),
  entity("arm", "rig", ["mat.accent", "accent"]),
  entity("tip", "arm", ["mat.neutral", "neutral"]),
]

const signal = () => new AbortController().signal

async function build(options: {
  glb?: string
  objects?: Scene3DEntityV2[]
  overrides?: ReturnType<typeof override>[]
} = {}) {
  const { plan, resolver } = makeLoadableScene({
    glb: glbOf(options.glb ?? "blender-empty-parent-scene.glb"),
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

function mounted(wrapper: THREE.Object3D, nodeName: string): THREE.Object3D {
  let found: THREE.Object3D | null = null
  wrapper.traverse((object) => {
    if (!found && object.userData?.name === nodeName) found = object
  })
  if (!found) throw new Error(`no mounted node named ${nodeName}`)
  return found
}

function worldPosition(handle: { entities: Map<string, THREE.Object3D> }, id: string): number[] {
  const node = mounted(handle.entities.get(id) as THREE.Object3D, id)
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).toArray()
}

/** Float32 accessors and a float32 GLB quaternion — compared, not matched. */
function expectClose(actual: number[], expected: number[], subject: string): void {
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i], `${subject}[${i}]`).toBeCloseTo(expected[i], 4)
  }
}

// ─── the oracle: the recipe's own numbers, in public Y-up, by hand ──────────
//
// The recipe places the rig at the origin and animates it from (0,0,0) to
// (2,0,0) in AUTHORING Z-up with a quarter turn about +Z over frames 1..12,
// linearly. The arm sits at authoring (0.3, 0, 1) inside it and the tip at
// (0.5, 0, 0.2) inside the arm. Authoring → public is (x, y, z) → (x, z, -y),
// so +Z up becomes +Y up and the rig's turn is a turn about public +Y.
//
// None of this reads the compiler or the renderer: it is the recipe, restated.

const FRAMES = EXPECTED.frameCount

function rigAngle(frame: number): number {
  return (frame / (FRAMES - 1)) * (Math.PI / 2)
}

/** Public-space rotation of a point about +Y (what an authoring +Z turn becomes). */
function turnAboutUp(point: number[], angle: number): number[] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // Authoring (x, y) rotate as usual; in public those axes are (x, -z).
  return [point[0] * c + point[2] * s, point[1], -point[0] * s + point[2] * c]
}

function rigOrigin(frame: number): number[] {
  return [(frame / (FRAMES - 1)) * 2, 0, 0]
}

/** Where the arm's exported root sits, with no edit: rig ∘ arm's own offset. */
function armWorld(frame: number): number[] {
  const own = turnAboutUp([0.3, 1, 0], rigAngle(frame))
  return rigOrigin(frame).map((v, i) => v + own[i])
}

/** ...and the tip, one level deeper. */
function tipWorld(frame: number): number[] {
  const own = turnAboutUp([0.3 + 0.5, 1 + 0.2, 0], rigAngle(frame))
  return rigOrigin(frame).map((v, i) => v + own[i])
}

/**
 * The same two, with the arm pinned to a WORLD point.
 *
 * The wrapper's origin is the declared point on every frame; the arm's own
 * baked offset still rides the rig's turn underneath it, and so does the tip's.
 * Authoring (0.75, -0.5, 1.25) is public (0.75, 1.25, 0.5).
 */
const PINNED_PUBLIC = [0.75, 1.25, 0.5]

function armWorldPinned(frame: number): number[] {
  const own = turnAboutUp([0.3, 1, 0], rigAngle(frame))
  return PINNED_PUBLIC.map((v, i) => v + own[i])
}

function tipWorldPinned(frame: number): number[] {
  const own = turnAboutUp([0.3 + 0.5, 1 + 0.2, 0], rigAngle(frame))
  return PINNED_PUBLIC.map((v, i) => v + own[i])
}

describe("a real export whose parent entity owns no mesh", () => {
  it("loads, and gives the parent no geometry of its own", async () => {
    const { loaded, handle } = await build()
    const root = [...loaded.glbById.values()][0].inspection.entityRootsByNodeName.get("rig")
    expect(root?.meshNodeCount).toBe(0)
    expect(root?.parentEntityId).toBeNull()
    const meshes: string[] = []
    ;(handle.entities.get("rig") as THREE.Object3D).traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && mesh.userData.objectId === "rig") meshes.push(mesh.name)
    })
    expect(meshes).toEqual([])
    handle.dispose()
  })

  it("carries the empty parent's baked motion to every descendant, every frame", async () => {
    const { handle } = await build()
    for (let frame = 0; frame < FRAMES; frame++) {
      handle.applyFrame(frame)
      expectClose(worldPosition(handle, "rig"), rigOrigin(frame), `rig@${frame}`)
      expectClose(worldPosition(handle, "arm"), armWorld(frame), `arm@${frame}`)
      expectClose(worldPosition(handle, "tip"), tipWorld(frame), `tip@${frame}`)
    }
    handle.dispose()
  })

  it("agrees with the compiler's own matrices too, in and out of order", async () => {
    const { handle } = await build()
    for (const frame of [0, 5, 11, 2, 11, 0]) {
      handle.applyFrame(frame)
      for (const id of EXPECTED.entities) {
        const rows = EXPECTED.worldByFrame[String(frame)][id]
        expectClose(worldPosition(handle, id), [rows[0][3], rows[1][3], rows[2][3]], `${id}@${frame}`)
      }
    }
    handle.dispose()
  })
})

describe("a world-space edit on a child of that moving, turning parent", () => {
  const PIN = () => override({
    id: "edit.arm.pin", kind: "entity-transform", entityId: "arm", space: "world",
    position: PINNED_PUBLIC as [number, number, number],
  })

  it("holds the declared scene point while the parent moves and turns", async () => {
    const { handle } = await build({ overrides: [PIN()] })
    for (let frame = 0; frame < FRAMES; frame++) {
      handle.applyFrame(frame)
      expectClose(worldPosition(handle, "arm"), armWorldPinned(frame), `arm@${frame}`)
      // Still attached: the tip keeps riding the rig's turn under the pinned arm.
      expectClose(worldPosition(handle, "tip"), tipWorldPinned(frame), `tip@${frame}`)
      // And the parent itself is untouched by an edit on its child.
      expectClose(worldPosition(handle, "rig"), rigOrigin(frame), `rig@${frame}`)
    }
    handle.dispose()
  })

  it("is a DIFFERENT scene from the same numbers read in the parent's frame", async () => {
    const world = await build({ overrides: [PIN()] })
    const local = await build({
      overrides: [override({ id: "edit.arm.pin", kind: "entity-transform", entityId: "arm",
        space: "local", position: PINNED_PUBLIC as [number, number, number] })],
    })
    world.handle.applyFrame(FRAMES - 1)
    local.handle.applyFrame(FRAMES - 1)
    const a = worldPosition(world.handle, "arm")
    const b = worldPosition(local.handle, "arm")
    // A quarter turn in: the parent's axes and the scene's are as far apart as
    // they get, and the two spaces have to say different things.
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1)
    world.handle.dispose()
    local.handle.dispose()
  })

  it("rebuilds into a file that draws the same frames with no override at all", async () => {
    // The round trip, end to end: this edit was materialized into the recipe as
    // `entity-world-transform`, Blender rebuilt it, and the compiler baked the
    // per-frame correction into the arm's own keyframes. If the two ends had
    // drifted apart — a constant where the renderer has a curve, an axis read in
    // the parent's frame — these two would separate as the rig turns.
    const edited = await build({ glb: "blender-empty-parent-edited-scene.glb" })
    const overlaid = await build({ overrides: [PIN()] })
    for (let frame = 0; frame < FRAMES; frame++) {
      edited.handle.applyFrame(frame)
      overlaid.handle.applyFrame(frame)
      for (const id of ["rig", "arm", "tip"]) {
        expectClose(worldPosition(edited.handle, id), worldPosition(overlaid.handle, id), `${id}@${frame}`)
      }
    }
    // ...and both differ from the unedited build, or the comparison proves nothing.
    const base = await build()
    base.handle.applyFrame(FRAMES - 1)
    edited.handle.applyFrame(FRAMES - 1)
    expect(worldPosition(edited.handle, "arm")).not.toEqual(worldPosition(base.handle, "arm"))
    edited.handle.dispose()
    overlaid.handle.dispose()
    base.handle.dispose()
  })
})

describe("what the .blend hides and what this renderer hides", () => {
  /** Is this object drawn, after every ancestor has had its say? */
  function drawn(object: THREE.Object3D): boolean {
    for (let cursor: THREE.Object3D | null = object; cursor; cursor = cursor.parent) {
      if (!cursor.visible) return false
    }
    return true
  }

  async function buildHidden() {
    return build({
      overrides: [
        override({ id: "edit.rig.hide", kind: "entity-visibility", entityId: "rig", visible: false }),
        // Explicitly SHOWN, and still inside the hidden rig.
        override({ id: "edit.tip.show", kind: "entity-visibility", entityId: "tip", visible: true }),
      ],
    })
  }

  it("hides exactly the meshes the reopened .blend hides", async () => {
    const { handle } = await buildHidden()
    handle.applyFrame(0)
    const meshes = VISIBILITY.objects.filter((entry) => entry.isMesh && entry.entityId)
    expect(meshes.length).toBeGreaterThan(0)
    for (const entry of meshes) {
      const object = mounted(handle.entities.get(entry.entityId as string) as THREE.Object3D, entry.name)
      // `hide_render` in the file is the INHERITED answer, and so is walking the
      // scene graph here: a hidden rig takes its arm and its tip with it.
      expect(drawn(object), `${entry.name} drawn`).toBe(!entry.hideRender)
    }
    handle.dispose()
  })

  it("keeps each entity's OWN visibility, so showing the parent restores them", async () => {
    const { handle } = await buildHidden()
    handle.applyFrame(0)
    const ownHiddenInFile = new Set(
      VISIBILITY.objects.filter((entry) => entry.ownHidden).map((entry) => entry.entityId),
    )
    expect(ownHiddenInFile).toEqual(new Set(["rig"]))
    for (const id of ["rig", "arm", "tip"]) {
      // The wrapper's own flag is the entity's own visibility, in both places.
      expect((handle.entities.get(id) as THREE.Object3D).visible, id).toBe(!ownHiddenInFile.has(id))
    }
    handle.dispose()
  })

  it.each([false, true])("preserves baked own visibility when the parent show override is %s", async (showParent) => {
    const ownHidden = new Set(VISIBILITY.objects.filter((entry) => entry.ownHidden).map((entry) => entry.entityId))
    const { handle } = await build({
      glb: "blender-empty-parent-edited-scene.glb",
      objects: OBJECTS.map((object) => ownHidden.has(object.id) ? { ...object, visible: false } : object),
      overrides: showParent
        ? [override({ id: "edit.rig.show", kind: "entity-visibility", entityId: "rig", visible: true })]
        : [],
    })
    // A rebuilt revision carries the native own-state in the plan, with no hide overlay.
    // Showing its empty parent must restore the children, including after reverse scrubbing.
    for (const frame of [0, FRAMES - 1, 0]) {
      handle.applyFrame(frame)
      for (const entry of VISIBILITY.objects.filter((item) => item.isMesh && item.entityId)) {
        const object = mounted(handle.entities.get(entry.entityId as string) as THREE.Object3D, entry.name)
        expect(drawn(object), `${entry.name}@${frame}`).toBe(showParent || !entry.hideRender)
      }
      expect(handle.entities.get("rig")?.visible).toBe(showParent)
      expect(handle.entities.get("tip")?.visible).toBe(true)
    }
    handle.dispose()
  })

  it("draws the explicitly shown descendant again as soon as its ancestor is shown", async () => {
    const { handle } = await build({
      overrides: [override({ id: "edit.tip.show", kind: "entity-visibility", entityId: "tip", visible: true })],
    })
    handle.applyFrame(0)
    for (const id of ["rig", "arm", "tip"]) {
      expect(drawn(mounted(handle.entities.get(id) as THREE.Object3D, id)), id).toBe(true)
    }
    handle.dispose()
  })

  it("records why the source uses render visibility and not the viewport's", () => {
    // Measured in the reopened file, not assumed: hiding an object in the view
    // layer takes it OUT of the evaluated depsgraph — which is what the entity
    // pass ray casts against and what the geometry checks read — while
    // `hide_render` leaves it there. Hiding an entity must change what the scene
    // draws, not what it measures.
    const probe = VISIBILITY.depsgraphProbe
    expect(probe.measured).toBe(true)
    expect(probe.instancesWithEyeHidden).toBe(probe.instances - 1)
    expect(probe.instancesWithRenderHidden).toBe(probe.instances)
    expect(VISIBILITY.objects.every((entry) => !entry.hiddenInViewLayer && !entry.hideViewport)).toBe(true)
  })
})
