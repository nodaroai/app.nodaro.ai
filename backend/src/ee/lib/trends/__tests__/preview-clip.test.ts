/**
 * The preview's input clip: the pure rules (ee/lib/trends/preview-clip.ts)
 * and what publishing needs of it (publish-check.ts).
 *
 * What must hold:
 *  - the cut is the 4 s window plus up to 1 s of real footage, never past the
 *    source's end;
 *  - a stored clip is current only when cut from THIS source at THIS start
 *    with THIS recipe, carrying the current stored face mask's cut (and no
 *    cut when there is no current mask);
 *  - a draft that offers no preview has no clip (`not_offered`), and
 *    `withoutPreviewClip` drops a stored one;
 *  - `withNewSourceClip` (an upscale or crop put in) drops the clip and
 *    records the new clip's hash;
 *  - publishing a trend that offers a preview needs a current clip
 *    (`preview_clip_missing` / `preview_clip_out_of_date` with `why`); one
 *    that offers none needs nothing;
 *  - `previewClip` is server-owned: a client's draft body never sets it.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import type { EngineEnvironment } from "../../engine-environments.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import { PREVIEW_CLIP_RECIPE, PREVIEW_CLIP_TAIL_SECONDS, currentPreviewClip, previewClipDurationSec, previewClipState, withoutPreviewClip } from "../preview-clip.js"
import { publishBlockers } from "../publish-check.js"
import { PREVIEW_SECONDS } from "../schemas.js"
import { SERVER_OWNED_DRAFT_FIELDS, withServerOwnedFields } from "../server-owned.js"
import { withNewSourceClip } from "../upscale.js"
import type { TrendFaceMask, TrendPreviewClip, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const MASK_URL = "https://cdn.example/trends/t1/mask.mp4"
const MASKING = { mode: "always" as const, threshold: 0.4 }

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 2,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    ...over,
  }
}

function clip(over: Partial<TrendPreviewClip> = {}): TrendPreviewClip {
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4",
    durationSec: 5,
    width: 240,
    height: 320,
    frames: 150,
    sha256: "a".repeat(64),
    sourceVideoUrl: SRC,
    startSec: 2,
    recipe: PREVIEW_CLIP_RECIPE,
    madeAt: "2026-10-27T10:00:00.000Z",
    ...over,
  }
}

const MASK_CUT = { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: MASK_URL }

function mask(d: Pick<TrendVersionData, "source" | "faceMasking">): TrendFaceMask {
  return {
    url: MASK_URL,
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "j1",
    stats: { shots: 1, heldFrames: 0, coverage: 0.02, droppedRegions: 0 },
    approvedAt: "2026-10-26T00:00:00Z",
    approvedBy: "admin",
  }
}

const SUPPORTS = {
  roleKinds: ["person", "location", "product", "pet"] as Array<"person" | "location" | "product" | "pet">,
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"] as Array<"480p" | "720p" | "1080p">,
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  faceMaskRecipe: "1",
  trendPrePrompt: true,
}
const env = (name: string): EngineEnvironment => ({ env: name, pluginBuildId: "b", supports: { castSwap: { ...SUPPORTS } }, updatedAt: "2026-10-20T00:00:00Z" })
const ENVS = [env("production"), env("staging")]
const REQUIRED = ["production", "staging"]
const codes = (d: TrendVersionData) => publishBlockers(d, ENVS, REQUIRED).map((b) => b.code)

describe("previewClipDurationSec", () => {
  it("is the 4 s window plus 1 s of real footage, within the source", () => {
    expect(PREVIEW_CLIP_TAIL_SECONDS).toBe(1)
    expect(previewClipDurationSec(12, 2)).toBe(PREVIEW_SECONDS + 1)
    // The window at the very end: the 4 s only (nothing after it).
    expect(previewClipDurationSec(12, 8)).toBe(4)
    // Half a second after the window: half a second of tail.
    expect(previewClipDurationSec(12, 7.5)).toBeCloseTo(4.5)
    // A source exactly 4 s: the whole clip.
    expect(previewClipDurationSec(4, 0)).toBe(4)
    // A start past the end (never valid, but never negative).
    expect(previewClipDurationSec(4, 5)).toBe(0)
  })
})

describe("previewClipState", () => {
  it("not_offered without a preview or a source; missing without a clip; current with a matching one", () => {
    expect(previewClipState(data({ previewStart: null }))).toEqual({ kind: "not_offered" })
    expect(previewClipState(data({ previewStart: null, previewClip: clip() }))).toEqual({ kind: "not_offered" })
    expect(previewClipState(data({ source: null }))).toEqual({ kind: "not_offered" })
    expect(previewClipState(data())).toEqual({ kind: "missing" })
    expect(previewClipState(data({ previewClip: clip() }))).toEqual({ kind: "current", clip: clip() })
    expect(currentPreviewClip(data({ previewClip: clip() }))).toEqual(clip())
    expect(currentPreviewClip(data())).toBeUndefined()
  })

  it("is out of date when the source, the start or the recipe moved, in that order of reasons", () => {
    expect(previewClipState(data({ previewClip: clip({ sourceVideoUrl: "https://cdn.example/trends/t1/other.mp4" }) }))).toEqual({ kind: "out_of_date", why: "source" })
    expect(previewClipState(data({ previewStart: 3, previewClip: clip() }))).toEqual({ kind: "out_of_date", why: "start" })
    expect(previewClipState(data({ previewClip: clip({ recipe: "0" }) }))).toEqual({ kind: "out_of_date", why: "recipe" })
    // The source wins over the start when both moved: it is the first thing to fix.
    expect(previewClipState(data({ previewStart: 3, previewClip: clip({ sourceVideoUrl: "https://x/other.mp4" }) }))).toEqual({ kind: "out_of_date", why: "source" })
  })

  it("follows the stored face mask: a current mask needs its cut; no mask needs none; another mask is out of date", () => {
    const masked = data({ faceMasking: MASKING })
    const withMask = { ...masked, faceMask: mask(masked) }
    // A mask approved, the clip cut before it: out of date.
    expect(previewClipState({ ...withMask, previewClip: clip() })).toEqual({ kind: "out_of_date", why: "face_mask" })
    // Cut with the mask: current.
    expect(previewClipState({ ...withMask, previewClip: clip({ faceMask: MASK_CUT }) })).toMatchObject({ kind: "current" })
    // Cut with another mask: out of date.
    expect(previewClipState({ ...withMask, previewClip: clip({ faceMask: { ...MASK_CUT, sourceMaskUrl: "https://x/old-mask.mp4" } }) })).toEqual({ kind: "out_of_date", why: "face_mask" })
    // The mask cleared (or no longer matching the settings): a clip carrying a mask cut is out of date.
    expect(previewClipState({ ...masked, previewClip: clip({ faceMask: MASK_CUT }) })).toEqual({ kind: "out_of_date", why: "face_mask" })
    expect(previewClipState({ ...withMask, faceMasking: { ...MASKING, threshold: 0.6 }, previewClip: clip({ faceMask: MASK_CUT }) })).toEqual({ kind: "out_of_date", why: "face_mask" })
    // Masking off: the stored mask is not sent, so the clip needs no cut.
    expect(previewClipState({ ...withMask, faceMasking: { mode: "off" }, previewClip: clip() })).toMatchObject({ kind: "current" })
  })
})

describe("withoutPreviewClip / withNewSourceClip", () => {
  it("drops the clip (the key left out), and returns the same object when there is none", () => {
    const d = data({ previewClip: clip() })
    expect(withoutPreviewClip(d)).not.toHaveProperty("previewClip")
    expect(withoutPreviewClip(d)).toEqual(data())
    const none = data()
    expect(withoutPreviewClip(none)).toBe(none)
  })

  it("a new source clip drops the stored preview clip and records the new clip's hash", () => {
    const d = data({ previewClip: clip() })
    const next = withNewSourceClip(d, { url: "https://cdn.example/trends/t1/up.mp4", durationSec: 11.96, width: 1080, height: 1920, sha256: "c".repeat(64) })
    expect(next).not.toHaveProperty("previewClip")
    expect(next.source).toEqual({ videoUrl: "https://cdn.example/trends/t1/up.mp4", durationSec: 11.96, width: 1080, height: 1920, sha256: "c".repeat(64) })
    // Without a hash (a store that could not read one): no key.
    const unhashed = withNewSourceClip(d, { url: "https://cdn.example/trends/t1/up.mp4", durationSec: 11.96, width: 1080, height: 1920 })
    expect(unhashed.source).not.toHaveProperty("sha256")
  })
})

describe("publishing", () => {
  it("needs a current preview clip when the trend offers a preview, and nothing when it does not", () => {
    expect(codes(data({ previewClip: clip() }))).toEqual([])
    expect(codes(data({ previewStart: null }))).toEqual([])
    expect(publishBlockers(data(), ENVS, REQUIRED)).toEqual([{ code: "preview_clip_missing", message: expect.stringContaining("not prepared yet") }])
    expect(publishBlockers(data({ previewStart: 3, previewClip: clip() }), ENVS, REQUIRED)).toEqual([
      { code: "preview_clip_out_of_date", why: "start", message: expect.stringContaining("preview start moved") },
    ])
    expect(publishBlockers(data({ previewClip: clip({ sourceVideoUrl: "https://x/other.mp4" }) }), ENVS, REQUIRED)).toEqual([
      { code: "preview_clip_out_of_date", why: "source", message: expect.stringContaining("source clip changed") },
    ])
    expect(publishBlockers(data({ previewClip: clip({ recipe: "0" }) }), ENVS, REQUIRED)).toEqual([
      { code: "preview_clip_out_of_date", why: "recipe", message: expect.stringContaining("cut differently") },
    ])
    const masked = data({ faceMasking: MASKING })
    expect(publishBlockers({ ...masked, faceMask: mask(masked), previewClip: clip() }, ENVS, REQUIRED)).toEqual([
      { code: "preview_clip_out_of_date", why: "face_mask", message: expect.stringContaining("face mask changed") },
    ])
    expect(codes({ ...masked, faceMask: mask(masked), previewClip: clip({ faceMask: MASK_CUT }) })).toEqual([])
  })

  it("is listed beside the source's own blockers, never instead of them", () => {
    const { display: _d, ...bare } = data().source!
    expect(codes(data({ source: bare }))).toEqual(["source_display_missing", "preview_clip_missing"])
    expect(codes(data({ source: null }))).toEqual(["source_missing"])
  })
})

describe("the server-owned preview clip", () => {
  it("is in the server-owned list: a client's body never sets it, and the stored one is kept", () => {
    expect(SERVER_OWNED_DRAFT_FIELDS).toContain("previewClip")
    const stored = data({ previewClip: clip() })
    const merged = withServerOwnedFields({ ...data(), previewClip: clip({ sha256: "f".repeat(64) }) }, stored)
    expect(merged.previewClip).toEqual(clip())
    expect(withServerOwnedFields({ ...data(), previewClip: clip() }, data())).not.toHaveProperty("previewClip")
  })
})
