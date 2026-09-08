import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DEntityV2 } from "../plan-shape"
import { makeGlb } from "./glb-fixtures"
import { makeLoadableScene } from "./v2-fixtures"

/**
 * ONE whole-scene clip, several semantic entity roots.
 *
 * That is what a Blender SCENE animation export actually produces: a single
 * clip whose tracks address nodes belonging to every entity in the file. Each
 * entity must bind only ITS tracks — which is also the only way one channel
 * keeps exactly one owner once the subtrees are mounted under separate
 * wrappers.
 *
 * The node names here deliberately mirror the real exporter's
 * (`box/body`, `floor.001`, `floor/floor`), because three's
 * `PropertyBinding.sanitizeNodeName` strips `/` and `.`: an `AnimationClip`
 * track for `box/body` is named `boxbody.position`. Matching tracks against the
 * RAW glTF names would silently bind nothing and the scene would sit frozen.
 */
const SCENE_GLB = makeGlb({
  nodes: [
    {
      name: "box",
      entityRootId: "box",
      children: [
        {
          name: "box/body",
          entityRootId: "box",
          mesh: true,
          materialName: "auto.box.identity",
          // 0 → 4 m on x over 2 s
          animateTranslation: {
            clip: "SCENE",
            times: [0, 2],
            values: [
              [0, 0, 0],
              [4, 0, 0],
            ],
          },
        },
      ],
    },
    {
      name: "floor",
      entityRootId: "floor",
      children: [
        {
          name: "floor.001",
          entityRootId: "floor",
          children: [
            {
              name: "floor/floor",
              entityRootId: "floor",
              mesh: true,
              materialName: "mat.floor",
              // 0 → -6 m on z over the same 2 s
              animateTranslation: {
                clip: "SCENE",
                times: [0, 2],
                values: [
                  [0, 0, 0],
                  [0, 0, -6],
                ],
              },
            },
          ],
        },
      ],
    },
  ],
})

const ANIMATION = { clipName: "SCENE", startFrame: 0, endFrameExclusive: 48 } as const

function entity(id: string, animated: boolean): Scene3DEntityV2 {
  return {
    id,
    name: `${id}-entity`,
    visual: {
      kind: "asset",
      assetId: "glb",
      rootNodeId: id,
      ...(animated ? { animation: { ...ANIMATION } } : {}),
    },
  } as Scene3DEntityV2
}

const signal = () => new AbortController().signal

async function build(objects: Scene3DEntityV2[]) {
  const { plan, resolver } = makeLoadableScene({
    glb: SCENE_GLB,
    glbRole: "scene-geometry",
    objects,
  })
  const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
  return { loaded, handle: buildScene3DV2Scene(loaded) }
}

/** World position of a mounted node, addressed by its SANITIZED name. */
function worldOf(handle: { scene: THREE.Scene }, sanitizedName: string): THREE.Vector3 {
  const node = handle.scene.getObjectByName(sanitizedName)
  if (!node) throw new Error(`no mounted node named ${sanitizedName}`)
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld)
}

describe("one whole-scene clip driving several entity roots", () => {
  it("binds the shared clip for every entity that maps it onto frames", async () => {
    const { handle } = await build([entity("box", true), entity("floor", true)])
    handle.applyFrame(24) // t = 1 s → half way through both tracks
    expect(worldOf(handle, "boxbody").x).toBeCloseTo(2, 6)
    expect(worldOf(handle, "floorfloor").z).toBeCloseTo(-3, 6)
    handle.dispose()
  })

  it("does not let one entity's track move another entity", async () => {
    // If the allowlist leaked, the floor's -z track would also drive the box.
    const { handle } = await build([entity("box", true), entity("floor", true)])
    handle.applyFrame(24)
    expect(worldOf(handle, "boxbody").z).toBeCloseTo(0, 6)
    expect(worldOf(handle, "floorfloor").x).toBeCloseTo(0, 6)
    handle.dispose()
  })

  it("moves only the entity that bound the clip", async () => {
    const { handle } = await build([entity("box", true), entity("floor", false)])
    handle.applyFrame(24)
    expect(worldOf(handle, "boxbody").x).toBeCloseTo(2, 6)
    expect(worldOf(handle, "floorfloor").z).toBeCloseTo(0, 6)
    handle.dispose()
  })

  it("WARNS about an entity the clip animates but that binds no animation", async () => {
    // The silent-freeze case: siblings move, this one does not, and a finished
    // MP4 is the worst place to notice.
    const { loaded, handle } = await build([entity("box", true), entity("floor", false)])
    expect(loaded.warnings).toEqual([
      expect.objectContaining({ code: "SCENE_ANIMATION_UNBOUND", subject: "floor" }),
    ])
    expect(loaded.warnings[0].message).toContain("floor/floor")
    handle.dispose()
  })

  it("stays silent when nothing under the entity is animated", async () => {
    const still = makeGlb({
      nodes: [
        { name: "box", entityRootId: "box", children: [{ name: "box/body", entityRootId: "box", mesh: true }] },
      ],
    })
    const { plan, resolver } = makeLoadableScene({
      glb: still,
      glbRole: "scene-geometry",
      objects: [entity("box", false)],
    })
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    expect(loaded.warnings).toEqual([])
  })

  it("is deterministic under random-order scrubbing across both roots", async () => {
    const { handle } = await build([entity("box", true), entity("floor", true)])
    const sequential = new Map<number, [number, number]>()
    for (let frame = 0; frame < 48; frame++) {
      handle.applyFrame(frame)
      sequential.set(frame, [worldOf(handle, "boxbody").x, worldOf(handle, "floorfloor").z])
    }
    for (const frame of [47, 0, 31, 12, 47, 3, 24]) {
      handle.applyFrame(frame)
      const [x, z] = sequential.get(frame) as [number, number]
      expect(worldOf(handle, "boxbody").x).toBeCloseTo(x, 10)
      expect(worldOf(handle, "floorfloor").z).toBeCloseTo(z, 10)
    }
    handle.dispose()
  })

  it("keeps a material role inside its owning root", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: SCENE_GLB,
      glbRole: "scene-geometry",
      objects: [
        {
          ...entity("box", true),
          materialBindings: [
            { role: "identity", materialName: "auto.box.identity", color: "#00ff00" },
          ],
        } as Scene3DEntityV2,
        entity("floor", true),
      ],
    })
    const handle = buildScene3DV2Scene(await loadScene3DV2(plan, { resolver, signal: signal() }))
    const materialOf = (sanitizedName: string) =>
      (handle.scene.getObjectByName(sanitizedName) as THREE.Mesh)
        .material as THREE.MeshStandardMaterial
    expect(materialOf("boxbody").color.getHexString()).toBe("00ff00")
    expect(materialOf("floorfloor").color.getHexString()).not.toBe("00ff00")
    handle.dispose()
  })
})
