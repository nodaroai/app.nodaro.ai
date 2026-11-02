/**
 * A trend's preparation steps (`TrendVersionData.steps`): stored with the
 * version, put on every run's body (the run, its estimate and the admin test
 * run compose the same), and sent ONLY to an engine that declares
 * `castSwap.steps`. What must hold:
 *
 *  - unset (absent or `{}`) is today's run exactly: no `steps` key anywhere;
 *  - the stored schema takes any model name (a model later removed from the
 *    list never breaks a saved version, nor the face mask routes that re-run
 *    it), and refuses a malformed setting;
 *  - an engine without the capability is never sent the key (its body schema
 *    would strip it silently), and the run still goes;
 *  - publishing needs the capability in every environment (`STEPS_NEED`);
 *  - the stored scene texts remember the scene step they were made with
 *    (`sceneStepKey`): a different step says so (`sceneStepChanged`) and
 *    never puts the mask out of date.
 */
import { afterEach, describe, expect, it } from "vitest"
import { sceneStepKeyOf, type CastSwapSteps, type TextStepSetting } from "../../../../lib/cast-swap-steps.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { composeTrendRun, type ComposedTrendRun } from "../compose.js"
import { faceMaskSettingsKey, faceMaskState } from "../face-mask.js"
import { CLIP_BODY_NEED, SHOT_LIST_NEED, STEPS_NEED, STYLE_REFS_NEED, publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendFaceMask, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const FULL = { mode: "always" as const, source: "full-depth" as const }

const LLM_PROMPT: TextStepSetting = { mode: "llm", llm: { model: "gemini-3.8-flash", instructions: "test instructions", inputs: ["rolePhotos"], maxChars: 2000 } }
const SCENE_LLM: TextStepSetting = { mode: "llm", llm: { model: "gemini-3.8-flash", inputs: ["clip"], maxChars: 3000 } }
const STEPS: CastSwapSteps = { enginePrompt: LLM_PROMPT }

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: null,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    ...over,
  }
}

const ENGINE = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskRecipe: "1",
  sourceModes: ["faces", "full-depth", "keep-people"],
  fullDepthScenes: ["description", "original", "none"],
}
const WITH_STEPS = { ...ENGINE, steps: true }
const WITH_CLIP_BODY = { ...WITH_STEPS, clipBodySheet: true }
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-10-31T00:00:00Z",
})
const REQUIRED = ["staging", "production"]

const run = (d: TrendVersionData): ComposedTrendRun =>
  composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })

describe("stored with the version", () => {
  it("takes a setting whose model is no longer listed (a stored version always loads)", () => {
    const gone: CastSwapSteps = { sceneDescription: { mode: "llm", llm: { model: "a-model-since-removed", inputs: ["clip"], maxChars: 1000 } } }
    const parsed = trendVersionDataSchema.safeParse(data({ steps: gone }))
    expect(parsed.success).toBe(true)
    expect(parsed.data!.steps).toEqual(gone)
  })

  it("refuses a malformed setting (a pet layout under product)", () => {
    const rules = {
      person: { "head-body": "collage", "body-only": "collage", "head-only": "head-body-cut", unclear: "head-body" },
      pet: { "head-body": "collage", "body-only": "head-body-side", "head-only": "head-body-side", unclear: "head-body-side" },
      product: { "head-body": "head-body-side", "body-only": "collage", "head-only": "turnaround", unclear: "turnaround" },
      location: { "head-body": "none", "body-only": "none", "head-only": "none", unclear: "none" },
    }
    const r = trendVersionDataSchema.safeParse({ ...data(), steps: { sheets: { rules } } })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.path.slice(0, 1)).toEqual(["steps"])
  })

  it("a version without it parses with no `steps` key", () => {
    const parsed = trendVersionDataSchema.parse(data())
    expect(Object.hasOwn(parsed, "steps")).toBe(false)
  })
})

describe("compose", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("compose puts the version's steps on the body (its own copy)", () => {
    const d = data({ steps: STEPS })
    const body = run(d).body
    expect(body.steps).toEqual(STEPS)
    expect(body.steps).not.toBe(d.steps)
  })

  it("`{}` or absent puts none: the body is today's", () => {
    const today = run(data()).body
    expect(Object.hasOwn(today, "steps")).toBe(false)
    const empty = run(data({ steps: {} })).body
    expect(Object.hasOwn(empty, "steps")).toBe(false)
    expect(empty).toEqual(today)
  })

  it("keeps it for an engine that declares castSwap.steps", () => {
    setPluginSupports({ castSwap: WITH_STEPS } as never)
    const r = run(data({ steps: STEPS }))
    withoutUnsupportedFields(r)
    expect(r.body.steps).toEqual(STEPS)
  })

  it("an engine without castSwap.steps never receives steps (the field is stripped, the run still goes)", () => {
    for (const cs of [ENGINE, { ...ENGINE, steps: false }] as Array<Record<string, unknown>>) {
      setPluginSupports({ castSwap: cs } as never)
      const withSteps = run(data({ steps: STEPS }))
      withoutUnsupportedFields(withSteps)
      expect(Object.hasOwn(withSteps.body, "steps"), JSON.stringify(cs.steps)).toBe(false)
      // Exactly the body a version without steps sends there.
      const without = run(data())
      withoutUnsupportedFields(without)
      expect(withSteps.body).toEqual(without.body)
    }
  })
})

describe("Body from the clip (`clipBody`)", () => {
  afterEach(() => _resetPluginSupportsForTests())

  const OFF: CastSwapSteps = { clipBody: { mode: "off" } }
  const BOTH: CastSwapSteps = { enginePrompt: LLM_PROMPT, clipBody: { mode: "on", prompt: "A test prompt." } }

  it("is stored with the version and put on the body when set", () => {
    expect(trendVersionDataSchema.parse(data({ steps: OFF })).steps).toEqual(OFF)
    expect(run(data({ steps: OFF })).body.steps).toEqual(OFF)
  })

  it("is sent to an engine that declares castSwap.clipBodySheet", () => {
    setPluginSupports({ castSwap: WITH_CLIP_BODY } as never)
    const r = run(data({ steps: BOTH }))
    withoutUnsupportedFields(r)
    expect(r.body.steps).toEqual(BOTH)
  })

  it("an engine with steps but without clipBodySheet never receives clipBody; the other steps still go", () => {
    setPluginSupports({ castSwap: WITH_STEPS } as never)
    const r = run(data({ steps: BOTH }))
    withoutUnsupportedFields(r)
    expect(r.body.steps).toEqual({ enginePrompt: LLM_PROMPT })
    // Only clipBody set: no steps key at all, exactly today's body there.
    const only = run(data({ steps: OFF }))
    withoutUnsupportedFields(only)
    expect(Object.hasOwn(only.body, "steps")).toBe(false)
    const without = run(data())
    withoutUnsupportedFields(without)
    expect(only.body).toEqual(without.body)
  })

  it("publish needs clipBodySheet in every environment only for On with an image prompt of its own", () => {
    const custom = data({ steps: { clipBody: { mode: "on", prompt: "A test prompt." } } })
    expect(publishBlockers(custom, [env("staging", WITH_CLIP_BODY), env("production", WITH_STEPS)], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: CLIP_BODY_NEED },
    ])
    expect(publishBlockers(custom, [env("staging", WITH_CLIP_BODY), env("production", WITH_CLIP_BODY)], REQUIRED)).toEqual([])
    expect(CLIP_BODY_NEED).toBe("clipBodySheet")
  })

  it("Off publishes anywhere, even where the engine takes no steps at all (it is stripped there)", () => {
    for (const steps of [OFF, { clipBody: { mode: "on" as const } }]) {
      const d = data({ steps })
      expect(publishBlockers(d, [env("staging", WITH_CLIP_BODY), env("production", ENGINE)], REQUIRED), JSON.stringify(steps)).toEqual([])
    }
    // Beside another step, that step's own need still holds.
    const both = data({ steps: { enginePrompt: LLM_PROMPT, clipBody: { mode: "off" } } })
    expect(publishBlockers(both, [env("staging", WITH_CLIP_BODY), env("production", ENGINE)], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: STEPS_NEED },
    ])
  })

  it("the shot list: sent only to an engine that declares castSwap.shotList; publish needs it only away from the defaults", () => {
    const WITH_SHOT_LIST = { ...WITH_STEPS, shotList: true }
    const precise = { shotList: { precise: { mode: "on" as const } } }
    setPluginSupports({ castSwap: WITH_STEPS } as never)
    const stripped = run(data({ steps: precise }))
    withoutUnsupportedFields(stripped)
    expect(Object.hasOwn(stripped.body, "steps")).toBe(false)
    setPluginSupports({ castSwap: WITH_SHOT_LIST } as never)
    const sent = run(data({ steps: precise }))
    withoutUnsupportedFields(sent)
    expect(sent.body.steps).toEqual(precise)
    expect(publishBlockers(data({ steps: precise }), [env("staging", WITH_SHOT_LIST), env("production", WITH_STEPS)], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: SHOT_LIST_NEED },
    ])
    expect(publishBlockers(data({ steps: precise }), [env("staging", WITH_SHOT_LIST), env("production", WITH_SHOT_LIST)], REQUIRED)).toEqual([])
    // The defaults (Flex on) need nothing, not even steps.
    expect(publishBlockers(data({ steps: { shotList: { flex: { mode: "on" } } } }), [env("staging", ENGINE), env("production", ENGINE)], REQUIRED)).toEqual([])
  })

  it("Style the role pictures: sent only to an engine that declares castSwap.styleRefs; publish needs it only when On", () => {
    const WITH_STYLE_REFS = { ...WITH_STEPS, styleRefs: true }
    const on = { styleRefs: { mode: "on" as const, send: "styled" as const } }
    expect(trendVersionDataSchema.parse(data({ steps: on })).steps).toEqual(on)
    setPluginSupports({ castSwap: { ...WITH_STEPS, shotList: true, clipBodySheet: true } } as never)
    const stripped = run(data({ steps: on }))
    withoutUnsupportedFields(stripped)
    expect(Object.hasOwn(stripped.body, "steps")).toBe(false)
    setPluginSupports({ castSwap: WITH_STYLE_REFS } as never)
    const sent = run(data({ steps: on }))
    withoutUnsupportedFields(sent)
    expect(sent.body.steps).toEqual(on)
    expect(publishBlockers(data({ steps: on }), [env("staging", WITH_STYLE_REFS), env("production", WITH_STEPS)], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: STYLE_REFS_NEED },
    ])
    expect(publishBlockers(data({ steps: on }), [env("staging", WITH_STYLE_REFS), env("production", WITH_STYLE_REFS)], REQUIRED)).toEqual([])
    expect(STYLE_REFS_NEED).toBe("styleRefs")
    // Off (the default) needs nothing, not even steps, and is stored as set.
    const off = { styleRefs: { mode: "off" as const, send: "styled-and-original" as const } }
    expect(trendVersionDataSchema.parse(data({ steps: off })).steps).toEqual(off)
    expect(publishBlockers(data({ steps: off }), [env("staging", ENGINE), env("production", ENGINE)], REQUIRED)).toEqual([])
  })

  it("PIN: a version with no steps composes the same body whatever the engine declares", () => {
    setPluginSupports({ castSwap: ENGINE } as never)
    const before = run(data())
    withoutUnsupportedFields(before)
    setPluginSupports({ castSwap: { ...WITH_STEPS, clipBodySheet: true, shotList: true, styleRefs: true } } as never)
    const after = run(data())
    withoutUnsupportedFields(after)
    expect(Object.hasOwn(after.body, "steps")).toBe(false)
    expect(after.body).toEqual(before.body)
  })

  it("a version that does not set it never needs clipBodySheet (absent is the engine's own default)", () => {
    const d = data({ steps: STEPS })
    expect(publishBlockers(d, [env("staging", WITH_STEPS), env("production", WITH_STEPS)], REQUIRED)).toEqual([])
  })
})

describe("publishing", () => {
  const approvedFull = (over: Partial<TrendVersionData> = {}): TrendVersionData => {
    const d = data({ faceMasking: FULL, ...over })
    const faceMask: TrendFaceMask = {
      url: "https://cdn.example/trends/t1/depth.mp4",
      frames: 360,
      recipe: { core: null, plugin: "1" },
      settingsKey: faceMaskSettingsKey(d)!,
      jobId: "job-1",
      stats: { shots: 0, heldFrames: 0, coverage: 1, droppedRegions: 0 },
      approvedAt: "2026-10-31T10:00:00.000Z",
      approvedBy: "admin",
    }
    return { ...d, faceMask }
  }

  it("publish is refused for an environment whose engine lacks steps", () => {
    const d = data({ steps: STEPS })
    expect(publishBlockers(d, [env("staging", WITH_STEPS), env("production", ENGINE)], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: STEPS_NEED },
    ])
    expect(publishBlockers(d, [env("staging", WITH_STEPS), env("production", WITH_STEPS)], REQUIRED)).toEqual([])
    expect(STEPS_NEED).toBe("steps")
  })

  it("a version without steps (absent or `{}`) never needs it", () => {
    for (const d of [data(), data({ steps: {} })]) {
      expect(publishBlockers(d, [env("staging", ENGINE), env("production", ENGINE)], REQUIRED)).toEqual([])
    }
  })

  it("a changed scene step never blocks publishing (the stored text is still sent)", () => {
    const d = approvedFull({ steps: { sceneDescription: SCENE_LLM } })
    const withText = { ...d, faceMask: { ...d.faceMask!, sceneDescription: "A kitchen." } }
    expect(publishBlockers(withText, [env("staging", WITH_STEPS), env("production", WITH_STEPS)], REQUIRED)).toEqual([])
  })
})

describe("the stored scene texts' step (`sceneStepKey`)", () => {
  const withMask = (steps: CastSwapSteps | undefined, mask: Partial<TrendFaceMask>): TrendVersionData => {
    const d = data({ faceMasking: FULL, ...(steps ? { steps } : {}) })
    return {
      ...d,
      faceMask: {
        url: "https://cdn.example/trends/t1/depth.mp4",
        frames: 360,
        recipe: { core: null, plugin: "1" },
        settingsKey: faceMaskSettingsKey(d)!,
        jobId: "job-1",
        stats: { shots: 0, heldFrames: 0, coverage: 1, droppedRegions: 0 },
        approvedAt: "2026-10-31T10:00:00.000Z",
        approvedBy: "admin",
        ...mask,
      },
    }
  }
  const state = (d: TrendVersionData) => faceMaskState(d, [env("staging", WITH_STEPS), env("production", WITH_STEPS)], REQUIRED)
  const KEY = sceneStepKeyOf(SCENE_LLM)!

  it("is the same when both are unset, and when the draft's step is the one recorded", () => {
    expect(state(withMask(undefined, { sceneDescription: "A kitchen." }))).toEqual({ status: "approved", reasons: [] })
    expect(state(withMask({ sceneDescription: SCENE_LLM }, { sceneDescription: "A kitchen.", sceneStepKey: KEY }))).toEqual({ status: "approved", reasons: [] })
  })

  it("sceneStepChanged flips when the draft's step differs from the one the texts were made with (never out of date)", () => {
    // Set since the make.
    expect(state(withMask({ sceneDescription: SCENE_LLM }, { sceneDescription: "A kitchen." }))).toEqual({ status: "approved", reasons: [], sceneStepChanged: true })
    // Cleared since the make.
    expect(state(withMask(undefined, { sceneDescription: "A kitchen.", sceneStepKey: KEY }))).toEqual({ status: "approved", reasons: [], sceneStepChanged: true })
    // Changed to another setting.
    expect(state(withMask({ sceneDescription: { mode: "template" } }, { sceneDescription: "A kitchen.", sceneStepKey: KEY }))).toEqual({
      status: "approved",
      reasons: [],
      sceneStepChanged: true,
    })
  })

  it("is never said of a mask with no stored scene text (an older make's unused preview text alone counts as none)", () => {
    expect(state(withMask({ sceneDescription: SCENE_LLM }, {}))).toEqual({ status: "approved", reasons: [] })
    expect(state(withMask(undefined, { previewSceneDescription: "0-4 s.", sceneStepKey: KEY }))).toEqual({ status: "approved", reasons: [] })
  })

  it("never enters the settings key: a mask made with any step stays up to date", () => {
    const d = data({ faceMasking: FULL })
    expect(faceMaskSettingsKey({ ...d, steps: { sceneDescription: SCENE_LLM } } as TrendVersionData)).toBe(faceMaskSettingsKey(d))
  })

  it("is part of the approved mask's schema", () => {
    const d = withMask({ sceneDescription: SCENE_LLM }, { sceneDescription: "A kitchen.", sceneStepKey: KEY })
    expect(trendVersionDataSchema.safeParse(d).success).toBe(true)
    expect(trendVersionDataSchema.safeParse({ ...d, faceMask: { ...d.faceMask, sceneStepKey: "" } }).success).toBe(false)
  })
})
