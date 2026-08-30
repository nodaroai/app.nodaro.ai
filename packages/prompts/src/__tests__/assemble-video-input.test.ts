import { describe, it, expect } from "vitest"
import { composeVideoPromptText } from "../assemble-video-input.js"
import { directionFieldsForSurface } from "../direction-registry.js"
import { getStylePromptHint, getStyleTerm } from "../style.js"
import { getTransitionPromptHint, getTransitionTerm } from "../transitions.js"
import { getCameraMotionPromptHint, getCameraMotionTerm } from "../camera-motions.js"
import { getFramingPromptHint } from "../framing.js"
import { getLightingPromptHint } from "../lighting.js"
import { buildMoodHints } from "../mood.js"
import { buildAestheticHints } from "../aesthetic.js"
import { buildAtmosphereHints } from "../atmosphere.js"
import { buildPhotographerHints } from "../photographer.js"
import { renderStructuredFields } from "../prompt-builder-structured-fields.js"

/**
 * `composeVideoPromptText` is the video route's ONLY prompt-composition step,
 * so two contracts matter here above everything else:
 *
 *  1. THE NO-OP CONTRACT — with no direction the caller's prompt comes back
 *     verbatim and untrimmed, `undefined` included. This is the local
 *     restatement of the route-level byte-parity oracle ("backward-compatible:
 *     no connectedReferences → prompt + flat refs pass through unchanged" in
 *     `backend/src/routes/__tests__/generate-video.test.ts`), and it is what
 *     makes this whole leg land dark.
 *  2. THE VERBOSITY POLICY — look dimensions render their full clause, motion
 *     dimensions their compact professional term. That split moved from the
 *     client to the platform, so it is pinned in both directions.
 *
 * Real catalog ids throughout: every `get*PromptHint` returns `""` on a miss,
 * so a made-up id would make most assertions vacuously pass.
 */

// ── Real ids, one per dimension used below ──────────────────────────────────
const STYLE = "cinematic" // look
const TRANSITION = "cross-dissolve" // motion
const CAMERA_MOTION = "handheld" // motion
const SHOT_SIZE = "wide-shot" // look, framing catalog
const TIME_OF_DAY = "dawn" // look, lighting catalog (time-of-day category)
const LIGHTING_STYLE = "three-point" // look, lighting catalog (style category)
const PHOTOGRAPHER = "tim-walker" // IMAGE-ONLY dimension
const NO_SUCH_ID = "__no_such_id__"

describe("composeVideoPromptText — the no-op contract", () => {
  it("returns a prompt verbatim when no direction is passed", () => {
    expect(composeVideoPromptText("a knight rides at dusk", undefined)).toBe(
      "a knight rides at dusk",
    )
  })

  it("returns a whitespace-only prompt verbatim and UNTRIMMED", () => {
    expect(composeVideoPromptText("  \n", undefined)).toBe("  \n")
  })

  it("preserves `undefined` (the video prompt is optional)", () => {
    expect(composeVideoPromptText(undefined, undefined)).toBeUndefined()
  })

  it("treats an empty direction object as no direction", () => {
    expect(composeVideoPromptText("a knight", {})).toBe("a knight")
    expect(composeVideoPromptText(undefined, {})).toBeUndefined()
  })
})

describe("composeVideoPromptText — the verbosity policy", () => {
  it("renders a LOOK dimension as its full clause", () => {
    expect(composeVideoPromptText("a knight", { style: STYLE })).toBe(
      `a knight. ${getStylePromptHint(STYLE)}`,
    )
  })

  it("renders a MOTION dimension as its compact term, not its full hint", () => {
    const out = composeVideoPromptText("a knight", { transition: TRANSITION })
    expect(out).toBe(`a knight. ${getTransitionTerm(TRANSITION)}`)
    expect(out).not.toContain(getTransitionPromptHint(TRANSITION))
  })

  it("applies both halves of the split policy in ONE fold", () => {
    const out = composeVideoPromptText("a knight", {
      style: STYLE,
      transition: TRANSITION,
    })
    expect(out).toContain(getStylePromptHint(STYLE))
    expect(out).toContain(getTransitionTerm(TRANSITION))
    expect(out).not.toContain(getTransitionPromptHint(TRANSITION))
  })

  it("honors a whole-fold `hintMode` override in both directions", () => {
    // "full" promotes the motion family to its full clause…
    expect(
      composeVideoPromptText("a knight", { transition: TRANSITION }, undefined, {
        hintMode: "full",
      }),
    ).toBe(`a knight. ${getTransitionPromptHint(TRANSITION)}`)
    // …and "compact" demotes the look family to its term.
    expect(
      composeVideoPromptText("a knight", { style: STYLE }, undefined, {
        hintMode: "compact",
      }),
    ).toBe(`a knight. ${getStyleTerm(STYLE)}`)
  })
})

describe("composeVideoPromptText — ordering", () => {
  it("puts camera motion first (the order Studio and the orchestrator both emit)", () => {
    const out = composeVideoPromptText("a knight", {
      style: STYLE,
      cameraMotion: CAMERA_MOTION,
    })!
    expect(out.indexOf(getCameraMotionTerm(CAMERA_MOTION))).toBeLessThan(
      out.indexOf(getStylePromptHint(STYLE)),
    )
    // Compact motion again — the camera-motion row is `family: "motion"`.
    expect(out).not.toContain(getCameraMotionPromptHint(CAMERA_MOTION))
  })

  it("folds in TABLE order, not the caller's object order", () => {
    // `shotSize` (row 2) precedes `style` (row 22) however the object is written.
    const out = composeVideoPromptText("a knight", {
      style: STYLE,
      shotSize: SHOT_SIZE,
    })!
    expect(out.indexOf(getFramingPromptHint(SHOT_SIZE))).toBeLessThan(
      out.indexOf(getStylePromptHint(STYLE)),
    )
  })

  it("appends the structured fragment AFTER every direction hint", () => {
    const structured = { mood: "wistful" }
    const fragment = renderStructuredFields(structured)
    expect(fragment.length).toBeGreaterThan(0)
    const out = composeVideoPromptText("a knight", { style: STYLE }, structured)!
    expect(out).toBe(`a knight. ${getStylePromptHint(STYLE)}. ${fragment}`)
  })
})

describe("composeVideoPromptText — multi-pick doctrine", () => {
  it("BLENDS two moods into ONE clause (not a per-id loop)", () => {
    const blended = buildMoodHints({ mood: ["happy", "serene"] }, "full")
    expect(blended).toHaveLength(1)
    expect(composeVideoPromptText("a knight", { mood: ["happy", "serene"] })).toBe(
      `a knight. ${blended[0]}`,
    )
  })

  it("BLENDS two aesthetics into ONE clause", () => {
    const blended = buildAestheticHints(["y2k", "cottagecore"], "full")
    expect(blended.length).toBeGreaterThan(0)
    expect(
      composeVideoPromptText("a knight", { aesthetic: ["y2k", "cottagecore"] }),
    ).toBe(`a knight. ${blended}`)
  })

  it("slices an over-cap array to the dimension's maxPicks (atmosphere = 2)", () => {
    const out = composeVideoPromptText("a knight", {
      atmosphere: ["clear", "cloudy", "overcast"],
    })!
    const kept = buildAtmosphereHints(["clear", "cloudy"], "full")
    expect(kept).toHaveLength(2)
    expect(out).toBe(`a knight. ${kept.join(". ")}`)
    expect(out).not.toContain(buildAtmosphereHints("overcast", "full")[0])
  })

  it("accepts an ARRAY on a single-pick key and keeps the first id", () => {
    // The legacy `V2LookPicker` shape: a single-pick dimension that stored an
    // array. Must degrade to one hint, never throw and never drop the key.
    const out = composeVideoPromptText("a knight", { style: [STYLE, "anime"] })
    expect(out).toBe(`a knight. ${getStylePromptHint(STYLE)}`)
  })
})

describe("composeVideoPromptText — tolerance", () => {
  it("skips an unknown id and leaves the prompt verbatim (no dangling '. ')", () => {
    expect(composeVideoPromptText("a knight", { style: NO_SUCH_ID })).toBe("a knight")
  })

  it("skips an IMAGE-ONLY dimension sent to a video run", () => {
    // `photographer` is accepted on the wire (surface is a render concern, not
    // a wire concern) and simply contributes nothing here.
    expect(buildPhotographerHints(PHOTOGRAPHER, "full").length).toBeGreaterThan(0)
    expect(composeVideoPromptText("a knight", { photographer: PHOTOGRAPHER })).toBe(
      "a knight",
    )
  })

  it("skips an unknown wire key entirely", () => {
    expect(
      composeVideoPromptText("a knight", { __not_a_dimension__: "x" } as never),
    ).toBe("a knight")
  })
})

describe("composeVideoPromptText — an empty or absent body", () => {
  it("returns the hints alone for an empty prompt (never a leading '. ')", () => {
    expect(composeVideoPromptText("", { style: STYLE })).toBe(getStylePromptHint(STYLE))
  })

  it("returns the hints alone for an ABSENT prompt", () => {
    expect(composeVideoPromptText(undefined, { style: STYLE })).toBe(
      getStylePromptHint(STYLE),
    )
  })
})

describe("composeVideoPromptText — the dedupe invariant", () => {
  // The five legacy keys address a WHOLE catalog, so they are not aliases of
  // their canonical counterparts. Overlap is resolved by exact-clause dedupe,
  // which suppresses a repeated clause without suppressing a different id.
  it("emits ONE clause when a legacy and a canonical key carry the SAME id", () => {
    expect(
      composeVideoPromptText("a knight", { framingId: SHOT_SIZE, shotSize: SHOT_SIZE }),
    ).toBe(`a knight. ${getFramingPromptHint(SHOT_SIZE)}`)
  })

  it("emits BOTH clauses for two DIFFERENT ids of one catalog", () => {
    // The case an alias table would have wrongly collapsed: `lightingId` is
    // whole-catalog, so a time-of-day pick beside a lighting-style pick is two
    // legitimate selections.
    const out = composeVideoPromptText("a knight", {
      lightingStyle: LIGHTING_STYLE,
      lightingId: TIME_OF_DAY,
    })
    expect(out).toBe(
      `a knight. ${getLightingPromptHint(LIGHTING_STYLE)}. ${getLightingPromptHint(TIME_OF_DAY)}`,
    )
  })
})

/**
 * ORDER TOTALITY — every video-surface dimension, folded in one call.
 *
 * The fixture is keyed in `directionFieldsForSurface("video")` order and pinned
 * against it, so adding, removing or reordering a video row fails HERE as well
 * as in the registry test. Each id was chosen to render a clause distinct from
 * every other row's, so the dedupe pass cannot mask a mis-ordering.
 */
const EVERY_VIDEO_DIMENSION: Record<string, string> = {
  cameraMotion: "static",
  shotSize: "extreme-wide-shot",
  angle: "eye-level",
  coverage: "single",
  composition: "rule-of-thirds",
  vantage: "front-on",
  pose: "standing-upright",
  compositionEffect: "bursting-through-frame",
  cameraFormat: "35mm-film",
  lens: "ultra-wide-14mm",
  timeOfDay: "dawn",
  lightingStyle: "three-point",
  lightingDirection: "front",
  lightingRatio: "ratio-1-1",
  colorTemperature: "temp-2700k",
  colorLook: "warm",
  atmosphere: "clear",
  style: "3d-render",
  mood: "happy",
  aesthetic: "y2k",
  setting: "coffee-shop",
  era: "1920s-flapper",
  backdrop: "white-seamless",
  actionFx: "earthquake-tremor",
  temporalSpeed: "real-time",
  temporalFreeze: "full-freeze",
  temporalDirection: "forward",
  temporalShutter: "long-exposure",
  transition: "none",
  loopSubject: "aurora",
  framingId: "wide-shot",
  framingAngleId: "medium-wide-shot",
  lightingId: "sunrise",
  lensId: "wide-24mm",
  cameraFormatId: "16mm-film",
}

describe("composeVideoPromptText — order totality over every video dimension", () => {
  it("covers exactly the video surface, in table order", () => {
    expect(Object.keys(EVERY_VIDEO_DIMENSION)).toEqual(
      directionFieldsForSurface("video").map((f) => f.key),
    )
  })

  it("resolves every fixture id to a real clause", () => {
    for (const [key, id] of Object.entries(EVERY_VIDEO_DIMENSION)) {
      expect(composeVideoPromptText("", { [key]: id }), `${key}=${id}`).not.toBe("")
    }
  })

  it("folds all 35 dimensions in registry order, one clause each", () => {
    // Per-dimension renders, composed in isolation through the same public
    // entry point, then concatenated in table order: the whole fold must equal
    // exactly that. Any reorder, drop or duplicate shows up as a diff.
    const expected = Object.entries(EVERY_VIDEO_DIMENSION).map(
      ([key, id]) => composeVideoPromptText("", { [key]: id })!,
    )
    expect(new Set(expected).size, "fixture ids must render distinct clauses").toBe(
      expected.length,
    )
    expect(composeVideoPromptText("a knight", EVERY_VIDEO_DIMENSION)).toBe(
      ["a knight", ...expected].join(". "),
    )
  })
})
