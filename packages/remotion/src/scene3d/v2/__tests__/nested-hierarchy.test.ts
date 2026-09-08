import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DEntityV2 } from "../plan-shape"
import { assetRefFor, makeGlb, type MakeGlbOptions } from "./glb-fixtures"
import { groupEntity, makeLoadableScene, override } from "./v2-fixtures"

/**
 * Nested entity roots: the contract between what the compiler EXPORTS and what
 * this renderer draws.
 *
 * A child entity's exported root sits inside its parent's and its transform is
 * relative to it, so the parent's baked — here animated — placement reaches the
 * child through the file itself. Mounting the child under the parent's WRAPPER
 * instead drops that baked placement.
 *
 * The two override spaces then say different things about the same child, and
 * `space` is a required field so the user picks which: `local` writes the
 * wrapper's own slot, which is the parent's frame and travels with it, while
 * `world` names a place in the SCENE and is re-derived from the parent's true
 * world on every frame.
 */

/** A rig sliding 0 → 4m on x over 2s, with a child arm 1m above it. */
const RIG_WITH_ARM: MakeGlbOptions = {
  nodes: [
    {
      name: "rig",
      entityRootId: "rig",
      animateTranslation: {
        clip: "scene",
        times: [0, 1, 2],
        values: [
          [0, 0, 0],
          [2, 0, 0],
          [4, 0, 0],
        ],
      },
      children: [
        { name: "rig/body", entityRootId: "rig", mesh: true, materialName: "steel" },
        {
          name: "arm",
          entityRootId: "arm",
          translation: [0, 1, 0],
          children: [{ name: "arm/body", entityRootId: "arm", mesh: true, materialName: "paint" }],
        },
      ],
    },
  ],
}

function assetEntity(partial: Partial<Scene3DEntityV2> & { id: string; rootNodeId: string }): Scene3DEntityV2 {
  const { rootNodeId, ...rest } = partial
  return {
    name: `${partial.id}-entity`,
    role: "prop",
    visual: {
      kind: "asset",
      assetId: "glb",
      rootNodeId,
      animation: { clipName: "scene", startFrame: 0, endFrameExclusive: 48 },
    },
    ...rest,
  } as Scene3DEntityV2
}

const RIG = assetEntity({ id: "rig", rootNodeId: "rig" })
const ARM = assetEntity({ id: "arm", rootNodeId: "arm", parentId: "rig" })

const signal = () => new AbortController().signal

async function build(options: { objects?: Scene3DEntityV2[]; overrides?: ReturnType<typeof override>[] } = {}) {
  const { plan, resolver } = makeLoadableScene({
    glb: makeGlb(RIG_WITH_ARM),
    glbRole: "scene-geometry",
    objects: options.objects ?? [RIG, ARM],
    overrides: options.overrides,
    durationInFrames: 48,
    fps: 24,
  })
  const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
  return { plan, loaded, handle: buildScene3DV2Scene(loaded) }
}

/** The world position of the entity's EXPORTED root, not of its wrapper. */
function exportedWorld(handle: { entities: Map<string, THREE.Object3D> }, id: string, rootNodeId: string): number[] {
  const wrapper = handle.entities.get(id) as THREE.Object3D
  let found: THREE.Object3D | null = null
  wrapper.traverse((object) => {
    if (!found && object.userData?.name === rootNodeId) found = object
  })
  if (!found) throw new Error(`no mounted node named ${rootNodeId}`)
  return new THREE.Vector3().setFromMatrixPosition((found as THREE.Object3D).matrixWorld).toArray()
}

/** glTF accessors are float32, so world positions are compared, not matched. */
function expectVec(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 5)
}

/** Where the rig's baked track has it at this frame (linear, 24 fps). */
function bakedRigX(frame: number): number {
  return Math.min(4, (frame / 24) * 2)
}

describe("nested entity roots — baked hierarchy", () => {
  it("mounts the child inside the parent's baked node, not under its wrapper", async () => {
    const { handle } = await build()
    const arm = handle.entities.get("arm") as THREE.Object3D
    const rig = handle.entities.get("rig") as THREE.Object3D
    // The wrapper's parent is the parent's exported node — which is what
    // carries the animated placement — and not the parent's wrapper.
    expect(arm.parent?.userData?.name).toBe("rig")
    expect(arm.parent?.parent).toBe(rig)
    handle.dispose()
  })

  it("carries the parent's animated placement into the child on every frame", async () => {
    const { handle } = await build()
    for (const frame of [0, 7, 24, 47, 12, 0]) {
      handle.applyFrame(frame)
      const x = bakedRigX(frame)
      expectVec(exportedWorld(handle, "rig", "rig"), [x, 0, 0])
      // The child's own baked local (0,1,0) composed onto the parent's world.
      expectVec(exportedWorld(handle, "arm", "arm"), [x, 1, 0])
    }
    handle.dispose()
  })

  it("moves the child when the PARENT is edited", async () => {
    const { handle } = await build({
      overrides: [override({ kind: "entity-transform", entityId: "rig", space: "local", position: [10, 0, 0] })],
    })
    for (const frame of [0, 24, 47]) {
      handle.applyFrame(frame)
      expectVec(exportedWorld(handle, "arm", "arm"), [10 + bakedRigX(frame), 1, 0])
    }
    handle.dispose()
  })

  it("holds a world-space edit at the place in the SCENE it names", async () => {
    const { handle } = await build({
      overrides: [override({ kind: "entity-transform", entityId: "arm", space: "world", position: [0, 0, 5] })],
    })
    const arm = handle.entities.get("arm") as THREE.Object3D
    const wrapperLocals: number[][] = []
    for (const frame of [0, 24, 47]) {
      handle.applyFrame(frame)
      wrapperLocals.push(arm.position.toArray())
      // The wrapper's origin is at world (0,0,5) whatever the rig is doing; the
      // arm's OWN baked (0,1,0) still composes under it, and would still be
      // rotated by a rotating parent. That is what "world" claims.
      expectVec(exportedWorld(handle, "arm", "arm"), [0, 1, 5])
    }
    // The price of naming a scene point under a moving parent: the wrapper is a
    // different matrix per frame. `overlays.py` re-derives exactly these.
    const frames = [0, 24, 47]
    wrapperLocals.forEach((local, index) => expectVec(local, [-bakedRigX(frames[index]), 0, 5]))
    handle.dispose()
  })

  it("keeps a LOCAL edit riding along with the parent it is attached to", async () => {
    const { handle } = await build({
      overrides: [override({ kind: "entity-transform", entityId: "arm", space: "local", position: [0, 0, 5] })],
    })
    const arm = handle.entities.get("arm") as THREE.Object3D
    for (const frame of [0, 24, 47]) {
      handle.applyFrame(frame)
      // Same numbers, the other space: a constant offset in the rig's frame, so
      // the rig's motion still carries it.
      expect(arm.position.toArray()).toEqual([0, 0, 5])
      expectVec(exportedWorld(handle, "arm", "arm"), [bakedRigX(frame), 1, 5])
    }
    handle.dispose()
  })

  it("divides an ancestor's own edit AND its baked motion out exactly once", async () => {
    const { handle } = await build({
      overrides: [
        override({ kind: "entity-transform", entityId: "rig", space: "local", position: [10, 0, 0] }),
        override({ kind: "entity-transform", entityId: "arm", space: "world", position: [0, 0, 5] }),
      ],
    })
    const arm = handle.entities.get("arm") as THREE.Object3D
    handle.applyFrame(24)
    // The rig's +10 and its baked +2 are both in the wrapper's true parent
    // world, so both are divided out — once each.
    expect(arm.position.toArray()).toEqual([-12, 0, 5])
    expectVec(exportedWorld(handle, "arm", "arm"), [0, 1, 5])
    handle.dispose()
  })

  it("gives each entity only the materials and meshes it owns", async () => {
    const { handle } = await build({
      overrides: [override({ kind: "entity-color", entityId: "rig", materialRole: "hull", color: "#00ff00" })],
      objects: [
        { ...RIG, materialBindings: [{ role: "hull", materialName: "steel" }] },
        { ...ARM, materialBindings: [{ role: "hull", materialName: "paint" }] },
      ],
    })
    const colorsOf = (id: string): string[] => {
      const out: string[] = []
      ;(handle.entities.get(id) as THREE.Object3D).traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh && mesh.userData.objectId === id) {
          out.push((mesh.material as THREE.MeshStandardMaterial).color.getHexString())
        }
      })
      return out
    }
    expect(colorsOf("rig")).toEqual([new THREE.Color("#00ff00").getHexString()])
    // Recolouring the parent's `hull` role must not reach the child's material,
    // which wears the same role name inside its own authorized root.
    expect(colorsOf("arm")).not.toContain(new THREE.Color("#00ff00").getHexString())
    handle.dispose()
  })

  it("refuses a material binding that names a material inside a nested child", async () => {
    await expect(
      build({ objects: [{ ...RIG, materialBindings: [{ role: "hull", materialName: "paint" }] }, ARM] }),
    ).rejects.toThrow(/not in this entity's asset root/)
  })
})

describe("an organizational parent that owns no mesh of its own", () => {
  /**
   * A rig that IS only a transform: an empty root sliding 0 → 4m on x, with the
   * only geometry in the entity nested under it. The compiler gives every
   * entity a root node whether or not any geometry op names it, so this is what
   * a recipe grouping entities under a `parentId` actually exports — and
   * ownership stopping at the nested root is precisely why the parent's own
   * mesh count is zero.
   */
  const EMPTY_RIG: MakeGlbOptions = {
    nodes: [
      {
        name: "rig",
        entityRootId: "rig",
        animateTranslation: { clip: "scene", times: [0, 1, 2], values: [[0, 0, 0], [2, 0, 0], [4, 0, 0]] },
        children: [
          {
            name: "arm",
            entityRootId: "arm",
            translation: [0, 1, 0],
            children: [{ name: "arm/body", entityRootId: "arm", mesh: true, materialName: "paint" }],
          },
        ],
      },
    ],
  }

  async function buildEmptyRig(objects?: Scene3DEntityV2[]) {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(EMPTY_RIG), glbRole: "scene-geometry",
      objects: objects ?? [RIG, ARM], durationInFrames: 48, fps: 24,
    })
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    return buildScene3DV2Scene(loaded)
  }

  it("loads a transform-only parent and carries its baked motion to the child", async () => {
    const handle = await buildEmptyRig()
    for (const frame of [0, 7, 24, 47, 12]) {
      handle.applyFrame(frame)
      expectVec(exportedWorld(handle, "rig", "rig"), [bakedRigX(frame), 0, 0])
      expectVec(exportedWorld(handle, "arm", "arm"), [bakedRigX(frame), 1, 0])
    }
    handle.dispose()
  })

  it("keeps mesh ownership disjoint — the parent owns none", async () => {
    const handle = await buildEmptyRig()
    const meshesOf = (id: string): string[] => {
      const out: string[] = []
      ;(handle.entities.get(id) as THREE.Object3D).traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh && mesh.userData.objectId === id) out.push(mesh.name || "(unnamed)")
      })
      return out
    }
    expect(meshesOf("rig")).toEqual([])
    expect(meshesOf("arm")).toHaveLength(1)
    handle.dispose()
  })

  it("still edits and hides like any other entity", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(EMPTY_RIG), glbRole: "scene-geometry", objects: [RIG, ARM],
      overrides: [override({ kind: "entity-transform", entityId: "rig", space: "local", position: [0, 0, 6] })],
      durationInFrames: 48, fps: 24,
    })
    const handle = buildScene3DV2Scene(await loadScene3DV2(plan, { resolver, signal: signal() }))
    handle.applyFrame(24)
    // Nothing to draw at the parent, but its transform still reaches the child.
    expectVec(exportedWorld(handle, "arm", "arm"), [bakedRigX(24), 1, 6])
    handle.dispose()
  })

  it("still refuses a root with no mesh and nothing nested inside it", async () => {
    const barren: MakeGlbOptions = {
      nodes: [
        { name: "rig", entityRootId: "rig", children: [{ name: "rig/empty", entityRootId: "rig" }] },
        { name: "prop", entityRootId: "prop", mesh: true },
      ],
    }
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(barren), glbRole: "scene-geometry",
      objects: [
        assetEntity({ id: "rig", rootNodeId: "rig" }),
        assetEntity({ id: "prop", rootNodeId: "prop" }),
      ],
      durationInFrames: 48,
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /contains no mesh and nothing is nested inside it/,
    )
  })
})

describe("nested entity roots — plan and file must agree", () => {
  it("rejects a plan that forgets the parent the file nests", async () => {
    await expect(build({ objects: [RIG, { ...ARM, parentId: undefined }] })).rejects.toThrow(
      /nests this entity's root inside entity "rig", but the plan declares parent "\(none\)"/,
    )
  })

  it("rejects a plan that names a different parent than the file", async () => {
    await expect(
      build({ objects: [RIG, groupEntity({ id: "other" }), { ...ARM, parentId: "other" }] }),
    ).rejects.toThrow(/but the plan declares parent "other"/)
  })

  it("rejects a plan that parents two independently exported roots of one asset", async () => {
    // Flattened export + declared parent is the case where the parent's baked
    // transform would silently never reach the child.
    const flat: MakeGlbOptions = {
      nodes: [
        { name: "rig", entityRootId: "rig", mesh: true, translation: [3, 0, 0] },
        { name: "arm", entityRootId: "arm", mesh: true, translation: [3, 1, 0] },
      ],
    }
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(flat),
      glbRole: "scene-geometry",
      objects: [
        assetEntity({ id: "rig", rootNodeId: "rig", visual: { kind: "asset", assetId: "glb", rootNodeId: "rig" } }),
        assetEntity({
          id: "arm",
          rootNodeId: "arm",
          parentId: "rig",
          visual: { kind: "asset", assetId: "glb", rootNodeId: "arm" },
        }),
      ],
      durationInFrames: 48,
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /exports its root outside that entity, so the parent's baked transform would never reach it/,
    )
  })

  it("rejects a nesting parent that binds a different asset", async () => {
    // The names line up and the plan's parentage is right, but the parent's
    // baked node lives in another file, so nothing would place the child.
    const { plan, resolver, bytes } = makeLoadableScene({
      glb: makeGlb(RIG_WITH_ARM),
      glbRole: "scene-geometry",
      objects: [RIG, ARM],
      durationInFrames: 48,
    })
    const second = makeGlb({ nodes: [{ name: "rig", entityRootId: "rig", mesh: true }] })
    bytes.glb2 = second
    const patched = {
      ...plan,
      assets: [...plan.assets, assetRefFor("glb2", "glb", "entity-geometry", second)],
      objects: [{ ...RIG, visual: { kind: "asset", assetId: "glb2", rootNodeId: "rig" } }, ARM],
    } as typeof plan
    await expect(loadScene3DV2(patched, { resolver, signal: signal() })).rejects.toThrow(
      /which does not bind asset "glb"/,
    )
  })

  it("still allows a non-asset parent that the file cannot express", async () => {
    // A `group` entity owns no exported node, so an asset child of it is a
    // scene-level root in the file and a child of the group's wrapper here —
    // nothing baked sits between them, so its `local` and `world` coincide.
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb({ nodes: [{ name: "rig", entityRootId: "rig", mesh: true }] }),
      glbRole: "scene-geometry",
      objects: [
        groupEntity({ id: "world", position: [5, 0, 0] }),
        assetEntity({
          id: "rig",
          rootNodeId: "rig",
          parentId: "world",
          visual: { kind: "asset", assetId: "glb", rootNodeId: "rig" },
        }),
      ],
      durationInFrames: 48,
    })
    const handle = buildScene3DV2Scene(await loadScene3DV2(plan, { resolver, signal: signal() }))
    handle.applyFrame(0)
    expectVec(exportedWorld(handle, "rig", "rig"), [5, 0, 0])
    handle.dispose()
  })
})
