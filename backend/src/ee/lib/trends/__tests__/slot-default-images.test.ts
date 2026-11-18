/**
 * A slot's original look (`TrendSlot.defaultImages`) and what a run sends for
 * an empty optional slot (compose.ts).
 *
 * What must hold:
 *  - the schema takes them on an optional slot of any kind (a location too),
 *    1–3 http(s) addresses, and refuses them on a required slot, clearly;
 *  - the person's own pictures always come first;
 *  - a Full depth run fills an empty optional slot with its original look,
 *    else none (kept as in the clip); an example NEVER fills a slot there, and
 *    the run records example 0;
 *  - a trend that hides its original fills it from the chosen example,
 *    whatever its kind, and never sends an original look;
 *  - every other trend fills it with its original look, whatever its kind
 *    (with or without examples); else a person from the chosen example, and a
 *    place, product or pet with none;
 *  - a slot an original look filled says `fromDefault: true` (`fromExample:
 *    false`); no other display slot has the key, and a run read back
 *    (`displaySlots`) keeps it only when true.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { composeTrendRun, TrendRunError } from "../compose.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import { displaySlots } from "../run-helpers.js"
import { emptyFillOf, type TrendEmptyFill } from "../empty-fill.js"
import { detailSlotOf } from "../../../routes/trends.js"
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

describe("an empty optional slot, by slot kind × original look × trend × example", () => {
  type TrendType = "ordinary" | "no example" | "hides its original" | "full depth"
  const KINDS: TrendSlot["kind"][] = ["person", "location", "product", "pet"]
  const TYPES: TrendType[] = ["ordinary", "no example", "hides its original", "full depth"]
  const LOOK = [img("x-look-a"), img("x-look-b")]
  const EX = [img("ex1-x")]
  const cases = KINDS.flatMap((kind) =>
    [true, false].flatMap((look) =>
      TYPES.flatMap((type) => [true, false].map((exampleHas) => ({ kind, look, type, exampleHas }))),
    ),
  )
  const name = ({ kind, look, type, exampleHas }: (typeof cases)[number]) =>
    `${kind}, ${look ? "with" : "without"} an original look, ${type}, the example ${exampleHas ? "has" : "has no"} pictures for it`

  /** A required lead and one optional slot `x` of `kind`; Example 1 has pictures for `x` when `exampleHas`. */
  function trendOf({ kind, look, type, exampleHas }: (typeof cases)[number]): TrendVersionData {
    const x = { key: "x", kind, label: { en: "X" }, required: false, roleName: "the other one", ...(look ? { defaultImages: LOOK } : {}) } as TrendSlot
    const example = { ...EXAMPLES[0]!, slots: { lead: [img("ex1-lead")], ...(exampleHas ? { x: EX } : {}) } }
    const d = data({ slots: [SLOTS[0]!, x], examples: type === "no example" ? [] : [example] })
    if (type === "hides its original") return { ...d, hideOriginal: true }
    if (type === "full depth") return withStoredClip({ ...d, faceMasking: FULL })
    return d
  }

  /** What the rule says `x` gets: [images, fromExample, fromDefault], its source, and the example the run records. */
  function expected(c: (typeof cases)[number]): { x: [string[], boolean, true | undefined]; fill: TrendEmptyFill; example: number } {
    const r = expectedRun(c)
    // The source by rule: "example" even where that example has no pictures for the slot (the run then sends none).
    const fill: TrendEmptyFill = r.x[2] ? "default" : c.type === "hides its original" || (c.type === "ordinary" && c.kind === "person" && !c.look) ? "example" : "original"
    return { ...r, fill }
  }

  function expectedRun({ kind, look, type, exampleHas }: (typeof cases)[number]): { x: [string[], boolean, true | undefined]; example: number } {
    const fromLook: [string[], boolean, true | undefined] = [LOOK, false, true]
    const fromExample: [string[], boolean, true | undefined] = exampleHas ? [EX, true, undefined] : [[], false, undefined]
    const none: [string[], boolean, true | undefined] = [[], false, undefined]
    switch (type) {
      case "full depth":
        return { x: look ? fromLook : none, example: 0 }
      case "hides its original":
        return { x: fromExample, example: 1 }
      case "no example":
        return { x: look ? fromLook : none, example: 0 }
      case "ordinary":
        return { x: look ? fromLook : kind === "person" ? fromExample : none, example: 1 }
    }
  }

  it.each(cases.map((c) => [name(c), c] as const))("%s", (_name, c) => {
    const r = run(trendOf(c))
    const want = expected(c)
    const x = r.display.slots.find((s) => s.key === "x")!
    expect([x.images, x.fromExample, x.fromDefault]).toEqual(want.x)
    // The key itself is there only when an original look filled the slot.
    expect(Object.hasOwn(x, "fromDefault")).toBe(want.x[2] === true)
    expect(r.display.example).toBe(want.example)
    // The rule's answer, and the trend's page states the same for the slot.
    const d = trendOf(c)
    const xSlot = d.slots.find((s) => s.key === "x")!
    expect(emptyFillOf(d, xSlot)).toBe(want.fill)
    expect(detailSlotOf(d, xSlot, "en").emptyFill).toBe(want.fill)
    // The engine is sent what the run records.
    expect(rolesOf(r)).toEqual([[img("me")], want.x[0]])
    // The lead always runs with the person's own pictures.
    expect(rows(r.display)[0]).toEqual(["lead", [img("me")], false, undefined])
  })

  it("puts the person's own pictures first, on every trend", () => {
    for (const type of TYPES) {
      const r = run(trendOf({ kind: "location", look: true, type, exampleHas: true }), { slots: { ...me, x: { images: [img("my-x")] } } })
      expect(rows(r.display)[1]).toEqual(["x", [img("my-x")], false, undefined])
    }
  })

  it("a Full depth trend that also hides its original sends neither its original look nor an example, as its page says", () => {
    for (const kind of KINDS) {
      for (const look of [true, false]) {
        const d = { ...trendOf({ kind, look, type: "full depth", exampleHas: true }), hideOriginal: true }
        const r = run(d)
        // Its original look would show frames of the original it hides: none is sent, and the page shows none.
        expect(rows(r.display)[1]).toEqual(["x", [], false, undefined])
        expect(r.display.example).toBe(0)
        const shown = detailSlotOf(d, d.slots[1]!, "en")
        expect(shown.emptyFill).toBe("original")
        expect(shown).not.toHaveProperty("defaultImages")
      }
    }
  })

  it("a required slot has no empty fill, on the rule and on the page", () => {
    for (const type of TYPES) {
      const d = trendOf({ kind: "person", look: false, type, exampleHas: true })
      expect(emptyFillOf(d, d.slots[0]!)).toBeUndefined()
      expect(detailSlotOf(d, d.slots[0]!, "en")).not.toHaveProperty("emptyFill")
    }
  })

  it("on a trend that hides its original, the body is the one the trend composes without original looks", () => {
    const withLooks = data({ hideOriginal: true })
    const withoutLooks = data({
      hideOriginal: true,
      slots: SLOTS.map((s) => {
        const { defaultImages: _d, ...rest } = s
        return rest as TrendSlot
      }),
    })
    expect(JSON.stringify(run(withLooks).body)).toBe(JSON.stringify(run(withoutLooks).body))
  })

  it("an example asked for by number is still recorded on an ordinary trend whose looks filled every empty slot", () => {
    const d = data({ examples: [EXAMPLES[0]!, { ...EXAMPLES[0]!, videoUrl: img("ex2") }] })
    const r = run(d, { example: 2 })
    expect(r.display.example).toBe(2)
    expect(rows(r.display)).toEqual([
      ["lead", [img("me")], false, undefined],
      ["guest", [img("guest-default")], false, true],
      // No original look: a pet stays as in the clip.
      ["dog", [], false, undefined],
      ["place", [img("place-a"), img("place-b")], false, true],
    ])
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
