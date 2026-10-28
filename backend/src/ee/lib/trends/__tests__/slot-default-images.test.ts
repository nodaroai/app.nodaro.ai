/**
 * A slot's default pictures for Full depth (`TrendSlot.defaultImages`).
 *
 * What must hold:
 *  - the schema takes them on an optional slot of any kind (a location too),
 *    1–3 http(s) addresses, and refuses them on a required slot, clearly;
 *  - a Full depth run fills an empty optional slot with them: the person's own
 *    pictures first, then the default, then none (kept as in the clip); an
 *    example NEVER fills a slot there, and the run records example 0 and
 *    `fromDefault: true` on a defaulted slot (`fromExample: false`);
 *  - every other clip preparation runs exactly as before, examples included,
 *    and its display slots carry no `fromDefault` key at all;
 *  - a run read back (`displaySlots`) keeps `fromDefault` only when true.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { composeTrendRun, TrendRunError } from "../compose.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import { displaySlots } from "../run-helpers.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendRunRequest, TrendSlot, TrendVersionData } from "../types.js"
import { TREND_PICTURE_MAX_BYTES } from "@nodaro/render-rules"
import { TREND_MEDIA_MAX_BYTES } from "../media.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const img = (n: string) => `https://cdn.example/trends/t1/${n}.png`
const FULL = { mode: "always" as const, source: "full-depth" as const }
const KEEP = { mode: "always" as const, source: "keep-people" as const }
const FACES = { mode: "always" as const, threshold: 0.4 }

const SLOTS: TrendSlot[] = [
  { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" },
  { key: "guest", kind: "person", label: { en: "Guest" }, required: false, roleName: "the man", defaultImages: [img("guest-default")] },
  { key: "dog", kind: "pet", label: { en: "Dog" }, required: false, roleName: "the dog" },
  { key: "place", kind: "location", label: { en: "Place" }, required: false, roleName: "the street", defaultImages: [img("place-a"), img("place-b")] },
]

const EXAMPLES: TrendVersionData["examples"] = [
  {
    videoUrl: img("ex1"),
    width: 240,
    height: 320,
    durationSec: 12,
    sourceJobId: "j1",
    slots: { lead: [img("ex1-lead")], guest: [img("ex1-guest")], dog: [img("ex1-dog")], place: [img("ex1-place")] },
  },
]

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Street" },
    source: { videoUrl: SRC, durationSec: 12 },
    previewStart: null,
    slots: SLOTS,
    references: [],
    examples: EXAMPLES,
    ...over,
  }
}

/** `d` with its approved stored clip (every depth mode runs on one only). */
function withStoredClip(d: TrendVersionData): TrendVersionData {
  return {
    ...d,
    faceMask: {
      url: "https://cdn.example/trends/t1/clip.mp4",
      frames: 360,
      recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
      settingsKey: faceMaskSettingsKey(d)!,
      jobId: "job-1",
      stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
      approvedAt: "2026-10-28T10:00:00.000Z",
      approvedBy: "admin",
    },
  }
}

const fullDepth = (over: Partial<TrendVersionData> = {}) => withStoredClip(data({ faceMasking: FULL, ...over }))
const trend = (d: TrendVersionData) => ({ id: "t-1", slug: "street", version: 1, data: d })
const me = { lead: { images: [img("me")] } }
const run = (d: TrendVersionData, req: Partial<TrendRunRequest> = {}) => composeTrendRun(trend(d), { slots: me, ...req })
const rows = (d: ReturnType<typeof run>["display"]) => d.slots.map((s) => [s.key, s.images, s.fromExample, s.fromDefault])
const rolesOf = (r: ReturnType<typeof run>) => (r.body.roles as Array<{ images: string[] }>).map((x) => x.images)

describe("the schema", () => {
  it("takes default pictures on an optional slot of any kind, a location included", () => {
    expect(trendVersionDataSchema.safeParse(data()).success).toBe(true)
  })

  it("refuses them on a required slot, naming the slot and the way out", () => {
    const slots = SLOTS.map((s) => (s.key === "lead" ? { ...s, defaultImages: [img("lead-default")] } : s))
    const r = trendVersionDataSchema.safeParse(data({ slots }))
    expect(r.success).toBe(false)
    const issue = r.error!.issues.find((i) => i.path.join(".") === "slots.0.defaultImages")
    expect(issue?.message).toBe('Slot "lead" is required, so it cannot have a default image. Remove its default images, or make it optional.')
  })

  it("holds them to 1–3 http(s) addresses", () => {
    const withDefaults = (defaultImages: string[]) => data({ slots: SLOTS.map((s) => (s.key === "guest" ? { ...s, defaultImages } : s)) })
    expect(trendVersionDataSchema.safeParse(withDefaults([])).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(withDefaults([img("a"), img("b"), img("c"), img("d")])).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(withDefaults(["ftp://cdn.example/a.png"])).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(withDefaults([img("a"), img("b"), img("c")])).success).toBe(true)
  })
})

describe("a Full depth run", () => {
  it("fills an empty optional slot with its default pictures, else with none — never the example's", () => {
    const r = run(fullDepth())
    expect(rows(r.display)).toEqual([
      ["lead", [img("me")], false, undefined],
      ["guest", [img("guest-default")], false, true],
      // No default: sent with no pictures, so the engine keeps the dog as in the clip.
      ["dog", [], false, undefined],
      ["place", [img("place-a"), img("place-b")], false, true],
    ])
    expect(rolesOf(r)).toEqual([[img("me")], [img("guest-default")], [], [img("place-a"), img("place-b")]])
    // None was used.
    expect(r.display.example).toBe(0)
    expect(r.body.trendRun.display).toEqual(r.display)
  })

  it("puts the person's own pictures first", () => {
    const r = run(fullDepth(), { slots: { ...me, guest: { images: [img("my-guest")] }, place: { images: [img("my-place")] } } })
    expect(rows(r.display)).toEqual([
      ["lead", [img("me")], false, undefined],
      ["guest", [img("my-guest")], false, undefined],
      ["dog", [], false, undefined],
      ["place", [img("my-place")], false, undefined],
    ])
  })

  it("never uses an example, even one asked for by number (which must still exist)", () => {
    const r = run(fullDepth(), { example: 1 })
    expect(r.display.example).toBe(0)
    expect(r.display.slots.some((s) => s.fromExample)).toBe(false)
    expect(rolesOf(r).flat().some((u) => u.includes("/ex1-"))).toBe(false)
    try {
      run(fullDepth(), { example: 2 })
      throw new Error("expected a refusal")
    } catch (e) {
      expect(e).toBeInstanceOf(TrendRunError)
      expect((e as TrendRunError).code).toBe("example_out_of_range")
    }
  })

  it("on a trend with no examples, runs the same", () => {
    expect(rows(run(fullDepth({ examples: [] })).display)).toEqual(rows(run(fullDepth()).display))
  })
})

describe("every other clip preparation", () => {
  // A depth mode or faces, with or without a stored clip, exactly as before default pictures existed.
  const others: Array<[string, TrendVersionData]> = [
    ["masking off", data()],
    ["faces", data({ faceMasking: FACES })],
    ["keep people", withStoredClip(data({ faceMasking: KEEP }))],
  ]
  const withoutDefaults = (d: TrendVersionData): TrendVersionData => ({
    ...d,
    slots: d.slots.map((s) => {
      const { defaultImages: _d, ...rest } = s
      return rest as TrendSlot
    }),
  })

  it.each(others)("%s fills an empty optional slot from the example, ignoring the defaults", (_name, d) => {
    const r = run(d)
    expect(rows(r.display)).toEqual([
      ["lead", [img("me")], false, undefined],
      ["guest", [img("ex1-guest")], true, undefined],
      ["dog", [img("ex1-dog")], true, undefined],
      ["place", [img("ex1-place")], true, undefined],
    ])
    expect(r.display.example).toBe(1)
    // No `fromDefault` key anywhere.
    expect(r.display.slots.every((s) => !Object.hasOwn(s, "fromDefault"))).toBe(true)
    // The body is byte for byte the one a trend without default pictures composes.
    expect(JSON.stringify(r.body)).toBe(JSON.stringify(run(withoutDefaults(d)).body))
  })

  it.each(others)("%s with no examples sends an empty optional slot with no pictures, ignoring the defaults", (_name, d) => {
    const r = run({ ...d, examples: [] })
    expect(rows(r.display)).toEqual([
      ["lead", [img("me")], false, undefined],
      ["guest", [], false, undefined],
      ["dog", [], false, undefined],
      ["place", [], false, undefined],
    ])
    expect(r.display.example).toBe(0)
  })
})

describe("the picture cap", () => {
  it("is the one the trend builder offers a Topaz upscale by (a result it could not store is never paid for)", () => {
    expect(TREND_MEDIA_MAX_BYTES.image).toBe(TREND_PICTURE_MAX_BYTES)
  })
})

describe("a run read back", () => {
  it("keeps `fromDefault` only when it is true", () => {
    const back = displaySlots(run(fullDepth()).display.slots)
    expect(back.map((s) => [s.key, s.fromDefault])).toEqual([
      ["lead", undefined],
      ["guest", true],
      ["dog", undefined],
      ["place", true],
    ])
    expect(Object.hasOwn(back[0]!, "fromDefault")).toBe(false)
    const odd = displaySlots([{ key: "guest", label: "Guest", kind: "person", images: [], fromExample: false, fromDefault: "yes" }])
    expect(Object.hasOwn(odd[0]!, "fromDefault")).toBe(false)
  })
})
