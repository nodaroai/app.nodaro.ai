import { describe, it, expect } from "vitest"
import { CAST_SWAP_POST_PROMPT_MAX, composeTrendRun, TrendRunError } from "../compose.js"
import { trendRunRequestSchema, trendVersionDataSchema, MAX_TREND_IMAGES } from "../schemas.js"
import type { TrendRunRequest, TrendSlot, TrendVersionData } from "../types.js"

const img = (n: string) => `https://cdn.example.com/${n}.jpg`

function version(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Dance off", he: "קרב ריקודים" },
    source: { videoUrl: "https://cdn.example.com/source.mp4", durationSec: 12 },
    previewStart: 2,
    slots: [
      {
        key: "lead",
        kind: "person",
        label: { en: "The lead", he: "המובילה" },
        hint: { en: "A clear face photo works best" },
        required: true,
        roleName: "the woman on the left",
        defaults: { body: "original", hair: "original" },
      },
      {
        key: "friend",
        kind: "person",
        label: { en: "Friend" },
        required: false,
        roleName: "the man on the right",
      },
      {
        key: "place",
        kind: "location",
        label: { en: "Place" },
        required: false,
        roleName: "the dance floor",
      },
    ],
    references: [{ images: [img("cloud1"), img("cloud2")], line: "the clouds in the opening dive" }],
    trendPrompt: "Keep the camera shake.",
    examples: [
      { videoUrl: img("ex1v"), width: 720, height: 1280, durationSec: 12, sourceJobId: "j1", slots: { lead: [img("ex1-lead")], friend: [img("ex1-friend")], place: [img("ex1-place")] } },
      { videoUrl: img("ex2v"), width: 720, height: 1280, durationSec: 12, sourceJobId: "j2", slots: { lead: [img("ex2-lead")], friend: [img("ex2-friend")], place: [img("ex2-place")] } },
    ],
    ...over,
  }
}

const trend = (data: TrendVersionData = version()) => ({ id: "t-1", slug: "dance-off", version: 3, data })

function req(over: Partial<TrendRunRequest> = {}): TrendRunRequest {
  return { slots: { lead: { images: [img("me")] } }, ...over }
}

function codeOf(fn: () => unknown): { code: string; slot?: string } {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(TrendRunError)
    const err = e as TrendRunError
    return { code: err.code, slot: err.slot }
  }
  throw new Error("expected a TrendRunError")
}

describe("composeTrendRun — slots", () => {
  it("rejects a slot key the version does not have", () => {
    expect(codeOf(() => composeTrendRun(trend(), req({ slots: { lead: { images: [img("me")] }, ghost: { images: [img("x")] } } })))).toEqual({
      code: "unknown_slot",
      slot: "ghost",
    })
  })

  it("does not treat inherited object keys as slots", () => {
    expect(codeOf(() => composeTrendRun(trend(), req({ slots: JSON.parse('{"lead":{"images":["https://cdn.example.com/me.jpg"]},"constructor":{}}') }))).code).toBe(
      "unknown_slot",
    )
  })

  it("names the missing required slot", () => {
    expect(codeOf(() => composeTrendRun(trend(), req({ slots: {} })))).toEqual({ code: "missing_slot", slot: "lead" })
    expect(codeOf(() => composeTrendRun(trend(), req({ slots: { lead: { body: "new" } } })))).toEqual({ code: "missing_slot", slot: "lead" })
  })

  it("fills an empty optional slot with the chosen example's pictures", () => {
    const { body, display } = composeTrendRun(trend(), req({ example: 2 }))
    expect(display.example).toBe(2)
    expect(display.slots.map((s) => [s.key, s.images, s.fromExample])).toEqual([
      ["lead", [img("me")], false],
      ["friend", [img("ex2-friend")], true],
      ["place", [img("ex2-place")], true],
    ])
    expect((body.roles as Array<{ images: string[] }>).map((r) => r.images)).toEqual([[img("me")], [img("ex2-friend")], [img("ex2-place")]])
  })

  it("uses Example 1 by default", () => {
    const { display } = composeTrendRun(trend(), req())
    expect(display.example).toBe(1)
    expect(display.slots[1]!.images).toEqual([img("ex1-friend")])
  })

  it("rejects an example out of range", () => {
    expect(codeOf(() => composeTrendRun(trend(), req({ example: 3 }))).code).toBe("example_out_of_range")
    expect(codeOf(() => composeTrendRun(trend(), req({ example: 0 }))).code).toBe("example_out_of_range")
  })

  it("rejects an explicit example on a version with none, even when every slot is filled", () => {
    const all = { lead: { images: [img("a")] }, friend: { images: [img("b")] }, place: { images: [img("c")] } }
    expect(codeOf(() => composeTrendRun(trend(version({ examples: [] })), req({ slots: all, example: 1 }))).code).toBe("example_out_of_range")
  })

  it("lets a version with no examples run when every slot is filled (admin test runs of a new draft)", () => {
    const all = { lead: { images: [img("a")] }, friend: { images: [img("b")] }, place: { images: [img("c")] } }
    const { display } = composeTrendRun(trend(version({ examples: [] })), req({ slots: all }))
    expect(display.slots.every((s) => !s.fromExample)).toBe(true)
  })

  it("rejects a version with no examples when an optional slot needs one", () => {
    expect(codeOf(() => composeTrendRun(trend(version({ examples: [] })), req())).code).toBe("example_out_of_range")
  })

  it("names an empty optional slot the example has no pictures for", () => {
    const data = version()
    data.examples[0]!.slots = { lead: [img("ex1-lead")], place: [img("ex1-place")] }
    expect(codeOf(() => composeTrendRun(trend(data), req()))).toEqual({ code: "missing_slot", slot: "friend" })
  })

  it("rejects a chip that is not the slot kind's own", () => {
    expect(codeOf(() => composeTrendRun(trend(), req({ slots: { lead: { images: [img("me")], coat: "new" } } })))).toEqual({
      code: "invalid_choice",
      slot: "lead",
    })
    expect(codeOf(() => composeTrendRun(trend(), req({ slots: { lead: { images: [img("me")] }, place: { body: "new" } } })))).toEqual({
      code: "invalid_choice",
      slot: "place",
    })
  })

  it("rejects 4 images in one slot at the request schema", () => {
    const r = trendRunRequestSchema.safeParse({ slots: { lead: { images: [img("1"), img("2"), img("3"), img("4")] } } })
    expect(r.success).toBe(false)
  })
})

describe("composeTrendRun — roles", () => {
  it("builds roles in slot order with the hidden roleName", () => {
    const { body } = composeTrendRun(trend(), req())
    expect(body.roles).toEqual([
      { kind: "person", name: "the woman on the left", images: [img("me")], body: "original", outfit: "new", hair: "original" },
      { kind: "person", name: "the man on the right", images: [img("ex1-friend")], body: "new", outfit: "new", hair: "new" },
      { kind: "location", name: "the dance floor", images: [img("ex1-place")] },
    ])
  })

  it("takes the user's chips over the slot defaults", () => {
    const { body, display } = composeTrendRun(trend(), req({ slots: { lead: { images: [img("me")], body: "new", outfit: "original" } } }))
    expect(body.roles[0]).toMatchObject({ body: "new", outfit: "original", hair: "original" })
    expect(display.slots[0]).toMatchObject({ body: "new", outfit: "original", hair: "original" })
  })

  it("carries pet and product chips from the slot defaults, then the request, else new", () => {
    const slots: TrendSlot[] = [
      { key: "dog", kind: "pet", label: { en: "Dog" }, required: true, roleName: "the dog", defaults: { coat: "original" } },
      { key: "can", kind: "product", label: { en: "Can" }, required: true, roleName: "the soda can", defaults: { shape: "original", finish: "original" } },
    ]
    const data = version({ slots, examples: [] })
    const { body, display } = composeTrendRun(trend(data), { slots: { dog: { images: [img("dog")] }, can: { images: [img("can")], finish: "new" } } })
    expect(body.roles).toEqual([
      { kind: "pet", name: "the dog", images: [img("dog")], body: "new", coat: "original" },
      { kind: "product", name: "the soda can", images: [img("can")], shape: "original", finish: "new" },
    ])
    expect(display.slots[0]).toMatchObject({ kind: "pet", body: "new", coat: "original" })
    expect(display.slots[0]).not.toHaveProperty("outfit")
    expect(display.slots[1]).toMatchObject({ kind: "product", shape: "original", finish: "new" })
    expect(display.slots[1]).not.toHaveProperty("body")
  })

  it("gives a location no chips", () => {
    const { body, display } = composeTrendRun(trend(), req())
    expect(Object.keys(body.roles[2] as object).sort()).toEqual(["images", "kind", "name"])
    expect(Object.keys(display.slots[2]!).sort()).toEqual(["fromExample", "images", "key", "kind", "label"])
  })
})

describe("composeTrendRun — details and prompt", () => {
  it("maps {slot:key} to {role:N} after the trend prompt", () => {
    const { body, display } = composeTrendRun(trend(), req({ details: "{slot:friend} spins {slot:lead}; {slot:place} at night" }))
    expect(body.postPrompt).toBe("Keep the camera shake.\n\n{role:2} spins {role:1}; {role:3} at night")
    expect(display.details).toBe("{slot:friend} spins {slot:lead}; {slot:place} at night")
  })

  it("rejects a mention of an unknown slot", () => {
    expect(codeOf(() => composeTrendRun(trend(), req({ details: "with {slot:ghost}" })))).toEqual({ code: "invalid_slot_mention", slot: "ghost" })
    expect(codeOf(() => composeTrendRun(trend(), req({ details: "with {slot:}" }))).code).toBe("invalid_slot_mention")
  })

  it("uses the trend prompt alone, or the details alone", () => {
    expect(composeTrendRun(trend(), req()).body.postPrompt).toBe("Keep the camera shake.")
    expect(composeTrendRun(trend(version({ trendPrompt: undefined })), req({ details: "slow" })).body.postPrompt).toBe("slow")
  })

  it("omits postPrompt and display.details when both are empty", () => {
    const { body, display } = composeTrendRun(trend(version({ trendPrompt: "" })), req({ details: "" }))
    expect(body).not.toHaveProperty("postPrompt")
    expect(display).not.toHaveProperty("details")
  })
})

describe("composeTrendRun — postPrompt cap", () => {
  it("is the engine's 4000 characters", () => {
    expect(CAST_SWAP_POST_PROMPT_MAX).toBe(4000)
  })

  it("composes a postPrompt of exactly 4000 characters", () => {
    const { body } = composeTrendRun(trend(version({ trendPrompt: "x".repeat(2998) })), req({ details: "y".repeat(1000) }))
    expect(body.postPrompt).toHaveLength(4000)
  })

  it("rejects 4001 characters with prompt_too_long and no slot", () => {
    expect(codeOf(() => composeTrendRun(trend(version({ trendPrompt: "x".repeat(2999) })), req({ details: "y".repeat(1000) })))).toEqual({
      code: "prompt_too_long",
      slot: undefined,
    })
  })

  it("measures the details after {slot:key} becomes {role:N}", () => {
    // Ten slots: the tenth, key "j", maps "{slot:j}" (8) to "{role:10}" (9).
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
    const slots: TrendSlot[] = keys.map((key, i) => ({
      key,
      kind: i < 6 ? ("person" as const) : i < 9 ? ("product" as const) : ("location" as const),
      label: { en: key },
      required: true,
      roleName: `role ${key}`,
    }))
    const data = version({ slots, examples: [], trendPrompt: "x".repeat(2998) })
    const all = Object.fromEntries(keys.map((k) => [k, { images: [img(k)] }]))
    // 1000 characters of details: unmapped the postPrompt is 2998 + 2 + 1000 = 4000; mapped it is 4001.
    const details = (key: string) => "y".repeat(992) + `{slot:${key}}`
    expect(details("j")).toHaveLength(1000)
    expect(codeOf(() => composeTrendRun(trend(data), { slots: all, details: details("j") })).code).toBe("prompt_too_long")
    expect(composeTrendRun(trend(data), { slots: all, details: details("a") }).body.postPrompt).toHaveLength(4000)
  })
})

describe("composeTrendRun — preview, resolution, source", () => {
  it("sends the preview from the trend's preview start", () => {
    const { body } = composeTrendRun(trend(), req({ preview: true }))
    expect(body.preview).toBe(true)
    expect(body.previewStart).toBe(2)
  })

  it("defaults to a full run", () => {
    expect(composeTrendRun(trend(), req()).body.preview).toBe(false)
  })

  it("rejects a preview when the trend offers none", () => {
    expect(codeOf(() => composeTrendRun(trend(version({ previewStart: null })), req({ preview: true }))).code).toBe("preview_unavailable")
    expect(composeTrendRun(trend(version({ previewStart: null })), req()).body.previewStart).toBe(0)
  })

  it("defaults to a 480p draft", () => {
    const { body } = composeTrendRun(trend(), req())
    expect(body.resolution).toBe("480p")
    expect(body.draft).toBe(true)
    expect(body).not.toHaveProperty("quality")
  })

  it("is not a draft above 480p, and draft can be turned off at 480p", () => {
    expect(composeTrendRun(trend(), req({ resolution: "1080p" })).body).toMatchObject({ resolution: "1080p", draft: false })
    expect(composeTrendRun(trend(), req({ resolution: "480p", draft: false })).body).toMatchObject({ resolution: "480p", draft: false })
  })

  it("rejects a version with no source clip", () => {
    expect(codeOf(() => composeTrendRun(trend(version({ source: null })), req())).code).toBe("source_missing")
  })

  it("sends the source clip and the fixed references", () => {
    const { body } = composeTrendRun(trend(), req())
    expect(body.videoUrl).toBe("https://cdn.example.com/source.mp4")
    expect(body.references).toEqual([{ images: [img("cloud1"), img("cloud2")], line: "the clouds in the opening dive" }])
  })
})

describe("composeTrendRun — display and needs", () => {
  it("stamps the trend in English and hands the same display to the engine", () => {
    const { body, display } = composeTrendRun(trend(), req())
    expect(display.trend).toEqual({ id: "t-1", slug: "dance-off", version: 3, name: "Dance off" })
    expect(display.slots[0]).toMatchObject({ key: "lead", label: "The lead", kind: "person" })
    expect(body.trendRun.display).toEqual(display)
  })

  it("keeps hidden data out of the display", () => {
    const { display } = composeTrendRun(trend(), req({ details: "{slot:lead}" }))
    const json = JSON.stringify(display)
    for (const hidden of ["the woman on the left", "the dance floor", "source.mp4", "cloud1", "opening dive", "camera shake"]) {
      expect(json).not.toContain(hidden)
    }
  })

  it("never puts slot labels or hints in what the engine reads", () => {
    const { body } = composeTrendRun(trend(), req())
    // The display rides along under trendRun (labels are public); the engine's own fields carry only roleName.
    const { trendRun: _display, ...engine } = body
    const json = JSON.stringify(engine)
    for (const label of ["The lead", "המובילה", "Friend", "Place"]) expect(json).not.toContain(label)
    expect(JSON.stringify(body)).not.toContain("A clear face photo works best")
  })

  it("reports the kinds used and whether there are fixed references", () => {
    expect(composeTrendRun(trend(), req()).needs).toEqual({ roleKinds: new Set(["person", "location"]), fixedReferences: true })
    expect(composeTrendRun(trend(version({ references: [] })), req()).needs.fixedReferences).toBe(false)
  })

  it("never exceeds the image cap for a version that passed validation", () => {
    const slots: TrendSlot[] = Array.from({ length: 8 }, (_, i) => ({
      key: `p${i}`,
      kind: i < 6 ? ("person" as const) : ("product" as const),
      label: { en: `P${i}` },
      required: true,
      roleName: `role ${i}`,
    }))
    const references = [{ images: [img("r1"), img("r2"), img("r3")], line: "a" }, { images: [img("r4"), img("r5"), img("r6")], line: "b" }]
    const data = version({ slots, references, examples: [] })
    expect(trendVersionDataSchema.safeParse(data).success).toBe(true)
    const three = [img("1"), img("2"), img("3")]
    const { body } = composeTrendRun(trend(data), { slots: Object.fromEntries(slots.map((s) => [s.key, { images: three }])) })
    const total =
      (body.roles as Array<{ images: string[] }>).reduce((n, r) => n + r.images.length, 0) + body.references.reduce((n, r) => n + r.images.length, 0)
    expect(total).toBe(MAX_TREND_IMAGES)
  })
})
