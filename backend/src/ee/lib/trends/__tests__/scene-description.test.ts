/**
 * A full-depth trend's stored scene descriptions (scene-description.ts,
 * decided 2026-10-28). What must hold:
 *
 *  - the face mask keeps both texts (≤ 4000 each), and they are not part of
 *    the settings key, so a clip with a description is the same clip;
 *  - a full-depth run whose scene is a description sends the stored text with
 *    the source window it covers: a preview run the preview's text and its
 *    4 s window (the preview's text while it was made for this start, else
 *    the whole clip's text, cut by the engine), a full run the whole clip's
 *    text and the whole clip;
 *  - nothing is sent for another scene, another clip preparation, or a clip
 *    made before descriptions existed;
 *  - both keys are stripped for an engine that does not declare
 *    `castSwap.storedSceneDescription` (or no longer takes the scene), so
 *    such an engine gets exactly the body it got before.
 */
import { afterEach, describe, expect, it } from "vitest"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { composeTrendRun } from "../compose.js"
import { faceMaskSettingsKey, storedFaceMaskFor } from "../face-mask.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import { sceneDescriptionText, sceneDescriptionsOf, sceneMakeFields, storedSceneDescriptionFor } from "../scene-description.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendFaceMask, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const FULL = { mode: "always" as const, source: "full-depth" as const }
const FULL_TEXT = "A neon kitchen. 0-6 s: the woman on the left dances; 6-12 s: the man joins."
const PREVIEW_TEXT = "0-4 s: the woman on the left spins."

function data(over: Partial<TrendVersionData> = {}, mask: Partial<TrendFaceMask> = {}): TrendVersionData {
  const d: TrendVersionData = {
    name: { en: "Dance" },
    source: { videoUrl: SRC, durationSec: 12 },
    previewStart: 3,
    slots: [
      { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman on the left" },
      { key: "pup", kind: "pet", label: { en: "Pup" }, required: false, roleName: "the dog" },
    ],
    references: [],
    examples: [],
    faceMasking: FULL,
    ...over,
  }
  return {
    ...d,
    faceMask: {
      url: "https://cdn.example/trends/t1/depth.mp4",
      frames: 360,
      recipe: { core: null, plugin: "1" },
      settingsKey: faceMaskSettingsKey(d)!,
      jobId: "job-1",
      stats: { shots: 0, heldFrames: 0, coverage: 1, droppedRegions: 0 },
      approvedAt: "2026-10-28T09:00:00.000Z",
      approvedBy: "admin",
      sceneDescription: FULL_TEXT,
      previewSceneDescription: PREVIEW_TEXT,
      previewSceneDescriptionStart: 3,
      ...mask,
    },
  }
}

const SUPPORTS = {
  roleKinds: ["person", "pet"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskRecipe: "1",
  sourceModes: ["faces", "full-depth", "keep-people"],
  promptStyles: ["precise", "flexible"],
  fullDepthScenes: ["description", "original", "none"],
}

const trend = (d: TrendVersionData) => ({ id: "t-1", slug: "dance", version: 1, data: d })
const run = (d: TrendVersionData, preview = false) =>
  composeTrendRun(trend(d), { slots: { lead: { images: ["https://cdn.example/me.png"] } }, ...(preview ? { preview: true } : {}) })

afterEach(() => _resetPluginSupportsForTests())

describe("storage", () => {
  it("the face mask keeps both texts up to 4000 characters, never an empty one", () => {
    expect(trendVersionDataSchema.safeParse(data()).success).toBe(true)
    expect(trendVersionDataSchema.safeParse(data({}, { sceneDescription: "x".repeat(4000) })).success).toBe(true)
    expect(trendVersionDataSchema.safeParse(data({}, { sceneDescription: "x".repeat(4001) })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({}, { previewSceneDescription: "x".repeat(4001) })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({}, { previewSceneDescription: "" })).success).toBe(false)
  })

  it("a description is not part of the clip: the stored clip stays the one sent", () => {
    const d = data({}, { sceneDescription: "Edited by the admin." })
    expect(d.faceMask!.settingsKey).toBe(faceMaskSettingsKey(data())!)
    expect(storedFaceMaskFor(d)).toEqual(storedFaceMaskFor(data()))
  })

  it("an engine's output is trimmed, capped and dropped when empty or not text", () => {
    expect(sceneDescriptionText("  A kitchen.\n")).toBe("A kitchen.")
    expect(sceneDescriptionText("x".repeat(4500))).toHaveLength(4000)
    expect(sceneDescriptionText("   ")).toBeUndefined()
    expect(sceneDescriptionText(7)).toBeUndefined()
    expect(sceneDescriptionsOf({ sceneDescription: " A. ", previewSceneDescription: null })).toEqual({ sceneDescription: "A." })
    expect(sceneDescriptionsOf({})).toEqual({})
    // The preview's start the make recorded, kept beside a preview text only.
    expect(sceneDescriptionsOf({ previewSceneDescription: "P." }, { previewStart: 2 })).toEqual({ previewSceneDescription: "P.", previewSceneDescriptionStart: 2 })
    expect(sceneDescriptionsOf({ sceneDescription: "A." }, { previewStart: 2 })).toEqual({ sceneDescription: "A." })
    expect(sceneDescriptionsOf({ previewSceneDescription: "P." }, { previewStart: "2" })).toEqual({ previewSceneDescription: "P." })
  })

  it("the make names each role by its role name and kind, with the preview's start", () => {
    expect(sceneMakeFields(data())).toEqual({
      roles: [
        { name: "the woman on the left", kind: "person" },
        { name: "the dog", kind: "pet" },
      ],
      previewStart: 3,
    })
    expect(sceneMakeFields(data({ previewStart: null }))).not.toHaveProperty("previewStart")
  })
})

describe("compose", () => {
  it("a full run sends the whole clip's text and the whole clip as its window", () => {
    const { body } = run(data())
    expect(body.sceneDescription).toBe(FULL_TEXT)
    expect(body.sceneDescriptionWindow).toEqual({ fromSec: 0, toSec: 12 })
  })

  it("a preview run sends the preview's text and its 4 s window while the text was made for this start", () => {
    const { body } = run(data(), true)
    expect(body.sceneDescription).toBe(PREVIEW_TEXT)
    expect(body.sceneDescriptionWindow).toEqual({ fromSec: 3, toSec: 7 })
  })

  it("a preview start moved since the make sends the whole clip's text, cut to the new window", () => {
    const { body } = run(data({ previewStart: 5 }), true)
    expect(body.sceneDescription).toBe(FULL_TEXT)
    expect(body.sceneDescriptionWindow).toEqual({ fromSec: 5, toSec: 9 })
    // A start never recorded reads as another start.
    const unrecorded = run(data({}, { previewSceneDescriptionStart: undefined }), true).body
    expect(unrecorded.sceneDescription).toBe(FULL_TEXT)
  })

  it("no preview text sends the whole clip's text, cut to the preview's window", () => {
    const { body } = run(data({}, { previewSceneDescription: undefined, previewSceneDescriptionStart: undefined }), true)
    expect(body.sceneDescription).toBe(FULL_TEXT)
    expect(body.sceneDescriptionWindow).toEqual({ fromSec: 3, toSec: 7 })
  })

  it("a full run is the same whatever the preview's text and start", () => {
    expect(run(data({ previewStart: 5 })).body.sceneDescription).toBe(FULL_TEXT)
    expect(run(data({ previewStart: 5 })).body.sceneDescriptionWindow).toEqual({ fromSec: 0, toSec: 12 })
  })

  it("the window is held to the clip", () => {
    expect(storedSceneDescriptionFor({ ...data(), previewStart: 10 }, FULL, true)!.sceneDescriptionWindow).toEqual({ fromSec: 10, toSec: 12 })
    expect(storedSceneDescriptionFor({ ...data(), previewStart: null }, FULL, true)).toBeUndefined()
  })

  it("the scene from the original, or none, sends no description", () => {
    for (const scene of ["original", "none"] as const) {
      const { body } = run(data({ faceMasking: { ...FULL, scene } }))
      expect(body).not.toHaveProperty("sceneDescription")
      expect(body).not.toHaveProperty("sceneDescriptionWindow")
    }
  })

  it("a clip made before descriptions existed sends none (the engine describes the clip per run)", () => {
    const { body } = run(data({}, { sceneDescription: undefined, previewSceneDescription: undefined }))
    expect(body).not.toHaveProperty("sceneDescription")
    const preview = run(data({}, { sceneDescription: undefined, previewSceneDescription: undefined }), true).body
    expect(preview).not.toHaveProperty("sceneDescription")
    expect(preview).not.toHaveProperty("sceneDescriptionWindow")
  })

  it("another clip preparation never sends one, whatever the face mask holds", () => {
    const faces = data({ faceMasking: { mode: "always", threshold: 0.4 } })
    expect(storedSceneDescriptionFor(faces, faces.faceMasking, false)).toBeUndefined()
    const keep = data({ faceMasking: { mode: "always", source: "keep-people" } })
    expect(storedSceneDescriptionFor(keep, keep.faceMasking, false)).toBeUndefined()
  })
})

describe("the engine's declaration", () => {
  it("an engine that declares `storedSceneDescription` is sent both keys", () => {
    setPluginSupports({ castSwap: { ...SUPPORTS, storedSceneDescription: true } as never })
    const composed = run(data(), true)
    withoutUnsupportedFields(composed)
    expect(composed.body.sceneDescription).toBe(PREVIEW_TEXT)
    expect(composed.body.sceneDescriptionWindow).toEqual({ fromSec: 3, toSec: 7 })
  })

  it("any other engine gets exactly the body it got before (both stripped)", () => {
    setPluginSupports({ castSwap: SUPPORTS as never })
    const composed = run(data())
    withoutUnsupportedFields(composed)
    expect(composed.body).not.toHaveProperty("sceneDescription")
    expect(composed.body).not.toHaveProperty("sceneDescriptionWindow")
    const without = run(data({}, { sceneDescription: undefined, previewSceneDescription: undefined }))
    withoutUnsupportedFields(without)
    expect(composed.body).toEqual(without.body)
  })

  it("an engine that does not take the described scene gets neither (its scene key was stripped first)", () => {
    setPluginSupports({ castSwap: { ...SUPPORTS, fullDepthScenes: ["original"], storedSceneDescription: true } as never })
    const composed = run(data())
    withoutUnsupportedFields(composed)
    expect(composed.body.faceMasking).not.toHaveProperty("scene")
    expect(composed.body).not.toHaveProperty("sceneDescription")
  })
})
