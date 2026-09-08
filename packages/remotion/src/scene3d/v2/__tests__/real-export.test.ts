import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as THREE from "three"
import { inspectGlb } from "../glb-inspect"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DEntityV2 } from "../plan-shape"
import { makeLoadableScene } from "./v2-fixtures"

/**
 * Bytes from a REAL Blender export (the trusted builder's smoke scene, 11 KiB).
 *
 * Every other GLB in this suite is one the fixture builder wrote, so it can
 * only ever test this renderer's own idea of the format. This file is the one
 * that proves the shapes the actual exporter emits — and it is exactly where
 * the first integration failure came from:
 *
 *   [0] "box/body"    extras{nodaroEntityId: "box",   nodaroSubpartId, nodaroMaterialRole}
 *   [1] "box"         extras{nodaroEntityId: "box"}          ← the semantic root
 *   [2] "floor/floor" extras{nodaroEntityId: "floor", …}
 *   [3] "floor.001"   extras{nodaroEntityId: "floor"}        ← glTF regrouping node
 *   [4] "floor"       extras{nodaroEntityId: "floor"}        ← the semantic root
 *
 * The id repeats on every node an entity owns (hit-testing needs it there), so
 * treating it as a unique key rejects a perfectly good export. The root is the
 * NODE NAME; the id confirms ownership.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function realGlb(): ArrayBuffer {
  const buffer = readFileSync(join(HERE, "fixtures", "blender-smoke-scene.glb"))
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

const BOX: Scene3DEntityV2 = {
  id: "box",
  name: "Box",
  role: "prop",
  identityColor: "#d33a2c",
  materialBindings: [
    { role: "identity", materialName: "auto.box.identity", color: "#d33a2c", roughness: 0.75 },
  ],
  visual: { kind: "asset", assetId: "glb", rootNodeId: "box" },
}

const FLOOR: Scene3DEntityV2 = {
  id: "floor",
  name: "Floor",
  role: "environment",
  visual: { kind: "asset", assetId: "glb", rootNodeId: "floor" },
}

describe("real Blender export — inspection", () => {
  const inspection = inspectGlb(realGlb(), "real")

  it("finds exactly the two semantic roots, keyed by node name", () => {
    expect([...inspection.entityRootsByNodeName.keys()].sort()).toEqual(["box", "floor"])
    expect(inspection.entityRootsByNodeName.get("box")?.entityId).toBe("box")
    expect(inspection.entityRootsByNodeName.get("floor")?.entityId).toBe("floor")
  })

  it("keeps an owned mesh that repeats the entity id inside its root", () => {
    const box = inspection.entityRootsByNodeName.get("box")
    expect([...(box?.subtreeNodeNames ?? [])].sort()).toEqual(["box", "box/body"])
    expect(box?.meshNodeCount).toBe(1)
    expect(box?.materialNames).toEqual(["auto.box.identity"])
  })

  it("absorbs the exporter's synthetic `floor.001` regrouping node", () => {
    const floor = inspection.entityRootsByNodeName.get("floor")
    expect([...(floor?.subtreeNodeNames ?? [])].sort()).toEqual([
      "floor",
      "floor.001",
      "floor/floor",
    ])
    // …and does NOT register it as a second root for the same id.
    expect(inspection.entityRootsByNodeName.has("floor.001")).toBe(false)
  })

  it("passes every capability and bounds check on real bytes", () => {
    expect(inspection.meshNodeCount).toBe(2)
    expect(inspection.triangleCount).toBeGreaterThan(0)
    expect(inspection.maxDepth).toBeLessThanOrEqual(3)
  })

  it("has node names that stay unique once three sanitizes them", () => {
    // `box/body` → `boxbody`, `floor.001` → `floor001`. If two collapsed onto
    // one name, GLTFLoader would rename and animation binding would drift.
    const sanitized = new Set(
      inspection.nodeNames.map((name) => THREE.PropertyBinding.sanitizeNodeName(name)),
    )
    expect(sanitized.size).toBe(inspection.nodeNames.length)
  })
})

describe("real Blender export — load and draw", () => {
  const signal = () => new AbortController().signal

  async function load() {
    const { plan, resolver } = makeLoadableScene({
      glb: realGlb(),
      glbRole: "scene-geometry",
      objects: [FLOOR, BOX],
      durationInFrames: 12,
      fps: 24,
    })
    return { plan, loaded: await loadScene3DV2(plan, { resolver, signal: signal() }) }
  }

  it("loads two entities out of ONE shared authorized asset", async () => {
    const { loaded } = await load()
    expect(loaded.glbById.size).toBe(1)
    expect(loaded.warnings).toEqual([])
  })

  it("mounts each entity's own subtree and nothing else", async () => {
    const { loaded } = await load()
    const handle = buildScene3DV2Scene(loaded)
    const box = handle.entities.get("box") as THREE.Object3D
    const floor = handle.entities.get("floor") as THREE.Object3D
    expect(box.getObjectByName("boxbody")).toBeTruthy() // sanitized `box/body`
    expect(box.getObjectByName("floorfloor")).toBeUndefined()
    expect(floor.getObjectByName("floorfloor")).toBeTruthy()
    handle.dispose()
  })

  it("keeps a material binding inside the owning root", async () => {
    // Recolouring the box must not touch the floor — the binding names a
    // material inside the box's authorized root only.
    const { loaded } = await load()
    const handle = buildScene3DV2Scene(loaded)
    const colorOf = (id: string) => {
      const meshes: THREE.MeshStandardMaterial[] = []
      ;(handle.entities.get(id) as THREE.Object3D).traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) meshes.push(mesh.material as THREE.MeshStandardMaterial)
      })
      return meshes.map((m) => m.color.getHexString())
    }
    expect(colorOf("box")).toEqual([new THREE.Color("#d33a2c").getHexString()])
    expect(colorOf("floor")).not.toContain(new THREE.Color("#d33a2c").getHexString())
    handle.dispose()
  })

  it("draws real frames in a shuffled order without drifting", async () => {
    const { plan, loaded } = await load()
    const handle = buildScene3DV2Scene(loaded)
    const positionOf = () =>
      new THREE.Vector3()
        .setFromMatrixPosition((handle.entities.get("box") as THREE.Object3D).matrixWorld)
        .toArray()

    handle.applyFrame(0)
    const atZero = positionOf()
    for (const frame of [plan.durationInFrames - 1, 5, 11, 2]) handle.applyFrame(frame)
    handle.applyFrame(0)
    expect(positionOf()).toEqual(atZero)
    handle.dispose()
  })

  it("rejects an entity that binds a root it does not own", async () => {
    // `rootNodeId` addresses a node; the extras id is what says whose it is.
    const { plan, resolver } = makeLoadableScene({
      glb: realGlb(),
      glbRole: "scene-geometry",
      objects: [{ ...BOX, visual: { kind: "asset", assetId: "glb", rootNodeId: "floor" } }],
      durationInFrames: 12,
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /owned by entity "floor", not by "box"/,
    )
  })

  it("rejects a rootNodeId that names an owned node instead of the root", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: realGlb(),
      glbRole: "scene-geometry",
      objects: [{ ...FLOOR, visual: { kind: "asset", assetId: "glb", rootNodeId: "floor.001" } }],
      durationInFrames: 12,
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /no semantic root node named "floor.001"/,
    )
  })
})
