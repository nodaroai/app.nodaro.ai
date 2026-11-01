/**
 * The face mesh (`faceMasking.faceMesh`, decided 2026-10-31): thin face lines
 * drawn on the masked heads (faces hidden) or on the depth clip (full depth),
 * never with keep people. What must hold:
 *
 *  - every existing setting is unchanged: absent and `false` validate, send
 *    and hash exactly as before the field existed (no `faceMesh` key on the
 *    wire, the same settings key, so every approved mask stays up to date);
 *  - `true` changes the settings key and the base key (a mask made without
 *    the mesh is never sent, nor reused, for a setting with it, nor the other
 *    way round);
 *  - keep people refuses it (`face_mesh_not_with_keep_people`);
 *  - an engine that does not declare `castSwap.faceMesh` is never sent it: a
 *    trend that draws it is held back from publishing there (`faceMesh`
 *    need), and a run there is sent without the key.
 */
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import {
  FACE_MESH_NOT_WITH_KEEP_PEOPLE,
  engineDrawsFaceMesh,
  faceMaskingMotionSchema,
  faceMaskingRunSent,
  faceMaskingSchema,
  faceMaskingSent,
  faceMaskingWithMarksSchema,
  faceMeshOn,
  withFaceMeshFor,
  withResolvedZone,
} from "../../../../lib/cast-swap-face-masking.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { composeTrendRun, type ComposedTrendRun } from "../compose.js"
import { faceMaskBaseKey, faceMaskSettingsKey, faceMaskSettingsKeyOf, faceMeshFacesDrawnOf, faceMeshRecipeOf, reusableFaceMaskBase, storedFaceMaskFor } from "../face-mask.js"
import { trendVersionDataSchema } from "../schemas.js"
import { FACE_MESH_NEED, publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import type { TrendFaceMask, TrendPreviewClip, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const FACES = { mode: "always" as const, threshold: 0.4 }
const FULL = { mode: "always" as const, source: "full-depth" as const }
const KEEP = { mode: "always" as const, source: "keep-people" as const }

function previewClipFor(d: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask" | "slots">): TrendPreviewClip {
  const mask = storedFaceMaskFor(d)
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: SRC, startSec: 0, recipe: "2", madeAt: "2026-10-31T10:00:00.000Z",
    ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
  }
}

const withClip = (d: TrendVersionData): TrendVersionData => ({ ...d, previewClip: previewClipFor(d) })

function data(faceMasking: TrendVersionData["faceMasking"]): TrendVersionData {
  return withClip({
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    faceMasking,
  })
}

function mask(d: TrendVersionData, over: Partial<TrendFaceMask> = {}): TrendFaceMask {
  return {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-10-31T10:00:00.000Z",
    approvedBy: "admin",
    ...over,
  }
}

const approved = (faceMasking: TrendVersionData["faceMasking"]) => {
  const d0 = data(faceMasking)
  return withClip({ ...d0, faceMask: mask(d0) })
}

const ENGINE = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskRecipe: "1",
  faceMaskErase: true,
  sourceModes: ["faces", "full-depth", "keep-people"],
  faceMaskTargets: ["face", "head", "body"],
  faceMaskMarkLabels: ["erased", "main"],
  fullDepthScenes: ["description", "original", "none"],
}
const MESH = { ...ENGINE, faceMesh: true }
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-10-31T00:00:00Z",
})
const REQUIRED = ["staging", "production"]

const issuesOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string; params?: unknown }> } } }, v: unknown) => {
  const r = schema.safeParse(v)
  return r.success ? [] : r.error!.issues
}

describe("the schema", () => {
  it("takes the face mesh with faces hidden (any target, any fill, always or auto) and with full depth", () => {
    for (const m of [
      { mode: "always", faceMesh: true },
      { mode: "auto", faceMesh: true, fill: "depth", target: "face" },
      { mode: "always", faceMesh: true, target: "body", fill: "blur" },
    ]) {
      expect(faceMaskingSchema.safeParse(m).success, JSON.stringify(m)).toBe(true)
      expect(faceMaskingMotionSchema.safeParse(m).success, JSON.stringify(m)).toBe(true)
      expect(faceMaskingWithMarksSchema.safeParse(m).success, JSON.stringify(m)).toBe(true)
    }
    expect(faceMaskingMotionSchema.safeParse({ ...FULL, faceMesh: true }).success).toBe(true)
    expect(faceMaskingWithMarksSchema.safeParse({ ...FULL, faceMesh: true, scene: "none" }).success).toBe(true)
  })

  it("refuses it with keep people, coded face_mesh_not_with_keep_people", () => {
    const issues = issuesOf(faceMaskingWithMarksSchema, { ...KEEP, faceMesh: true })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ path: ["faceMesh"], params: { code: FACE_MESH_NOT_WITH_KEEP_PEOPLE }, message: expect.stringMatching(/Keep people/) })
    expect(FACE_MESH_NOT_WITH_KEEP_PEOPLE).toBe("face_mesh_not_with_keep_people")
  })

  it("takes `false` anywhere, keep people included (the same as left out), and refuses a non-boolean", () => {
    for (const schema of [faceMaskingSchema, faceMaskingMotionSchema, faceMaskingWithMarksSchema]) {
      expect(schema.safeParse({ mode: "always", faceMesh: false }).success).toBe(true)
      expect(schema.safeParse({ mode: "always", faceMesh: "yes" }).success).toBe(false)
    }
    expect(faceMaskingWithMarksSchema.safeParse({ ...KEEP, faceMesh: false }).success).toBe(true)
  })

  it("takes it with the masking off (inert, like any other key kept there)", () => {
    expect(faceMaskingSchema.safeParse({ mode: "off", faceMesh: true }).success).toBe(true)
  })
})

describe("what is sent", () => {
  it("faces: the mesh only as true, never false; a setting without it exactly as before", () => {
    expect(faceMaskingSent({ ...FACES, faceMesh: true })).toEqual({ ...withResolvedZone(FACES), faceMesh: true })
    expect(faceMaskingSent({ ...FACES, faceMesh: false })).toEqual(faceMaskingSent(FACES))
    expect(Object.hasOwn(faceMaskingSent({ ...FACES, faceMesh: false }), "faceMesh")).toBe(false)
    expect(Object.hasOwn(withResolvedZone({ ...FACES, faceMesh: false }), "faceMesh")).toBe(false)
  })

  it("full depth: `{ mode, source }` plus `faceMesh: true` when it draws it; a run adds its scene", () => {
    expect(faceMaskingSent({ ...FULL, faceMesh: true })).toEqual({ mode: "always", source: "full-depth", faceMesh: true })
    expect(faceMaskingSent({ ...FULL, faceMesh: false })).toEqual({ mode: "always", source: "full-depth" })
    expect(faceMaskingRunSent({ ...FULL, faceMesh: true })).toEqual({ mode: "always", source: "full-depth", faceMesh: true, scene: "description" })
  })

  it("keep people: never a face mesh, whatever is stored", () => {
    expect(Object.hasOwn(faceMaskingSent({ ...KEEP, faceMesh: true }), "faceMesh")).toBe(false)
    expect(faceMeshOn({ ...KEEP, faceMesh: true })).toBe(false)
  })

  it("to an engine that does not draw it: no key at all (withFaceMeshFor)", () => {
    expect(withFaceMeshFor({ ...FACES, faceMesh: true }, true)).toEqual({ ...FACES, faceMesh: true })
    expect(withFaceMeshFor({ ...FACES, faceMesh: true }, false)).toEqual(FACES)
    expect(withFaceMeshFor({ ...FACES, faceMesh: false }, true)).toEqual(FACES)
    expect(engineDrawsFaceMesh(undefined)).toBe(false)
    expect(engineDrawsFaceMesh({})).toBe(false)
    expect(engineDrawsFaceMesh({ faceMesh: true })).toBe(true)
  })
})

describe("the settings key", () => {
  it("is unchanged for a setting without the mesh, absent or false (every approved mask stays up to date)", () => {
    for (const m of [FACES, { ...FACES, target: "face" as const, fill: "depth" as const }, FULL]) {
      expect(faceMaskSettingsKeyOf(SRC, { ...m, faceMesh: false }, []), JSON.stringify(m)).toBe(faceMaskSettingsKeyOf(SRC, m, []))
    }
    // Pinned: the very hash every faces / full-depth setting had before the face mesh existed (the
    // clip and the setting as sent, its zone resolved, its mode left out: `v2:` + sha256 of sorted JSON).
    const v2 = (faceMasking: unknown) =>
      `v2:${createHash("sha256").update(JSON.stringify({ faceMasking, videoUrl: SRC })).digest("hex")}`
    expect(faceMaskSettingsKeyOf(SRC, FACES, [])).toBe(v2({ threshold: 0.4, zone: { bottomPct: 0, leftPct: 10, rightPct: 10, topPct: 0 } }))
    expect(faceMaskSettingsKeyOf(SRC, { ...FACES, faceMesh: false }, [])).toBe(v2({ threshold: 0.4, zone: { bottomPct: 0, leftPct: 10, rightPct: 10, topPct: 0 } }))
    expect(faceMaskSettingsKeyOf(SRC, { ...FULL, faceMesh: false }, [])).toBe(v2({ source: "full-depth" }))
  })

  it("changes when it is turned on, for faces and for full depth", () => {
    expect(faceMaskSettingsKeyOf(SRC, { ...FACES, faceMesh: true }, [])).not.toBe(faceMaskSettingsKeyOf(SRC, FACES, []))
    expect(faceMaskSettingsKeyOf(SRC, { ...FULL, faceMesh: true }, [])).not.toBe(faceMaskSettingsKeyOf(SRC, FULL, []))
  })

  it("makes a mask approved without the mesh out of date (never sent) for a setting with it, and the other way round", () => {
    const without = approved(FACES)
    const switched = { ...without, faceMasking: { ...FACES, faceMesh: true } }
    expect(storedFaceMaskFor(switched)).toBeUndefined()
    const withMesh = approved({ ...FACES, faceMesh: true })
    expect(storedFaceMaskFor({ ...withMesh, faceMasking: FACES })).toBeUndefined()
    expect(storedFaceMaskFor({ ...withMesh, faceMasking: { ...FACES, faceMesh: true } })).toBeDefined()
  })

  it("the base key carries it too: a raw mask made without the mesh is never the base of one with it", () => {
    const d0 = data(FACES)
    const base = faceMaskBaseKey(d0)!
    expect(faceMaskBaseKey(data({ ...FACES, faceMesh: true }))).not.toBe(base)
    const stored = mask(d0, { rawMaskUrl: "https://cdn.example/raw.mp4", baseKey: base })
    expect(reusableFaceMaskBase({ ...d0, faceMask: stored }, "1")).toBeDefined()
    expect(reusableFaceMaskBase({ ...d0, faceMasking: { ...FACES, faceMesh: true }, faceMask: stored }, "1")).toBeUndefined()
  })
})

describe("publishing", () => {
  it("a trend that draws the mesh needs an engine that declares it, in every environment", () => {
    for (const fm of [{ ...FACES, faceMesh: true }, { ...FULL, faceMesh: true }]) {
      const blockers = publishBlockers(approved(fm), [env("staging", MESH), env("production", ENGINE)], REQUIRED)
      expect(blockers, JSON.stringify(fm)).toEqual([{ code: "engine_unsupported", env: "production", need: FACE_MESH_NEED }])
      expect(publishBlockers(approved(fm), [env("staging", MESH), env("production", MESH)], REQUIRED), JSON.stringify(fm)).toEqual([])
    }
    expect(FACE_MESH_NEED).toBe("faceMesh")
  })

  it("a trend without the mesh (absent, false) never needs it", () => {
    for (const fm of [FACES, { ...FACES, faceMesh: false }, FULL]) {
      expect(publishBlockers(approved(fm), [env("staging", ENGINE), env("production", ENGINE)], REQUIRED), JSON.stringify(fm)).toEqual([])
    }
  })
})

describe("a run", () => {
  afterEach(() => _resetPluginSupportsForTests())
  const run = (d: TrendVersionData): ComposedTrendRun =>
    composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })

  it("is composed with `faceMesh: true` (faces and full depth), and with no key when it is off", () => {
    expect(run(approved({ ...FACES, faceMesh: true })).body.faceMasking).toMatchObject({ faceMesh: true })
    expect(run(approved({ ...FULL, faceMesh: true })).body.faceMasking).toEqual({ mode: "always", source: "full-depth", scene: "description", faceMesh: true })
    expect(Object.hasOwn(run(approved({ ...FACES, faceMesh: false })).body.faceMasking!, "faceMesh")).toBe(false)
  })

  it("keeps it for an engine that draws it, and drops the key for one that does not (withoutUnsupportedFields)", () => {
    setPluginSupports({ castSwap: MESH } as never)
    const drawn = run(approved({ ...FACES, faceMesh: true }))
    withoutUnsupportedFields(drawn)
    expect(drawn.body.faceMasking).toMatchObject({ faceMesh: true })

    setPluginSupports({ castSwap: ENGINE } as never)
    for (const fm of [{ ...FACES, faceMesh: true }, { ...FULL, faceMesh: true }]) {
      const older = run(approved(fm))
      withoutUnsupportedFields(older)
      expect(Object.hasOwn(older.body.faceMasking!, "faceMesh"), JSON.stringify(fm)).toBe(false)
    }
  })
})

describe("the stored mask's faces drawn (`facesDrawn`)", () => {
  afterEach(() => _resetPluginSupportsForTests())
  const run = (d: TrendVersionData): ComposedTrendRun =>
    composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
  const withDrawn = (faceMasking: TrendVersionData["faceMasking"], facesDrawn: number | undefined) => {
    const d0 = data(faceMasking)
    return withClip({ ...d0, faceMask: mask(d0, facesDrawn === undefined ? {} : { facesDrawn }) })
  }

  it("is read from the make's answer (`output_data.faceMesh.facesDrawn`): a whole number, else none", () => {
    expect(faceMeshFacesDrawnOf({ faceMesh: { frames: 360, framesWithFaces: 0, facesDrawn: 0 } })).toBe(0)
    expect(faceMeshFacesDrawnOf({ faceMesh: { facesDrawn: 412 } })).toBe(412)
    for (const v of [{}, { faceMesh: null }, { faceMesh: { facesDrawn: -1 } }, { faceMesh: { facesDrawn: 1.5 } }, { faceMesh: { facesDrawn: "3" } }, null]) {
      expect(faceMeshFacesDrawnOf(v)).toBeUndefined()
    }
  })

  it("rides `storedFaceMask` to an engine that draws the mesh — 0 included, so it leaves the mesh's line out", () => {
    setPluginSupports({ castSwap: MESH } as never)
    for (const n of [0, 412]) {
      const r = run(withDrawn({ ...FACES, faceMesh: true }, n))
      withoutUnsupportedFields(r)
      expect(r.body.storedFaceMask).toMatchObject({ facesDrawn: n })
    }
    const none = run(withDrawn({ ...FACES, faceMesh: true }, undefined))
    withoutUnsupportedFields(none)
    expect(none.body.storedFaceMask).toBeDefined()
    expect(Object.hasOwn(none.body.storedFaceMask!, "facesDrawn")).toBe(false)
  })

  it("never to an engine that does not declare the face mesh (its strict schema would refuse it)", () => {
    setPluginSupports({ castSwap: ENGINE } as never)
    const r = run(withDrawn({ ...FACES, faceMesh: true }, 0))
    withoutUnsupportedFields(r)
    expect(r.body.storedFaceMask).toBeDefined()
    expect(Object.hasOwn(r.body.storedFaceMask!, "facesDrawn")).toBe(false)
  })

  it("the mesh's recipe: read from the make's answer, sent with the stored clip to an engine that draws the mesh, never to another", () => {
    expect(faceMeshRecipeOf({ faceMesh: { facesDrawn: 3, recipe: "2026-11-01" } })).toBe("2026-11-01")
    for (const v of [{}, { faceMesh: { recipe: "" } }, { faceMesh: { recipe: 7 } }, { faceMesh: { recipe: "x".repeat(41) } }, null]) {
      expect(faceMeshRecipeOf(v)).toBeUndefined()
    }
    const d0 = data({ ...FACES, faceMesh: true })
    const d = withClip({ ...d0, faceMask: mask(d0, { facesDrawn: 5, meshRecipe: "2026-11-01" }) })
    setPluginSupports({ castSwap: MESH } as never)
    const r = run(d)
    withoutUnsupportedFields(r)
    expect(r.body.storedFaceMask).toMatchObject({ facesDrawn: 5, meshRecipe: "2026-11-01" })
    setPluginSupports({ castSwap: ENGINE } as never)
    const older = run(d)
    withoutUnsupportedFields(older)
    expect(Object.hasOwn(older.body.storedFaceMask!, "meshRecipe")).toBe(false)
    // A mask made before the recipe was recorded sends none.
    setPluginSupports({ castSwap: MESH } as never)
    const before = run(withDrawn({ ...FACES, faceMesh: true }, 5))
    withoutUnsupportedFields(before)
    expect(Object.hasOwn(before.body.storedFaceMask!, "meshRecipe")).toBe(false)
    expect(trendVersionDataSchema.safeParse({ ...d, faceMask: { ...d.faceMask, meshRecipe: "" } }).success).toBe(false)
  })

  it("is part of the approved mask's schema", () => {
    const d = withDrawn({ ...FACES, faceMesh: true }, 0)
    expect(trendVersionDataSchema.safeParse(d).success).toBe(true)
    expect(trendVersionDataSchema.safeParse({ ...d, faceMask: { ...d.faceMask, facesDrawn: -1 } }).success).toBe(false)
  })
})
