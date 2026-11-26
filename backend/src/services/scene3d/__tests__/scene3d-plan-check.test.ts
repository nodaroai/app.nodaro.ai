/**
 * The plan check — what a contract-valid scene SHOWS.
 *
 * The five fixtures are real Generate 3D Scene answers (identity replaced,
 * reference links dropped). Three of them were delivered as finished scenes
 * with zero revisions although nothing in them was assembled: every part of
 * the jets, the cockpit and two of the astronauts sat at its LOCAL offset in
 * world space, because no part named the group that moves it. In the jets'
 * scene that also left both camera shots looking at mountains and sky. All
 * five pass the contract — which is why this check exists.
 */
import { describe, expect, it } from "vitest"
import { SCENE3D_PLAN_TYPE, SCENE3D_SCHEMA_VERSION, scene3DPlanSchema, type Scene3DObject, type Scene3DPlanV1 } from "@nodaro/shared/scene3d"
import {
  SCENE3D_PARTS_DETACHED_CODE,
  SCENE3D_SHOT_WITHOUT_SUBJECT_CODE,
  scene3DPlanFindings,
} from "../scene3d-plan-check.js"
import jetsDetached from "./fixtures/jets-parts-detached.json"
import jetsParented from "./fixtures/jets-parented.json"
import astronautDetachedA from "./fixtures/astronaut-parts-detached-a.json"
import astronautDetachedB from "./fixtures/astronaut-parts-detached-b.json"
import astronautParented from "./fixtures/astronaut-parented.json"

const fixture = (raw: unknown): Scene3DPlanV1 => raw as Scene3DPlanV1
const codes = (plan: Scene3DPlanV1) => scene3DPlanFindings(plan).map((f) => f.code)

function object(id: string, overrides: Partial<Scene3DObject> = {}): Scene3DObject {
  return {
    id,
    name: id,
    primitive: "box",
    dimensions: [1, 1, 1],
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#888888",
    ...overrides,
  }
}

function plan(objects: Scene3DObject[], camera: Partial<Scene3DPlanV1["camera"]> = {}): Scene3DPlanV1 {
  return {
    planType: SCENE3D_PLAN_TYPE,
    schemaVersion: SCENE3D_SCHEMA_VERSION,
    revisionId: "00000000-0000-4000-8000-0000000000aa",
    width: 1920,
    height: 1080,
    fps: 24,
    durationInFrames: 96,
    backgroundColor: "#101014",
    camera: { position: [0, 2, 8], target: [0, 0.5, 0], focalLengthMm: 35, sensorWidthMm: 36, ...camera },
    objects,
    lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
  }
}

const GROUND = object("ground", { primitive: "plane", dimensions: [1000, 1000, 0.01], position: [0, 0, 0], rotation: [-1.5708, 0, 0] })

describe("the saved scenes", () => {
  it("all five pass the contract — it cannot see what this check sees", () => {
    for (const raw of [jetsDetached, jetsParented, astronautDetachedA, astronautDetachedB, astronautParented]) {
      expect(scene3DPlanSchema.safeParse(raw).success).toBe(true)
    }
  })

  it("the jets: every animated group is empty, and neither camera shot shows a subject", () => {
    const findings = scene3DPlanFindings(fixture(jetsDetached))
    const detached = findings.filter((f) => f.code === SCENE3D_PARTS_DETACHED_CODE)
    expect(detached.map((f) => f.message.match(/^group "([^"]+)"/)?.[1])).toEqual(["lead", "chase", "pilot-head"])
    expect(detached.every((f) => f.severity === "blocking")).toBe(true)
    // The parts are named for the model to re-parent.
    expect(detached[0].message).toContain('"lead-fuselage"')
    expect(detached[0].message).toContain("LOCAL")

    const shots = findings.filter((f) => f.code === SCENE3D_SHOT_WITHOUT_SUBJECT_CODE)
    expect(shots.map((f) => f.message.match(/frames (\d+-\d+)/)?.[1])).toEqual(["0-40", "41-95"])
    expect(shots.every((f) => f.severity === "advisory")).toBe(true)
    // Located for the model: where the camera is and where the subjects are.
    expect(shots[1].message).toMatch(/camera is at \[[^\]]+\] looking at \[[^\]]+\]/)
    expect(shots[1].message).toMatch(/nearest subjects are "[^"]+" at \[/)
  })

  it("the jets once assembled: nothing to report, the cut to black included", () => {
    expect(scene3DPlanFindings(fixture(jetsParented))).toEqual([])
  })

  it("the astronauts with loose limbs: blocking, though the camera sees the pile of parts", () => {
    for (const raw of [astronautDetachedA, astronautDetachedB]) {
      const found = codes(fixture(raw))
      expect(found.length).toBeGreaterThan(0)
      expect(new Set(found)).toEqual(new Set([SCENE3D_PARTS_DETACHED_CODE]))
    }
  })

  it("the assembled astronaut: nothing to report", () => {
    expect(scene3DPlanFindings(fixture(astronautParented))).toEqual([])
  })
})

describe("detached parts", () => {
  it("a static empty group with no parts named after it is harmless", () => {
    expect(codes(plan([GROUND, object("hero"), object("spare", { primitive: "group" })]))).toEqual([])
  })

  it("an empty group is flagged when parts are named after it, even when it does not move", () => {
    const found = scene3DPlanFindings(plan([GROUND, object("car", { primitive: "group" }), object("car-body"), object("car_wheel")]))
    expect(found.map((f) => f.code)).toEqual([SCENE3D_PARTS_DETACHED_CODE])
    expect(found[0].message).toContain('"car-body", "car_wheel"')
  })

  it("a group with one attached part passes", () => {
    const car = object("car", { primitive: "group", keyframes: [{ frame: 95, position: [5, 0, 0] }] })
    expect(codes(plan([GROUND, car, object("car-body", { parentId: "car" })]))).toEqual([])
  })
})

describe("shots without a subject", () => {
  it("a subject behind the camera is not seen; turning the camera to it is", () => {
    const behind = plan([GROUND, object("hero", { position: [0, 0.5, 20] })])
    expect(codes(behind)).toEqual([SCENE3D_SHOT_WITHOUT_SUBJECT_CODE])
    expect(codes({ ...behind, camera: { ...behind.camera, target: [0, 0.5, 20] } })).toEqual([])
  })

  it("a subject too small to read in the frame does not count", () => {
    const tiny = object("hero", { dimensions: [0.05, 0.05, 0.05], position: [0, 0.5, -400] })
    expect(codes(plan([GROUND, tiny], { target: [0, 0.5, -400] }))).toEqual([SCENE3D_SHOT_WITHOUT_SUBJECT_CODE])
  })

  it("scenery never counts as the subject, but moving scenery does", () => {
    const mountain = object("mountain", { primitive: "cone", dimensions: [300, 200, 300], position: [0, 100, -400] })
    const away = object("hero", { position: [0, 0.5, 30] })
    expect(codes(plan([GROUND, mountain, away], { target: [0, 100, -400] }))).toEqual([SCENE3D_SHOT_WITHOUT_SUBJECT_CODE])
    const drifting = { ...mountain, keyframes: [{ frame: 95, position: [0, 100, -390] as [number, number, number] }] }
    expect(codes(plan([GROUND, drifting, away], { target: [0, 100, -400] }))).toEqual([])
  })

  it("a scene of scenery alone has no subject to miss", () => {
    const mountain = object("mountain", { primitive: "cone", dimensions: [300, 200, 300], position: [0, 100, -400] })
    expect(codes(plan([GROUND, mountain], { target: [0, 0, 400] }))).toEqual([])
  })

  it("judges each shot on its own, split at the camera's cuts", () => {
    const hero = object("hero")
    const cut = plan([GROUND, hero], {
      keyframes: [
        { frame: 47, position: [0, 2, 8], target: [0, 0.5, 0] },
        { frame: 48, position: [0, 2, 8], target: [0, 0.5, 50] },
      ],
    })
    const found = scene3DPlanFindings(cut)
    expect(found.map((f) => f.code)).toEqual([SCENE3D_SHOT_WITHOUT_SUBJECT_CODE])
    expect(found[0].message).toContain("frames 48-95")
  })

  it("a subject that enters partway through the shot passes it", () => {
    const flyBy = object("jet", { position: [0, 0.5, 60], keyframes: [{ frame: 95, position: [0, 0.5, 0] }] })
    expect(codes(plan([GROUND, flyBy]))).toEqual([])
  })

  it("a seam a frame or two long is not a shot", () => {
    const hero = object("hero")
    const seam = plan([GROUND, hero], {
      keyframes: [
        { frame: 1, position: [0, 2, 8], target: [0, 0.5, 50] },
        { frame: 2, position: [0, 2, 8], target: [0, 0.5, 0] },
      ],
    })
    expect(codes(seam)).toEqual([])
  })

  it("a camera inside an object's bounds sees it (a card held to the lens)", () => {
    const card = object("card", { primitive: "plane", dimensions: [5, 5, 0.01], position: [0, 2, 7.5], keyframes: [{ frame: 1, position: [0, 2, 7.5] }] })
    expect(codes(plan([GROUND, card], { target: [0, 2, -10] }))).toEqual([])
  })
})
