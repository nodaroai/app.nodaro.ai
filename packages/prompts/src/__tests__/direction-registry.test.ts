import { describe, it, expect } from "vitest"
import {
  DIRECTION_FIELDS,
  DIRECTION_KEYS,
  DIRECTION_ARRAY_CEILING,
  IMAGE_HINT_MODE_DEFAULT,
  VIDEO_HINT_MODE_DEFAULT,
  directionFieldsForSurface,
  modeForFamily,
  renderDirectionHints,
} from "../direction-registry.js"
import {
  buildFramingHints,
  getFramingPromptHint,
  getFramingTerm,
  getFramingCategoryLimit,
  FRAMING_FIELD_BY_CATEGORY,
  type FramingCategory,
} from "../framing.js"
import { buildLightingHints, getLightingPromptHint } from "../lighting.js"
import { buildExposureHints } from "../exposure-settings.js"
import { getLensPromptHint } from "../lens.js"
import { getCameraFormatPromptHint } from "../camera-format.js"
import { buildMoodHints } from "../mood.js"
import { buildAestheticHints } from "../aesthetic.js"
import { buildPhotographerHints } from "../photographer.js"
import { buildAtmosphereHints } from "../atmosphere.js"
import { getStylePromptHint, getStyleTerm } from "../style.js"
import { getCameraMotionPromptHint, getCameraMotionTerm } from "../camera-motions.js"

/**
 * The direction registry is the platform-owned contract for the flat
 * `direction` wire channel: WHICH dimensions ride it, in WHAT order they fold,
 * and HOW each catalog renders its selection. Every assertion here is a pin on
 * that contract — a failure means a reorder / retable was intentional and the
 * changeset has to say so.
 */

const IMAGE = { surface: "image" } as const
const VIDEO = { surface: "video" } as const

// Real catalog ids (every getter returns "" on a miss, so a fake id would make
// most of these assertions vacuously pass).
const NO_SUCH_ID = "__no_such_id__"

describe("DIRECTION_FIELDS — table integrity", () => {
  it("has unique keys", () => {
    const keys = DIRECTION_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("gives every row a positive maxPicks and a render function", () => {
    for (const spec of DIRECTION_FIELDS) {
      expect(spec.maxPicks, spec.key).toBeGreaterThanOrEqual(1)
      expect(typeof spec.render, spec.key).toBe("function")
    }
  })

  it("exports DIRECTION_KEYS in table order", () => {
    expect(DIRECTION_KEYS).toEqual(DIRECTION_FIELDS.map((f) => f.key))
  })

  // ── THE ORDER PIN ────────────────────────────────────────────────────────
  // The canonical fold order, exported so a client preview cannot drift from
  // the server. Camera motion leads; the five pre-registry keys form the
  // LEGACY BLOCK at the tail (see the legacy-tail pin below).
  it("pins the canonical fold order (42 keys)", () => {
    expect(DIRECTION_KEYS).toEqual([
      "cameraMotion",
      "shotSize",
      "angle",
      "coverage",
      "composition",
      "vantage",
      "pose",
      "compositionEffect",
      "cameraFormat",
      "lens",
      "aperture",
      "shutterSpeed",
      "isoValue",
      "timeOfDay",
      "lightingStyle",
      "lightingDirection",
      "lightingRatio",
      "colorTemperature",
      "colorLook",
      "atmosphere",
      "postProcess",
      "style",
      "mood",
      "aesthetic",
      "photoGenre",
      "photographer",
      "renderQuality",
      "setting",
      "era",
      "backdrop",
      "actionFx",
      "temporalSpeed",
      "temporalFreeze",
      "temporalDirection",
      "temporalShutter",
      "transition",
      "loopSubject",
      "framingId",
      "framingAngleId",
      "lightingId",
      "lensId",
      "cameraFormatId",
    ])
  })

  // ── THE LEGACY-TAIL PIN (the darkness guarantee) ─────────────────────────
  // This is what makes "no prompt text changed for any EXISTING caller" true:
  // the five pre-registry keys sit LAST, in the exact order the old inlined
  // `composePromptText` folded them. Re-sorting the table must fail loudly.
  it("keeps the five pre-registry keys last, in their original fold order", () => {
    expect(DIRECTION_KEYS.slice(-5)).toEqual([
      "framingId",
      "framingAngleId",
      "lightingId",
      "lensId",
      "cameraFormatId",
    ])
  })

  it("folds a legacy-only direction in the original order", () => {
    const hints = renderDirectionHints(
      {
        framingId: "wide-shot",
        framingAngleId: "low-angle",
        lightingId: "dawn",
        lensId: "wide-24mm",
        cameraFormatId: "16mm-film",
      },
      IMAGE,
    )
    expect(hints).toEqual([
      getFramingPromptHint("wide-shot"),
      getFramingPromptHint("low-angle"),
      getLightingPromptHint("dawn"),
      getLensPromptHint("wide-24mm"),
      getCameraFormatPromptHint("16mm-film"),
    ])
  })

  // ── COUNT PIN ────────────────────────────────────────────────────────────
  it("pins the surface split", () => {
    expect(DIRECTION_FIELDS).toHaveLength(42)
    expect(DIRECTION_FIELDS.filter((f) => f.surface === "both")).toHaveLength(27)
    expect(DIRECTION_FIELDS.filter((f) => f.surface === "image")).toHaveLength(7)
    expect(DIRECTION_FIELDS.filter((f) => f.surface === "video")).toHaveLength(8)
    expect(directionFieldsForSurface("image")).toHaveLength(34)
    expect(directionFieldsForSurface("video")).toHaveLength(35)
  })

  it("excludes characterFx (it needs a per-shot composer, not a bare id)", () => {
    expect(DIRECTION_KEYS).not.toContain("characterFx")
  })

  it("exposes a wire array ceiling above every per-row cap", () => {
    for (const spec of DIRECTION_FIELDS) {
      expect(spec.maxPicks, spec.key).toBeLessThanOrEqual(DIRECTION_ARRAY_CEILING)
    }
  })

  // ── CANONICAL-CAP PIN ────────────────────────────────────────────────────
  // `maxPicks` is written as a literal per row (the table stays readable, and
  // most catalogs have no exported cap to derive from), but where the platform
  // DOES own a canonical per-dimension limit the two must agree. Framing is
  // that case: `getFramingCategoryLimit` is the source of truth the pickers
  // read, so raising it (e.g. composition 2 → 3) must fail here rather than
  // leave the registry silently slicing to the stale number.
  it("matches the canonical framing category limits", () => {
    const byKey = new Map(DIRECTION_FIELDS.map((f) => [f.key as string, f.maxPicks]))
    for (const [category, field] of Object.entries(FRAMING_FIELD_BY_CATEGORY)) {
      expect(byKey.get(field), field).toBe(getFramingCategoryLimit(category as FramingCategory))
    }
  })
})

describe("renderDirectionHints — totality", () => {
  it("renders nothing for an empty id list, in both modes", () => {
    for (const spec of DIRECTION_FIELDS) {
      expect(spec.render([], "full"), spec.key).toEqual([])
      expect(spec.render([], "compact"), spec.key).toEqual([])
    }
  })

  it("renders nothing for an unknown id, in both modes (never throws)", () => {
    for (const spec of DIRECTION_FIELDS) {
      expect(spec.render([NO_SUCH_ID], "full"), spec.key).toEqual([])
      expect(spec.render([NO_SUCH_ID], "compact"), spec.key).toEqual([])
    }
  })

  it("returns [] for undefined / {} / empty values", () => {
    expect(renderDirectionHints(undefined, IMAGE)).toEqual([])
    expect(renderDirectionHints({}, IMAGE)).toEqual([])
    expect(renderDirectionHints({ style: "" }, IMAGE)).toEqual([])
    expect(renderDirectionHints({ mood: [] }, IMAGE)).toEqual([])
    expect(renderDirectionHints({ style: NO_SUCH_ID }, IMAGE)).toEqual([])
  })

  it("ignores wire keys that are not in the table", () => {
    expect(
      renderDirectionHints({ notAKey: "whatever" } as never, IMAGE),
    ).toEqual([])
  })
})

describe("renderDirectionHints — surface filtering", () => {
  it("makes a video-only key inert on the image surface", () => {
    expect(renderDirectionHints({ cameraMotion: "handheld" }, IMAGE)).toEqual([])
    expect(renderDirectionHints({ temporalSpeed: "slow-motion" }, IMAGE)).toEqual([])
    expect(renderDirectionHints({ actionFx: "earthquake-tremor" }, IMAGE)).toEqual([])
  })

  it("makes an image-only key inert on the video surface", () => {
    expect(renderDirectionHints({ aperture: "aperture-f1-4" }, VIDEO)).toEqual([])
    expect(renderDirectionHints({ photographer: "tim-walker" }, VIDEO)).toEqual([])
  })

  it("renders a `both` key on both surfaces", () => {
    const expected = [getStylePromptHint("anime")]
    expect(renderDirectionHints({ style: "anime" }, IMAGE)).toEqual(expected)
    expect(renderDirectionHints({ style: "anime" }, VIDEO)).toEqual(expected)
  })

  it("folds in table order regardless of the caller's object-literal order", () => {
    const hints = renderDirectionHints({ style: "anime", shotSize: "wide-shot" }, IMAGE)
    expect(hints).toEqual([getFramingPromptHint("wide-shot"), getStylePromptHint("anime")])
  })
})

describe("renderDirectionHints — multiplicity", () => {
  it("caps a multi-pick dimension at its maxPicks", () => {
    const capped = renderDirectionHints({ mood: ["happy", "joyful", "relieved"] }, IMAGE)
    expect(capped).toEqual(buildMoodHints({ mood: ["happy", "joyful"] }, "full"))
  })

  it("tolerates an array on a single-pick key (top pick wins, no throw)", () => {
    expect(renderDirectionHints({ style: ["anime", "3d-render"] }, IMAGE)).toEqual([
      getStylePromptHint("anime"),
    ])
  })

  it("de-dupes repeated ids inside one key", () => {
    expect(renderDirectionHints({ atmosphere: ["clear", "clear"] }, IMAGE)).toEqual(
      buildAtmosphereHints("clear", "full"),
    )
  })
})

// ── THE DEDUPE INVARIANT ───────────────────────────────────────────────────
// The five legacy whole-catalog keys address the SAME catalogs as their
// canonical counterparts but are NOT aliases of one category — so overlap is
// resolved by exact-clause dedupe, never by an alias table.
describe("renderDirectionHints — dedupe invariant", () => {
  it("emits ONE clause when a legacy key and its canonical counterpart carry the same id", () => {
    expect(renderDirectionHints({ framingId: "wide-shot", shotSize: "wide-shot" }, IMAGE)).toEqual([
      getFramingPromptHint("wide-shot"),
    ])
  })

  it("emits BOTH clauses for two DIFFERENT ids of one catalog (what an alias table would have broken)", () => {
    const hints = renderDirectionHints(
      { lightingId: "dawn", lightingStyle: "rembrandt" },
      IMAGE,
    )
    expect(hints).toHaveLength(2)
    expect(hints).toContain(getLightingPromptHint("dawn"))
    expect(hints).toContain(getLightingPromptHint("rembrandt"))
  })

  it("collapses the degenerate legacy case: the same id on two keys of one catalog", () => {
    // The single documented byte difference for a pre-registry caller: this
    // emitted the identical clause TWICE before the registry.
    expect(
      renderDirectionHints({ framingId: "wide-shot", framingAngleId: "wide-shot" }, IMAGE),
    ).toEqual([getFramingPromptHint("wide-shot")])
  })
})

// ── BLEND SEMANTICS ────────────────────────────────────────────────────────
// Mood / Aesthetic / Photographer emit ONE blended clause for a multi-pick, not
// one paragraph per id. A naive per-id loop would silently regress this.
describe("renderDirectionHints — blend catalogs", () => {
  it("blends two moods into the catalog's own single clause", () => {
    const hints = renderDirectionHints({ mood: ["happy", "joyful"] }, IMAGE)
    expect(hints).toEqual(buildMoodHints({ mood: ["happy", "joyful"] }, "full"))
    expect(hints).toHaveLength(1)
  })

  it("blends two aesthetics through buildAestheticHints", () => {
    const hints = renderDirectionHints({ aesthetic: ["y2k", "cottagecore"] }, IMAGE)
    expect(hints).toHaveLength(1)
    expect(hints).toEqual([buildAestheticHints(["y2k", "cottagecore"], "full")])
  })

  it("blends two photographers through buildPhotographerHints", () => {
    const hints = renderDirectionHints(
      { photographer: ["tim-walker", "paolo-roversi"] },
      IMAGE,
    )
    expect(hints).toHaveLength(1)
    expect(hints).toEqual([buildPhotographerHints(["tim-walker", "paolo-roversi"], "full")])
  })
})

// ── FAMILY EQUIVALENCE ─────────────────────────────────────────────────────
// Ties the flat per-category keys to the canonical family walks FOREVER: the
// registry must render exactly what a wired picker node of that family does.
describe("renderDirectionHints — family equivalence with the canonical builders", () => {
  it("matches buildFramingHints for the five framing keys", () => {
    const framing = {
      shotSize: "wide-shot",
      angle: "low-angle",
      coverage: "two-shot",
      composition: "rule-of-thirds",
      vantage: "profile-left",
    }
    expect(renderDirectionHints(framing, IMAGE)).toEqual(
      buildFramingHints(framing, false, "full"),
    )
  })

  it("matches buildLightingHints for the five lighting keys", () => {
    const lighting = {
      timeOfDay: "dawn",
      lightingStyle: "rembrandt",
      lightingDirection: "side",
      lightingRatio: "ratio-1-2",
      colorTemperature: "temp-3200k",
    }
    expect(renderDirectionHints(lighting, IMAGE)).toEqual(buildLightingHints(lighting, "full"))
  })

  it("matches buildExposureHints for the three exposure keys", () => {
    const exposure = {
      aperture: "aperture-f1-4",
      shutterSpeed: "shutter-1-60",
      isoValue: "iso-400",
    }
    expect(renderDirectionHints(exposure, IMAGE)).toEqual(buildExposureHints(exposure, "full"))
  })
})

describe("hint modes", () => {
  it("resolves a flat mode for both families", () => {
    expect(modeForFamily("compact", "look")).toBe("compact")
    expect(modeForFamily("compact", "motion")).toBe("compact")
  })

  it("resolves a split mode per family", () => {
    expect(modeForFamily(VIDEO_HINT_MODE_DEFAULT, "look")).toBe("full")
    expect(modeForFamily(VIDEO_HINT_MODE_DEFAULT, "motion")).toBe("compact")
    expect(IMAGE_HINT_MODE_DEFAULT).toBe("full")
  })

  it("emits compact terms in compact mode", () => {
    expect(renderDirectionHints({ style: "anime" }, { ...IMAGE, mode: "compact" })).toEqual([
      getStyleTerm("anime"),
    ])
    expect(
      renderDirectionHints({ shotSize: "wide-shot" }, { ...IMAGE, mode: "compact" }),
    ).toEqual([getFramingTerm("wide-shot")])
  })

  it("applies the split mode per family on a video fold", () => {
    const hints = renderDirectionHints(
      { cameraMotion: "handheld", style: "anime" },
      { ...VIDEO, mode: VIDEO_HINT_MODE_DEFAULT },
    )
    // cameraMotion leads (motion → compact term); style follows (look → full).
    expect(hints).toEqual([getCameraMotionTerm("handheld"), getStylePromptHint("anime")])
    expect(hints[0]).not.toBe(getCameraMotionPromptHint("handheld"))
  })
})
