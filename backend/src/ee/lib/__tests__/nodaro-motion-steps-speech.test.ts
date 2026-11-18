import { describe, expect, it } from "vitest"
import type { EngineEnvironment } from "../engine-environments.js"
import {
  environmentsThatCannotTakeShotListSpeech,
  environmentsWhosePlatformCannotTakeShotListSpeech,
  platformHoldOfShotListSpeech,
} from "../nodaro-motion-steps-gate.js"
import { withSavedSteps } from "../trends/schemas.js"
import { shotListSpeechTrendRefusal } from "../nodaro-motion-steps-gate.js"

/**
 * The shot list's speech (decided 2026-11-18, `shotList.<style>.speech`): the steps setting stores it only once every
 * environment's engine declares `castSwap.shotListSpeech` (409) and every environment's platform claims
 * `shotListSpeech`, fresh (422, held first). A trend's steps take it too, held only on a change (decided 2026-11-18).
 */
const NOW = Date.parse("2026-11-18T12:00:00.000Z")
const ENGINE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: [], trendRun: true, steps: true, shotList: true, shotListSpeech: true }
const env = (name: string, castSwap: Record<string, unknown>, platform?: Record<string, unknown>, at = "2026-11-18T11:59:00.000Z"): EngineEnvironment => ({
  env: name,
  pluginBuildId: null,
  supports: { castSwap } as EngineEnvironment["supports"],
  updatedAt: "2026-11-18T00:00:00.000Z",
  ...(platform ? { platformClaim: { supports: platform, at } } : {}),
})
const both = (castSwap: Record<string, unknown>, platform?: Record<string, unknown>) => [env("staging", castSwap, platform), env("production", castSwap, platform)]

describe("the engine side", () => {
  it("names each environment whose engine does not declare it (none recorded too)", () => {
    expect(environmentsThatCannotTakeShotListSpeech(both(ENGINE))).toEqual([])
    expect(environmentsThatCannotTakeShotListSpeech([env("staging", ENGINE), env("production", { ...ENGINE, shotListSpeech: undefined })])).toEqual(["production"])
    expect(environmentsThatCannotTakeShotListSpeech([env("staging", { ...ENGINE, shotList: undefined })])).toEqual(["staging", "production"])
  })
})

describe("the platform hold", () => {
  const words = { shotList: { flex: { mode: "on" as const, speech: "words" as const } } }

  it("holds a setting that asks for speech while a platform does not claim it, or its claim is stale", () => {
    expect(environmentsWhosePlatformCannotTakeShotListSpeech(both(ENGINE, { shotListSpeech: true }), NOW)).toEqual([])
    expect(platformHoldOfShotListSpeech([words], both(ENGINE, { shotListSpeech: true }), NOW)).toBeNull()
    expect(platformHoldOfShotListSpeech([undefined, words], [env("staging", ENGINE, { shotListSpeech: true }), env("production", ENGINE)], NOW)).toEqual({
      code: "platform_unsupported",
      envs: ["production"],
      message: "The platform in production does not take Speech in the script yet, and this setting is shared by every environment: set it to Off, or wait until production is updated.",
    })
    // A claim from a beat long gone counts as none.
    const stale = both(ENGINE, { shotListSpeech: true }).map((e) => ({ ...e, platformClaim: { ...e.platformClaim!, at: "2026-11-01T00:00:00.000Z" } }))
    expect(platformHoldOfShotListSpeech([words], stale, NOW)?.envs).toEqual(["staging", "production"])
  })

  it("never holds a setting without speech (off or absent)", () => {
    expect(platformHoldOfShotListSpeech([{ shotList: { flex: { mode: "on", speech: "off" } } }, undefined, {}], [], NOW)).toBeNull()
  })
})

describe("a trend's steps", () => {
  it("take speech and its mouths (decided 2026-11-18): stored as set, Off and the default mouths left out", () => {
    const steps = { shotList: { precise: { mode: "on", speech: "who" }, flex: { mode: "on", speech: "words", speechMouth: "all" } } }
    expect(withSavedSteps({ steps })).toEqual({ data: { steps } })
    expect(withSavedSteps({ steps: { shotList: { precise: { mode: "on", speech: "off", speechMouth: "none" } } } })).toEqual({ data: { steps: { shotList: { precise: { mode: "on" } } } } })
    expect(withSavedSteps({ steps: { shotList: { flex: { mode: "on", speech: "who", speechMouth: "spoken" } } } })).toEqual({ data: { steps: { shotList: { flex: { mode: "on", speech: "who" } } } } })
  })

  it("keep the clip steps' models: Gemini 4 Hydrogen (Video Remake's shot list only) is refused, Carbon and Flash are not", () => {
    const shotList = (model: string) => ({ steps: { shotList: { flex: { mode: "on", llm: { model, inputs: ["clip", "rolePhotos"], maxChars: 4000 } } } } })
    expect(withSavedSteps(shotList("gemini-4-hydrogen"))).toEqual({
      problems: [{ path: "steps.shotList.flex.llm.model", code: "model_cannot_read_clip", message: expect.any(String) }],
    })
    for (const model of ["gemini-4-carbon", "gemini-3.8-flash"]) expect(withSavedSteps(shotList(model))).toHaveProperty("data")
  })
})

describe("a trend draft's change of speech (`shotListSpeechTrendRefusal`)", () => {
  const who = { shotList: { flex: { mode: "on" as const, speech: "who" as const } } }
  const whoNone = { shotList: { flex: { mode: "on" as const, speech: "who" as const, speechMouth: "none" as const } } }
  const lacking = [env("staging", ENGINE), env("production", { ...ENGINE, shotListSpeech: undefined }, { shotListSpeech: true })]

  it("holds a change to speech: the platform first (422), then the engine (409)", () => {
    expect(shotListSpeechTrendRefusal(who, undefined, lacking, NOW)).toMatchObject({ status: 422, error: { code: "platform_unsupported", envs: ["staging"] } })
    const platforms = lacking.map((e) => ({ ...e, platformClaim: { supports: { shotListSpeech: true }, at: "2026-11-18T11:59:00.000Z" } }))
    expect(shotListSpeechTrendRefusal(who, undefined, platforms, NOW)).toMatchObject({ status: 409, error: { code: "engine_unsupported", envs: ["production"] } })
    expect(shotListSpeechTrendRefusal(who, undefined, both(ENGINE, { shotListSpeech: true }), NOW)).toBeNull()
  })

  it("a mouths change is a change; the same speech, or none, is never held", () => {
    expect(shotListSpeechTrendRefusal(whoNone, who, lacking, NOW)?.status).toBe(422)
    expect(shotListSpeechTrendRefusal(who, who, lacking, NOW)).toBeNull()
    expect(shotListSpeechTrendRefusal({ shotList: { flex: { mode: "on", speech: "who", speechMouth: "spoken" } } }, who, lacking, NOW)).toBeNull()
    expect(shotListSpeechTrendRefusal({ shotList: { flex: { mode: "on", speech: "off" } } }, who, lacking, NOW)).toBeNull()
  })
})
