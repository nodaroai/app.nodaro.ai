/**
 * Role outlines (`faceMasking.roleOutlines`, decided 2026-11-01): a coloured
 * ring around each person role's masked region on a trend's stored face mask,
 * named in the run. What must hold:
 *
 *  - the palette goes by role order among the PERSON slots, the same on the
 *    server and in the editor (render-rules);
 *  - every existing setting is unchanged: absent and `false` validate and
 *    hash exactly as before (every approved mask stays up to date), and a run
 *    never carries `faceMasking.roleOutlines`;
 *  - on: a slot mark may name a required person; the settings key hashes the
 *    outlines (slot, colour, boxes), the base key only a depth fill's gray
 *    view; every run must use the stored mask;
 *  - a run is told which colour is which role (`storedFaceMask.outlines`):
 *    the outlines that ringed someone, for roles with pictures, only on an
 *    engine that declares `castSwap.roleOutlines`; a preview's prepared clip
 *    keeps them (and `facesDrawn`);
 *  - publishing needs the capability in every environment.
 */
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { ROLE_OUTLINE_PALETTE, personSlotOrder, roleOutlineColour, roleOutlineColourName, roleOutlinesOf, slotMarkAllowed } from "@nodaro/render-rules"
import {
  ROLE_OUTLINES_NEED_FACES,
  engineDrawsRoleOutlines,
  faceMaskingSchema,
  faceMaskingWithMarksSchema,
  roleOutlinesOn,
  withoutMarks,
} from "../../../../lib/cast-swap-face-masking.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { forLoadedEngine } from "../../cast-swap-prompt-parts.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { composeTrendRun, type ComposedTrendRun } from "../compose.js"
import { faceMaskBaseKey, faceMaskSettingsKey, faceMaskSettingsKeyOf, faceMaskStoredRequired, reusableFaceMaskBase, storedFaceMaskFor } from "../face-mask.js"
import { promptPartsRequestFor } from "../prompt-parts-store.js"
import { ROLE_OUTLINES_NEED, publishBlockers } from "../publish-check.js"
import { makeOutlinesOf, recordedOutlinesOf, runOutlinesFor } from "../role-outlines.js"
import { faceMaskVariantKey } from "../face-mask-variants.js"
import { trendVersionDataSchema } from "../schemas.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import type { FaceMaskMark } from "@nodaro/render-rules"
import type { TrendFaceMask, TrendPreviewClip, TrendSlot, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const FACES = { mode: "always" as const, threshold: 0.4 }
const ON = { ...FACES, roleOutlines: true }

const SLOTS: TrendSlot[] = [
  { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the singer" },
  { key: "place", kind: "location", label: { en: "Place" }, required: false, roleName: "the stage" },
  { key: "guest", kind: "person", label: { en: "Guest" }, required: false, roleName: "the dancer" },
  { key: "extra", kind: "person", label: { en: "Extra" }, required: false, roleName: "the drummer" },
]

const box = (leftPct: number, rightPct: number, fromFrame = 0, toFrame = 359) => ({ fromFrame, toFrame, leftPct, topPct: 0, rightPct, bottomPct: 100 })
const slotMark = (slot: string, leftPct: number, rightPct: number): FaceMaskMark => ({ label: { slot }, ...box(leftPct, rightPct) })
const MARKS = [slotMark("lead", 0, 40), slotMark("guest", 60, 100), slotMark("lead", 0, 30)]

function previewClipFor(d: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask" | "slots">): TrendPreviewClip {
  const mask = storedFaceMaskFor(d)
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: SRC, startSec: 0, recipe: "1", madeAt: "2026-11-01T10:00:00.000Z",
    ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
  }
}
const withClip = (d: TrendVersionData): TrendVersionData => ({ ...d, previewClip: previewClipFor(d) })

function data(faceMasking: TrendVersionData["faceMasking"], slots: TrendSlot[] = SLOTS): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots,
    references: [],
    examples: [],
    faceMasking,
  }
}

function mask(d: TrendVersionData, over: Partial<TrendFaceMask> = {}): TrendFaceMask {
  return {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-11-01T10:00:00.000Z",
    approvedBy: "admin",
    ...over,
  }
}

const OUTLINED: TrendFaceMask["outlines"] = [
  { slot: "lead", colour: "#FF00FF", regionsDrawn: 340 },
  { slot: "guest", colour: "#FFE600", regionsDrawn: 120 },
]
const approved = (faceMasking: TrendVersionData["faceMasking"], over: Partial<TrendFaceMask> = {}) => {
  const d0 = data(faceMasking)
  return withClip({ ...d0, faceMask: mask(d0, over) })
}

const ENGINE = {
  roleKinds: ["person", "location"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskRecipe: "1",
  faceMaskErase: true,
  preparedPreview: true,
  faceMesh: true,
}
const OUTLINES = { ...ENGINE, roleOutlines: true }
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-11-01T00:00:00Z",
})
const REQUIRED = ["staging", "production"]

describe("the palette (render-rules)", () => {
  it("is magenta, yellow, red, orange, white, purple — no blue or green (the face mesh's)", () => {
    expect(ROLE_OUTLINE_PALETTE.map((c) => c.name)).toEqual(["magenta", "yellow", "red", "orange", "white", "purple"])
    for (const { hex } of ROLE_OUTLINE_PALETTE) expect(hex).toMatch(/^#[0-9A-F]{6}$/)
    expect(new Set(ROLE_OUTLINE_PALETTE.map((c) => c.hex)).size).toBe(6)
  })

  it("goes by role order among the PERSON slots, whatever the other slots", () => {
    expect(personSlotOrder(SLOTS)).toEqual(["lead", "guest", "extra"])
    expect(roleOutlineColour(SLOTS, "lead")).toBe("#FF00FF")
    expect(roleOutlineColour(SLOTS, "guest")).toBe("#FFE600")
    expect(roleOutlineColour(SLOTS, "extra")).toBe("#FF1F1F")
    expect(roleOutlineColour(SLOTS, "place")).toBeNull()
    expect(roleOutlineColour(SLOTS, "nobody")).toBeNull()
    expect(roleOutlineColourName("#ffe600")).toBe("yellow")
    expect(roleOutlineColourName("#123456")).toBeNull()
  })

  it("a slot mark may name a required person only while outlines are on; never a non-person", () => {
    const [lead, place, guest] = SLOTS
    expect(slotMarkAllowed(lead, false)).toBe(false)
    expect(slotMarkAllowed(lead, true)).toBe(true)
    expect(slotMarkAllowed(guest, false)).toBe(true)
    expect(slotMarkAllowed(place, true)).toBe(false)
    expect(slotMarkAllowed(undefined, true)).toBe(false)
  })

  it("builds one outline per person slot with marks, in role order, its boxes in the marks' order", () => {
    expect(roleOutlinesOf(SLOTS, [slotMark("guest", 60, 100), ...MARKS.slice(0, 1), MARKS[2]!])).toEqual([
      { slot: "lead", colour: "#FF00FF", boxes: [box(0, 40), box(0, 30)] },
      { slot: "guest", colour: "#FFE600", boxes: [box(60, 100)] },
    ])
  })
})

describe("the schema", () => {
  it("takes role outlines on a trend's faces-hidden setting, `false` and absent alike", () => {
    for (const m of [ON, { ...FACES, roleOutlines: false }, FACES, { ...ON, fill: "depth", target: "body" }]) {
      expect(faceMaskingWithMarksSchema.safeParse(m).success, JSON.stringify(m)).toBe(true)
    }
    expect(faceMaskingWithMarksSchema.safeParse({ ...FACES, roleOutlines: "yes" }).success).toBe(false)
  })

  it("refuses them with a depth mode, coded role_outlines_need_faces", () => {
    for (const source of ["full-depth", "keep-people"] as const) {
      const r = faceMaskingWithMarksSchema.safeParse({ mode: "always", source, roleOutlines: true })
      expect(r.success).toBe(false)
      expect(r.error!.issues[0]).toMatchObject({ path: ["roleOutlines"], params: { code: ROLE_OUTLINES_NEED_FACES } })
    }
  })

  it("never takes them on a direct run's setting (a trend's stored mask alone)", () => {
    expect(faceMaskingSchema.safeParse(ON).success).toBe(false)
  })

  it("takes a required person's slot marks while on, refuses them while off", () => {
    const marks = [slotMark("lead", 0, 40)]
    expect(trendVersionDataSchema.safeParse(data({ ...ON, marks })).success).toBe(true)
    const off = trendVersionDataSchema.safeParse(data({ ...FACES, marks }))
    expect(off.success).toBe(false)
    expect(off.error!.issues.find((i) => i.path.join(".") === "faceMasking.marks.0.label")?.message).toMatch(/required person.*turn role outlines on/)
    // Never a non-person, on or off.
    expect(trendVersionDataSchema.safeParse(data({ ...ON, marks: [slotMark("place", 0, 40)] })).success).toBe(false)
  })

  it("takes recorded outlines on the approved mask and on a variant, strictly", () => {
    const d = approved({ ...ON, marks: MARKS }, { outlines: OUTLINED })
    expect(trendVersionDataSchema.safeParse(d).success).toBe(true)
    for (const bad of [
      [{ slot: "lead", colour: "magenta", regionsDrawn: 1 }],
      [{ slot: "lead", colour: "#FF00FF", regionsDrawn: -1 }],
      [{ slot: "lead", colour: "#FF00FF", regionsDrawn: 1, extra: true }],
    ]) {
      expect(trendVersionDataSchema.safeParse({ ...d, faceMask: { ...d.faceMask, outlines: bad } }).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe("what a run carries", () => {
  it("the run's setting never has the flag (withoutMarks drops it with the marks)", () => {
    expect(withoutMarks({ ...ON, marks: MARKS })).toEqual(FACES)
    expect(roleOutlinesOn(ON)).toBe(true)
    expect(roleOutlinesOn({ ...ON, mode: "off" })).toBe(false)
    expect(roleOutlinesOn({ ...FACES, roleOutlines: false })).toBe(false)
  })

  it("an engine declares it as `castSwap.roleOutlines`", () => {
    expect(engineDrawsRoleOutlines(undefined)).toBe(false)
    expect(engineDrawsRoleOutlines({})).toBe(false)
    expect(engineDrawsRoleOutlines({ roleOutlines: true })).toBe(true)
  })
})

describe("the settings key", () => {
  it("is unchanged for a setting without outlines, absent or false (every approved mask stays up to date)", () => {
    const v2 = (faceMasking: unknown) => `v2:${createHash("sha256").update(JSON.stringify({ faceMasking, videoUrl: SRC })).digest("hex")}`
    const before = v2({ threshold: 0.4, zone: { bottomPct: 0, leftPct: 10, rightPct: 10, topPct: 0 } })
    expect(faceMaskSettingsKeyOf(SRC, FACES, SLOTS)).toBe(before)
    expect(faceMaskSettingsKeyOf(SRC, { ...FACES, roleOutlines: false }, SLOTS)).toBe(before)
    // Off, a setting's slot marks never touch the base key (as before).
    expect(faceMaskSettingsKey(data({ ...FACES, marks: [slotMark("guest", 60, 100)] }))).toBe(before)
  })

  it("changes when they are turned on, when a role's box changes, and when a person slot moves (its colour)", () => {
    const on = faceMaskSettingsKey(data({ ...ON, marks: MARKS }))
    expect(on).not.toBe(faceMaskSettingsKey(data({ ...FACES, marks: [slotMark("guest", 60, 100)] })))
    expect(on).not.toBe(faceMaskSettingsKey(data(ON)))
    expect(faceMaskSettingsKey(data({ ...ON, marks: [MARKS[0]!, slotMark("guest", 55, 100), MARKS[2]!] }))).not.toBe(on)
    const swapped = [SLOTS[2]!, SLOTS[1]!, SLOTS[0]!, SLOTS[3]!]
    expect(faceMaskSettingsKey(data({ ...ON, marks: MARKS }, swapped))).not.toBe(on)
    // The same boxes in another order are the same mask.
    expect(faceMaskSettingsKey(data({ ...ON, marks: [MARKS[2]!, MARKS[1]!, MARKS[0]!] }))).toBe(on)
  })

  it("the base key: a blur fill's raw mask stays the base; a depth fill's (drawn gray while on) does not", () => {
    expect(faceMaskBaseKey(data({ ...ON, marks: MARKS }))).toBe(faceMaskBaseKey(data(FACES)))
    const depth = { ...FACES, fill: "depth" as const }
    expect(faceMaskBaseKey(data({ ...depth, roleOutlines: true }))).not.toBe(faceMaskBaseKey(data(depth)))
    // A box edit never changes the base: the next make reuses the raw mask (fromMask).
    expect(faceMaskBaseKey(data({ ...depth, roleOutlines: true, marks: MARKS }))).toBe(faceMaskBaseKey(data({ ...depth, roleOutlines: true })))
    const d0 = data({ ...ON, marks: MARKS })
    const stored = mask(d0, { rawMaskUrl: "https://cdn.example/raw.mp4", baseKey: faceMaskBaseKey(data(FACES))! })
    expect(reusableFaceMaskBase({ ...d0, faceMask: stored }, "1")).toBeDefined()
  })

  it("every run must use the stored mask while on (a mask made per run draws none)", () => {
    expect(faceMaskStoredRequired(data(ON))).toBe(true)
    expect(faceMaskStoredRequired(data(FACES))).toBe(false)
  })
})

describe("the make's outlines", () => {
  it("one per person slot with marks; a variant's, less the people it leaves empty; none while off", () => {
    const d = data({ ...ON, marks: MARKS })
    expect(makeOutlinesOf(d)).toEqual([
      { slot: "lead", colour: "#FF00FF", boxes: [box(0, 40), box(0, 30)] },
      { slot: "guest", colour: "#FFE600", boxes: [box(60, 100)] },
    ])
    expect(makeOutlinesOf(d, ["guest"]).map((o) => o.slot)).toEqual(["lead"])
    expect(makeOutlinesOf(data({ ...FACES, marks: [slotMark("guest", 60, 100)] }))).toEqual([])
  })

  it("what the make answered is recorded only when it accounts for every outline sent, in its colour", () => {
    const sent = makeOutlinesOf(data({ ...ON, marks: MARKS }))
    const answer = { outlines: [{ slot: "guest", colour: "#ffe600", framesDrawn: 100, regionsDrawn: 120 }, { slot: "lead", colour: "#FF00FF", framesDrawn: 340, regionsDrawn: 340 }], outlinesAmbiguous: 3 }
    expect(recordedOutlinesOf(answer, sent)).toEqual(OUTLINED)
    expect(recordedOutlinesOf({}, sent)).toBeNull()
    expect(recordedOutlinesOf({ outlines: answer.outlines.slice(1) }, sent)).toBeNull()
    expect(recordedOutlinesOf({ outlines: [{ ...answer.outlines[0]!, colour: "#FF0000" }, answer.outlines[1]] }, sent)).toBeNull()
    expect(recordedOutlinesOf({ outlines: [{ ...answer.outlines[0]!, regionsDrawn: 1.5 }, answer.outlines[1]] }, sent)).toBeNull()
    // None sent: the engine still answers its (empty) list.
    expect(recordedOutlinesOf({ outlines: [] }, [])).toEqual([])
    expect(recordedOutlinesOf({}, [])).toBeNull()
  })

  it("a run is told of the outlines that ringed someone, for roles with pictures, by role number", () => {
    const slots = [{ key: "lead", images: ["a"] }, { key: "place", images: ["b"] }, { key: "guest", images: [] }, { key: "extra", images: ["c"] }]
    expect(runOutlinesFor(OUTLINED, slots)).toEqual([{ role: 1, colour: "#FF00FF" }])
    expect(runOutlinesFor(OUTLINED, slots.map((s) => ({ ...s, images: ["x"] })))).toEqual([{ role: 1, colour: "#FF00FF" }, { role: 3, colour: "#FFE600" }])
    expect(runOutlinesFor([{ slot: "lead", colour: "#FF00FF", regionsDrawn: 0 }], slots)).toEqual([])
    expect(runOutlinesFor(undefined, slots)).toEqual([])
  })
})

describe("a run", () => {
  afterEach(() => _resetPluginSupportsForTests())
  const run = (d: TrendVersionData, req: Record<string, unknown> = {}): ComposedTrendRun =>
    composeTrendRun(
      { id: "t-1", slug: "dance", version: 1, data: d },
      { slots: { lead: { images: ["https://cdn.example/me.png"] }, guest: { images: ["https://cdn.example/you.png"] } }, ...req },
    )
  const outlined = () => approved({ ...ON, marks: MARKS }, { outlines: OUTLINED, facesDrawn: 12 })

  it("sends the stored mask, required, with which colour is which role — never the flag on its setting", () => {
    setPluginSupports({ castSwap: OUTLINES } as never)
    const r = run(outlined())
    withoutUnsupportedFields(r)
    expect(r.body.storedFaceMask).toEqual({
      url: "https://cdn.example/trends/t1/clip.mp4",
      frames: 360,
      required: true,
      facesDrawn: 12,
      outlines: [{ role: 1, colour: "#FF00FF" }, { role: 3, colour: "#FFE600" }],
    })
    expect(Object.hasOwn(r.body.faceMasking!, "roleOutlines")).toBe(false)
  })

  it("a run that leaves a marked optional person empty: their person mask, with ITS outlines (the people it covers)", () => {
    const base = approved({ ...ON, marks: MARKS }, { outlines: OUTLINED, rawMaskUrl: "https://cdn.example/raw.mp4" })
    const variant = {
      emptySlots: ["guest"],
      key: faceMaskVariantKey(base, ["guest"])!,
      url: "https://cdn.example/trends/t1/no-guest.mp4",
      frames: 360,
      jobId: "job-v",
      stats: { coverage: 0.5, erasedRegions: 120 },
      approvedAt: "2026-11-01T10:00:00.000Z",
      outlines: [{ slot: "lead", colour: "#FF00FF", regionsDrawn: 340 }],
    }
    const d = { ...base, faceMask: { ...base.faceMask!, variants: [variant] } }
    expect(trendVersionDataSchema.safeParse(d).success).toBe(true)
    const r = run(d, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
    expect(r.body.storedFaceMask).toEqual({ url: variant.url, frames: 360, required: true, outlines: [{ role: 1, colour: "#FF00FF" }] })
  })

  it("strips the outlines for an engine that does not declare them (its strict schema would refuse them)", () => {
    setPluginSupports({ castSwap: ENGINE } as never)
    const r = run(outlined())
    withoutUnsupportedFields(r)
    expect(r.body.storedFaceMask).toBeDefined()
    expect(Object.hasOwn(r.body.storedFaceMask!, "outlines")).toBe(false)
  })

  it("a preview's prepared clip keeps what the mask says: required, facesDrawn and the outlines", () => {
    setPluginSupports({ castSwap: OUTLINES } as never)
    const r = run(outlined(), { preview: true })
    withoutUnsupportedFields(r)
    expect(r.body.preparedPreview).toBe(true)
    expect(r.body.storedFaceMask).toEqual({
      url: "https://cdn.example/trends/t1/preview-mask.mp4",
      frames: 150,
      required: true,
      facesDrawn: 12,
      outlines: [{ role: 1, colour: "#FF00FF" }, { role: 3, colour: "#FFE600" }],
    })
  })

  it("the face mesh's recipe rides the stored clip, a preview's prepared cut and a person variant (whose lines are the base's)", () => {
    setPluginSupports({ castSwap: OUTLINES } as never)
    const meshed = approved({ ...ON, marks: MARKS }, { outlines: OUTLINED, facesDrawn: 12, meshRecipe: "2026-11-01" })
    const full = run(meshed)
    withoutUnsupportedFields(full)
    expect(full.body.storedFaceMask).toMatchObject({ facesDrawn: 12, meshRecipe: "2026-11-01" })
    const preview = run(meshed, { preview: true })
    withoutUnsupportedFields(preview)
    expect(preview.body.preparedPreview).toBe(true)
    expect(preview.body.storedFaceMask).toMatchObject({ url: "https://cdn.example/trends/t1/preview-mask.mp4", meshRecipe: "2026-11-01" })

    const base = approved({ ...ON, marks: MARKS }, { outlines: OUTLINED, rawMaskUrl: "https://cdn.example/raw.mp4", meshRecipe: "2026-11-01" })
    const variant = {
      emptySlots: ["guest"],
      key: faceMaskVariantKey(base, ["guest"])!,
      url: "https://cdn.example/trends/t1/no-guest.mp4",
      frames: 360,
      jobId: "job-v",
      stats: { coverage: 0.5, erasedRegions: 120 },
      approvedAt: "2026-11-01T10:00:00.000Z",
    }
    const d = { ...base, faceMask: { ...base.faceMask!, variants: [variant] } }
    const r = run(d, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
    expect(r.body.storedFaceMask).toMatchObject({ url: variant.url, meshRecipe: "2026-11-01" })
  })

  it("refuses to run once a box changed after approval (face_mask_required), never masking per run", () => {
    const d = outlined()
    const edited = { ...d, faceMasking: { ...ON, marks: [slotMark("lead", 0, 45), MARKS[1]!] } }
    expect(() => run(edited)).toThrow(expect.objectContaining({ code: "face_mask_required" }))
  })
})

describe("the prompt parts check", () => {
  afterEach(() => _resetPluginSupportsForTests())
  it("counts the outlines' line for a trend that draws them, only on an engine that declares them", () => {
    const req = promptPartsRequestFor(data({ ...ON, marks: MARKS }))
    expect(req.roleOutlines).toBe(true)
    expect(Object.hasOwn(promptPartsRequestFor(data(FACES)), "roleOutlines")).toBe(false)
    setPluginSupports({ castSwap: { ...OUTLINES, promptParts: true } } as never)
    expect(forLoadedEngine(req).roleOutlines).toBe(true)
    setPluginSupports({ castSwap: { ...ENGINE, promptParts: true } } as never)
    expect(Object.hasOwn(forLoadedEngine(req), "roleOutlines")).toBe(false)
  })
})

describe("publishing", () => {
  it("a trend that draws them needs an engine that declares them, in every environment", () => {
    const d = approved({ ...ON, marks: MARKS }, { outlines: OUTLINED })
    expect(publishBlockers(d, [env("staging", OUTLINES), env("production", ENGINE)], REQUIRED)).toContainEqual({
      code: "engine_unsupported",
      env: "production",
      need: ROLE_OUTLINES_NEED,
    })
    expect(publishBlockers(d, [env("staging", OUTLINES), env("production", OUTLINES)], REQUIRED).filter((b) => b.need === ROLE_OUTLINES_NEED)).toEqual([])
    expect(ROLE_OUTLINES_NEED).toBe("roleOutlines")
  })

  it("a trend without them never needs them", () => {
    expect(publishBlockers(approved(FACES), [env("staging", ENGINE), env("production", ENGINE)], REQUIRED).filter((b) => b.need === ROLE_OUTLINES_NEED)).toEqual([])
  })
})
