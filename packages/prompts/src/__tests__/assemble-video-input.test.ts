import { describe, it, expect } from "vitest"
import { composeVideoPromptText } from "../assemble-video-input.js"
import {
  FILM_STYLE_KEYS,
  VIDEO_HINT_MODE_DEFAULT,
  directionFieldsForSurface,
  renderDirectionHints,
} from "../direction-registry.js"
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
 *  3. THE `[style]` SECTION — the look clauses read in a trailing block, not
 *     inline; the motion family and the structured fragment stay in the body.
 *     The header is written as a LITERAL in every expectation here so a typo in
 *     `STYLE_SECTION_HEADER` fails rather than redefining the contract.
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
  it("renders a LOOK dimension as its full clause, in the section", () => {
    expect(composeVideoPromptText("a knight", { style: STYLE })).toBe(
      `a knight\n\n[style]:\n${getStylePromptHint(STYLE)}`,
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
    // …and "compact" demotes the look family to its term. Verbosity does not
    // move a clause: the look term still reads in the section.
    expect(
      composeVideoPromptText("a knight", { style: STYLE }, undefined, {
        hintMode: "compact",
      }),
    ).toBe(`a knight\n\n[style]:\n${getStyleTerm(STYLE)}`)
  })
})

/**
 * THE BODY/SECTION BOUNDARY. Tal's rule: camera motion is part of the shot
 * prose, not the style — so the WHOLE motion family stays in the body, and the
 * boundary is the registry's `family` column, the same column the verbosity
 * policy above splits on. Coupling them is deliberate; a row cannot be shot
 * prose for one and look for the other.
 */
describe("composeVideoPromptText — what stays in the body", () => {
  it("keeps every motion clause inline and emits no header for a motion-only fold", () => {
    const out = composeVideoPromptText("a knight", {
      cameraMotion: CAMERA_MOTION,
      transition: TRANSITION,
    })
    expect(out).toBe(
      `a knight. ${getCameraMotionTerm(CAMERA_MOTION)}. ${getTransitionTerm(TRANSITION)}`,
    )
    expect(out).not.toContain("[style]")
  })

  it("splits a mixed fold: motion inline, look in the section", () => {
    expect(
      composeVideoPromptText("a knight", { cameraMotion: CAMERA_MOTION, style: STYLE }),
    ).toBe(
      `a knight. ${getCameraMotionTerm(CAMERA_MOTION)}\n\n[style]:\n${getStylePromptHint(STYLE)}`,
    )
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
    // `shotSize` (row 2) precedes `lightingStyle` (row 15) on the scene line
    // however the object is written.
    const out = composeVideoPromptText("a knight", {
      lightingStyle: LIGHTING_STYLE,
      shotSize: SHOT_SIZE,
    })!
    expect(out.indexOf(getFramingPromptHint(SHOT_SIZE))).toBeLessThan(
      out.indexOf(getLightingPromptHint(LIGHTING_STYLE)),
    )
  })

  it("groups before it orders: the film line leads the scene line", () => {
    // `shotSize` folds at row 2 and `style` at row 22, so table order alone
    // would read the framing clause first. The section's two lines outrank it.
    expect(composeVideoPromptText("a knight", { style: STYLE, shotSize: SHOT_SIZE })).toBe(
      `a knight\n\n[style]:\n${getStylePromptHint(STYLE)}\n${getFramingPromptHint(SHOT_SIZE)}`,
    )
  })

  it("ends the BODY with the structured fragment, then hangs the section off it", () => {
    const structured = { mood: "wistful" }
    const fragment = renderStructuredFields(structured)
    expect(fragment.length).toBeGreaterThan(0)
    const out = composeVideoPromptText(
      "a knight",
      { style: STYLE, cameraMotion: CAMERA_MOTION },
      structured,
    )!
    expect(out).toBe(
      `a knight. ${getCameraMotionTerm(CAMERA_MOTION)}. ${fragment}` +
        `\n\n[style]:\n${getStylePromptHint(STYLE)}`,
    )
  })
})

describe("composeVideoPromptText — multi-pick doctrine", () => {
  it("BLENDS two moods into ONE clause (not a per-id loop)", () => {
    const blended = buildMoodHints({ mood: ["happy", "serene"] }, "full")
    expect(blended).toHaveLength(1)
    expect(composeVideoPromptText("a knight", { mood: ["happy", "serene"] })).toBe(
      `a knight\n\n[style]:\n${blended[0]}`,
    )
  })

  it("BLENDS two aesthetics into ONE clause", () => {
    const blended = buildAestheticHints(["y2k", "cottagecore"], "full")
    expect(blended.length).toBeGreaterThan(0)
    expect(
      composeVideoPromptText("a knight", { aesthetic: ["y2k", "cottagecore"] }),
    ).toBe(`a knight\n\n[style]:\n${blended}`)
  })

  it("slices an over-cap array to the dimension's maxPicks (atmosphere = 2)", () => {
    const out = composeVideoPromptText("a knight", {
      atmosphere: ["clear", "cloudy", "overcast"],
    })!
    const kept = buildAtmosphereHints(["clear", "cloudy"], "full")
    expect(kept).toHaveLength(2)
    // Both survivors share the scene line, `. `-joined exactly as an inline
    // fold joined them.
    expect(out).toBe(`a knight\n\n[style]:\n${kept.join(". ")}`)
    expect(out).not.toContain(buildAtmosphereHints("overcast", "full")[0])
  })

  it("accepts an ARRAY on a single-pick key and keeps the first id", () => {
    // The legacy `V2LookPicker` shape: a single-pick dimension that stored an
    // array. Must degrade to one hint, never throw and never drop the key.
    const out = composeVideoPromptText("a knight", { style: [STYLE, "anime"] })
    expect(out).toBe(`a knight\n\n[style]:\n${getStylePromptHint(STYLE)}`)
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
    expect(composeVideoPromptText("", { transition: TRANSITION })).toBe(
      getTransitionTerm(TRANSITION),
    )
  })

  it("returns the hints alone for an ABSENT prompt", () => {
    expect(composeVideoPromptText(undefined, { transition: TRANSITION })).toBe(
      getTransitionTerm(TRANSITION),
    )
  })

  it("drops the section's blank line with the body (never a leading newline)", () => {
    const sectionOnly = `[style]:\n${getStylePromptHint(STYLE)}`
    expect(composeVideoPromptText("", { style: STYLE })).toBe(sectionOnly)
    expect(composeVideoPromptText(undefined, { style: STYLE })).toBe(sectionOnly)
    expect(composeVideoPromptText("   ", { style: STYLE })).toBe(sectionOnly)
  })

  it("TRIMS a prompt the section is the only thing folded onto", () => {
    // The section counts as "something folded", so the body is trimmed exactly
    // as the hint-join branch trims it — otherwise the blank line would inherit
    // the prompt's trailing whitespace. (With NO fold at all the prompt still
    // comes back untrimmed: the no-op contract above.)
    expect(composeVideoPromptText("  a knight \n", { style: STYLE })).toBe(
      `a knight\n\n[style]:\n${getStylePromptHint(STYLE)}`,
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
    ).toBe(`a knight\n\n[style]:\n${getFramingPromptHint(SHOT_SIZE)}`)
  })

  it("emits BOTH clauses for two DIFFERENT ids of one catalog", () => {
    // The case an alias table would have wrongly collapsed: `lightingId` is
    // whole-catalog, so a time-of-day pick beside a lighting-style pick is two
    // legitimate selections. Both are scene-line clauses, so they share a line.
    const out = composeVideoPromptText("a knight", {
      lightingStyle: LIGHTING_STYLE,
      lightingId: TIME_OF_DAY,
    })
    expect(out).toBe(
      `a knight\n\n[style]:\n` +
        `${getLightingPromptHint(LIGHTING_STYLE)}. ${getLightingPromptHint(TIME_OF_DAY)}`,
    )
  })

  it("emits NO header when every look clause deduped away", () => {
    // The section's existence follows the clause COUNT after dedupe, not the
    // caller's key count: two keys, one clause, one line — and a fold whose
    // every look clause vanished would take the no-header path.
    const out = composeVideoPromptText("a knight", {
      framingId: SHOT_SIZE,
      shotSize: SHOT_SIZE,
    })!
    expect(out.split("[style]:")).toHaveLength(2)
    expect(composeVideoPromptText("a knight", { style: NO_SUCH_ID })).not.toContain("[style]")
  })
})

/**
 * ORDER TOTALITY — every video-surface dimension, folded in one call, and the
 * slot each one lands in.
 *
 * The fixture is keyed in `directionFieldsForSurface("video")` order and pinned
 * against it, so adding, removing or reordering a video row fails HERE as well
 * as in the registry test. Each id was chosen to render a clause distinct from
 * every other row's, so the dedupe pass cannot mask a mis-ordering.
 *
 * The expectation is an INDEPENDENT recomputation off the registry (per-row
 * clauses, classified by `family` + `FILM_STYLE_KEYS`, re-assembled by hand),
 * not a second call through the composer — so a composer that slotted a row
 * wrongly would have to be wrong in the registry to pass.
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

  it("folds all 35 dimensions into body, film line and scene line", () => {
    const filmKeys: readonly string[] = FILM_STYLE_KEYS
    const bySlot: Record<"body" | "film" | "scene", string[]> = { body: [], film: [], scene: [] }
    for (const row of directionFieldsForSurface("video")) {
      const slot =
        row.family === "motion" ? "body" : filmKeys.includes(row.key) ? "film" : "scene"
      bySlot[slot].push(
        ...renderDirectionHints(
          { [row.key]: EVERY_VIDEO_DIMENSION[row.key] },
          { surface: "video", mode: VIDEO_HINT_MODE_DEFAULT },
        ),
      )
    }
    const every = [...bySlot.body, ...bySlot.film, ...bySlot.scene]
    expect(new Set(every).size, "fixture ids must render distinct clauses").toBe(every.length)
    // Every slot has to be occupied or the assembly below proves less than it
    // looks (an empty film line would collapse the section to one line).
    for (const slot of ["body", "film", "scene"] as const) {
      expect(bySlot[slot].length, slot).toBeGreaterThan(0)
    }

    expect(composeVideoPromptText("a knight", EVERY_VIDEO_DIMENSION)).toBe(
      `${["a knight", ...bySlot.body].join(". ")}` +
        `\n\n[style]:\n${bySlot.film.join(". ")}\n${bySlot.scene.join(". ")}`,
    )
  })

  it("puts the five film rows on the film line and nothing else", () => {
    expect(FILM_STYLE_KEYS).toEqual([
      "cameraFormat",
      "colorLook",
      "style",
      "era",
      "cameraFormatId",
    ])
    const filmLine = composeVideoPromptText("a knight", EVERY_VIDEO_DIMENSION)!
      .split("\n\n[style]:\n")[1]!
      .split("\n")[0]!
    for (const key of FILM_STYLE_KEYS) {
      if (!(key in EVERY_VIDEO_DIMENSION)) continue
      const [clause] = renderDirectionHints(
        { [key]: EVERY_VIDEO_DIMENSION[key] },
        { surface: "video", mode: VIDEO_HINT_MODE_DEFAULT },
      )
      expect(filmLine, key).toContain(clause)
    }
    // …and a scene-line dimension never leaks onto it.
    expect(filmLine).not.toContain(
      renderDirectionHints(
        { setting: EVERY_VIDEO_DIMENSION.setting },
        { surface: "video", mode: VIDEO_HINT_MODE_DEFAULT },
      )[0],
    )
  })
})
