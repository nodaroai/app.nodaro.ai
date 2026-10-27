/**
 * A trend's per-person face mask variants (lib/trends/face-mask-variants.ts,
 * decided 2026-10-27): which people are marked, the sets a run can leave
 * empty, each variant's boxes and key, its state, the run's pick (compose.ts),
 * the publish gate (publish-check.ts) and the slot-mark validation
 * (schemas.ts). The variant routes are pinned in
 * routes/__tests__/admin-trends-face-mask-variants.test.ts.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { storedFaceMaskFor } from "../face-mask.js"
import type { FaceMaskMark } from "@nodaro/render-rules"
import { composeTrendRun, TrendRunError } from "../compose.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import {
  faceMaskVariantBoxes,
  faceMaskVariantFor,
  faceMaskVariantKey,
  faceMaskVariantSets,
  faceMaskVariantsApply,
  faceMaskVariantsOverCap,
  faceMaskVariantsState,
  keptVariantsFor,
  markedPeople,
  withCurrentVariants,
} from "../face-mask-variants.js"
import { publishBlockers } from "../publish-check.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import type { TrendFaceMask, TrendFaceMaskVariant, TrendSlot, TrendVersionData, TrendPreviewClip } from "../types.js"

const SRC = "https://cdn.example.com/trends/t-1/source.mp4"
/**
 * A preview input clip current for the fixture's source at start 0, carrying
 * the matching cut of the data's current stored face mask when it has one:
 * publishing needs one (preview-clip.test.ts holds its rules).
 */
function previewClipFor(d: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask">): TrendPreviewClip {
  const mask = storedFaceMaskFor(d)
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: SRC, startSec: 0, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
    ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
  }
}
const MASKING = { mode: "always" as const, threshold: 0.4 }
const box = (leftPct: number, from = 0, to = 359) => ({ fromFrame: from, toFrame: to, leftPct, topPct: 10, rightPct: leftPct + 20, bottomPct: 60 })
const slotMark = (slot: string, leftPct: number): FaceMaskMark => ({ label: { slot }, ...box(leftPct) })
const ERASED: FaceMaskMark = { label: "erased", ...box(0) }

const person = (key: string, required: boolean): TrendSlot => ({ key, kind: "person", label: { en: key }, required, roleName: `the ${key}` })

/** A trend with no examples: a lead (required) and three optional people. */
function data(marks: FaceMaskMark[], over: Partial<TrendVersionData> = {}): TrendVersionData {
  const d: TrendVersionData = {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example.com/display.mp4", posterUrl: "https://cdn.example.com/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [person("lead", true), person("amy", false), person("ben", false), person("cat", false)],
    references: [],
    examples: [],
    faceMasking: { ...MASKING, ...(marks.length > 0 ? { marks } : {}) },
    ...over,
  }
  const withMask = { ...d, faceMask: over.faceMask ?? baseMask(d) }
  return { ...withMask, previewClip: previewClipFor(withMask) }
}

function baseMask(d: TrendVersionData, over: Partial<TrendFaceMask> = {}): TrendFaceMask {
  return {
    url: "https://cdn.example.com/trends/t-1/mask.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "fm-1",
    stats: { shots: 1, heldFrames: 0, coverage: 0.04, droppedRegions: 0 },
    approvedAt: "2026-10-27T10:00:00.000Z",
    approvedBy: "admin",
    rawMaskUrl: "https://cdn.example.com/trends/t-1/raw.mp4",
    baseKey: "v2:base",
    baseStats: { shots: 1, heldFrames: 0, coverage: 0.05, droppedRegions: 0 },
    ...over,
  }
}

/** `d` with an approved, up-to-date variant for each of `sets` (`url` absent for the ones in `empty`). */
function withVariants(d: TrendVersionData, sets: string[][], empty: string[][] = []): TrendVersionData {
  const variants: TrendFaceMaskVariant[] = sets.map((set, i) => ({
    emptySlots: set,
    key: faceMaskVariantKey(d, set)!,
    ...(empty.some((e) => e.join() === set.join()) ? {} : { url: `https://cdn.example.com/trends/t-1/v${i}.mp4` }),
    frames: 360,
    jobId: `var-${i}`,
    stats: { coverage: 0.02, erasedRegions: 3 },
    approvedAt: "2026-10-27T11:00:00.000Z",
  }))
  return { ...d, faceMask: { ...d.faceMask!, variants } }
}

const trend = (d: TrendVersionData) => ({ id: "t-1", slug: "dance", version: 1, data: d })
const img = (n: string) => `https://cdn.example.com/${n}.jpg`

describe("which people are marked, and which sets a run can leave empty", () => {
  it("counts only optional people with a slot mark, each once, sorted", () => {
    const d = data([slotMark("ben", 50), ERASED, slotMark("amy", 10), slotMark("ben", 60)])
    expect(markedPeople(d)).toEqual(["amy", "ben"])
    expect(markedPeople(data([ERASED]))).toEqual([])
    // A trend that does not mask has nobody marked.
    expect(markedPeople({ ...d, faceMasking: { mode: "off", marks: d.faceMasking!.marks } })).toEqual([])
  })

  it("one set per non-empty subset (2^k − 1), by size then key", () => {
    expect(faceMaskVariantSets(data([slotMark("amy", 10)]))).toEqual([["amy"]])
    expect(faceMaskVariantSets(data([slotMark("amy", 10), slotMark("ben", 40)]))).toEqual([["amy"], ["ben"], ["amy", "ben"]])
    const three = faceMaskVariantSets(data([slotMark("cat", 70), slotMark("amy", 10), slotMark("ben", 40)]))
    expect(three).toHaveLength(7)
    expect(three).toEqual([["amy"], ["ben"], ["cat"], ["amy", "ben"], ["amy", "cat"], ["ben", "cat"], ["amy", "ben", "cat"]])
  })

  it("applies only to a trend with no examples (an example fills every empty slot)", () => {
    const d = data([slotMark("amy", 10)])
    expect(faceMaskVariantsApply(d)).toBe(true)
    const withExample = { ...d, examples: [{ videoUrl: img("ex"), width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: {} }] }
    expect(faceMaskVariantsApply(withExample)).toBe(false)
    expect(faceMaskVariantSets(withExample)).toEqual([])
  })

  it("has no sets over the cap of 3 marked people", () => {
    const four = data([slotMark("amy", 10), slotMark("ben", 30), slotMark("cat", 50), slotMark("dan", 70)], {
      slots: [person("lead", true), person("amy", false), person("ben", false), person("cat", false), person("dan", false)],
    })
    expect(faceMaskVariantsOverCap(four)).toBe(true)
    expect(faceMaskVariantSets(four)).toEqual([])
  })
})

describe("a variant's boxes and key", () => {
  const marks = [ERASED, slotMark("amy", 10), slotMark("ben", 40), slotMark("ben", 45)]
  it("always erases the erased (Everyone) marks, erases the empty people's, and keeps every other marked person's", () => {
    const { eraseAlways, erase, keep } = faceMaskVariantBoxes(data(marks), ["amy"])
    // "Everyone" applies in every variant exactly as in the base: keep never overrides it.
    expect(eraseAlways).toEqual([box(0)])
    expect(erase).toEqual([box(10)])
    expect(keep).toEqual([box(40), box(45)])
    const both = faceMaskVariantBoxes(data(marks), ["amy", "ben"])
    expect(both.erase).toEqual([box(10), box(40), box(45)])
    expect(both.keep).toEqual([])
    // Boxes only: no label reaches the core job.
    expect(JSON.stringify(both)).not.toContain("label")
  })

  it("changes when any slot mark changes (keep boxes are every variant's), when an erased mark or the raw mask changes; not with mark order", () => {
    const d = data(marks)
    const key = faceMaskVariantKey(d, ["amy"])!
    expect(key.startsWith("pv1:")).toBe(true)
    expect(faceMaskVariantKey(data([marks[0]!, marks[3]!, marks[2]!, marks[1]!]), ["amy"])).toBe(key)
    // Ben's marks are Amy's variant's keep boxes: editing them makes it out of date too.
    expect(faceMaskVariantKey(data([ERASED, slotMark("amy", 10), slotMark("ben", 41), slotMark("ben", 45)]), ["amy"])).not.toBe(key)
    expect(faceMaskVariantKey(data([{ ...ERASED, leftPct: 1 }, ...marks.slice(1)]), ["amy"])).not.toBe(key)
    expect(faceMaskVariantKey({ ...d, faceMask: { ...d.faceMask!, rawMaskUrl: "https://cdn.example.com/other.mp4" } }, ["amy"])).not.toBe(key)
    expect(faceMaskVariantKey(d, ["ben"])).not.toBe(key)
    // No raw mask, or no masking: no variant can be made.
    expect(faceMaskVariantKey({ ...d, faceMask: { ...d.faceMask!, rawMaskUrl: undefined } }, ["amy"])).toBeNull()
    expect(faceMaskVariantKey({ ...d, faceMasking: { mode: "off" } }, ["amy"])).toBeNull()
  })
})

describe("withCurrentVariants (a save of the marks, the slots or the examples)", () => {
  it("drops the variants of sets no run can leave empty any more and the jobs for them or for older marks; keeps an out-of-date variant of a current set", () => {
    const d = withVariants(data([slotMark("amy", 10), slotMark("ben", 40)]), [["amy"], ["ben"], ["amy", "ben"]])
    const job = { emptySlots: ["amy"], key: faceMaskVariantKey(d, ["amy"])!, jobId: "a", eraseJobId: "e", startedAt: "t" }
    const failed = { emptySlots: ["ben"], key: faceMaskVariantKey(d, ["ben"])!, jobId: "b", startedAt: "t", error: { message: "x", at: "t" } }
    const before = { ...d, faceMask: { ...d.faceMask!, variantJobs: [job, failed] } }
    expect(withCurrentVariants(before)).toEqual({ data: before, abandoned: [] })
    // Ben's marks removed, Amy's moved: only Amy's set remains, her variant out of date, her job for the old marks dropped.
    const edited = { ...before, faceMasking: { ...MASKING, marks: [slotMark("amy", 12)] } }
    const { data: next, abandoned } = withCurrentVariants(edited)
    expect(next.faceMask!.variants!.map((v) => v.emptySlots)).toEqual([["amy"]])
    expect(next.faceMask!.variantJobs).toBeUndefined()
    // The failed one needs no closing; the one in the making does.
    expect(abandoned.map((j) => j.jobId)).toEqual(["a"])
    expect(faceMaskVariantsState(next).variants.map((v) => v.status)).toEqual(["out_of_date"])
  })

  it("never lets a change of people grow past the 7 sets: old sets go, the new ones fit", () => {
    const slots = [person("lead", true), person("amy", false), person("ben", false), person("cat", false), person("dan", false)]
    const d = withVariants(data([slotMark("amy", 10), slotMark("ben", 40)], { slots }), [["amy"], ["ben"], ["amy", "ben"]])
    const changed = { ...d, faceMasking: { ...MASKING, marks: [slotMark("amy", 10), slotMark("cat", 50), slotMark("dan", 70)] } }
    const { data: next } = withCurrentVariants(changed)
    expect(next.faceMask!.variants!.map((v) => v.emptySlots)).toEqual([["amy"]])
    expect(trendVersionDataSchema.safeParse(next).success).toBe(true)
  })
})

describe("faceMaskVariantsState", () => {
  const d = data([slotMark("amy", 10), slotMark("ben", 40)])
  it("missing, then approved per set; out of date once a mark moves; making and failed from the job", () => {
    expect(faceMaskVariantsState(d).variants.map((v) => v.status)).toEqual(["missing", "missing", "missing"])
    const made = withVariants(d, [["amy"], ["ben"], ["amy", "ben"]])
    expect(faceMaskVariantsState(made).variants.map((v) => v.status)).toEqual(["approved", "approved", "approved"])
    const moved = { ...made, faceMasking: { ...MASKING, marks: [slotMark("amy", 11), slotMark("ben", 40)] } }
    // Amy's box moved: every variant has it (erased or kept), so all three are out of date.
    expect(faceMaskVariantsState(moved).variants.map((v) => v.status)).toEqual(["out_of_date", "out_of_date", "out_of_date"])
    const key = faceMaskVariantKey(d, ["amy"])!
    const job = { emptySlots: ["amy"], key, jobId: "a", eraseJobId: "e", startedAt: "t" }
    const making = { ...d, faceMask: { ...d.faceMask!, variantJobs: [job] } }
    expect(faceMaskVariantsState(making).variants[0]!.status).toBe("making")
    const failed = { ...d, faceMask: { ...d.faceMask!, variantJobs: [{ ...job, error: { message: "boom", at: "t" } }] } }
    expect(faceMaskVariantsState(failed).variants[0]!.status).toBe("failed")
    // A job for older marks is not this set's making.
    const stale = { ...d, faceMask: { ...d.faceMask!, variantJobs: [{ ...job, key: "pv1:old" }] } }
    expect(faceMaskVariantsState(stale).variants[0]!.status).toBe("missing")
  })

  it("says why the approved mask cannot make variants", () => {
    expect(faceMaskVariantsState({ ...d, faceMask: undefined }).baseProblem).toBe("no_base")
    expect(faceMaskVariantsState({ ...d, faceMask: { ...d.faceMask!, rawMaskUrl: undefined } }).baseProblem).toBe("no_raw_mask")
    expect(faceMaskVariantsState({ ...d, faceMask: { ...d.faceMask!, settingsKey: "v2:other" } }).baseProblem).toBe("base_out_of_date")
    const depth = data([slotMark("amy", 10)], { faceMasking: { ...MASKING, fill: "depth", marks: [slotMark("amy", 10)] } })
    expect(faceMaskVariantsState(depth).baseProblem).toBe("no_raw_mask")
    expect(faceMaskVariantsState(d).baseProblem).toBeNull()
  })

  it("keptVariantsFor keeps only the variants still made from the new base and marks", () => {
    const made = withVariants(d, [["amy"], ["ben"]])
    expect(keptVariantsFor(made, made).variants).toHaveLength(2)
    const newBase = { ...made, faceMask: { ...made.faceMask!, rawMaskUrl: "https://cdn.example.com/raw2.mp4", variants: undefined } }
    expect(keptVariantsFor(newBase, made)).toEqual({})
  })
})

describe("the run's pick (composeTrendRun)", () => {
  const marks = [slotMark("amy", 10), slotMark("ben", 40)]
  const d = withVariants(data(marks), [["amy"], ["ben"], ["amy", "ben"]], [["amy", "ben"]])
  const fill = (...keys: string[]) => ({ slots: Object.fromEntries(["lead", ...keys].map((k) => [k, { images: [img(k)] }])) })

  it("sends the variant for exactly the marked people left empty, required", () => {
    const amyEmpty = composeTrendRun(trend(d), fill("ben", "cat"))
    expect(amyEmpty.body.storedFaceMask).toEqual({ url: "https://cdn.example.com/trends/t-1/v0.mp4", frames: 360, required: true })
    expect(amyEmpty.needs.storedFaceMask).toBe(true)
    expect(amyEmpty.body.faceMasking).toMatchObject({ mode: "always", threshold: 0.4 })
    // Cat has no marks: leaving her empty changes nothing.
    expect(composeTrendRun(trend(d), fill("ben")).body.storedFaceMask).toEqual(amyEmpty.body.storedFaceMask)
    expect(composeTrendRun(trend(d), fill("amy", "cat")).body.storedFaceMask).toMatchObject({ url: "https://cdn.example.com/trends/t-1/v1.mp4" })
  })

  it("sends no masking at all when the variant left nothing to cover", () => {
    const { body, needs, maskingZoneLeftOut } = composeTrendRun(trend(d), fill("cat"))
    expect(body).not.toHaveProperty("faceMasking")
    expect(body).not.toHaveProperty("storedFaceMask")
    expect(needs).toMatchObject({ faceMasking: false, faceMaskTarget: null, storedFaceMask: false })
    expect(maskingZoneLeftOut).toBe(false)
  })

  it("refuses a run whose variant is missing or out of date (face_mask_required)", () => {
    const none = data(marks)
    expect(() => composeTrendRun(trend(none), fill("ben"))).toThrow(TrendRunError)
    const moved = { ...d, faceMasking: { ...MASKING, marks: [slotMark("amy", 12), slotMark("ben", 40)] } }
    try {
      composeTrendRun(trend(moved), fill("ben"))
      throw new Error("expected a refusal")
    } catch (e) {
      expect((e as TrendRunError).code).toBe("face_mask_required")
    }
  })

  it("leaves the body byte-identical to before slot marks when every marked person is filled", () => {
    // A person's chips with none chosen (the slot's kind's defaults).
    const CHIPS = { body: "new", outfit: "new", hair: "new" }
    const { body, needs } = composeTrendRun(trend(d), fill("amy", "ben"))
    expect(body).toStrictEqual({
      videoUrl: SRC,
      roles: [
        { kind: "person", name: "the lead", images: [img("lead")], ...CHIPS },
        { kind: "person", name: "the amy", images: [img("amy")], ...CHIPS },
        { kind: "person", name: "the ben", images: [img("ben")], ...CHIPS },
        { kind: "person", name: "the cat", images: [], ...CHIPS },
      ],
      references: [],
      faceMasking: { mode: "always", threshold: 0.4, zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } },
      storedFaceMask: { url: "https://cdn.example.com/trends/t-1/mask.mp4", frames: 360 },
      // Resolved, and dropped for an engine that does not declare prompt styles (prompt-style.test.ts).
      promptStyle: "precise",
      preview: false,
      previewStart: 0,
      resolution: "480p",
      draft: true,
      // Which input the run edits (compose.ts); dropped for an engine that does not take a prepared preview (run-helpers.ts).
      sourceAsset: { kind: "full", durationSec: 12 },
      trendRun: {
        display: {
          trend: { id: "t-1", slug: "dance", version: 1, name: "Dance" },
          example: 0,
          slots: [
            { key: "lead", label: "lead", kind: "person", images: [img("lead")], fromExample: false, ...CHIPS },
            { key: "amy", label: "amy", kind: "person", images: [img("amy")], fromExample: false, ...CHIPS },
            { key: "ben", label: "ben", kind: "person", images: [img("ben")], fromExample: false, ...CHIPS },
            { key: "cat", label: "cat", kind: "person", images: [], fromExample: false, ...CHIPS },
          ],
        },
      },
    })
    expect(needs.storedFaceMask).toBe(false)
    // The same trend with no slot marks at all sends exactly that.
    const plain = { ...data([]), faceMask: baseMask(data([])) }
    expect(composeTrendRun(trend(plain), fill("amy", "ben")).body).toStrictEqual(body)
  })

  it("a trend with examples never picks a variant: an empty slot takes the example's person", () => {
    const example = { videoUrl: img("ex"), width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: { lead: [img("x")], amy: [img("xa")], ben: [img("xb")], cat: [img("xc")] } }
    const withExample = { ...d, examples: [example] }
    const { body } = composeTrendRun(trend(withExample), fill())
    expect(body.storedFaceMask).toEqual({ url: "https://cdn.example.com/trends/t-1/mask.mp4", frames: 360 })
  })

  it("faceMaskVariantFor reads the set in any order", () => {
    expect(faceMaskVariantFor(d, ["ben", "amy"])).toBe("unmasked")
    expect(faceMaskVariantFor(d, ["cat"])).toBeNull()
  })
})

describe("publishing (publishBlockers)", () => {
  const ALL = {
    roleKinds: ["person"],
    fullQuality: true,
    resolutions: ["480p", "720p", "1080p"],
    trendRun: true,
    faceMasking: true,
    storedFaceMask: true,
    storedFaceMaskRequired: true,
    faceMaskRecipe: "1",
  }
  const env = (name: string, castSwap: Record<string, unknown> = ALL): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-10-27T00:00:00Z",
  })
  const ENVS = [env("staging"), env("production")]
  const REQ = ["staging", "production"]
  const codes = (d: TrendVersionData, envs = ENVS) => publishBlockers(d, envs, REQ).map((b) => b.code)
  const marks = [slotMark("amy", 10), slotMark("ben", 40)]

  it("needs every variant made and up to date", () => {
    const d = data(marks)
    const blockers = publishBlockers(d, ENVS, REQ)
    expect(blockers.map((b) => b.code)).toEqual(["face_mask_variant_missing", "face_mask_variant_missing", "face_mask_variant_missing"])
    expect(blockers.map((b) => b.slots)).toEqual([["amy"], ["ben"], ["amy", "ben"]])
    const made = withVariants(d, [["amy"], ["ben"], ["amy", "ben"]])
    expect(codes(made)).toEqual([])
    const moved = { ...made, faceMasking: { ...MASKING, marks: [slotMark("amy", 12), slotMark("ben", 40)] } }
    expect(codes(moved)).toEqual(["face_mask_variant_out_of_date", "face_mask_variant_out_of_date", "face_mask_variant_out_of_date"])
  })

  it("refuses more than 3 marked people, examples or not", () => {
    const slots = [person("lead", true), person("amy", false), person("ben", false), person("cat", false), person("dan", false)]
    const four = data([slotMark("amy", 10), slotMark("ben", 30), slotMark("cat", 50), slotMark("dan", 70)], { slots })
    const blockers = publishBlockers(four, ENVS, REQ)
    expect(blockers.map((b) => b.code)).toEqual(["face_mask_people_over_cap"])
    expect(blockers[0]!.message).toMatch(/at most 3/)
    const withExample = { ...four, examples: [{ videoUrl: img("ex"), width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: Object.fromEntries(slots.map((s) => [s.key, [img(s.key)]])) }] }
    expect(codes(withExample)).toContain("face_mask_people_over_cap")
  })

  it("asks for no variant on a trend with examples (slot marks there have no run effect)", () => {
    const slots = data(marks).slots
    const withExample = { ...data(marks), examples: [{ videoUrl: img("ex"), width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: Object.fromEntries(slots.map((s) => [s.key, [img(s.key)]])) }] }
    expect(codes(withExample)).toEqual([])
  })

  it("says the approved mask cannot make variants when it kept no raw mask; says nothing of variants while the base is out of date", () => {
    const d = data(marks)
    const noRaw = { ...d, faceMask: { ...d.faceMask!, rawMaskUrl: undefined } }
    expect(codes(noRaw)).toEqual(["face_mask_variant_missing"])
    // A stale mask is sent with no run, so the preview clip (cut with it) goes stale too: re-cut for the check.
    const staleMask = { ...d, faceMask: { ...d.faceMask!, settingsKey: "v2:old" } }
    const stale = { ...staleMask, previewClip: previewClipFor(staleMask) }
    expect(codes(stale)).toEqual(["face_mask_out_of_date"])
  })

  it("needs an engine that refuses to mask per run (storedFaceMaskRequired) once runs can be sent a variant", () => {
    const made = withVariants(data(marks), [["amy"], ["ben"], ["amy", "ben"]])
    const old = [env("staging", { ...ALL, storedFaceMaskRequired: false }), env("production")]
    expect(publishBlockers(made, old, REQ)).toEqual([{ code: "engine_unsupported", env: "staging", need: "storedFaceMaskRequired" }])
  })
})

describe("slot marks in the trend schema", () => {
  const valid = (d: TrendVersionData) => trendVersionDataSchema.safeParse(d)
  it("takes a slot mark naming an optional person of the same version", () => {
    expect(valid(data([slotMark("amy", 10), ERASED])).success).toBe(true)
  })

  it("refuses one naming an unknown slot, a required person or a slot of another kind, at the mark's label", () => {
    const place: TrendSlot = { key: "place", kind: "location", label: { en: "Place" }, required: false, roleName: "the floor" }
    for (const [slot, why] of [["nobody", /names no slot/], ["lead", /required person/], ["place", /not a person/]] as const) {
      const d = data([slotMark(slot, 10)], { slots: [...data([]).slots, place] })
      const r = valid(d)
      expect(r.success).toBe(false)
      const issue = r.error!.issues.find((i) => i.path.join(".") === "faceMasking.marks.0.label")
      expect(issue?.message).toMatch(why)
      expect(issue?.message).toMatch(/Remove that person's face marks first/)
    }
  })

  it("refuses making a marked slot required, or deleting it, while it has marks", () => {
    const d = data([slotMark("amy", 10)])
    expect(valid({ ...d, slots: d.slots.map((s) => (s.key === "amy" ? { ...s, required: true } : s)) }).success).toBe(false)
    expect(valid({ ...d, slots: d.slots.filter((s) => s.key !== "amy") }).success).toBe(false)
  })

  it("holds erased and slot marks to one cap of 50", () => {
    const fifty = Array.from({ length: 25 }, () => ERASED).concat(Array.from({ length: 25 }, () => slotMark("amy", 10)))
    expect(valid(data(fifty)).success).toBe(true)
    expect(valid(data([...fifty, slotMark("ben", 40)])).success).toBe(false)
    // A label of neither shape is refused.
    expect(valid(data([{ ...ERASED, label: { slot: "amy", extra: 1 } as never }])).success).toBe(false)
    expect(valid(data([{ ...ERASED, label: { person: "amy" } as never }])).success).toBe(false)
  })
})
