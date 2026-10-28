import { describe, it, expect } from "vitest"
import { CAST_SWAP_POST_PROMPT_MAX, composeTrendRun, TrendRunError } from "../compose.js"
import { trendRunRequestSchema, trendVersionDataSchema, MAX_TREND_IMAGES } from "../schemas.js"
import type { TrendRunRequest, TrendSlot, TrendVersionData } from "../types.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import { faceMaskVariantKey } from "../face-mask-variants.js"
import { PREVIEW_CLIP_RECIPE } from "../preview-clip.js"
import { withResolvedZone } from "../../../../lib/cast-swap-face-masking.js"

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

function codeOf(fn: () => unknown): { code: string; slot?: string; chip?: string } {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(TrendRunError)
    const err = e as TrendRunError
    return { code: err.code, slot: err.slot, chip: err.chip }
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
    // No example to name: the run records 0 ("no example").
    expect(display.example).toBe(0)
  })

  it("runs a version with no examples with an empty optional slot kept as in the original (no pictures, example 0)", () => {
    const { body, display } = composeTrendRun(trend(version({ examples: [] })), req())
    expect(display.example).toBe(0)
    expect(display.slots.map((s) => [s.key, s.images, s.fromExample])).toEqual([
      ["lead", [img("me")], false],
      ["friend", [], false],
      ["place", [], false],
    ])
    const roles = body.roles as Array<{ kind: string; name: string; images: string[] }>
    expect(roles.map((r) => [r.kind, r.name, r.images])).toEqual([
      ["person", "the woman on the left", [img("me")]],
      ["person", "the man on the right", []],
      ["location", "the dance floor", []],
    ])
    expect(body.trendRun.display.example).toBe(0)
  })

  it("still records the example it used when the version has examples", () => {
    const all = { lead: { images: [img("a")] }, friend: { images: [img("b")] }, place: { images: [img("c")] } }
    expect(composeTrendRun(trend(), req({ slots: all })).display.example).toBe(1)
  })

  it("an empty optional slot on a no-example Kling 4 trend counts no pictures toward its cap", () => {
    const data = version({ examples: [], references: [], engine: "kling-4" })
    const { display } = composeTrendRun(trend(data), req())
    expect(display.slots.map((s) => s.images.length)).toEqual([1, 0, 0])
  })

  it("sends no pictures for an empty optional slot the chosen example has none for (kept as in the clip)", () => {
    const data = version()
    data.examples[0]!.slots = { lead: [img("ex1-lead")], place: [img("ex1-place")] }
    const { body, display } = composeTrendRun(trend(data), req())
    expect(display.example).toBe(1)
    expect(display.slots.map((s) => [s.key, s.images, s.fromExample])).toEqual([
      ["lead", [img("me")], false],
      ["friend", [], false],
      ["place", [img("ex1-place")], true],
    ])
    expect((body.roles as Array<{ name: string; images: string[] }>).map((r) => [r.name, r.images])).toEqual([
      ["the woman on the left", [img("me")]],
      ["the man on the right", []],
      ["the dance floor", [img("ex1-place")]],
    ])
    // The person's own pictures still win over the example's gap.
    const own = composeTrendRun(trend(data), req({ slots: { lead: { images: [img("me")] }, friend: { images: [img("pal")] } } }))
    expect(own.display.slots[1]).toMatchObject({ images: [img("pal")], fromExample: false })
  })

  it("still refuses a required slot left empty when the example has pictures for it", () => {
    expect(codeOf(() => composeTrendRun(trend(), req({ slots: {} })))).toEqual({ code: "missing_slot", slot: "lead" })
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

  it("keeps a non-kind chip `invalid_choice` even when the slot hides chips", () => {
    const data = version()
    const lead = { ...data.slots[0]!, chips: [] } as TrendSlot
    const hiding = version({ slots: [lead, ...data.slots.slice(1)] })
    expect(codeOf(() => composeTrendRun(trend(hiding), req({ slots: { lead: { images: [img("me")], coat: "new" } } })))).toEqual({
      code: "invalid_choice",
      slot: "lead",
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

  it("sends every picture as its original file, never a CDN display rendition", () => {
    const shown = (path: string) => `https://cdn.nodaro.ai/cdn-cgi/image/width=1600,quality=80,format=auto/${path}`
    const file = (path: string) => `https://cdn.nodaro.ai/${path}`
    const data = version({
      references: [{ images: [shown("trends/cloud.png")], line: "the clouds in the opening dive" }],
      examples: [
        { videoUrl: img("ex1v"), width: 720, height: 1280, durationSec: 12, sourceJobId: "j1", slots: { lead: [img("ex1-lead")], friend: [shown("trends/friend.png")], place: [img("ex1-place")] } },
      ],
    })
    const { body, display } = composeTrendRun(trend(data), req({ slots: { lead: { images: [shown("community/listing-1/portrait.png"), img("me")] } } }))
    expect(body.roles.map((r) => (r as { images: string[] }).images)).toEqual([
      [file("community/listing-1/portrait.png"), img("me")],
      [file("trends/friend.png")],
      [img("ex1-place")],
    ])
    expect(body.references).toEqual([{ images: [file("trends/cloud.png")], line: "the clouds in the opening dive" }])
    expect(display.slots[0]!.images).toEqual([file("community/listing-1/portrait.png"), img("me")])
    expect(JSON.stringify(body)).not.toContain("/cdn-cgi/")
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

  it("names the whole source as what every run edits (sourceAsset full, its length, its hash once recorded)", () => {
    expect(composeTrendRun(trend(), req()).body.sourceAsset).toEqual({ kind: "full", durationSec: 12 })
    expect(composeTrendRun(trend(), req({ preview: true })).body.sourceAsset).toEqual({ kind: "full", durationSec: 12 })
    const hashed = version({ source: { videoUrl: "https://cdn.example.com/source.mp4", durationSec: 12, sha256: "a".repeat(64) } })
    expect(composeTrendRun(trend(hashed), req()).body.sourceAsset).toEqual({ kind: "full", sha256: "a".repeat(64), durationSec: 12 })
    // Never sent as composed: the wire flag is the engine-aware step's (withPreparedPreview).
    expect(composeTrendRun(trend(hashed), req({ preview: true })).body).not.toHaveProperty("preparedPreview")
  })
})

describe("composeTrendRun — the preview's prepared input clip (a candidate)", () => {
  const SOURCE = "https://cdn.example.com/source.mp4"
  const CLIP = {
    videoUrl: "https://cdn.example.com/trends/t-1/preview.mp4",
    durationSec: 5,
    width: 720,
    height: 1280,
    frames: 150,
    sha256: "b".repeat(64),
    sourceVideoUrl: SOURCE,
    startSec: 2,
    recipe: PREVIEW_CLIP_RECIPE,
    madeAt: "2026-10-27T10:00:00.000Z",
  }
  const MASKING = { mode: "always" as const, threshold: 0.4 }
  const MASK_URL = "https://cdn.example.com/trends/t-1/mask.mp4"
  const faceMaskOf = (d: TrendVersionData) => ({
    url: MASK_URL,
    frames: 360,
    recipe: { core: "2026-10-25", plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "fm-1",
    stats: { shots: 1, heldFrames: 0, coverage: 0.01, droppedRegions: 0 },
    approvedAt: "2026-10-25T10:00:00.000Z",
    approvedBy: "admin",
  })
  const CLIP_MASK = { url: "https://cdn.example.com/trends/t-1/preview-mask.mp4", frames: 150, sha256: "c".repeat(64), sourceMaskUrl: MASK_URL }

  it("a preview of a version with a current clip carries it; a full run, or no clip, carries none", () => {
    const d = version({ previewClip: CLIP })
    expect(composeTrendRun(trend(d), req({ preview: true })).preparedPreview).toEqual({ clip: CLIP })
    expect(composeTrendRun(trend(d), req())).not.toHaveProperty("preparedPreview")
    expect(composeTrendRun(trend(), req({ preview: true }))).not.toHaveProperty("preparedPreview")
  })

  it("the body is exactly today's either way: the whole source, the trend's previewStart, no wire flag", () => {
    const withClip = composeTrendRun(trend(version({ previewClip: CLIP })), req({ preview: true })).body
    const without = composeTrendRun(trend(), req({ preview: true })).body
    expect(withClip).toEqual(without)
    expect(withClip.videoUrl).toBe(SOURCE)
    expect(withClip.previewStart).toBe(2)
    expect(withClip).not.toHaveProperty("preparedPreview")
    expect(withClip.sourceAsset).toEqual({ kind: "full", durationSec: 12 })
  })

  it("an out-of-date clip is no candidate (moved window, another source, another recipe)", () => {
    const moved = version({ previewClip: { ...CLIP, startSec: 1 } })
    expect(composeTrendRun(trend(moved), req({ preview: true }))).not.toHaveProperty("preparedPreview")
    const other = version({ previewClip: { ...CLIP, sourceVideoUrl: "https://cdn.example.com/older.mp4" } })
    expect(composeTrendRun(trend(other), req({ preview: true }))).not.toHaveProperty("preparedPreview")
    const recipe = version({ previewClip: { ...CLIP, recipe: "0" } })
    expect(composeTrendRun(trend(recipe), req({ preview: true }))).not.toHaveProperty("preparedPreview")
  })

  it("a run sent the base stored mask needs the clip's own cut of it: with one it is a candidate, without one it is not", () => {
    const d = version({ faceMasking: MASKING })
    const faceMask = faceMaskOf(d)
    const withCut = { ...d, faceMask, previewClip: { ...CLIP, faceMask: CLIP_MASK } }
    const run = composeTrendRun(trend(withCut), req({ preview: true }))
    expect(run.body.storedFaceMask).toEqual({ url: MASK_URL, frames: 360 })
    expect(run.preparedPreview).toEqual({ clip: { ...CLIP, faceMask: CLIP_MASK } })
    // A clip cut before the mask was approved: out of date (preview-clip.ts), so no candidate.
    const noCut = { ...d, faceMask, previewClip: CLIP }
    const bare = composeTrendRun(trend(noCut), req({ preview: true }))
    expect(bare.body.storedFaceMask).toEqual({ url: MASK_URL, frames: 360 })
    expect(bare).not.toHaveProperty("preparedPreview")
  })

  it("a clip with a mask cut on a trend whose mask is out of date is no candidate either (the run masks per run)", () => {
    const d = version({ faceMasking: MASKING })
    const stale = { ...d, faceMasking: { ...MASKING, threshold: 0.6 }, faceMask: faceMaskOf(d), previewClip: { ...CLIP, faceMask: CLIP_MASK } }
    const run = composeTrendRun(trend(stale), req({ preview: true }))
    expect(run.body).not.toHaveProperty("storedFaceMask")
    expect(run).not.toHaveProperty("preparedPreview")
  })

  it("a run sent a per-person variant of the mask carries no candidate (the clip holds the base mask's cut only)", () => {
    // No examples, one marked optional person ("friend"), left empty: the run takes the variant for exactly them.
    const mark = { label: { slot: "friend" }, fromFrame: 0, toFrame: 100, leftPct: 50, topPct: 0, rightPct: 100, bottomPct: 50 }
    const d = version({ examples: [], faceMasking: { ...MASKING, marks: [mark] } })
    const faceMask = { ...faceMaskOf(d), rawMaskUrl: "https://cdn.example.com/trends/t-1/raw.mp4" }
    const withBase = { ...d, faceMask }
    const variantKey = faceMaskVariantKey(withBase, ["friend"])!
    const variants = [{ emptySlots: ["friend"], key: variantKey, url: "https://cdn.example.com/trends/t-1/v-friend.mp4", frames: 360, jobId: "v-1", stats: { coverage: 0.02, erasedRegions: 1 }, approvedAt: "2026-10-27T11:00:00.000Z" }]
    const data = { ...withBase, faceMask: { ...faceMask, variants }, previewClip: { ...CLIP, faceMask: CLIP_MASK } }

    const variantRun = composeTrendRun(trend(data), req({ preview: true }))
    expect(variantRun.body.storedFaceMask).toEqual({ url: "https://cdn.example.com/trends/t-1/v-friend.mp4", frames: 360, required: true })
    expect(variantRun).not.toHaveProperty("preparedPreview")

    // The same trend with the friend filled: the base mask, so the clip (with its cut) is a candidate.
    const baseRun = composeTrendRun(trend(data), req({ preview: true, slots: { lead: { images: [img("me")] }, friend: { images: [img("pal")] } } }))
    expect(baseRun.body.storedFaceMask).toEqual({ url: MASK_URL, frames: 360 })
    expect(baseRun.preparedPreview).toEqual({ clip: { ...CLIP, faceMask: CLIP_MASK } })
  })

  it("a variant that left nothing to cover runs unmasked, and the clip is still a candidate", () => {
    const mark = { label: { slot: "friend" }, fromFrame: 0, toFrame: 100, leftPct: 50, topPct: 0, rightPct: 100, bottomPct: 50 }
    const d = version({ examples: [], faceMasking: { ...MASKING, marks: [mark] } })
    const faceMask = { ...faceMaskOf(d), rawMaskUrl: "https://cdn.example.com/trends/t-1/raw.mp4" }
    const withBase = { ...d, faceMask }
    const variants = [{ emptySlots: ["friend"], key: faceMaskVariantKey(withBase, ["friend"])!, frames: 360, jobId: "v-1", stats: { coverage: 0, erasedRegions: 1 }, approvedAt: "2026-10-27T11:00:00.000Z" }]
    const data = { ...withBase, faceMask: { ...faceMask, variants }, previewClip: { ...CLIP, faceMask: CLIP_MASK } }
    const run = composeTrendRun(trend(data), req({ preview: true }))
    expect(run.body).not.toHaveProperty("storedFaceMask")
    expect(run.body).not.toHaveProperty("faceMasking")
    expect(run.preparedPreview).toEqual({ clip: { ...CLIP, faceMask: CLIP_MASK } })
  })

  it("a version with a preview clip validates, and the clip never reaches the display", () => {
    const d = version({ previewClip: CLIP })
    expect(trendVersionDataSchema.safeParse(d).success).toBe(true)
    const { display, body } = composeTrendRun(trend(d), req({ preview: true }))
    expect(JSON.stringify(display)).not.toContain("preview.mp4")
    expect(JSON.stringify(body.trendRun)).not.toContain("preview.mp4")
  })
})

describe("composeTrendRun — engine", () => {
  const kling = () => trend(version({ engine: "kling-4" }))

  it("sends no engine for a version that names none, so the body is as it always was", () => {
    const { body, needs } = composeTrendRun(trend(), req())
    expect(body).not.toHaveProperty("engine")
    expect(needs.engine).toBe("seedance-2-5")
  })

  it("sends no engine for a Seedance 2.5 version either", () => {
    const { body } = composeTrendRun(trend(version({ engine: "seedance-2-5" })), req())
    expect(body).not.toHaveProperty("engine")
    expect(body).toMatchObject({ resolution: "480p", draft: true })
  })

  it("sends Kling 4 at 720p, with no draft, by default", () => {
    const { body, needs } = composeTrendRun(kling(), req())
    expect(body).toMatchObject({ engine: "kling-4", resolution: "720p", draft: false })
    expect(needs.engine).toBe("kling-4")
  })

  it("sends Kling 4 at 1080p when asked, and a 4 s preview from the trend's start", () => {
    expect(composeTrendRun(kling(), req({ resolution: "1080p" })).body).toMatchObject({ engine: "kling-4", resolution: "1080p", draft: false })
    expect(composeTrendRun(kling(), req({ preview: true })).body).toMatchObject({ preview: true, previewStart: 2, resolution: "720p", draft: false })
  })

  it("takes draft: false on Kling 4 (there is no draft to turn off)", () => {
    expect(composeTrendRun(kling(), req({ draft: false })).body).toMatchObject({ resolution: "720p", draft: false })
  })

  it("sends the trend's klingLength on Kling 4 only, and none when the trend sets none (cut-end)", () => {
    expect(composeTrendRun(kling(), req()).body).not.toHaveProperty("klingLength")
    expect(composeTrendRun(trend(version({ engine: "kling-4", klingLength: "cut-start" })), req()).body).toMatchObject({ klingLength: "cut-start" })
    expect(composeTrendRun(trend(version({ engine: "kling-4", klingLength: "cut-start" })), req({ preview: true })).body).toMatchObject({ klingLength: "cut-start" })
    expect(composeTrendRun(trend(version({ klingLength: "cut-start" })), req()).body).not.toHaveProperty("klingLength")
  })

  it("sends pulseAudio: generated on Kling 4 only when the trend asks for Kling's audio, and no key for the original audio (the default)", () => {
    expect(composeTrendRun(kling(), req()).body).not.toHaveProperty("pulseAudio")
    expect(composeTrendRun(trend(version({ engine: "kling-4", pulseAudio: "original" })), req()).body).not.toHaveProperty("pulseAudio")
    expect(composeTrendRun(trend(version({ engine: "kling-4", pulseAudio: "generated" })), req()).body).toMatchObject({ pulseAudio: "generated" })
    expect(composeTrendRun(trend(version({ engine: "kling-4", pulseAudio: "generated" })), req({ preview: true })).body).toMatchObject({ pulseAudio: "generated" })
    // Seedance never gets it.
    expect(composeTrendRun(trend(version({ pulseAudio: "generated" })), req()).body).not.toHaveProperty("pulseAudio")
  })

  it("refuses a Kling 4 run that would send more than 10 pictures, as the route counts them", () => {
    // version(): lead and friend (people: one prepared picture each), place (a location: its own), and a reference of 2.
    const three = [img("a"), img("b"), img("c")]
    const slots = { lead: { images: three }, friend: { images: three }, place: { images: three } }
    const refs = (n: number) => [{ images: Array.from({ length: n }, (_, i) => img(`r${i}`)), line: "the sign" }]
    // 1 + 1 + 3 + 5 = 10: the most.
    expect(composeTrendRun(trend(version({ engine: "kling-4", references: refs(5) })), { slots }).body).toMatchObject({ engine: "kling-4" })
    // 1 + 1 + 3 + 6 = 11.
    expect(codeOf(() => composeTrendRun(trend(version({ engine: "kling-4", references: refs(6) })), { slots })).code).toBe("too_many_images")
    // Seedance 2.5 keeps its own 30.
    expect(composeTrendRun(trend(version({ references: refs(6) })), { slots }).body).not.toHaveProperty("engine")
  })

  it("refuses a draft on Kling 4, at any resolution", () => {
    expect(codeOf(() => composeTrendRun(kling(), req({ draft: true }))).code).toBe("draft_unsupported")
    expect(codeOf(() => composeTrendRun(kling(), req({ draft: true, resolution: "480p" }))).code).toBe("draft_unsupported")
  })

  it("refuses 480p on Kling 4", () => {
    expect(codeOf(() => composeTrendRun(kling(), req({ resolution: "480p" }))).code).toBe("resolution_unsupported")
    expect(codeOf(() => composeTrendRun(kling(), req({ resolution: "480p", draft: false }))).code).toBe("resolution_unsupported")
  })

  it("refuses draft above 480p by the trend's engine: Kling 4 draft_unsupported, Seedance 2.5 validation_error", () => {
    expect(trendRunRequestSchema.safeParse({ slots: {}, draft: true, resolution: "720p" }).success).toBe(true)
    expect(codeOf(() => composeTrendRun(kling(), req({ draft: true, resolution: "720p" }))).code).toBe("draft_unsupported")
    expect(codeOf(() => composeTrendRun(trend(), req({ draft: true, resolution: "1080p" }))).code).toBe("validation_error")
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
    expect(composeTrendRun(trend(), req()).needs).toEqual({
      roleKinds: new Set(["person", "location"]),
      fixedReferences: true,
      faceMasking: false,
      faceMaskTarget: null,
      faceMaskSource: null,
      storedFaceMask: false,
      trendPrePrompt: false,
      engine: "seedance-2-5",
    })
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

describe("composeTrendRun — face masking and pre prompt", () => {
  const AUTO = { mode: "auto" as const, fill: "depth" as const, minFaceHeightPct: 10, zone: { topPct: 5 }, threshold: 0.4 }

  it("leaves the body exactly as today when the trend has neither, or masking is off", () => {
    const today = composeTrendRun(trend(), req()).body
    expect(Object.keys(today)).not.toContain("faceMasking")
    expect(Object.keys(today)).not.toContain("prePrompt")
    const off = composeTrendRun(trend(version({ faceMasking: { mode: "off", fill: "depth" } })), req())
    expect(off.body).toEqual(today)
    expect(off.needs.faceMasking).toBe(false)
  })

  it("passes the trend's masking and pre prompt at the top level of the body", () => {
    const { body, needs } = composeTrendRun(trend(version({ faceMasking: AUTO, prePrompt: "HIDDEN pre words" })), req())
    expect(body.faceMasking).toEqual(AUTO)
    expect(body.faceMasking).not.toBe(AUTO)
    expect(body.prePrompt).toBe("HIDDEN pre words")
    expect(needs.faceMasking).toBe(true)
    expect(needs.trendPrePrompt).toBe(true)
    // The pre prompt is its own field, never folded into the post prompt.
    expect(body.postPrompt).toBe("Keep the camera shake.")
  })

  it("sends a pre prompt without masking, and masking without a pre prompt", () => {
    const a = composeTrendRun(trend(version({ prePrompt: "only words" })), req())
    expect(a.body.prePrompt).toBe("only words")
    expect(a.needs).toMatchObject({ trendPrePrompt: true, faceMasking: false })
    expect(composeTrendRun(trend(version({ prePrompt: "" })), req()).needs.trendPrePrompt).toBe(false)
    expect(a.body).not.toHaveProperty("faceMasking")
    const b = composeTrendRun(trend(version({ faceMasking: { mode: "always" } })), req())
    expect(b.body.faceMasking).toEqual({ mode: "always", zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } })
    expect(b.body).not.toHaveProperty("prePrompt")
  })

  it("sends the default margins (10 % left and right) for a zone left out; null or all 0 stays no margins", () => {
    const NONE = { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 }
    const zoneOf = (faceMasking: TrendVersionData["faceMasking"]) => composeTrendRun(trend(version({ faceMasking })), req()).body.faceMasking?.zone
    expect(zoneOf({ mode: "auto" })).toEqual({ leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 })
    expect(zoneOf({ mode: "always", fill: "depth" })).toEqual({ leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 })
    // Off: null is sent as all four margins 0, which every engine reads as no margins.
    expect(zoneOf({ mode: "auto", zone: null })).toEqual(NONE)
    expect(zoneOf({ mode: "auto", zone: NONE })).toEqual(NONE)
    // A zone given is sent as it is (a margin it leaves out is the engine's 0).
    expect(zoneOf({ mode: "auto", zone: { topPct: 5 } })).toEqual({ topPct: 5 })
    // The preview of the same trend sends the same margins as its full run.
    const preview = composeTrendRun(trend(version({ faceMasking: { mode: "auto" } })), req({ preview: true })).body
    expect(preview.faceMasking?.zone).toEqual({ leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 })
  })

  it("passes the target through as the trend stores it, and needs what the masks cover (left out = the head)", () => {
    const face = composeTrendRun(trend(version({ faceMasking: { mode: "always", target: "face" } })), req())
    expect(face.body.faceMasking).toMatchObject({ mode: "always", target: "face" })
    expect(face.needs.faceMaskTarget).toBe("face")
    const head = composeTrendRun(trend(version({ faceMasking: { mode: "auto", target: "head" } })), req())
    expect(head.body.faceMasking).toMatchObject({ target: "head" })
    expect(head.needs.faceMaskTarget).toBe("head")
    const leftOut = composeTrendRun(trend(version({ faceMasking: { mode: "auto" } })), req())
    expect(leftOut.body.faceMasking).not.toHaveProperty("target")
    expect(leftOut.needs.faceMaskTarget).toBe("head")
    expect(composeTrendRun(trend(version({ faceMasking: { mode: "off", target: "face" } })), req()).needs.faceMaskTarget).toBeNull()
  })

  it("never writes the default zone into the trend's own setting", () => {
    const masking = { mode: "auto" as const }
    composeTrendRun(trend(version({ faceMasking: masking })), req())
    expect(masking).not.toHaveProperty("zone")
  })

  it("keeps both out of the display", () => {
    const { body, display } = composeTrendRun(trend(version({ faceMasking: AUTO, prePrompt: "HIDDEN pre words" })), req())
    for (const d of [display, body.trendRun.display]) {
      expect(d).not.toHaveProperty("faceMasking")
      expect(d).not.toHaveProperty("prePrompt")
      expect(JSON.stringify(d)).not.toContain("HIDDEN pre words")
      expect(JSON.stringify(d)).not.toContain("depth")
    }
  })

  it("never forwards the request's previewJobId", () => {
    const { body } = composeTrendRun(
      trend(version({ faceMasking: AUTO })),
      req({ previewJobId: "00000000-0000-4000-8000-0000000000f1" }),
    )
    expect(JSON.stringify(body)).not.toContain("previewJobId")
  })
})

describe("composeTrendRun — chips shown to the person", () => {
  // The lead shows only its outfit: body (default "original") and hair
  // (default "original") are fixed; the friend shows only hair, so its body
  // and outfit (no default) are fixed at "new".
  function hiding(): TrendVersionData {
    const data = version()
    const [lead, friend, place] = data.slots as [TrendSlot, TrendSlot, TrendSlot]
    return version({
      slots: [{ ...lead, chips: ["outfit"] } as TrendSlot, { ...friend, chips: ["hair"] } as TrendSlot, place],
    })
  }
  const roleChips = (body: { roles: unknown[] }, i: number) => {
    const { body: b, outfit, hair } = body.roles[i] as Record<string, unknown>
    return { body: b, outfit, hair }
  }

  it("refuses a chip the slot hides, naming the slot and the chip", () => {
    expect(codeOf(() => composeTrendRun(trend(hiding()), req({ slots: { lead: { images: [img("me")], hair: "new" } } })))).toEqual({
      code: "chip_not_offered",
      slot: "lead",
      chip: "hair",
    })
    expect(codeOf(() => composeTrendRun(trend(hiding()), req({ slots: { lead: { images: [img("me")] }, friend: { body: "original" } } })))).toEqual({
      code: "chip_not_offered",
      slot: "friend",
      chip: "body",
    })
  })

  it("refuses a hidden chip even when it sends the fixed value", () => {
    expect(codeOf(() => composeTrendRun(trend(hiding()), req({ slots: { lead: { images: [img("me")], body: "original" } } }))).code).toBe(
      "chip_not_offered",
    )
  })

  it("refuses every chip of a slot that shows none", () => {
    const data = version()
    const lead = { ...data.slots[0]!, chips: [] } as TrendSlot
    const none = version({ slots: [lead, ...data.slots.slice(1)] })
    expect(codeOf(() => composeTrendRun(trend(none), req({ slots: { lead: { images: [img("me")], outfit: "new" } } })))).toEqual({
      code: "chip_not_offered",
      slot: "lead",
      chip: "outfit",
    })
  })

  it("takes a shown chip from the request and fixes the hidden ones at the slot's value, else new", () => {
    const { body } = composeTrendRun(
      trend(hiding()),
      req({ slots: { lead: { images: [img("me")], outfit: "original" }, friend: { images: [img("you")], hair: "original" } } }),
    )
    expect(roleChips(body, 0)).toEqual({ body: "original", outfit: "original", hair: "original" })
    expect(roleChips(body, 1)).toEqual({ body: "new", outfit: "new", hair: "original" })
    expect(body.trendRun.display.slots[0]).toMatchObject({ body: "original", outfit: "original", hair: "original" })
  })

  it("an admin test run sets any chip, hidden ones included", () => {
    const { body } = composeTrendRun(
      trend(hiding()),
      req({ slots: { lead: { images: [img("me")], body: "new", hair: "new" }, friend: { images: [img("you")], outfit: "original" } } }),
      { allowHiddenChips: true },
    )
    expect(roleChips(body, 0)).toEqual({ body: "new", outfit: "new", hair: "new" })
    expect(roleChips(body, 1)).toEqual({ body: "new", outfit: "original", hair: "new" })
  })

  it("an admin test run still refuses a chip that is not the kind's own", () => {
    expect(
      codeOf(() => composeTrendRun(trend(hiding()), req({ slots: { lead: { images: [img("me")], coat: "new" } } }), { allowHiddenChips: true })).code,
    ).toBe("invalid_choice")
  })

  it("a slot without `chips` shows them all: every chip of its kind may be sent", () => {
    const { body } = composeTrendRun(trend(), req({ slots: { lead: { images: [img("me")], body: "new", outfit: "original", hair: "new" } } }))
    expect(roleChips(body, 0)).toEqual({ body: "new", outfit: "original", hair: "new" })
  })
})

describe("composeTrendRun — the stored face mask", () => {
  const MASKING = { mode: "always" as const, threshold: 0.4 }
  const data = version({ faceMasking: MASKING })
  const faceMask = {
    url: "https://cdn.example.com/trends/t-1/mask.mp4",
    frames: 360,
    recipe: { core: "2026-10-25", plugin: "1" },
    settingsKey: faceMaskSettingsKey(data)!,
    jobId: "fm-1",
    stats: { shots: 1, heldFrames: 0, coverage: 0.01, droppedRegions: 0 },
    approvedAt: "2026-10-25T10:00:00.000Z",
    approvedBy: "admin",
  }

  it("sends it beside the masking when it was made from these settings", () => {
    const { body } = composeTrendRun(trend({ ...data, faceMask }), req())
    expect(body.storedFaceMask).toEqual({ url: faceMask.url, frames: 360 })
    expect(body.faceMasking).toEqual(withResolvedZone(MASKING))
    // A preview cuts it like the source: the same stored mask.
    expect(composeTrendRun(trend({ ...data, faceMask }), req({ preview: true })).body.storedFaceMask).toEqual({ url: faceMask.url, frames: 360 })
  })

  it("leaves it out when it is out of date or the trend no longer masks (the run masks per run)", () => {
    const changed = composeTrendRun(trend({ ...data, faceMasking: { ...MASKING, threshold: 0.6 }, faceMask }), req()).body
    expect(changed).not.toHaveProperty("storedFaceMask")
    expect(changed.faceMasking).toMatchObject({ threshold: 0.6 })
    const off = composeTrendRun(trend({ ...data, faceMasking: { mode: "off" }, faceMask }), req()).body
    expect(off).not.toHaveProperty("storedFaceMask")
    expect(off).not.toHaveProperty("faceMasking")
  })

  it("a version with a stored mask still validates", () => {
    expect(trendVersionDataSchema.safeParse({ ...data, faceMask }).success).toBe(true)
    expect(trendVersionDataSchema.safeParse({ ...data, faceMask: { ...faceMask, extra: 1 } }).success).toBe(false)
  })

  describe("with marks", () => {
    const MARK = { label: "erased" as const, fromFrame: 0, toFrame: 100, leftPct: 50, topPct: 0, rightPct: 100, bottomPct: 50 }
    const marked = version({ faceMasking: { ...MASKING, marks: [MARK] } })
    const markedMask = { ...faceMask, settingsKey: faceMaskSettingsKey(marked)! }

    it("runs on the approved mask made with them, and never sends the marks", () => {
      for (const r of [req(), req({ preview: true })]) {
        const { body, needs } = composeTrendRun(trend({ ...marked, faceMask: markedMask }), r)
        // The engine must take a stored mask (engineSupports): never masked per run.
        expect(needs.storedFaceMask).toBe(true)
        // Required: an engine that honours it fails the run rather than masking per run.
        expect(body.storedFaceMask).toEqual({ url: faceMask.url, frames: 360, required: true })
        expect(body.faceMasking).toEqual(withResolvedZone(MASKING))
        expect(body.faceMasking).not.toHaveProperty("marks")
      }
    })

    it("refuses the run (face_mask_required) with no approved mask, or one made without these marks", () => {
      expect(codeOf(() => composeTrendRun(trend(marked), req()))).toMatchObject({ code: "face_mask_required" })
      // The mask approved before the marks were added: masking per run would cover the faces they leave out.
      expect(codeOf(() => composeTrendRun(trend({ ...marked, faceMask }), req()))).toMatchObject({ code: "face_mask_required" })
    })

    it("a trend without marks sends its stored mask as before (not required)", () => {
      expect(composeTrendRun(trend({ ...data, faceMask }), req()).body.storedFaceMask).toEqual({ url: faceMask.url, frames: 360 })
    })

    it("empty marks run as before marks existed (per run when no mask matches)", () => {
      const { body } = composeTrendRun(trend(version({ faceMasking: { ...MASKING, marks: [] } })), req())
      expect(body).not.toHaveProperty("storedFaceMask")
      expect(body.faceMasking).toEqual(withResolvedZone(MASKING))
    })

    it("a version with marks validates; a mark with another label, a stray key or more than 50 does not", () => {
      expect(trendVersionDataSchema.safeParse(marked).success).toBe(true)
      const bad = (marks: unknown) => trendVersionDataSchema.safeParse({ ...marked, faceMasking: { ...MASKING, marks } }).success
      expect(bad([{ ...MARK, label: "keep" }])).toBe(false)
      expect(bad([{ ...MARK, extra: 1 }])).toBe(false)
      expect(bad([{ ...MARK, topPct: 60 }])).toBe(false)
      expect(bad(Array.from({ length: 51 }, () => MARK))).toBe(false)
      expect(bad(Array.from({ length: 50 }, () => MARK))).toBe(true)
    })
  })
})

describe("composeTrendRun — the 4 s preview's own prompt parts", () => {
  /** Every prompt part worded differently for the preview. */
  const PREVIEW = version({
    slots: [
      { ...version().slots[0]!, previewRoleName: "PREVIEW the woman" },
      { ...version().slots[1]!, previewRoleName: "PREVIEW the man" },
      version().slots[2]!,
    ] as TrendSlot[],
    references: [{ images: [img("cloud1"), img("cloud2")], line: "the clouds in the opening dive", previewLine: "PREVIEW the clouds" }],
    prePrompt: "FULL pre words",
    trendPrompt: "FULL trend words",
    previewPrePrompt: "PREVIEW pre words",
    previewTrendPrompt: "PREVIEW trend words",
  })
  const names = (body: { roles: unknown[] }) => body.roles.map((r) => (r as { name: string }).name)

  it("a preview run sends each preview part: role names, reference lines, pre and trend prompts", () => {
    const { body, needs } = composeTrendRun(trend(PREVIEW), req({ preview: true, details: "with a hat" }))
    expect(names(body)).toEqual(["PREVIEW the woman", "PREVIEW the man", "the dance floor"])
    expect(body.references).toEqual([{ images: [img("cloud1"), img("cloud2")], line: "PREVIEW the clouds" }])
    expect(body.prePrompt).toBe("PREVIEW pre words")
    expect(body.postPrompt).toBe("PREVIEW trend words\n\nwith a hat")
    expect(needs.trendPrePrompt).toBe(true)
  })

  it("a full run sends the full run's parts only", () => {
    const { body } = composeTrendRun(trend(PREVIEW), req({ details: "with a hat" }))
    expect(names(body)).toEqual(["the woman on the left", "the man on the right", "the dance floor"])
    expect(body.references[0]!.line).toBe("the clouds in the opening dive")
    expect(body.prePrompt).toBe("FULL pre words")
    expect(body.postPrompt).toBe("FULL trend words\n\nwith a hat")
    expect(JSON.stringify(body)).not.toContain("PREVIEW")
  })

  it("a full run that follows a preview sends the full run's parts too", () => {
    const { body } = composeTrendRun(trend(PREVIEW), req({ previewJobId: "00000000-0000-4000-8000-000000000099", resolution: "1080p" }))
    expect(body.preview).toBe(false)
    expect(JSON.stringify(body)).not.toContain("PREVIEW")
    expect(body.prePrompt).toBe("FULL pre words")
  })

  it("each preview part left empty (or blank) falls back to the full run's, one by one", () => {
    const partly = version({
      ...PREVIEW,
      slots: [{ ...PREVIEW.slots[0]!, previewRoleName: "  " }, PREVIEW.slots[1]!, PREVIEW.slots[2]!] as TrendSlot[],
      references: [{ ...PREVIEW.references[0]!, previewLine: "" }],
      previewPrePrompt: "",
    })
    const { body } = composeTrendRun(trend(partly), req({ preview: true }))
    expect(names(body)).toEqual(["the woman on the left", "PREVIEW the man", "the dance floor"])
    expect(body.references[0]!.line).toBe("the clouds in the opening dive")
    expect(body.prePrompt).toBe("FULL pre words")
    expect(body.postPrompt).toBe("PREVIEW trend words")
  })

  it("a trend with no preview parts sends a preview exactly as before", () => {
    const plain = version({ prePrompt: "FULL pre words" })
    const before = composeTrendRun(trend(plain), req({ preview: true })).body
    const empty = version({
      prePrompt: "FULL pre words",
      previewPrePrompt: "",
      previewTrendPrompt: "",
      slots: plain.slots.map((s) => ({ ...s, previewRoleName: "" })) as TrendSlot[],
      references: plain.references.map((r) => ({ ...r, previewLine: "" })),
    })
    expect(composeTrendRun(trend(empty), req({ preview: true })).body).toEqual(before)
  })

  it("a pre prompt only the preview has is sent by a preview alone, and needs trendPrePrompt there", () => {
    const onlyPreview = version({ previewPrePrompt: "PREVIEW pre words" })
    const preview = composeTrendRun(trend(onlyPreview), req({ preview: true }))
    expect(preview.body.prePrompt).toBe("PREVIEW pre words")
    expect(preview.needs.trendPrePrompt).toBe(true)
    const full = composeTrendRun(trend(onlyPreview), req())
    expect(full.body).not.toHaveProperty("prePrompt")
    expect(full.needs.trendPrePrompt).toBe(false)
  })

  it("holds the preview's trend prompt and the details to the post prompt cap", () => {
    const long = version({ trendPrompt: "short", previewTrendPrompt: "t".repeat(3000) })
    expect(composeTrendRun(trend(long), req({ details: "d".repeat(999) })).body.postPrompt).toContain("short")
    expect(codeOf(() => composeTrendRun(trend(long), req({ preview: true, details: "d".repeat(999) }))).code).toBe("prompt_too_long")
  })

  it("never puts a preview part in the public display", () => {
    const { display, body } = composeTrendRun(trend(PREVIEW), req({ preview: true }))
    expect(JSON.stringify(display)).not.toContain("PREVIEW")
    expect(JSON.stringify(body.trendRun)).not.toContain("PREVIEW")
  })

  it("the preview parts validate with their full ones' limits, empty allowed", () => {
    expect(trendVersionDataSchema.safeParse(PREVIEW).success).toBe(true)
    const empty = { ...PREVIEW, previewPrePrompt: "", previewTrendPrompt: "", slots: PREVIEW.slots.map((s) => ({ ...s, previewRoleName: "" })) }
    expect(trendVersionDataSchema.safeParse(empty).success).toBe(true)
  })
})
