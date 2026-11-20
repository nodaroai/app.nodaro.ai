/**
 * The Face chip on a trend's person slot (decided 2026-11-20). What must hold:
 *
 *  - the schemas take `face` on a person slot (its default, its place in `chips`) and on a run's slot, and nowhere else;
 *  - a slot that lists no `chips` offers exactly what it offered before (Face is opt-in), and a run of a trend that
 *    never chose a face sends and records no `face` at all — byte-identical to before the chip;
 *  - a chosen face is sent as chosen (the person's pick where offered, else the slot's default), and a run that keeps a
 *    face needs an engine that declares `castSwap.roleFace` (refused, never stripped, on any other);
 *  - on a stored face mask, a run that keeps one face while a pictured person takes a new one also sends the mask
 *    before its marks (`raw`), the erased boxes (`erase`) and each person role's boxes (`roleBoxes`), only then, and
 *    only to an engine that declares `castSwap.roleFaceStoredMask`;
 *  - publishing needs both capabilities, and names a masked trend whose mixed runs would be refused;
 *  - the public trend routes keep the engine's `role_face_with_stored_mask` refusal readable.
 */
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import type { FaceMaskMark } from "@nodaro/render-rules"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { composeTrendRun, TrendRunError, type ComposedTrendRun } from "../compose.js"
import { faceMaskBaseKey, faceMaskSettingsKey } from "../face-mask.js"
import { promptPartsRequestFor } from "../prompt-parts-store.js"
import { ROLE_FACE_NEED, ROLE_FACE_STORED_MASK_NEED, publishBlockers } from "../publish-check.js"
import { faceChipKey, faceChipStored, faceSlotsWithoutOutlines, mixesFaces, roleFaceRemakeFor, trendMayKeepFaces } from "../role-face.js"
import { engineSupports, publicRefusal, withoutUnsupportedFields } from "../run-helpers.js"
import { CHIPS_BY_KIND, shownChips, trendRunRequestSchema, trendVersionDataSchema } from "../schemas.js"
import { PREVIEW_CLIP_RECIPE } from "../preview-clip.js"
import type { TrendFaceMask, TrendSlot, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const ON = { mode: "always" as const, threshold: 0.4, roleOutlines: true }

const person = (key: string, roleName: string, over: Partial<Extract<TrendSlot, { kind: "person" }>> = {}): TrendSlot => ({
  key, kind: "person", label: { en: key }, required: key === "lead", roleName, ...over,
})
const SLOTS: TrendSlot[] = [person("lead", "the singer"), person("guest", "the dancer")]
const OFFERS_FACE: TrendSlot[] = [person("lead", "the singer", { chips: ["body", "outfit", "hair", "face"] }), person("guest", "the dancer")]

const box = (leftPct: number, rightPct: number) => ({ fromFrame: 0, toFrame: 359, leftPct, topPct: 0, rightPct, bottomPct: 100 })
const slotMark = (slot: string, l: number, r: number): FaceMaskMark => ({ label: { slot }, ...box(l, r) })
const erased = (l: number, r: number): FaceMaskMark => ({ label: "erased", ...box(l, r) })

function data(slots: TrendSlot[] = SLOTS, faceMasking?: TrendVersionData["faceMasking"]): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: null,
    slots,
    references: [],
    examples: [],
    ...(faceMasking ? { faceMasking } : {}),
  }
}

function withMask(d: TrendVersionData, over: Partial<TrendFaceMask> = {}): TrendVersionData {
  const mask: TrendFaceMask = {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-11-20T10:00:00.000Z",
    approvedBy: "admin",
    outlines: [
      { slot: "lead", colour: "#FF00FF", regionsDrawn: 300 },
      { slot: "guest", colour: "#FFE600", regionsDrawn: 120 },
    ],
    rawMaskUrl: "https://cdn.example/trends/t1/raw.mp4",
    baseKey: faceMaskBaseKey(d)!,
    ...over,
  }
  return { ...d, faceMask: mask }
}

const BOTH = { lead: { images: ["https://cdn.example/me.png"] }, guest: { images: ["https://cdn.example/you.png"] } }
const run = (d: TrendVersionData, slots: Record<string, Record<string, unknown>> = BOTH, admin = false): ComposedTrendRun =>
  composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, trendRunRequestSchema.parse({ slots }), { allowHiddenChips: admin })
const roleOf = (r: ComposedTrendRun, i: number) => (r.body.roles as Array<Record<string, unknown>>)[i]!

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
  roleOutlines: true,
}
const FACE = { ...ENGINE, roleFace: true, roleFaceStoredMask: true }
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({ env: name, pluginBuildId: "b", supports: { castSwap: castSwap as never }, updatedAt: "2026-11-20T00:00:00Z" })
const REQUIRED = ["staging", "production"]

afterEach(() => _resetPluginSupportsForTests())

describe("the schemas", () => {
  it("take face on a person slot's defaults and chips, and on a run's slot", () => {
    expect(CHIPS_BY_KIND.person).toEqual(["body", "outfit", "hair", "face"])
    const d = data([person("lead", "the singer", { defaults: { face: "original" }, chips: ["face"] }), person("guest", "the dancer")])
    expect(trendVersionDataSchema.safeParse(d).success).toBe(true)
    expect(trendRunRequestSchema.safeParse({ slots: { lead: { images: ["https://cdn.example/a.png"], face: "original" } } }).success).toBe(true)
  })

  it("refuse face on any other kind, and any other value", () => {
    const pet: TrendSlot = { key: "dog", kind: "pet", label: { en: "Dog" }, required: true, roleName: "the dog", defaults: { face: "new" } as never }
    expect(trendVersionDataSchema.safeParse(data([pet])).success).toBe(false)
    expect(trendRunRequestSchema.safeParse({ slots: { lead: { face: "both" } } }).success).toBe(false)
  })
})

describe("which chips a slot offers", () => {
  it("leaves Face out of a slot that lists no chips (every trend made before it offers what it did)", () => {
    expect(shownChips(SLOTS[0]!)).toEqual(["body", "outfit", "hair"])
    expect(shownChips(OFFERS_FACE[0]!)).toEqual(["body", "outfit", "hair", "face"])
    expect(shownChips(person("x", "y", { chips: ["outfit", "face"] }))).toEqual(["outfit", "face"])
  })
})

describe("a run of a trend that never chose a face", () => {
  it("sends and records no face: the roles, display slots and needs are as before the chip", () => {
    const r = run(data())
    for (const i of [0, 1]) {
      expect(roleOf(r, i)).toEqual({ kind: "person", name: i === 0 ? "the singer" : "the dancer", images: [i === 0 ? "https://cdn.example/me.png" : "https://cdn.example/you.png"], body: "new", outfit: "new", hair: "new" })
      expect(r.display.slots[i]).not.toHaveProperty("face")
    }
    expect(r.needs).not.toHaveProperty("roleFace")
  })

  it("asks the prompt-parts route with no face either", () => {
    const body = promptPartsRequestFor(data()) as { roles: Array<Record<string, unknown>> }
    expect(body.roles.every((role) => !("face" in role))).toBe(true)
  })
})

describe("a run that chooses a face", () => {
  it("sends the person's pick where the slot offers it, and needs roleFace for an original", () => {
    const r = run(data(OFFERS_FACE), { ...BOTH, lead: { ...BOTH.lead, face: "original" } })
    expect(roleOf(r, 0).face).toBe("original")
    expect(roleOf(r, 1)).not.toHaveProperty("face")
    expect(r.display.slots[0]!.face).toBe("original")
    expect(r.needs.roleFace).toBe(true)
    const kept = run(data(OFFERS_FACE), { ...BOTH, lead: { ...BOTH.lead, face: "new" } })
    expect(roleOf(kept, 0).face).toBe("new")
    expect(kept.needs).not.toHaveProperty("roleFace")
  })

  it("refuses a face on a slot that does not offer it, but sends the slot's own default", () => {
    expect(() => run(data(), { ...BOTH, lead: { ...BOTH.lead, face: "original" } })).toThrow(TrendRunError)
    const fixed = run(data([person("lead", "the singer", { defaults: { face: "original" } }), person("guest", "the dancer")]))
    expect(roleOf(fixed, 0).face).toBe("original")
    expect(fixed.needs.roleFace).toBe(true)
    // An admin's test run may set it anyway.
    expect(roleOf(run(data(), { ...BOTH, lead: { ...BOTH.lead, face: "original" } }, true), 0).face).toBe("original")
  })

  it("is refused on an engine that does not take the Face chip, never sent without it", () => {
    const r = run(data(OFFERS_FACE), { ...BOTH, lead: { ...BOTH.lead, face: "original" } })
    setPluginSupports({ castSwap: ENGINE } as never)
    expect(engineSupports(r)).toBe(false)
    setPluginSupports({ castSwap: { ...ENGINE, roleFace: true } } as never)
    expect(engineSupports(r)).toBe(true)
    // A run that keeps no face runs where it ran before.
    setPluginSupports({ castSwap: ENGINE } as never)
    expect(engineSupports(run(data(OFFERS_FACE)))).toBe(true)
  })
})

describe("a run on a stored face mask", () => {
  const masked = (slots: TrendSlot[] = OFFERS_FACE) =>
    withMask(data(slots, { ...ON, marks: [slotMark("lead", 0, 40), erased(45, 55), slotMark("guest", 60, 100)] }))
  const keepLead = { ...BOTH, lead: { ...BOTH.lead, face: "original" } }

  it("that keeps one face and remakes another sends what the engine remakes the mask from", () => {
    setPluginSupports({ castSwap: FACE } as never)
    const r = run(masked(), keepLead)
    withoutUnsupportedFields(r)
    expect(r.body.storedFaceMask).toMatchObject({
      url: "https://cdn.example/trends/t1/clip.mp4",
      required: true,
      outlines: [{ role: 1, colour: "#FF00FF" }, { role: 2, colour: "#FFE600" }],
      raw: { url: "https://cdn.example/trends/t1/raw.mp4" },
      erase: [box(45, 55)],
      roleBoxes: [{ role: 1, boxes: [box(0, 40)] }, { role: 2, boxes: [box(60, 100)] }],
    })
    expect(r.body.storedFaceMask!.raw).not.toHaveProperty("depthUrl")
  })

  it("sends the depth view on a depth fill, and no raw mask that is not from these base settings", () => {
    const depth = withMask(data(OFFERS_FACE, { ...ON, fill: "depth", marks: [slotMark("lead", 0, 40), slotMark("guest", 60, 100)] }), { depthUrl: "https://cdn.example/trends/t1/depth.mp4" })
    expect(roleFaceRemakeFor(depth).raw).toEqual({ url: "https://cdn.example/trends/t1/raw.mp4", depthUrl: "https://cdn.example/trends/t1/depth.mp4" })
    expect(roleFaceRemakeFor({ ...depth, faceMask: { ...depth.faceMask!, depthUrl: undefined } }).raw).toBeUndefined()
    expect(roleFaceRemakeFor({ ...depth, faceMask: { ...depth.faceMask!, baseKey: "other" } }).raw).toBeUndefined()
    expect(roleFaceRemakeFor(depth)).not.toHaveProperty("erase")
  })

  it("sends none of them when it does not mix faces: the mask of before, byte for byte", () => {
    setPluginSupports({ castSwap: FACE } as never)
    const before = run(masked())
    withoutUnsupportedFields(before)
    for (const k of ["raw", "erase", "roleBoxes"]) expect(before.body.storedFaceMask).not.toHaveProperty(k)
    // Everyone keeps their face: nothing to remake.
    const all = run(masked([OFFERS_FACE[0]!, person("guest", "the dancer", { chips: ["face"] })]), { ...keepLead, guest: { ...BOTH.guest, face: "original" } })
    withoutUnsupportedFields(all)
    for (const k of ["raw", "erase", "roleBoxes"]) expect(all.body.storedFaceMask).not.toHaveProperty(k)
  })

  it("sends none of them to an engine that cannot remake the mask", () => {
    setPluginSupports({ castSwap: { ...ENGINE, roleFace: true } } as never)
    const r = run(masked(), keepLead)
    withoutUnsupportedFields(r)
    expect(r.body.storedFaceMask).toMatchObject({ url: "https://cdn.example/trends/t1/clip.mp4", required: true })
    for (const k of ["raw", "erase", "roleBoxes"]) expect(r.body.storedFaceMask).not.toHaveProperty(k)
  })

  it("a 4 s preview that mixes faces cuts the whole clip itself: the raw mask and boxes are the whole clip's", () => {
    setPluginSupports({ castSwap: { ...FACE, preparedPreview: true } } as never)
    const base = { ...masked(), previewStart: 2 }
    const withClip: TrendVersionData = {
      ...base,
      previewClip: {
        videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 4, width: 240, height: 320, frames: 120, sha256: "a".repeat(64),
        sourceVideoUrl: SRC, startSec: 2, recipe: PREVIEW_CLIP_RECIPE, madeAt: "2026-11-20T10:00:00.000Z",
        faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 120, sha256: "b".repeat(64), sourceMaskUrl: base.faceMask!.url },
      },
    }
    const preview = (slots: Record<string, Record<string, unknown>>) => {
      const r = composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: withClip }, trendRunRequestSchema.parse({ slots, preview: true }))
      withoutUnsupportedFields(r)
      return r
    }
    const mixed = preview(keepLead)
    expect(mixed.body).not.toHaveProperty("preparedPreview")
    expect(mixed.body.videoUrl).toBe(SRC)
    expect(mixed.body.storedFaceMask).toMatchObject({ url: "https://cdn.example/trends/t1/clip.mp4", frames: 360, raw: { url: "https://cdn.example/trends/t1/raw.mp4" } })
    // Any other preview still uses its prepared cut.
    const plain = preview(BOTH)
    expect(plain.body.preparedPreview).toBe(true)
    expect(plain.body.storedFaceMask).toMatchObject({ url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 120 })
  })

  it("mixes faces only with a pictured person taking a new one", () => {
    expect(mixesFaces([{ kind: "person", images: [], face: "original" }, { kind: "person", images: ["a"] }])).toBe(true)
    expect(mixesFaces([{ kind: "person", images: ["a"], face: "original" }, { kind: "person", images: [] }])).toBe(false)
    expect(mixesFaces([{ kind: "person", images: ["a"], face: "original" }, { kind: "pet", images: ["b"] }])).toBe(false)
  })
})

describe("what a trend stores", () => {
  it("is keyed per person slot, and empty when none stores it", () => {
    expect(faceChipKey(data())).toBe("")
    expect(faceChipStored(data(OFFERS_FACE))).toBe(true)
    expect(faceChipKey(data(OFFERS_FACE))).not.toBe(faceChipKey(data([person("lead", "the singer", { defaults: { face: "new" } }), SLOTS[1]!])))
    expect(trendMayKeepFaces(data([person("lead", "the singer", { defaults: { face: "new" } })]))).toBe(false)
    expect(trendMayKeepFaces(data(OFFERS_FACE))).toBe(true)
  })
})

describe("publishing", () => {
  // Both people required: no run leaves a marked person empty (no per-person masks).
  const PUB: TrendSlot[] = [OFFERS_FACE[0]!, person("guest", "the dancer", { required: true })]
  const masked = withMask(data(PUB, { ...ON, marks: [slotMark("lead", 0, 40), slotMark("guest", 60, 100)] }))
  const codes = (d: TrendVersionData, castSwap: Record<string, unknown>) => publishBlockers(d, REQUIRED.map((e) => env(e, castSwap)), REQUIRED)

  it("needs roleFace for a trend whose runs can keep a face, and roleFaceStoredMask when it masks", () => {
    expect(codes(data(OFFERS_FACE), ENGINE).filter((b) => b.code === "engine_unsupported").map((b) => b.need)).toEqual([ROLE_FACE_NEED, ROLE_FACE_NEED])
    const needs = codes(masked, ENGINE).filter((b) => b.code === "engine_unsupported").map((b) => b.need)
    expect(needs).toEqual([ROLE_FACE_NEED, ROLE_FACE_STORED_MASK_NEED, ROLE_FACE_NEED, ROLE_FACE_STORED_MASK_NEED])
    expect(codes(masked, FACE).filter((b) => b.code === "engine_unsupported")).toEqual([])
    expect(codes(data(), ENGINE).filter((b) => b.need === ROLE_FACE_NEED)).toEqual([])
  })

  it("names a masked trend's person who can keep their face and has no role outline", () => {
    expect(codes(masked, FACE).filter((b) => b.code.startsWith("face_chip"))).toEqual([])
    const unringed = withMask(data(PUB, { ...ON, marks: [slotMark("guest", 60, 100)] }))
    expect(faceSlotsWithoutOutlines(unringed)).toEqual(["lead"])
    expect(codes(unringed, FACE).find((b) => b.code === "face_chip_needs_role_outlines")).toMatchObject({ slots: ["lead"] })
    const noOutlines = withMask(data(PUB, { mode: "always", threshold: 0.4 }))
    expect(codes(noOutlines, FACE).find((b) => b.code === "face_chip_needs_role_outlines")).toMatchObject({ slots: ["lead"] })
    // A depth preparation has no role outlines: left to the engine, never named.
    expect(faceSlotsWithoutOutlines(data(OFFERS_FACE, { mode: "always", threshold: 0.4, source: "full-depth" } as never))).toEqual([])
    // One person alone never mixes faces: nothing to name.
    expect(faceSlotsWithoutOutlines(data([OFFERS_FACE[0]!], { mode: "always", threshold: 0.4 }))).toEqual([])
  })

  it("names an approved mask that kept no copy from before its marks", () => {
    const noRaw = withMask(data(PUB, { ...ON, marks: [slotMark("lead", 0, 40), slotMark("guest", 60, 100)] }), { rawMaskUrl: undefined })
    expect(codes(noRaw, FACE).map((b) => b.code)).toContain("face_chip_needs_raw_mask")
    expect(codes(masked, FACE).map((b) => b.code)).not.toContain("face_chip_needs_raw_mask")
  })

  it("names a trend whose mixed runs would use a per-person mask (an optional marked person left empty)", () => {
    const optional = withMask(data(OFFERS_FACE, { ...ON, marks: [slotMark("lead", 0, 40), slotMark("guest", 60, 100)] }))
    expect(codes(optional, FACE).find((b) => b.code === "face_chip_with_person_masks")).toMatchObject({ slots: ["guest"] })
    // An example with pictures for that person fills it on every run: no per-person mask.
    const filled = { ...optional, examples: [{ videoUrl: "https://cdn.example/ex.mp4", width: 240, height: 320, durationSec: 12, slots: { lead: ["https://cdn.example/l.png"], guest: ["https://cdn.example/g.png"] }, sourceJobId: "00000000-0000-4000-8000-0000000000b0" }] } as TrendVersionData
    expect(codes(filled, FACE).map((b) => b.code)).not.toContain("face_chip_with_person_masks")
    // A trend whose runs keep no face is never named.
    const noFace = withMask(data(SLOTS, { ...ON, marks: [slotMark("lead", 0, 40), slotMark("guest", 60, 100)] }))
    expect(codes(noFace, FACE).filter((b) => b.code.startsWith("face_chip"))).toEqual([])
  })
})

describe("the engine's refusal of a mixed run on the public routes", () => {
  it("stays readable", () => {
    let sent: { status?: number; body?: unknown } = {}
    const reply = {
      status(code: number) { sent.status = code; return this },
      send(body: unknown) { sent.body = body; return this },
    }
    publicRefusal(reply as never, { statusCode: 400, body: JSON.stringify({ error: { code: "role_face_with_stored_mask", message: "engine words" } }) })
    expect(sent.status).toBe(400)
    expect((sent.body as { error: { code: string; message: string } }).error.code).toBe("role_face_with_stored_mask")
    expect((sent.body as { error: { message: string } }).error.message).not.toBe("engine words")
    sent = {}
  })

  it("keeps roles_keep_everything readable too, on the envelope or carried on an issue", () => {
    for (const error of [
      { code: "roles_keep_everything", message: "Every role keeps everything from the video, engine words" },
      { code: "validation_error", message: "engine words", issues: [{ path: ["roles"], message: "x", params: { code: "roles_keep_everything" } }] },
      { code: "validation_error", message: "engine words", issues: [{ path: ["roles"], code: "role_face_with_stored_mask" }] },
    ]) {
      let sent: { status?: number; body?: { error: { code: string; message: string } } } = {}
      const reply = {
        status(code: number) { sent.status = code; return this },
        send(body: never) { sent.body = body; return this },
      }
      publicRefusal(reply as never, { statusCode: 400, body: JSON.stringify({ error }) })
      expect(sent.status).toBe(400)
      const want = error.code === "validation_error" ? (error.issues![0] as { params?: { code: string }; code?: string }).params?.code ?? (error.issues![0] as { code: string }).code : error.code
      expect(sent.body!.error.code).toBe(want)
      expect(Object.keys(sent.body!.error).sort()).toEqual(["code", "message"])
      expect(sent.body!.error.message).not.toContain("engine words")
      sent = {}
    }
    // Any other issue is still trend_run_rejected.
    let other: { body?: { error: { code: string } } } = {}
    publicRefusal({ status() { return this }, send(body: never) { other.body = body; return this } } as never, { statusCode: 400, body: JSON.stringify({ error: { code: "validation_error", issues: [{ code: "too_big" }] } }) })
    expect(other.body!.error.code).toBe("trend_run_rejected")
    other = {}
  })
})
