import { describe, it, expect } from "vitest"
import type { Caption } from "@remotion/captions"
import {
  resolveCaptionSegments,
  findSegmentOverlap,
  captionsNeedWordTimings,
  captionRenderFps,
  captionRenderFpsWithinFrameCap,
  isStaticTextCaptionSource,
  staticTextCaptionBlock,
  splitCaptionsAcrossWindows,
  dropNullCaptionLevers,
  explicitLevers,
  MIN_CLIPPED_PHRASE_MS,
  type CaptionStyleDefaults,
} from "../caption-segments.js"
import { transcribeSegmentsToCaptions } from "../../audio/captions-mappers.js"
import { burnCaptionsPlanSchema, BURN_CAPTIONS_MAX_FRAMES } from "../../../lib/plan-schemas.js"

// Top-level defaults a segment inherits when it omits a field. `look: "clean"`
// + a distinctive top-level explicit lever (`highlightColor`) lets the cascade
// tests below tell "inherited the top-level explicit" from "started fresh".
const DEFAULTS: CaptionStyleDefaults = {
  style: "word-pop",
  position: "bottom",
  fontSize: 32,
  look: "clean",
  // color + backgroundColor are BASE fields (always inherit); highlightColor is a
  // LOOK lever (resets when a segment names its own look).
  explicit: { color: "#ffffff", backgroundColor: "#101010", highlightColor: "#00ff00" },
}

function cap(text: string, startMs: number, endMs: number): Caption {
  return { text, startMs, endMs, timestampMs: startMs, confidence: null }
}

const SHARED: Caption[] = [
  cap("same", 0, 500),
  cap("face", 500, 1000),
  cap("studio", 4000, 4500),
  cap("drift", 8000, 8500),
]

describe("resolveCaptionSegments — words", () => {
  it("filters the shared transcript to each segment's time range (kinetic → per-word)", () => {
    const [intro, body] = resolveCaptionSegments(
      SHARED,
      [
        { startMs: 0, endMs: 3000 },
        { startMs: 3000, endMs: 9000 },
      ],
      DEFAULTS,
    )
    expect(intro!.captions.map((c) => c.text)).toEqual(["same", "face"])
    expect(body!.captions.map((c) => c.text)).toEqual(["studio", "drift"])
  })

  it("M1: a SUBTITLE segment joins the shared range into ONE phrase block spanning its range", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, style: "subtitle" }],
      DEFAULTS,
    )
    // One caption, not per-word — the static/subtitle read is a whole phrase.
    expect(seg!.captions).toHaveLength(1)
    expect(seg!.captions[0]!.text).toBe("same face")
    expect(seg!.captions[0]!.startMs).toBe(0)
    expect(seg!.captions[0]!.endMs).toBe(3000)
  })

  it("uses a segment's own text: kinetic synthesises per-word across its range", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, text: "Same face, every shot." }],
      DEFAULTS,
    )
    expect(seg!.captions.map((c) => c.text.trim())).toEqual(["Same", "face,", "every", "shot."])
    expect(seg!.captions[0]!.startMs).toBe(0)
    expect(seg!.captions[seg!.captions.length - 1]!.endMs).toBe(3000)
  })

  it("M1: a SUBTITLE segment's own text is ONE block (not per-word) spanning its range", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, style: "subtitle", text: "  Same face, every shot.  " }],
      DEFAULTS,
    )
    expect(seg!.captions).toHaveLength(1)
    expect(seg!.captions[0]!.text).toBe("Same face, every shot.") // trimmed
    expect(seg!.captions[0]!.startMs).toBe(0)
    expect(seg!.captions[0]!.endMs).toBe(3000)
  })

  it("uses a segment's own captions[] (over the shared transcript) when provided", () => {
    const own = [cap("HOOK", 100, 900)]
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, captions: own }], DEFAULTS)
    expect(seg!.captions).toEqual(own)
  })

  it("drops a segment's own words that START outside its range (a held line must not leak them in)", () => {
    // Absolute-ms captions handed to segment B [5000, 10000): "Intro"/"title"
    // belong to the previous range. The line-based overlays hold a line through
    // gaps, so left in the list they would show at 5000 as a held/straddling line.
    const own = [cap("Intro", 4000, 4400), cap("title", 4500, 4800), cap("body", 5300, 5600), cap("starts", 5600, 6000)]
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 5000, endMs: 10000, captions: own }], DEFAULTS)
    expect(seg!.captions.map((c) => c.text)).toEqual(["body", "starts"])
    // A word that starts inside and ends outside stays with the segment it started in.
    const [edge] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, captions: [cap("mid", 2800, 3200)] }], DEFAULTS)
    expect(edge!.captions.map((c) => c.text)).toEqual(["mid"])
  })

  it("assigns a straddling shared word to the ONE segment its start falls in (no mid-word style jump)", () => {
    const straddle = [cap("mid", 2800, 3200)] // starts in A, ends in B
    const [a, b] = resolveCaptionSegments(
      straddle,
      [
        { startMs: 0, endMs: 3000 },
        { startMs: 3000, endMs: 6000 },
      ],
      DEFAULTS,
    )
    expect(a!.captions.map((c) => c.text)).toEqual(["mid"])
    expect(b!.captions.map((c) => c.text)).toEqual([])
  })
})

describe("resolveCaptionSegments — look cascade", () => {
  it("style/placement: segment override wins, otherwise inherits the top-level default", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96 }],
      DEFAULTS,
    )
    expect(seg!.style).toBe("subtitle")
    expect(seg!.position).toBe("top")
    expect(seg!.fontSize).toBe(96)
  })

  it("a segment WITHOUT its own look inherits the top-level look AND the top-level explicit levers", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000 }], DEFAULTS)
    // Inherited look = clean (Inter) + inherited top-level explicit highlightColor.
    expect(seg!.fontFamily).toBe("Inter")
    expect(seg!.highlightColor).toBe("#00ff00")
    expect(seg!.color).toBe("#ffffff")
  })

  it("a segment's OWN explicit lever wins over the inherited TOP-LEVEL explicit lever (precedence, not merge)", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      // highlightColor is ALSO set on the top-level defaults (#00ff00); the
      // segment's own value must win — a swapped spread would leak #00ff00.
      [{ startMs: 0, endMs: 3000, uppercase: true, strokeColor: "#123456", strokeWidth: 8, highlightColor: "#ff00ff" }],
      DEFAULTS,
    )
    expect(seg!.uppercase).toBe(true)
    expect(seg!.strokeColor).toBe("#123456")
    expect(seg!.strokeWidth).toBe(8)
    expect(seg!.highlightColor).toBe("#ff00ff") // segment's own, not the top-level #00ff00
  })

  it("FOOTGUN: a segment that names its OWN look resets the LOOK levers — it does NOT inherit the top-level ones", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, look: "outline" }], DEFAULTS)
    // outline's own highlight (#FFE600), NOT the top-level explicit #00ff00.
    expect(seg!.highlightColor).toBe("#FFE600")
    expect(seg!.fontFamily).toBe("Montserrat")
    expect(seg!.uppercase).toBe(true)
    expect(seg!.strokeColor).toBe("#000000")
  })

  it("BUT base fields (color / backgroundColor) still inherit through a segment's own look", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, look: "outline" }], DEFAULTS)
    // color/backgroundColor are base caption fields, not look levers — they carry
    // the top-level value even when the segment picks its own look.
    expect(seg!.backgroundColor).toBe("#101010")
    // outline sets color:#ffffff, and the top-level base is also #ffffff; assert a
    // DISTINCT top-level base survives too.
    const [seg2] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, look: "outline" }], {
      ...DEFAULTS,
      explicit: { color: "#abcdef", backgroundColor: "#101010" },
    })
    expect(seg2!.color).toBe("#abcdef") // inherited base beats outline's own #ffffff
    expect(seg2!.backgroundColor).toBe("#101010")
  })

  it("a segment with its OWN look still applies its OWN explicit override on top of that look", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, look: "outline", highlightColor: "#ff00ff" }],
      DEFAULTS,
    )
    expect(seg!.highlightColor).toBe("#ff00ff") // own explicit wins over own look
    expect(seg!.fontFamily).toBe("Montserrat") // rest still from outline
  })
})

describe("resolveCaptionSegments — animate inheritance (seg.animate ?? defaults.animate)", () => {
  const animateDefaults = (animate?: boolean): CaptionStyleDefaults => ({ ...DEFAULTS, animate })

  it("a segment WITHOUT its own animate inherits the top-level default (true)", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000 }], animateDefaults(true))
    expect(seg!.animate).toBe(true)
  })
  it("a segment WITHOUT its own animate inherits the top-level default (false)", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000 }], animateDefaults(false))
    expect(seg!.animate).toBe(false)
  })
  it("a segment's OWN animate:false wins over a top-level default of true", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, animate: false }], animateDefaults(true))
    expect(seg!.animate).toBe(false)
  })
  it("a segment's OWN animate:true wins over a top-level default of false", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, animate: true }], animateDefaults(false))
    expect(seg!.animate).toBe(true)
  })
  it("stays undefined when neither the segment nor the top level sets it (?? does not invent a value)", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000 }], animateDefaults(undefined))
    expect(seg!.animate).toBeUndefined()
  })

  it("a resolved segment's animate:false survives the render-plan schema (the lever is not stripped)", () => {
    // Zod strips unknown keys silently — if burnCaptionsSegmentSchema lacked `animate`,
    // the resolver could carry it while the plan quietly dropped it and the render
    // lost the lever. Parse a resolved segment through the plan and assert it lands.
    const segments = resolveCaptionSegments([], [{ startMs: 0, endMs: 3000, text: "Hello there.", animate: false }], animateDefaults(true))
    expect(segments[0]!.animate).toBe(false)
    const plan = {
      planType: "burn-captions" as const,
      sourceVideo: "https://example.com/v.mp4",
      captions: [] as Caption[],
      style: "word-pop" as const,
      position: "bottom" as const,
      fontSize: 32,
      color: "#ffffff",
      segments,
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 90,
    }
    const parsed = burnCaptionsPlanSchema.safeParse(plan)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.segments?.[0]?.animate).toBe(false)
  })
})

describe("resolveCaptionSegments — placement", () => {
  // positionY overrides position at render, so an INHERITED positionY must not
  // beat a placement the segment asked for itself.
  const withY: CaptionStyleDefaults = { ...DEFAULTS, positionY: 85 }

  it("a segment that names its own position does NOT inherit the top-level positionY", () => {
    const [intro] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, position: "top" }], withY)
    expect(intro!.position).toBe("top")
    expect(intro!.positionY).toBeUndefined()
  })
  it("a segment with no placement of its own inherits both", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000 }], withY)
    expect(seg!.position).toBe("bottom")
    expect(seg!.positionY).toBe(85)
  })
  it("a segment's own positionY always wins", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, position: "top", positionY: 40 }], withY)
    expect(seg!.positionY).toBe(40)
  })
})

describe("resolveCaptionSegments — plan contract", () => {
  it("resolved segments validate against the render plan schema (resolver ↔ plan contract)", () => {
    const segments = resolveCaptionSegments(
      SHARED,
      [
        { startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96, look: "outline", text: "Same face." },
        { startMs: 3000, endMs: 9000, style: "word-pop", position: "bottom", fontSize: 48 },
      ],
      DEFAULTS,
    )
    const plan = {
      planType: "burn-captions" as const,
      sourceVideo: "https://example.com/v.mp4",
      captions: SHARED,
      style: "word-pop" as const,
      position: "bottom" as const,
      fontSize: 32,
      color: "#ffffff",
      segments,
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 300,
    }
    expect(burnCaptionsPlanSchema.safeParse(plan).success).toBe(true)
  })

  it("plan allows EMPTY top-level captions when segments carry the words (no post-reservation render fail)", () => {
    const segments = resolveCaptionSegments([], [{ startMs: 0, endMs: 3000, text: "Hello there." }], DEFAULTS)
    const base = {
      planType: "burn-captions" as const,
      sourceVideo: "https://example.com/v.mp4",
      style: "word-pop" as const,
      position: "bottom" as const,
      fontSize: 32,
      color: "#ffffff",
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 90,
    }
    expect(burnCaptionsPlanSchema.safeParse({ ...base, captions: [], segments }).success).toBe(true)
    expect(burnCaptionsPlanSchema.safeParse({ ...base, captions: [] }).success).toBe(false)
  })
})

describe("findSegmentOverlap", () => {
  it("returns null for non-overlapping (unsorted) segments", () => {
    expect(findSegmentOverlap([{ startMs: 3000, endMs: 6000 }, { startMs: 0, endMs: 3000 }])).toBeNull()
  })
  it("detects an overlap regardless of order", () => {
    expect(findSegmentOverlap([{ startMs: 0, endMs: 4000 }, { startMs: 3000, endMs: 8000 }])).toContain("overlap")
  })
  it("treats touching boundaries (endMs == next startMs) as non-overlapping", () => {
    expect(findSegmentOverlap([{ startMs: 0, endMs: 3000 }, { startMs: 3000, endMs: 6000 }])).toBeNull()
  })
})

describe("resolveCaptionSegments — maxWordsPerLine", () => {
  it("inherits the top-level cap, and a segment's own wins", () => {
    const [inherited, own, none] = resolveCaptionSegments(
      SHARED,
      [
        { startMs: 0, endMs: 1000 },
        { startMs: 1000, endMs: 2000, maxWordsPerLine: 5 },
        { startMs: 2000, endMs: 3000 },
      ],
      { ...DEFAULTS, maxWordsPerLine: 2 },
    )
    expect(inherited!.maxWordsPerLine).toBe(2)
    expect(own!.maxWordsPerLine).toBe(5)
    expect(none!.maxWordsPerLine).toBe(2)
  })

  it("a subtitle segment's own text wraps to the cap as one block, and the render gets no cap", () => {
    const [five, eight] = resolveCaptionSegments(
      SHARED,
      [
        { startMs: 0, endMs: 1600, style: "subtitle", text: "Saved 3 hours a week", maxWordsPerLine: 4 },
        { startMs: 1600, endMs: 3000, style: "subtitle", text: "one two three four five six seven eight" },
      ],
      { ...DEFAULTS, maxWordsPerLine: 4 },
    )
    expect(five!.captions).toEqual([{ text: "Saved 3 hours\na week", startMs: 0, endMs: 1600, timestampMs: 0, confidence: null }])
    expect(five!.maxWordsPerLine).toBeUndefined()
    expect(eight!.captions.map((c) => c.text)).toEqual(["one two three four\nfive six seven eight"])
    expect(eight!.maxWordsPerLine).toBeUndefined()
  })

  it("stays undefined when neither level sets one (unset = fit the width)", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 1000 }], DEFAULTS)
    expect(seg!.maxWordsPerLine).toBeUndefined()
  })

  it("a resolved segment carrying the cap still validates against the render plan", () => {
    const segments = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, text: "Hello there." }],
      { ...DEFAULTS, maxWordsPerLine: 2 },
    )
    const plan = {
      planType: "burn-captions" as const,
      sourceVideo: "https://example.com/v.mp4",
      captions: SHARED,
      style: "word-pop" as const,
      position: "bottom" as const,
      fontSize: 32,
      color: "#ffffff",
      maxWordsPerLine: 2,
      segments,
      fps: 24,
      width: 1080,
      height: 1920,
      durationInFrames: 72,
    }
    expect(burnCaptionsPlanSchema.safeParse(plan).success).toBe(true)
    // Out of band on either level is a plan the render must never receive.
    expect(burnCaptionsPlanSchema.safeParse({ ...plan, maxWordsPerLine: 0 }).success).toBe(false)
    expect(burnCaptionsPlanSchema.safeParse({ ...plan, maxWordsPerLine: 21 }).success).toBe(false)
    expect(burnCaptionsPlanSchema.safeParse({ ...plan, maxWordsPerLine: 2.5 }).success).toBe(false)
  })
})

describe("captionsNeedWordTimings", () => {
  it("a kinetic top-level style needs them; a subtitle does not", () => {
    expect(captionsNeedWordTimings({ style: "karaoke" })).toBe(true)
    expect(captionsNeedWordTimings({ style: "word-highlight" })).toBe(true)
    expect(captionsNeedWordTimings({ style: "subtitle" })).toBe(false)
    // An absent style is `subtitle` — the route's own default.
    expect(captionsNeedWordTimings({})).toBe(false)
  })

  it("with segments, only the ones that fall back to the SHARED transcript count", () => {
    // Self-sourced kinetic segment: its own text is synthesised, so the
    // transcription owes this render nothing.
    expect(
      captionsNeedWordTimings({
        style: "subtitle",
        segments: [{ style: "karaoke", text: "own words" }, {}],
      }),
    ).toBe(false)
    expect(
      captionsNeedWordTimings({
        style: "subtitle",
        segments: [{ style: "karaoke", captions: [{}] }],
      }),
    ).toBe(false)
    // One shared-transcript kinetic segment is enough.
    expect(
      captionsNeedWordTimings({ style: "subtitle", segments: [{ text: "own" }, { style: "karaoke" }] }),
    ).toBe(true)
  })

  it("a segment with no style of its own inherits the top-level one", () => {
    expect(captionsNeedWordTimings({ style: "karaoke", segments: [{}] })).toBe(true)
    expect(captionsNeedWordTimings({ style: "subtitle", segments: [{}] })).toBe(false)
  })
})

describe("captionRenderFps", () => {
  it("rounds the source's rate", () => {
    expect(captionRenderFps(24)).toBe(24)
    expect(captionRenderFps(24000 / 1001)).toBe(24)
    expect(captionRenderFps(29.97)).toBe(30)
  })

  it("clamps into the plan's band instead of producing a plan that cannot validate", () => {
    expect(captionRenderFps(120)).toBe(60)
    expect(captionRenderFps(8)).toBe(15)
  })

  it("falls back to 30 for an unknown or nonsensical rate", () => {
    expect(captionRenderFps(undefined)).toBe(30)
    expect(captionRenderFps(0)).toBe(30)
    expect(captionRenderFps(-24)).toBe(30)
    expect(captionRenderFps(Number.NaN)).toBe(30)
    expect(captionRenderFps(Number.POSITIVE_INFINITY)).toBe(30)
  })
})

/**
 * S1 — `text` on a `subtitle` IS the caption, not the kinetic fallback. The
 * regression this pins: a subtitle carrying a styling lever routes to Remotion,
 * whose worker path ignored `text` and burned a transcription of the audio
 * instead of the caller's words.
 */
describe("isStaticTextCaptionSource", () => {
  it("subtitle + text IS the static source", () => {
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "SALE ENDS FRIDAY" })).toBe(true)
    // An absent style is `subtitle` (the route's own default).
    expect(isStaticTextCaptionSource({ text: "SALE ENDS FRIDAY" })).toBe(true)
    // A styling lever does not change WHERE the words come from, only who draws them.
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "hi" })).toBe(true)
  })

  it("a richer caption source wins over text (precedence unchanged)", () => {
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "hi", captions: [{}] })).toBe(false)
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "hi", transcript: { words: [] } })).toBe(false)
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "hi", segments: [{}] })).toBe(false)
  })

  it("on a KINETIC style text stays the FALLBACK, never the static block", () => {
    for (const style of ["karaoke", "word-highlight", "word-pop", "bouncy", "tiktok-words"]) {
      expect(isStaticTextCaptionSource({ style, text: "hi" })).toBe(false)
    }
  })

  it("empty / whitespace-only text is no source at all", () => {
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "" })).toBe(false)
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "   \n\t " })).toBe(false)
    expect(isStaticTextCaptionSource({ style: "subtitle" })).toBe(false)
    expect(isStaticTextCaptionSource({ style: "subtitle", text: null })).toBe(false)
  })

  it("an empty captions[] / segments[] is not a source (it does not beat text)", () => {
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "hi", captions: [] })).toBe(true)
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "hi", segments: [] })).toBe(true)
    expect(isStaticTextCaptionSource({ style: "subtitle", text: "hi", transcript: null })).toBe(true)
  })
})

describe("staticTextCaptionBlock", () => {
  it("is ONE caption spanning the whole video", () => {
    expect(staticTextCaptionBlock("SALE ENDS FRIDAY", { videoDurationSeconds: 12 })).toEqual({
      text: "SALE ENDS FRIDAY",
      startMs: 0,
      endMs: 12000,
      timestampMs: 0,
      confidence: null,
    })
  })

  it("falls back to 5s when the source duration is unknown", () => {
    expect(staticTextCaptionBlock("hi", {}).endMs).toBe(5000)
    expect(staticTextCaptionBlock("hi", { videoDurationSeconds: 0 }).endMs).toBe(5000)
  })

  it("preserves `\\n` as a forced line break (and trims the outside)", () => {
    expect(staticTextCaptionBlock("  LINE ONE\nLINE TWO  ", { videoDurationSeconds: 3 }).text)
      .toBe("LINE ONE\nLINE TWO")
  })

  it("re-wraps each paragraph to maxWordsPerLine words, keeping the caller's breaks", () => {
    expect(staticTextCaptionBlock("one two three four five", { videoDurationSeconds: 3, maxWordsPerLine: 2 }).text)
      .toBe("one two\nthree four\nfive")
    // The caller's own break is a paragraph boundary — the cap never merges across it.
    expect(staticTextCaptionBlock("one two three\nfour", { videoDurationSeconds: 3, maxWordsPerLine: 2 }).text)
      .toBe("one two\nthree\nfour")
    // A blank line the caller wrote survives.
    expect(staticTextCaptionBlock("a b\n\nc d", { videoDurationSeconds: 3, maxWordsPerLine: 2 }).text)
      .toBe("a b\n\nc d")
  })

  it("spreads the words evenly over the fewest lines the cap allows", () => {
    const wrap = (text: string) => staticTextCaptionBlock(text, { videoDurationSeconds: 3, maxWordsPerLine: 4 }).text
    expect(wrap("Saved 3 hours a week")).toBe("Saved 3 hours\na week")
    expect(wrap("one two three four five six seven eight")).toBe("one two three four\nfive six seven eight")
    expect(wrap("one two three four five six seven eight nine")).toBe("one two three\nfour five six\nseven eight nine")
  })

  it("leaves the text alone when no cap is set", () => {
    expect(staticTextCaptionBlock("one two three four", { videoDurationSeconds: 3 }).text)
      .toBe("one two three four")
  })
})

/**
 * S5 — a PHRASE that straddles a segment boundary is split at the boundary and
 * clipped to each window, instead of being dropped whole (F12: a 10 s segment
 * rendered with no captions at all, at the kinetic price).
 */
describe("splitCaptionsAcrossWindows", () => {
  const windows = [{ startMs: 0, endMs: 5000 }, { startMs: 5000, endMs: 10000 }]

  it("splits a straddling PHRASE into two clipped parts — neither dropped, no overlap", () => {
    const phrase = cap("so I built a whole world inside the studio", 4000, 8000)
    const [a, b] = splitCaptionsAcrossWindows([phrase], windows)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a![0]).toMatchObject({ text: phrase.text, startMs: 4000, endMs: 5000 })
    expect(b![0]).toMatchObject({ text: phrase.text, startMs: 5000, endMs: 8000 })
    // Clipped windows are disjoint, so the phrase is never on screen twice at once.
    expect(a![0]!.endMs).toBeLessThanOrEqual(b![0]!.startMs)
  })

  it("a phrase fully inside one window is passed through UNTOUCHED (same object)", () => {
    const phrase = cap("inside one window only", 1000, 2000)
    const [a, b] = splitCaptionsAcrossWindows([phrase], windows)
    expect(a![0]).toBe(phrase)
    expect(b).toEqual([])
  })

  it("drops a sliver shorter than the minimum, keeping the readable part", () => {
    const phrase = cap("two words", 4900, 4900 + 3000)
    const [a, b] = splitCaptionsAcrossWindows([phrase], windows)
    expect(MIN_CLIPPED_PHRASE_MS).toBe(250)
    expect(a).toEqual([]) // 100 ms of it fell in window A
    expect(b![0]).toMatchObject({ startMs: 5000, endMs: 7900 })
  })

  it("keeps the LONGEST part when every part would be a sliver (never lose the phrase)", () => {
    const phrase = cap("two words", 4900, 5050)
    const [a, b] = splitCaptionsAcrossWindows([phrase], windows)
    // 100 ms in A, 50 ms in B — both slivers, so the longer one is kept.
    expect(a).toHaveLength(1)
    expect(a![0]).toMatchObject({ startMs: 4900, endMs: 5000 })
    expect(b).toEqual([])
  })

  it("WORD-level membership is unchanged: the window containing the START, timings untouched", () => {
    const word = cap("mid", 4800, 5200)
    const [a, b] = splitCaptionsAcrossWindows([word], windows)
    expect(a![0]).toBe(word) // not clipped, not copied
    expect(b).toEqual([])
    // ...and a word that starts outside every window is still dropped.
    expect(splitCaptionsAcrossWindows([cap("late", 12000, 12500)], windows)).toEqual([[], []])
  })

  it("a zero-width phrase falls back to the start-only rule instead of vanishing", () => {
    const flat = cap("two words", 5000, 5000)
    const [a, b] = splitCaptionsAcrossWindows([flat], windows)
    expect(a).toEqual([])
    expect(b![0]).toBe(flat)
  })
})

describe("resolveCaptionSegments — phrase captions across a boundary (S5)", () => {
  it("renders a straddling phrase in BOTH segments, in each segment's own style", () => {
    const phrase = cap("so I built a whole world", 4000, 8000)
    const [intro, body] = resolveCaptionSegments(
      [phrase],
      [
        { startMs: 0, endMs: 5000, style: "subtitle" },
        { startMs: 5000, endMs: 10000, style: "word-pop" },
      ],
      DEFAULTS,
    )
    // The subtitle segment collapses its (clipped) phrase into one block.
    expect(intro!.captions).toHaveLength(1)
    expect(intro!.captions[0]!.text).toBe("so I built a whole world")
    // The kinetic segment keeps the clipped phrase entry.
    expect(body!.captions).toHaveLength(1)
    expect(body!.captions[0]).toMatchObject({ startMs: 5000, endMs: 8000 })
  })

  it("F12: a whisper phrase that only OVERLAPS the segment still captions it", () => {
    // Phrase boundaries a word-less lane really returns; the segment starts
    // mid-phrase, so start-only membership left it with no captions at all.
    const phrases = transcribeSegmentsToCaptions([
      { start: 0, end: 4.8, text: "So I built a whole world" },
      { start: 4.8, end: 16.0, text: "inside the studio, and then I rendered it as one long take" },
      { start: 16, end: 21, text: "and it just worked" },
    ])
    const [seg] = resolveCaptionSegments(phrases, [{ startMs: 5000, endMs: 15000, style: "subtitle" }], DEFAULTS)
    expect(seg!.captions).toHaveLength(1)
    expect(seg!.captions[0]!.text).toContain("inside the studio")
    expect(seg!.captions[0]!).toMatchObject({ startMs: 5000, endMs: 15000 })
  })

  it("a segment's OWN phrase captions[] are clipped to its window, not dropped", () => {
    const [seg] = resolveCaptionSegments(
      [],
      [{ startMs: 5000, endMs: 10000, style: "word-pop", captions: [cap("two words", 4000, 8000)] }],
      DEFAULTS,
    )
    expect(seg!.captions).toHaveLength(1)
    expect(seg!.captions[0]).toMatchObject({ startMs: 5000, endMs: 8000 })
  })
})

/**
 * S6 — the frame budget is checked only when the render plan validates, which is
 * after credits are reserved (and after any paid transcription), so a long clip
 * at a high source rate falls back to the historical 30 instead.
 */
describe("captionRenderFpsWithinFrameCap", () => {
  it("keeps the source rate for anything that fits the plan's frame cap", () => {
    expect(captionRenderFpsWithinFrameCap(60, 1700)).toBe(60)
    expect(captionRenderFpsWithinFrameCap(24, 600)).toBe(24)
    expect(captionRenderFpsWithinFrameCap(60, BURN_CAPTIONS_MAX_FRAMES / 60)).toBe(60)
  })

  it("falls back to 30 for a clip whose duration × fps would blow the cap", () => {
    expect(captionRenderFpsWithinFrameCap(60, 1860)).toBe(30) // 31 min at 60 fps
    expect(captionRenderFpsWithinFrameCap(50, 2400)).toBe(30)
  })

  it("never raises a rate that is already at or below the fallback", () => {
    expect(captionRenderFpsWithinFrameCap(24, 99999)).toBe(24)
    expect(captionRenderFpsWithinFrameCap(30, 99999)).toBe(30)
  })
})

/** S7 — `null` is UNSET everywhere a lever is forwarded into the render plan. */
describe("dropNullCaptionLevers", () => {
  it("drops every null lever and leaves the rest alone (copy, never mutate)", () => {
    const input = {
      style: "subtitle", text: "Hi",
      look: null, fontFamily: null, strokeColor: null, highlightColor: null,
      uppercase: null, animate: null, color: null, backgroundColor: null,
      position: "top",
    }
    const out = dropNullCaptionLevers(input)
    for (const k of ["look", "fontFamily", "strokeColor", "highlightColor", "uppercase", "animate", "color", "backgroundColor"]) {
      expect(k in out).toBe(false)
    }
    expect(out).toMatchObject({ style: "subtitle", text: "Hi", position: "top" })
    expect(input.look).toBeNull() // input untouched
  })

  it("keeps a real value, including the falsy ones", () => {
    const out = dropNullCaptionLevers({ uppercase: false, animate: false, color: "#000000" })
    expect(out).toEqual({ uppercase: false, animate: false, color: "#000000" })
  })
})

/** The same rule one level down: a null lever must not be pulled off the input
 *  as if it were set — it would overwrite the look's own value with null AND
 *  fail the plan's `.optional()` (never `.nullable()`) schema mid-run. */
describe("explicitLevers", () => {
  it("treats null as UNSET, exactly like undefined", () => {
    expect(
      explicitLevers({
        fontFamily: null, fontWeight: null, color: null, backgroundColor: null,
        strokeColor: null, strokeWidth: null, highlightColor: null, uppercase: null,
      }),
    ).toEqual({})
  })

  it("still carries every value the caller really set, falsy ones included", () => {
    expect(
      explicitLevers({ fontFamily: "Inter", fontWeight: null, strokeWidth: 0, uppercase: false, strokeColor: null }),
    ).toEqual({ fontFamily: "Inter", strokeWidth: 0, uppercase: false })
  })
})
