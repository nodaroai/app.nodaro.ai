import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DEntityV2 } from "../plan-shape"
import { makeGlb, type MakeGlbOptions } from "./glb-fixtures"
import { makeLoadableScene, override } from "./v2-fixtures"

/**
 * What `local` and `world` MEAN, checked against an oracle that does not share
 * a line of code with the thing it is checking.
 *
 * Comparing the renderer to itself — or to the compiler, which mirrors it — can
 * only ever prove the two agree, and they agreed while `world` was following a
 * rotated parent's local axes. So the expected matrices below are built here,
 * from the fixtures' KNOWN factors (this rotation, this scale, this baked
 * translation at this frame) with this file's own 4x4 arithmetic, and the two
 * space rules are re-derived from their statement rather than called:
 *
 *   local:  W = compose(p ?? base.p, q ?? base.q, s ?? base.s)
 *           — the wrapper's own slot, which is the parent entity's frame.
 *
 *   world:  A = the true world of the wrapper's parent at this frame
 *           (t_A, q_A, s_A) = decompose(A)
 *           W = A⁻¹ · compose(p ?? t_A, q ?? q_A, s ?? s_A)
 *           — the declared channels are the wrapper's world ones, in SCENE
 *             axes, so A is divided out exactly once.
 *
 * For a position-only world edit that second rule has a closed form this file
 * uses instead of a decomposition, which is what makes it an independent
 * derivation and not a paraphrase:
 *
 *   W = translate( S_A⁻¹ · R_A⁻¹ · (p − t_A) )
 *
 * Read: whatever scene point the user named, expressed in the parent's frame.
 * Every ancestor's baked motion is still under the edit, so the entity stays
 * attached and its own animation still plays.
 */

// ─── this file's own matrix arithmetic (column-major, like three.js) ────────

type M = number[]

function mul(a: M, b: M): M {
  const out = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = sum
    }
  }
  return out
}

function translate([x, y, z]: number[]): M {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

function scaleM([x, y, z]: number[]): M {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
}

/** Rotation about +Z by `radians`, written out rather than composed. */
function rotZ(radians: number): M {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** Rotation about +Y by `radians`. */
function rotY(radians: number): M {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
}

/** Inverse of a rigid-plus-scale chain, by inverting the factors in reverse. */
function inverseOfFactors(factors: M[]): M {
  return factors.reduceRight((acc, factor) => mul(acc, inverseFactor(factor)), identity())
}

/** The 3x3 linear part's inverse, by cofactors — no decomposition anywhere. */
function inverseLinear(m: M): M {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
  const c = [
    a[4] * a[8] - a[5] * a[7], a[2] * a[7] - a[1] * a[8], a[1] * a[5] - a[2] * a[4],
    a[5] * a[6] - a[3] * a[8], a[0] * a[8] - a[2] * a[6], a[2] * a[3] - a[0] * a[5],
    a[3] * a[7] - a[4] * a[6], a[1] * a[6] - a[0] * a[7], a[0] * a[4] - a[1] * a[3],
  ]
  const det = a[0] * c[0] + a[3] * c[1] + a[6] * c[2]
  return [c[0] / det, c[1] / det, c[2] / det, 0, c[3] / det, c[4] / det, c[5] / det, 0,
    c[6] / det, c[7] / det, c[8] / det, 0, 0, 0, 0, 1]
}

/**
 * The wrapper a POSITION-only world edit produces, from its closed form:
 *
 *   W = translate( M⁻¹ · (p − t_A) )   where A = T(t_A) · M
 *
 * No `decompose` and no call into the renderer — just "the point the user
 * named, minus where the parent's frame starts, read in that frame's axes".
 */
function worldWrapper(parentWorld: M, p: number[]): M {
  const t = originOf(parentWorld)
  const linear = inverseLinear(parentWorld)
  return translate(apply(linear, [p[0] - t[0], p[1] - t[1], p[2] - t[2]]))
}

function identity(): M {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** Each fixture factor is a pure translate, pure scale or pure rotation. */
function inverseFactor(m: M): M {
  const isTranslation = m[0] === 1 && m[5] === 1 && m[10] === 1 && m[1] === 0 && m[2] === 0 && m[4] === 0
  if (isTranslation) return translate([-m[12], -m[13], -m[14]])
  const isDiagonal = m[1] === 0 && m[2] === 0 && m[4] === 0 && m[6] === 0 && m[8] === 0 && m[9] === 0
  if (isDiagonal) return scaleM([1 / m[0], 1 / m[5], 1 / m[10]])
  // A rotation: its inverse is its transpose.
  return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]
}

function originOf(m: M): number[] {
  return [m[12], m[13], m[14]]
}

function apply(m: M, [x, y, z]: number[]): number[] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

function expectClose(actual: number[], expected: number[], digits = 4): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], digits)
}

// ─── scene plumbing ─────────────────────────────────────────────────────────

const FPS = 24
const FRAMES = 48
const signal = () => new AbortController().signal

/** `animated` binds the fixture's one clip; a static fixture has none to bind. */
function assetEntity(
  partial: Partial<Scene3DEntityV2> & { id: string; rootNodeId: string },
  animated = false,
): Scene3DEntityV2 {
  const { rootNodeId, ...rest } = partial
  return {
    name: `${partial.id}-entity`,
    role: "prop",
    visual: {
      kind: "asset", assetId: "glb", rootNodeId,
      ...(animated ? { animation: { clipName: "scene", startFrame: 0, endFrameExclusive: FRAMES } } : {}),
    },
    ...rest,
  } as Scene3DEntityV2
}

async function build(glb: MakeGlbOptions, objects: Scene3DEntityV2[], overrides?: ReturnType<typeof override>[]) {
  const { plan, resolver } = makeLoadableScene({
    glb: makeGlb(glb), glbRole: "scene-geometry", objects, overrides, durationInFrames: FRAMES, fps: FPS,
  })
  const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
  return buildScene3DV2Scene(loaded)
}

/** The world matrix of a MOUNTED exported node, as a flat column-major array. */
function worldOf(handle: { entities: Map<string, THREE.Object3D> }, entityId: string, nodeName: string): M {
  const wrapper = handle.entities.get(entityId) as THREE.Object3D
  let found: THREE.Object3D | null = null
  wrapper.traverse((object) => {
    if (!found && object.userData?.name === nodeName) found = object
  })
  if (!found) throw new Error(`no mounted node named ${nodeName}`)
  return [...(found as THREE.Object3D).matrixWorld.elements]
}

const QUARTER_TURN_Z: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2]

// ─── the rotated parent from root's reproduction ────────────────────────────

describe("override spaces under a rotated parent", () => {
  /**
   * Root's reproduction, exactly: parent exported at (10,0,0) turned a quarter
   * turn about +Z, child exported at its local (2,0,0). Base world (10,2,0),
   * because the parent's rotation sends the child's local +x to scene +y.
   */
  const ROTATED: MakeGlbOptions = {
    nodes: [{
      name: "parent", entityRootId: "parent", translation: [10, 0, 0], rotation: QUARTER_TURN_Z,
      children: [
        { name: "parent/body", entityRootId: "parent", mesh: true },
        { name: "child", entityRootId: "child", translation: [2, 0, 0],
          children: [{ name: "child/body", entityRootId: "child", mesh: true }] },
      ],
    }],
  }
  const OBJECTS = [
    assetEntity({ id: "parent", rootNodeId: "parent" }),
    assetEntity({ id: "child", rootNodeId: "child", parentId: "parent" }),
  ]

  const parentWorld = mul(translate([10, 0, 0]), rotZ(Math.PI / 2))
  const childLocal = translate([2, 0, 0])

  it("agrees with the oracle on the unedited base world", async () => {
    const handle = await build(ROTATED, OBJECTS)
    handle.applyFrame(0)
    expectClose(originOf(worldOf(handle, "child", "child")), originOf(mul(parentWorld, childLocal)))
    expectClose(originOf(worldOf(handle, "child", "child")), [10, 2, 0])
    handle.dispose()
  })

  it("moves a LOCAL edit along the parent's turned axes", async () => {
    const handle = await build(ROTATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "child", space: "local", position: [1, 0, 0] })])
    handle.applyFrame(0)
    // The wrapper's slot is the parent's frame, so +x there is scene +y here.
    const expected = mul(mul(parentWorld, translate([1, 0, 0])), childLocal)
    expectClose(originOf(worldOf(handle, "child", "child")), originOf(expected))
    expectClose(originOf(worldOf(handle, "child", "child")), [10, 3, 0])
    handle.dispose()
  })

  it("puts a WORLD edit at the scene point it names, not on the parent's axes", async () => {
    const handle = await build(ROTATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "child", space: "world", position: [1, 0, 0] })])
    handle.applyFrame(0)
    // Closed form: the wrapper's origin IS scene (1,0,0). The child's own baked
    // (2,0,0) still rides under it, still turned by the parent — that is the
    // attachment surviving, and it is why the answer is (1,2,0) and not (11,2,0)
    // (a scene-axes DELTA, which is a different claim the contract does not make)
    // and not (10,3,0) (the parent's local +y, which is what `local` means).
    const expected = mul(mul(parentWorld, worldWrapper(parentWorld, [1, 0, 0])), childLocal)
    expectClose(originOf(worldOf(handle, "child", "child")), originOf(expected))
    expectClose(originOf(worldOf(handle, "child", "child")), [1, 2, 0])
    handle.dispose()
  })

  it("reads the two spaces apart — the whole reason `space` is declared", async () => {
    const local = await build(ROTATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "child", space: "local", position: [1, 0, 0] })])
    const world = await build(ROTATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "child", space: "world", position: [1, 0, 0] })])
    local.applyFrame(0)
    world.applyFrame(0)
    expect(originOf(worldOf(local, "child", "child"))).not.toEqual(originOf(worldOf(world, "child", "child")))
    local.dispose()
    world.dispose()
  })
})

// ─── non-uniform scale ──────────────────────────────────────────────────────

describe("override spaces under a non-uniformly scaled parent", () => {
  const SCALED: MakeGlbOptions = {
    nodes: [{
      name: "parent", entityRootId: "parent", translation: [1, 2, 3], scale: [2, 4, 0.5],
      rotation: QUARTER_TURN_Z,
      children: [
        { name: "parent/body", entityRootId: "parent", mesh: true },
        { name: "child", entityRootId: "child", translation: [1, 0, 0],
          children: [{ name: "child/body", entityRootId: "child", mesh: true }] },
      ],
    }],
  }
  const OBJECTS = [
    assetEntity({ id: "parent", rootNodeId: "parent" }),
    assetEntity({ id: "child", rootNodeId: "child", parentId: "parent" }),
  ]
  const factors = [translate([1, 2, 3]), rotZ(Math.PI / 2), scaleM([2, 4, 0.5])]
  const parentWorld = factors.reduce(mul)

  it("still lands a position-only world edit exactly on its scene point", async () => {
    const handle = await build(SCALED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "child", space: "world", position: [-3, 5, 2] })])
    handle.applyFrame(0)
    // Position alone never shears: W is a pure translation whatever the parent's
    // scale is, so the wrapper's origin is the named point on the nose.
    const wrapperOrigin = originOf(mul(parentWorld, worldWrapper(parentWorld, [-3, 5, 2])))
    expectClose(wrapperOrigin, [-3, 5, 2])
    // ...and the child's own baked (1,0,0) is still scaled and turned by the
    // parent underneath it: attachment, not detachment.
    const childOffset = apply(mul(rotZ(Math.PI / 2), scaleM([2, 4, 0.5])), [1, 0, 0])
    expectClose(originOf(worldOf(handle, "child", "child")),
      [-3 + childOffset[0], 5 + childOffset[1], 2 + childOffset[2]])
    handle.dispose()
  })

  it("refuses a world ROTATION it could only draw by dropping the shear", async () => {
    // `inverse(parentWorld) · target` here is scale⁻¹ · rot⁻¹ · rot_declared ·
    // scale, which under a non-uniform scale is no position/rotation/scale
    // triple at all. `decompose` would answer anyway; the renderer refuses.
    // The builder draws frame 0 as it finishes, so the refusal lands there —
    // before a caller can render a frame of it.
    await expect(build(SCALED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "child", space: "world", rotation: [0, 0, 0.6] })]))
      .rejects.toThrow(/shears the entity/)
  })

  it("takes the same rotation happily when the parent's scale is uniform", async () => {
    const uniform: MakeGlbOptions = {
      nodes: [{
        name: "parent", entityRootId: "parent", translation: [1, 2, 3], scale: [2, 2, 2],
        rotation: QUARTER_TURN_Z,
        children: [
          { name: "parent/body", entityRootId: "parent", mesh: true },
          { name: "child", entityRootId: "child", translation: [1, 0, 0],
            children: [{ name: "child/body", entityRootId: "child", mesh: true }] },
        ],
      }],
    }
    const handle = await build(uniform, OBJECTS,
      [override({ kind: "entity-transform", entityId: "child", space: "world", rotation: [0, 0, 0.6] })])
    expect(() => handle.applyFrame(0)).not.toThrow()
    handle.dispose()
  })
})

// ─── animated ancestor, mixed ancestor overlays, scrubbing ──────────────────

describe("override spaces under an animated ancestor", () => {
  /** A rig turning a quarter turn about +Z over 2s while sliding out to x=4. */
  const ANIMATED: MakeGlbOptions = {
    nodes: [{
      name: "rig", entityRootId: "rig",
      animateTranslation: { clip: "scene", times: [0, 2], values: [[0, 0, 0], [4, 0, 0]] },
      animateRotation: { clip: "scene", times: [0, 2], values: [[0, 0, 0, 1], QUARTER_TURN_Z] },
      children: [
        { name: "rig/body", entityRootId: "rig", mesh: true },
        { name: "arm", entityRootId: "arm", translation: [0, 1, 0],
          children: [{ name: "arm/body", entityRootId: "arm", mesh: true }] },
      ],
    }],
  }
  const OBJECTS = [
    assetEntity({ id: "rig", rootNodeId: "rig" }, true),
    assetEntity({ id: "arm", rootNodeId: "arm", parentId: "rig" }, true),
  ]

  /** The rig's baked factors at `frame`, from the track this file wrote. */
  function rigFactors(frame: number): M[] {
    const t = Math.min(2, frame / FPS)
    // three.js samples rotation with SLERP; between identity and a quarter turn
    // about the same axis that is the linear angle.
    return [translate([(t / 2) * 4, 0, 0]), rotZ((t / 2) * (Math.PI / 2))]
  }

  it("re-derives the world edit's wrapper on every frame, in and out of order", async () => {
    const handle = await build(ANIMATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "arm", space: "world", position: [0, 0, 5] })])
    for (const frame of [0, 12, 24, 47, 5, 24, 0, 47]) {
      handle.applyFrame(frame)
      const rig = rigFactors(frame)
      const rigWorld = rig.reduce(mul)
      // The wrapper's origin stays at the named scene point on every frame,
      // whatever the rig is doing...
      expectClose(originOf(mul(rigWorld, worldWrapper(rigWorld, [0, 0, 5]))), [0, 0, 5])
      // ...and the arm's own baked (0,1,0) is still turned by the rig, so the
      // drawn node tracks the rig's rotation while its origin does not drift.
      const armOffset = apply(rig[1], [0, 1, 0])
      expectClose(originOf(worldOf(handle, "arm", "arm")), [armOffset[0], armOffset[1], 5 + armOffset[2]])
    }
    handle.dispose()
  })

  it("gives a scrubbed frame the same matrices as a played one", async () => {
    const played = await build(ANIMATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "arm", space: "world", position: [0, 0, 5] })])
    const scrubbed = await build(ANIMATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "arm", space: "world", position: [0, 0, 5] })])
    for (let frame = 0; frame <= 30; frame++) played.applyFrame(frame)
    scrubbed.applyFrame(47)
    scrubbed.applyFrame(30)
    expectClose(worldOf(played, "arm", "arm"), worldOf(scrubbed, "arm", "arm"), 6)
    played.dispose()
    scrubbed.dispose()
  })

  it("divides a mixed ancestor chain out once — the ancestor's own edit and its motion", async () => {
    const handle = await build(ANIMATED, OBJECTS, [
      override({ kind: "entity-transform", entityId: "rig", space: "local", position: [0, 0, 7] }),
      override({ kind: "entity-transform", entityId: "arm", space: "world", position: [0, 0, 5] }),
    ])
    for (const frame of [0, 24, 47]) {
      handle.applyFrame(frame)
      const rig = rigFactors(frame)
      // The rig's own +7 sits ABOVE its baked placement, in the scene frame.
      const chain = [translate([0, 0, 7]), ...rig]
      const rigWorld = chain.reduce(mul)
      expectClose(originOf(mul(rigWorld, worldWrapper(rigWorld, [0, 0, 5]))), [0, 0, 5])
      const armOffset = apply(rig[1], [0, 1, 0])
      expectClose(originOf(worldOf(handle, "arm", "arm")), [armOffset[0], armOffset[1], 5 + armOffset[2]])
    }
    handle.dispose()
  })

  it("leaves the ancestor's own baked motion playing under both spaces", async () => {
    const world = await build(ANIMATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "arm", space: "world", position: [0, 0, 5] })])
    const local = await build(ANIMATED, OBJECTS,
      [override({ kind: "entity-transform", entityId: "arm", space: "local", position: [0, 0, 5] })])
    const rigAt = (handle: Awaited<ReturnType<typeof build>>, frame: number): number[] => {
      handle.applyFrame(frame)
      return originOf(worldOf(handle, "rig", "rig"))
    }
    for (const frame of [0, 24, 47]) {
      // Neither edit touches the parent: it is where the file bakes it.
      expectClose(rigAt(world, frame), [(Math.min(2, frame / FPS) / 2) * 4, 0, 0])
      expectClose(rigAt(local, frame), [(Math.min(2, frame / FPS) / 2) * 4, 0, 0])
    }
    world.dispose()
    local.dispose()
  })
})

// ─── a deeper chain, and the flat case that must not change ─────────────────

describe("override spaces elsewhere in the tree", () => {
  it("resolves a grandchild against its whole exported chain", async () => {
    const deep: MakeGlbOptions = {
      nodes: [{
        name: "a", entityRootId: "a", translation: [1, 0, 0], rotation: QUARTER_TURN_Z,
        children: [
          { name: "a/body", entityRootId: "a", mesh: true },
          { name: "b", entityRootId: "b", translation: [0, 2, 0], scale: [2, 2, 2],
            children: [
              { name: "b/body", entityRootId: "b", mesh: true },
              { name: "c", entityRootId: "c", translation: [3, 0, 0],
                children: [{ name: "c/body", entityRootId: "c", mesh: true }] },
            ] },
        ],
      }],
    }
    const objects = [
      assetEntity({ id: "a", rootNodeId: "a" }),
      assetEntity({ id: "b", rootNodeId: "b", parentId: "a" }),
      assetEntity({ id: "c", rootNodeId: "c", parentId: "b" }),
    ]
    const handle = await build(deep, objects,
      [override({ kind: "entity-transform", entityId: "c", space: "world", position: [4, -1, 2] })])
    handle.applyFrame(0)
    const chain = [translate([1, 0, 0]), rotZ(Math.PI / 2), translate([0, 2, 0]), scaleM([2, 2, 2])]
    const chainWorld = chain.reduce(mul)
    expectClose(originOf(mul(chainWorld, worldWrapper(chainWorld, [4, -1, 2]))), [4, -1, 2])
    // The grandchild's own baked (3,0,0), scaled by b and turned by a.
    const own = apply(mul(rotZ(Math.PI / 2), scaleM([2, 2, 2])), [3, 0, 0])
    expectClose(originOf(worldOf(handle, "c", "c")), [4 + own[0], -1 + own[1], 2 + own[2]])
    handle.dispose()
  })

  it("keeps the two spaces identical for a scene-level entity", async () => {
    const flat: MakeGlbOptions = {
      nodes: [{
        name: "prop", entityRootId: "prop", translation: [5, 0, 1], rotation: QUARTER_TURN_Z,
        children: [{ name: "prop/body", entityRootId: "prop", mesh: true }],
      }],
    }
    const objects = [assetEntity({ id: "prop", rootNodeId: "prop" })]
    const edit = { kind: "entity-transform" as const, entityId: "prop", position: [2, 3, 4] as [number, number, number] }
    const local = await build(flat, objects, [override({ ...edit, space: "local" })])
    const world = await build(flat, objects, [override({ ...edit, space: "world" })])
    local.applyFrame(0)
    world.applyFrame(0)
    // Nothing sits between the wrapper and the scene, so the two frames are the
    // same frame — the asset behaviour a flat scene has always had, unchanged,
    // with the entity's own baked placement still under the constant wrapper.
    expectClose(worldOf(local, "prop", "prop"), worldOf(world, "prop", "prop"), 6)
    expectClose(originOf(worldOf(world, "prop", "prop")), originOf(mul(translate([2, 3, 4]), mul(translate([5, 0, 1]), rotZ(Math.PI / 2)))))
    local.dispose()
    world.dispose()
  })

  it("resolves against a group parent's wrapper when no baked node is between", async () => {
    // A `group` entity has no exported node, so the wrapper hangs directly under
    // its parent's wrapper and the true parent world IS the overlay chain.
    const flat: MakeGlbOptions = {
      nodes: [{
        name: "prop", entityRootId: "prop", translation: [0, 0, 0],
        children: [{ name: "prop/body", entityRootId: "prop", mesh: true }],
      }],
    }
    const objects: Scene3DEntityV2[] = [
      { id: "holder", name: "holder", role: "prop", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
        visual: { kind: "group" } } as unknown as Scene3DEntityV2,
      assetEntity({ id: "prop", rootNodeId: "prop", parentId: "holder" }),
    ]
    const handle = await build(flat, objects, [
      override({ kind: "entity-transform", entityId: "holder", space: "local", position: [0, 6, 0] }),
      override({ kind: "entity-transform", entityId: "prop", space: "world", position: [0, 0, 0] }),
    ])
    handle.applyFrame(0)
    expectClose(originOf(worldOf(handle, "prop", "prop")), [0, 0, 0])
    handle.dispose()
  })
})

// ─── the same rotation and scale, checked against three.js itself ───────────

describe("the oracle's own arithmetic", () => {
  it("matches three.js on the factors it builds", () => {
    const mine = mul(translate([1, 2, 3]), mul(rotZ(0.7), scaleM([2, 4, 0.5])))
    const theirs = new THREE.Matrix4()
      .makeTranslation(1, 2, 3)
      .multiply(new THREE.Matrix4().makeRotationZ(0.7))
      .multiply(new THREE.Matrix4().makeScale(2, 4, 0.5))
    expectClose(mine, [...theirs.elements], 10)
    const rotated = mul(rotY(0.3), rotZ(-1.1))
    const alsoRotated = new THREE.Matrix4().makeRotationY(0.3).multiply(new THREE.Matrix4().makeRotationZ(-1.1))
    expectClose(rotated, [...alsoRotated.elements], 10)
  })

  it("inverts its factor chains exactly", () => {
    const factors = [translate([3, -1, 2]), rotZ(0.4), scaleM([2, 4, 0.5])]
    expectClose(mul(factors.reduce(mul), inverseOfFactors(factors)), identity(), 10)
    // The cofactor inverse and the factor-by-factor one agree on the linear part.
    const chain = factors.reduce(mul)
    expectClose(apply(inverseLinear(chain), apply(chain, [1, 2, 3]).map((v, i) => v - originOf(chain)[i])), [1, 2, 3], 10)
  })
})
