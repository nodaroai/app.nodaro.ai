import { describe, expect, it } from "vitest"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DEntityV2 } from "../plan-shape"
import { makeGlb } from "./glb-fixtures"
import { makeLoadableScene, primitiveEntity, override } from "./v2-fixtures"

const car: Scene3DEntityV2 = {
  id: "car", name: "Car", visual: {
    kind: "asset", assetId: "glb", rootNodeId: "car.root",
    animation: { clipName: "drive", startFrame: 0, endFrameExclusive: 24 },
  },
  anchors: [
    { name: "door.tip", nodeName: "car/door.hinge", position: [1, 0, 0] },
    { name: "legacy", position: [1, 0, 0] },
  ],
}

function animatedGlb() {
  return makeGlb({ nodes: [{
    name: "car.root", entityRootId: "car", scale: [-2, 3, 4],
    animateTranslation: { clip: "drive", times: [0, 1], values: [[5, 1, 2], [7, 1, 2]] },
    children: [{
      name: "car/door.hinge", mesh: true, translation: [0, 2, 0],
      animateRotation: { clip: "drive", times: [0, 1],
        values: [[0, 0, 0, 1], [0, 0, Math.SQRT1_2, Math.SQRT1_2]] },
    }],
  }] })
}

async function load(glb: ArrayBuffer, entities: Scene3DEntityV2[]) {
  const { plan, resolver } = makeLoadableScene({ glb, objects: entities, durationInFrames: 24 })
  return loadScene3DV2(plan, { resolver, signal: new AbortController().signal })
}

describe("semantic anchor playback", () => {
  it("follows the owned animated node through mirrored scale and random seeks", async () => {
    const handle = buildScene3DV2Scene(await load(animatedGlb(), [car]))
    try {
      const frames = Array.from({ length: 24 }, (_, i) => i)
      for (const frame of [...frames, ...frames.toReversed(), ...frames.map(f => f * 11 % 24)]) {
        handle.applyFrame(frame)
        const t = frame / 24
        const position = handle.getAnchorWorldPosition("car", "door.tip")
        expect(position[0]).toBeCloseTo(5 + 2 * t - 2 * Math.cos(t * Math.PI / 2), 5)
        expect(position[1]).toBeCloseTo(1 + 3 * (2 + Math.sin(t * Math.PI / 2)), 5)
        expect(position[2]).toBeCloseTo(2, 5)
        const legacy = handle.getAnchorWorldPosition("car", "legacy")
        expect(legacy[0]).toBeCloseTo(3 + 2 * t, 6)
        expect(legacy.slice(1)).toEqual([1, 2])
      }
    } finally { handle.dispose() }
  })

  it("preserves entity-local anchors for primitives", async () => {
    const entity = primitiveEntity({ id: "box", position: [3, 2, 1], scale: [2, 3, 4],
      anchors: [{ name: "top", position: [1, 1, 1] }] })
    const { plan, resolver } = makeLoadableScene({ objects: [entity] })
    const loaded = await loadScene3DV2(plan, { resolver, signal: new AbortController().signal })
    const handle = buildScene3DV2Scene(loaded)
    try { expect(handle.getAnchorWorldPosition("box", "top")).toEqual([5, 5, 5]) }
    finally { handle.dispose() }
  })

  it("rejects an absent bound node before playback", async () => {
    await expect(load(animatedGlb(), [{ ...car, anchors: [
      { name: "missing", nodeName: "missing", position: [0, 0, 0] },
    ] }])).rejects.toMatchObject({ code: "SCENE_ASSET_BINDING" })
  })

  it("carries a bound point through a manual entity transform", async () => {
    const { plan, resolver } = makeLoadableScene({ glb: animatedGlb(), objects: [car],
      durationInFrames: 24, overrides: [override({ kind: "entity-transform", entityId: "car",
        space: "local", position: [10, 0, 0] })] })
    const loaded = await loadScene3DV2(plan, { resolver, signal: new AbortController().signal })
    const handle = buildScene3DV2Scene(loaded)
    try {
      handle.applyFrame(12)
      expect(handle.getAnchorWorldPosition("car", "door.tip")[0]).toBeCloseTo(16 - Math.SQRT2, 5)
      handle.applyFrame(0)
      expect(handle.getAnchorWorldPosition("car", "door.tip")).toEqual([13, 7, 2])
    } finally { handle.dispose() }
  })

  it("rejects bindings into a nested entity's subtree", async () => {
    const glb = makeGlb({ nodes: [{ name: "parent", entityRootId: "parent", mesh: true,
      children: [{ name: "child", entityRootId: "child", mesh: true }],
    }] })
    const entities: Scene3DEntityV2[] = [
      { id: "parent", name: "Parent", visual: { kind: "asset", assetId: "glb", rootNodeId: "parent" },
        anchors: [{ name: "foreign", nodeName: "child", position: [0, 0, 0] }] },
      { id: "child", name: "Child", parentId: "parent",
        visual: { kind: "asset", assetId: "glb", rootNodeId: "child" } },
    ]
    await expect(load(glb, entities)).rejects.toMatchObject({ code: "SCENE_ASSET_BINDING" })
  })

  it("fails an unknown anchor instead of substituting the entity origin", async () => {
    const handle = buildScene3DV2Scene(await load(animatedGlb(), [car]))
    try { expect(() => handle.getAnchorWorldPosition("car", "missing")).toThrow(/anchor/) }
    finally { handle.dispose() }
    expect(() => handle.getAnchorWorldPosition("car", "door.tip")).toThrow(/anchor/)
  })
})
