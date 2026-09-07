import { describe, it, expect } from "vitest"
import {
  ATMOSPHERES,
  CAMERA_MOTIONS,
  COLOR_LOOKS,
  DIRECTION_KEYS,
  FRAMINGS,
  IMAGE_HINT_MODE_DEFAULT,
  POST_PROCESS_EFFECTS,
  TRANSITIONS,
  VIDEO_HINT_MODE_DEFAULT,
  getAtmospherePromptHint,
  getColorLookPromptHint,
  getColorLookTerm,
  getFramingPromptHint,
  getPostProcessEffectPromptHint,
  getTransitionPromptHint,
  getTransitionTerm,
  renderDirectionHints,
} from "@nodaro/prompts"

import {
  directionHints,
  directionWireFields,
  appendHints,
  IMAGE_HINT_MODE,
  VIDEO_HINT_MODE,
  type Direction,
} from "../direction"
import { CAMERA_MOVEMENT_KEY } from "../look-pickers"
import { RETIRED_LOOK_IDS } from "../look-pickers"
import { directionWithoutTransition } from "../transition"

/**
 * The PROJECTION is the load-bearing decision: studio sends catalog IDS on the
 * `direction` channel and folds NO look clause itself, on either stage. Pin the
 * projection's contract — surface filtering, arrays, retired-id migration, no-op
 * drops, and omit-when-empty — so a future "just bake it into the text again"
 * would be a deliberate edit, not silent drift.
 */

// Pick catalog entries that actually carry a prompt hint, so the assertions are
// exact (catalog data could in theory have empty hints).
const framing = FRAMINGS.find(
  (f) => f.category === "shot-size" && getFramingPromptHint(f.id).length > 0,
)!
const colorLook = COLOR_LOOKS.find((c) => getColorLookPromptHint(c.id).length > 0)!
const atmosphere = ATMOSPHERES.find((a) => getAtmospherePromptHint(a.id).length > 0)!

const D: Direction = {
  framingId: framing.id,
  colorLookId: colorLook.id,
  atmosphereId: atmosphere.id,
}

describe("directionWireFields — studio picker keys → the platform wire", () => {
  it("maps every set dimension onto its canonical platform key", () => {
    const image = directionWireFields(D, "image")
    // `framingId` (the studio pill key) projects onto the CANONICAL registry key
    // — not the pre-registry legacy `framingId` slot.
    expect(image).toEqual({
      shotSize: framing.id,
      colorLook: colorLook.id,
      atmosphere: [atmosphere.id],
    })
    // Every emitted key is a real registry key, or the route would drop it.
    for (const k of Object.keys(image!)) {
      expect(DIRECTION_KEYS).toContain(k)
    }
  })

  it("filters by SURFACE — an image-only dimension never rides a video run", () => {
    const postProcess = POST_PROCESS_EFFECTS.find(
      (e) => getPostProcessEffectPromptHint(e.id).length > 0,
    )!
    const d: Direction = { postProcessId: postProcess.id, colorLookId: colorLook.id }
    expect(directionWireFields(d, "image")).toHaveProperty("postProcess")
    expect(directionWireFields(d, "video")).not.toHaveProperty("postProcess")
    // …and a video-only dimension never rides an image run.
    const v: Direction = {
      transitionId: TRANSITIONS.find(
        (t) => getTransitionPromptHint(t.id).length > 0,
      )!.id,
    }
    expect(directionWireFields(v, "video")).toHaveProperty("transition")
    expect(directionWireFields(v, "image")).toBeUndefined()
  })

  it("keeps a multi-pick dimension as an ARRAY and a single-pick as a bare id", () => {
    const [a1, a2] = ATMOSPHERES.filter(
      (a) => getAtmospherePromptHint(a.id).length > 0,
    ).slice(0, 2)
    const out = directionWireFields(
      { atmosphereId: [a1.id, a2.id], colorLookId: colorLook.id },
      "image",
    )
    expect(out?.atmosphere).toEqual([a1.id, a2.id])
    expect(out?.colorLook).toBe(colorLook.id)
  })

  it("applies the RETIRED-id migration on the wire, not just in the menus", () => {
    const [retired, replacement] = Object.entries(RETIRED_LOOK_IDS)[0]
    expect(directionWireFields({ framingId: retired }, "image")).toEqual({
      shotSize: replacement,
    })
  })

  it("DROPS a no-op id, so camera-motion Auto alone projects to nothing", () => {
    // "auto" carries an empty promptHint — folding nothing. Keeping the key
    // would make the omit-when-empty guard below a lie.
    expect(CAMERA_MOTIONS.find((m) => m.id === "auto")?.promptHint).toBe("")
    expect(
      directionWireFields({ [CAMERA_MOVEMENT_KEY]: "auto" }, "video"),
    ).toBeUndefined()
    // A REAL motion still rides, and it rides as `cameraMotion`.
    const real = CAMERA_MOTIONS.find((m) => m.promptHint.length > 0)!
    expect(
      directionWireFields({ [CAMERA_MOVEMENT_KEY]: real.id }, "video"),
    ).toEqual({ cameraMotion: real.id })
  })

  it("returns UNDEFINED (never `{}`) when nothing projects", () => {
    // `direction: {}` is truthy for /v1/generate-image's `isStructuredImageMode`
    // check and relaxes the prompt to `.min(0)` — an empty object must never
    // reach the wire, on either stage.
    expect(directionWireFields({}, "image")).toBeUndefined()
    expect(directionWireFields({}, "video")).toBeUndefined()
    expect(directionWireFields({ colorLookId: "" }, "image")).toBeUndefined()
  })

  it("appendHints comma-joins onto a trimmed prompt, skipping empties", () => {
    // Still the join for the CLIENT channel (Subject clauses, per-beat picks).
    expect(appendHints("a knight", ["dramatic", ""])).toBe("a knight, dramatic")
    expect(appendHints("  x  ", [])).toBe("x")
    expect(appendHints("   ", [])).toBe("")
    expect(appendHints("", ["only hint"])).toBe("only hint")
  })
})

/**
 * VERBOSITY is the second axis, and it is the one that can silently change every
 * prompt the studio sends. It now lives entirely server-side, so the pin is that
 * studio's two policy constants ARE the platform's defaults — a fork would make
 * the preview claim a phrasing the route doesn't produce.
 */

// A transition whose compact term genuinely DIFFERS from its full hint — so
// "motion folded compact" cannot pass by accident on an entry where the two
// strings happen to coincide.
const transition = TRANSITIONS.find(
  (t) =>
    getTransitionTerm(t.id).length > 0 &&
    getTransitionTerm(t.id) !== getTransitionPromptHint(t.id),
)!

// A look + a motion dimension in ONE selection — the mixed case the split exists
// for. Registry order puts Light & Color before Motion & Time.
const MIXED: Direction = {
  colorLookId: colorLook.id,
  transitionId: transition.id,
}

describe("direction — verbosity policy is the platform's", () => {
  it("IMAGE_HINT_MODE / VIDEO_HINT_MODE ARE the platform defaults", () => {
    expect(IMAGE_HINT_MODE).toEqual(IMAGE_HINT_MODE_DEFAULT)
    expect(VIDEO_HINT_MODE).toEqual(VIDEO_HINT_MODE_DEFAULT)
  })

  it("VIDEO folds the MOTION family compact and the LOOK full", () => {
    const hints = directionHints(directionWireFields(MIXED, "video"), "video")
    expect(hints).toEqual([
      getColorLookPromptHint(colorLook.id),
      getTransitionTerm(transition.id),
    ])
    // The paragraph the motion picker used to inject is gone, not merely joined.
    expect(hints).not.toContain(getTransitionPromptHint(transition.id))
  })

  it("IMAGE never receives a compact term", () => {
    const hints = directionHints(directionWireFields(D, "image"), "image")
    expect(hints).toContain(getFramingPromptHint(framing.id))
    expect(hints).toContain(getColorLookPromptHint(colorLook.id))
    expect(hints).toContain(getAtmospherePromptHint(atmosphere.id))
    expect(hints).not.toContain(getColorLookTerm(colorLook.id))
  })

  it("directionHints is EXACTLY the platform renderer — never a re-fold", () => {
    // G4's core: the preview and the server must render the same object the
    // same way. Any client re-implementation would lie (six dimensions render
    // differently server-side, and the whole fold is clause-deduped).
    const image = directionWireFields(D, "image")
    expect(directionHints(image, "image")).toEqual(
      renderDirectionHints(image, {
        surface: "image",
        mode: IMAGE_HINT_MODE_DEFAULT,
      }),
    )
    const video = directionWireFields(MIXED, "video")
    expect(directionHints(video, "video")).toEqual(
      renderDirectionHints(video, {
        surface: "video",
        mode: VIDEO_HINT_MODE_DEFAULT,
      }),
    )
    expect(directionHints(undefined, "image")).toEqual([])
  })
})

/**
 * The scene's Transition pill and the shots' own transition nodes both reach
 * this one projection. While shots are up they own the boundary — one node each
 * — so a scene-level pick made before they existed must step aside rather than
 * ride along invisibly beside them. The carve-out now happens ON THE PROJECTION
 * (the wire), which is the only place it can still be observed.
 */
describe("a scene's Transition steps aside for the shots' own", () => {
  it("drops ONLY the transition from the wire", () => {
    expect(
      directionWireFields(directionWithoutTransition(MIXED), "video"),
    ).toEqual({ colorLook: colorLook.id })
  })

  it("keeps the PICK — turning the shots off brings it back", () => {
    // Dropped from the fold, never from the selection: the pill is hidden while
    // shots are up, so erasing the value here would be deleting a choice the
    // user could no longer see to re-make.
    const kept = directionWithoutTransition(MIXED)
    expect(MIXED.transitionId).toBe(transition.id)
    expect(directionWireFields(MIXED, "video")).toHaveProperty("transition")
    expect(kept).not.toBe(MIXED)
  })

  it("a scene with no transition pays nothing", () => {
    const bare: Direction = { colorLookId: colorLook.id }
    expect(directionWithoutTransition(bare)).toBe(bare)
  })
})
