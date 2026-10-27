/**
 * A trend's prompt style (`promptStyle`) and full depth's scene source
 * (`faceMasking.scene`). What must hold:
 *
 *  - the schema takes the styles and scenes, and a scene with full depth only;
 *  - the scene never changes the stored clip: the settings key, the mask's
 *    state and the stored mask sent are the same whatever it is;
 *  - a run sends both resolved, and an engine that declares neither gets
 *    exactly the body it got before they existed;
 *  - the engine's prompt parts are asked with both, only where it takes them;
 *  - publishing holds back a trend an environment would run otherwise than
 *    it says, and a full-depth trend that sends the original with a clip
 *    longer than the engines take.
 */
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { faceMaskingMotionSchema, faceMaskingSent, faceMaskingRunSent } from "../../../../lib/cast-swap-face-masking.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { forLoadedEngine } from "../../cast-swap-prompt-parts.js"
import { composeTrendRun } from "../compose.js"
import { faceMaskSettingsKey, faceMaskState, storedFaceMaskFor } from "../face-mask.js"
import { promptPartsRequestFor } from "../prompt-parts-store.js"
import { FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC, fullDepthClipTooLong, promptStyleOf, trendSceneOf } from "../prompt-style.js"
import { publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendFaceMask, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const FACES = { mode: "always" as const, threshold: 0.4 }
const FULL = { mode: "always" as const, source: "full-depth" as const }
const KEEP = { mode: "always" as const, source: "keep-people" as const }

function data(over: Partial<TrendVersionData> = {}, durationSec = 12): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec },
    },
    previewStart: 0,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    faceMasking: FACES,
    ...over,
  }
}

function withMask(d: TrendVersionData): TrendVersionData {
  const faceMask: TrendFaceMask = {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-10-27T10:00:00.000Z",
    approvedBy: "admin",
  }
  return { ...d, faceMask }
}

const BASE = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskRecipe: "1",
  faceMaskErase: true,
  sourceModes: ["faces", "full-depth", "keep-people"],
  faceMaskTargets: ["face", "head", "body"],
  faceMaskMarkLabels: ["erased", "main"],
}
const STYLES = { ...BASE, promptStyles: ["precise", "flexible"], fullDepthScenes: ["description", "original", "none"] }
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-10-27T00:00:00Z",
})
const REQUIRED = ["staging", "production"]
const envs = (castSwap: Record<string, unknown>) => [env("staging", castSwap), env("production", castSwap)]
const codes = (d: TrendVersionData, castSwap: Record<string, unknown>) => publishBlockers(d, envs(castSwap), REQUIRED).map((b) => b.code)

const trend = (d: TrendVersionData) => ({ id: "t-1", slug: "dance", version: 1, data: d })
const run = (d: TrendVersionData) => composeTrendRun(trend(d), { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
const issues = (over: Partial<TrendVersionData>) => {
  const r = trendVersionDataSchema.safeParse(data(over))
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
}

afterEach(() => _resetPluginSupportsForTests())

describe("the schema", () => {
  it("takes either prompt style, stores it as given, and refuses another", () => {
    expect(issues({ promptStyle: "precise" })).toEqual([])
    expect(issues({ promptStyle: "flexible" })).toEqual([])
    expect(trendVersionDataSchema.safeParse(data()).data).not.toHaveProperty("promptStyle")
    expect(issues({ promptStyle: "motion" as never })).not.toEqual([])
  })

  it("takes a scene with full depth only", () => {
    for (const scene of ["description", "original", "none"] as const) expect(issues({ faceMasking: { ...FULL, scene } })).toEqual([])
    expect(issues({ faceMasking: { ...FULL, scene: "video" as never } })).not.toEqual([])
    expect(issues({ faceMasking: { ...FACES, scene: "original" } })).toEqual([expect.stringMatching(/^faceMasking\.scene: .*Full depth/)])
    expect(issues({ faceMasking: { ...KEEP, scene: "none" } })).toEqual([expect.stringMatching(/^faceMasking\.scene: /)])
  })
})

describe("the scene never changes the stored clip", () => {
  it("the settings key is the same with the scene left out, or any scene", () => {
    const key = faceMaskSettingsKey(data({ faceMasking: FULL }))
    for (const scene of ["description", "original", "none"] as const) {
      expect(faceMaskSettingsKey(data({ faceMasking: { ...FULL, scene } }))).toBe(key)
    }
  })

  it("an approved clip stays approved and is still sent after the scene changes", () => {
    const approved = withMask(data({ faceMasking: FULL }))
    const changed: TrendVersionData = { ...approved, faceMasking: { ...FULL, scene: "none" } }
    expect(faceMaskState(changed, envs(STYLES), REQUIRED).reasons).toEqual([])
    expect(storedFaceMaskFor(changed)).toEqual({ url: "https://cdn.example/trends/t1/clip.mp4", frames: 360 })
  })

  it("a make (faceMaskingSent) is never sent it; a run (faceMaskingRunSent) is, resolved", () => {
    expect(faceMaskingSent({ ...FULL, scene: "original" })).toEqual({ mode: "always", source: "full-depth" })
    expect(faceMaskingRunSent(FULL)).toEqual({ mode: "always", source: "full-depth", scene: "description" })
    expect(faceMaskingRunSent({ ...FULL, scene: "none" })).toEqual({ mode: "always", source: "full-depth", scene: "none" })
    expect(faceMaskingRunSent(FACES)).toEqual(faceMaskingSent(FACES))
  })
})

describe("resolving", () => {
  it("the prompt style: Flexible for full depth, Precise otherwise, the trend's own when it names one", () => {
    expect(promptStyleOf(data())).toBe("precise")
    expect(promptStyleOf(data({ faceMasking: undefined }))).toBe("precise")
    expect(promptStyleOf(data({ faceMasking: KEEP }))).toBe("precise")
    expect(promptStyleOf(data({ faceMasking: FULL }))).toBe("flexible")
    expect(promptStyleOf(data({ faceMasking: FULL, promptStyle: "precise" }))).toBe("precise")
    expect(promptStyleOf(data({ promptStyle: "flexible" }))).toBe("flexible")
  })

  it("the scene: full depth's only, a description when left out", () => {
    expect(trendSceneOf(data({ faceMasking: FULL }))).toBe("description")
    expect(trendSceneOf(data({ faceMasking: { ...FULL, scene: "original" } }))).toBe("original")
    expect(trendSceneOf(data())).toBeNull()
    expect(trendSceneOf(data({ faceMasking: { ...FULL, mode: "off" } }))).toBeNull()
  })
})

describe("a run", () => {
  it("sends the prompt style resolved, and full depth's scene resolved", () => {
    expect(run(data()).body.promptStyle).toBe("precise")
    expect(run(data({ promptStyle: "flexible" })).body.promptStyle).toBe("flexible")
    const full = run(withMask(data({ faceMasking: { ...FULL, scene: "original" } }))).body
    expect(full.promptStyle).toBe("flexible")
    expect(full.faceMasking).toEqual({ mode: "always", source: "full-depth", scene: "original" })
  })

  it("an engine that declares neither gets exactly the body it got before they existed", () => {
    setPluginSupports({ castSwap: BASE as never })
    for (const d of [data(), data({ promptStyle: "flexible" }), withMask(data({ faceMasking: { ...FULL, scene: "none" } }))]) {
      const composed = run(d)
      const { promptStyle: _style, ...before } = structuredClone(composed.body)
      if (before.faceMasking) delete before.faceMasking.scene
      withoutUnsupportedFields(composed)
      expect(composed.body).toStrictEqual(before)
    }
  })

  it("an engine that declares them keeps both, and one that lacks the named one drops only it", () => {
    setPluginSupports({ castSwap: STYLES as never })
    const composed = run(withMask(data({ faceMasking: FULL })))
    withoutUnsupportedFields(composed)
    expect(composed.body).toMatchObject({ promptStyle: "flexible", faceMasking: { scene: "description" } })

    setPluginSupports({ castSwap: { ...STYLES, promptStyles: ["precise"], fullDepthScenes: ["original"] } as never })
    const other = run(withMask(data({ faceMasking: FULL })))
    withoutUnsupportedFields(other)
    expect(other.body).not.toHaveProperty("promptStyle")
    expect(other.body.faceMasking).toEqual({ mode: "always", source: "full-depth" })
  })
})

describe("the engine's prompt parts", () => {
  it("are asked for the trend's prompt style and scene, resolved", () => {
    expect(promptPartsRequestFor(data())).toMatchObject({ source: "faces", promptStyle: "precise" })
    expect(promptPartsRequestFor(data())).not.toHaveProperty("scene")
    expect(promptPartsRequestFor(data({ faceMasking: FULL }))).toMatchObject({ source: "full-depth", promptStyle: "flexible", scene: "description" })
    expect(promptPartsRequestFor(data({ faceMasking: KEEP, promptStyle: "flexible" }))).toMatchObject({ source: "keep-people", promptStyle: "flexible" })
  })

  it("are sent the style and scene only where the engine takes them", () => {
    const body = promptPartsRequestFor(data({ faceMasking: { ...FULL, scene: "none" } }))
    setPluginSupports({ castSwap: BASE as never })
    const old = forLoadedEngine(body)
    expect(old).not.toHaveProperty("promptStyle")
    expect(old).not.toHaveProperty("scene")
    expect(old.source).toBe("full-depth")
    setPluginSupports({ castSwap: STYLES as never })
    expect(forLoadedEngine(body)).toMatchObject({ promptStyle: "flexible", scene: "none" })
  })
})

describe("publishing", () => {
  it("a style other than the clip preparation's default needs an engine that declares it", () => {
    expect(codes(withMask(data({ promptStyle: "flexible" })), BASE)).toEqual(["prompt_style_unsupported", "prompt_style_unsupported"])
    expect(codes(withMask(data({ promptStyle: "flexible" })), STYLES)).toEqual([])
    // The default, named or not, never needs it.
    expect(codes(withMask(data({ promptStyle: "precise" })), BASE)).toEqual([])
    expect(codes(withMask(data()), BASE)).toEqual([])
    const full = (over: Partial<TrendVersionData> = {}) => withMask(data({ faceMasking: { ...FULL, scene: "original" }, ...over }))
    expect(codes(full({ promptStyle: "flexible" }), BASE)).toEqual([])
    expect(codes(full({ promptStyle: "precise" }), BASE)).toEqual(["prompt_style_unsupported", "prompt_style_unsupported"])
    const blocker = publishBlockers(withMask(data({ promptStyle: "flexible" })), [env("staging", STYLES), env("production", BASE)], REQUIRED)
    expect(blocker).toEqual([expect.objectContaining({ code: "prompt_style_unsupported", env: "production", need: "promptStyle:flexible" })])
  })

  it("full depth's scene needs an engine that takes it; an engine before scenes sends the original only", () => {
    const full = (scene?: "description" | "original" | "none") => withMask(data({ faceMasking: scene ? { ...FULL, scene } : FULL }))
    expect(codes(full(), BASE)).toEqual(["full_depth_scene_unsupported", "full_depth_scene_unsupported"])
    expect(codes(full("none"), BASE)).toEqual(["full_depth_scene_unsupported", "full_depth_scene_unsupported"])
    expect(codes(full("original"), BASE)).toEqual([])
    for (const scene of ["description", "original", "none"] as const) expect(codes(full(scene), STYLES)).toEqual([])
    expect(publishBlockers(full(), envs(BASE), REQUIRED)[0]).toMatchObject({ env: "staging", need: "scene:description" })
  })

  it("full depth that sends the original refuses a clip over 27.5 s (0.4 s below the engine's 27.9 s); the other scenes take any", () => {
    expect(FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC).toBe(27.5)
    const full = (scene: "description" | "original" | "none", sec: number) => withMask(data({ faceMasking: { ...FULL, scene } }, sec))
    expect(fullDepthClipTooLong(full("original", 27.5))).toBe(false)
    expect(fullDepthClipTooLong(full("original", 27.55))).toBe(true)
    // The engine would still take it, but a re-encode or a depth map a frame long could tip it over at run.
    expect(fullDepthClipTooLong(full("original", 27.9))).toBe(true)
    expect(codes(full("original", 29.5), STYLES)).toEqual(["full_depth_clip_too_long"])
    expect(codes(full("description", 29.5), STYLES)).toEqual([])
    expect(codes(full("none", 29.5), STYLES)).toEqual([])
    // Not a full-depth trend at all: never.
    expect(fullDepthClipTooLong(data({}, 29.5))).toBe(false)
  })
})

describe("a direct Motion run's masking", () => {
  const ok = (v: unknown) => faceMaskingMotionSchema.safeParse(v).success
  it("is a face mask or full depth (with its scene), never keep people and never marks", () => {
    expect(ok(FACES)).toBe(true)
    expect(ok({ mode: "auto", target: "face" })).toBe(true)
    expect(ok({ ...FULL, scene: "original" })).toBe(true)
    expect(ok(FULL)).toBe(true)
    expect(ok({ ...FULL, mode: "auto" })).toBe(false)
    expect(ok(KEEP)).toBe(false)
    expect(ok({ ...FACES, scene: "none" })).toBe(false)
    expect(ok({ ...FACES, marks: [] })).toBe(false)
  })
})
