/**
 * Prism's newer reference audio modes (cast-swap 0.426.0): "one-tone" (the
 * clip's audio flattened to one steady tone) and "octave" (one octave up).
 * A trend may set either, per output resolution like the others; its run is
 * sent one only by an engine that lists it in
 * `castSwap.prismReferenceAudioModes` (any other is sent the full audio for
 * it), and publishing needs it in every environment.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  castSwapPrismReferenceAudioSchema,
  declaredOnlyPrismReferenceAudioModesOf,
  engineTakesPrismReferenceAudioMode,
} from "../../../../lib/cast-swap-prism-reference-audio.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { environmentsThatCannotTakePrismReferenceAudioModes } from "../../nodaro-motion-prism-reference-audio-modes.js"
import { composeTrendRun } from "../compose.js"
import { prismReferenceAudioModeNeed, publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendVersionData } from "../types.js"

const ENGINE = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  prismReferenceAudio: true,
  prismReferenceAudioPerResolution: true,
}
const ALL = ["full", "voice", "none", "one-tone", "octave"]
const MODES = { ...ENGINE, prismReferenceAudioModes: ALL }

function trend(prismReferenceAudio: unknown, engine?: "kling-4"): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: "https://cdn.example/trends/t1/src.mp4",
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [{ videoUrl: "https://cdn.example/ex.mp4", width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: { lead: ["https://cdn.example/l.png"] } }],
    prismReferenceAudio: prismReferenceAudio as never,
    ...(engine ? { engine } : {}),
  }
}
const sent = (d: TrendVersionData, req: Record<string, unknown> = {}) => {
  const r = composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } }, ...req })
  withoutUnsupportedFields(r)
  return r.body.prismReferenceAudio
}

afterEach(() => _resetPluginSupportsForTests())

describe("the setting", () => {
  it("takes one-tone and octave, as one mode or per resolution, on a trend too", () => {
    expect(castSwapPrismReferenceAudioSchema.parse("one-tone")).toEqual({ "480p": "one-tone", "720p": "one-tone", "1080p": "one-tone" })
    expect(castSwapPrismReferenceAudioSchema.parse({ "720p": "octave", "1080p": "one-tone" })).toEqual({ "720p": "octave", "1080p": "one-tone" })
    expect(castSwapPrismReferenceAudioSchema.safeParse({ "720p": "two-tone" }).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(trend({ "480p": "octave" })).success).toBe(true)
    expect(declaredOnlyPrismReferenceAudioModesOf({ "480p": "octave", "720p": "one-tone", "1080p": "octave" })).toEqual(["one-tone", "octave"])
    expect(declaredOnlyPrismReferenceAudioModesOf({ "480p": "voice" })).toEqual([])
  })

  it("an engine takes them only when it lists them; voice and none keep their rule", () => {
    expect(engineTakesPrismReferenceAudioMode(ENGINE, "one-tone")).toBe(false)
    expect(engineTakesPrismReferenceAudioMode(ENGINE, "voice")).toBe(true)
    expect(engineTakesPrismReferenceAudioMode(ENGINE, "full")).toBe(true)
    expect(engineTakesPrismReferenceAudioMode(MODES, "octave")).toBe(true)
    expect(engineTakesPrismReferenceAudioMode({ ...ENGINE, prismReferenceAudioModes: ["one-tone"] }, "octave")).toBe(false)
    // Listed by an engine that takes no reference audio at all: never.
    expect(engineTakesPrismReferenceAudioMode({ prismReferenceAudioModes: ALL }, "one-tone")).toBe(false)
  })
})

describe("a trend run", () => {
  it("is sent them only by an engine that lists them; any other is sent the full audio there", () => {
    const d = trend({ "480p": "one-tone", "720p": "octave", "1080p": "voice" })
    setPluginSupports({ castSwap: MODES } as never)
    expect(sent(d)).toEqual({ "480p": "one-tone", "720p": "octave", "1080p": "voice" })
    setPluginSupports({ castSwap: ENGINE } as never)
    expect(sent(d)).toEqual({ "1080p": "voice" })
    setPluginSupports({ castSwap: { ...ENGINE, prismReferenceAudioModes: ["full", "voice", "none", "octave"] } } as never)
    expect(sent(d)).toEqual({ "720p": "octave", "1080p": "voice" })
    setPluginSupports({ castSwap: ENGINE } as never)
    expect(sent(trend("octave"))).toBeUndefined()
  })

  it("an engine that takes one mode is sent the run's own resolution's, when it lists it", () => {
    const d = trend({ "480p": "octave", "720p": "one-tone" })
    setPluginSupports({ castSwap: { ...ENGINE, prismReferenceAudioPerResolution: false, prismReferenceAudioModes: ALL } } as never)
    expect(sent(d)).toBe("octave")
    expect(sent(d, { resolution: "720p" })).toBe("one-tone")
    setPluginSupports({ castSwap: { ...ENGINE, prismReferenceAudioPerResolution: false } } as never)
    expect(sent(d)).toBeUndefined()
  })
})

describe("publishing", () => {
  const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-01T00:00:00Z",
  })
  const needs = (d: TrendVersionData, envs: EngineEnvironment[]) =>
    publishBlockers(d, envs, ["staging", "production"]).filter((b) => b.code === "engine_unsupported" && b.need?.startsWith("prismReferenceAudio:"))

  it("needs each mode a Prism trend names in every environment", () => {
    expect(prismReferenceAudioModeNeed("one-tone")).toBe("prismReferenceAudio:one-tone")
    const d = trend({ "480p": "one-tone", "1080p": "octave" })
    expect(needs(d, [env("staging", MODES), env("production", ENGINE)])).toEqual([
      { code: "engine_unsupported", env: "production", need: "prismReferenceAudio:one-tone" },
      { code: "engine_unsupported", env: "production", need: "prismReferenceAudio:octave" },
    ])
    expect(needs(d, [env("staging", { ...ENGINE, prismReferenceAudioModes: ["one-tone"] }), env("production", MODES)])).toEqual([
      { code: "engine_unsupported", env: "staging", need: "prismReferenceAudio:octave" },
    ])
    expect(needs(d, [env("staging", MODES), env("production", MODES)])).toEqual([])
  })

  it("needs nothing new for voice, none, the full audio, or a Pulse trend (which never sends it)", () => {
    for (const d of [trend({ "480p": "voice", "720p": "none" }), trend(undefined), trend("full"), trend({ "720p": "octave" }, "kling-4")]) {
      expect(needs(d, [env("staging", ENGINE), env("production", ENGINE)]), JSON.stringify(d.prismReferenceAudio)).toEqual([])
    }
  })

  it("the shared setting's environments: every one must list each mode asked, a missing one included", () => {
    const envs = [env("production", MODES), env("staging", { ...ENGINE, prismReferenceAudioModes: ["one-tone"] })]
    expect(environmentsThatCannotTakePrismReferenceAudioModes(envs, [])).toEqual([])
    expect(environmentsThatCannotTakePrismReferenceAudioModes(envs, ["one-tone"])).toEqual([])
    expect(environmentsThatCannotTakePrismReferenceAudioModes(envs, ["one-tone", "octave"])).toEqual(["staging"])
    expect(environmentsThatCannotTakePrismReferenceAudioModes([env("production", MODES)], ["octave"])).toEqual(["staging"])
  })
})
