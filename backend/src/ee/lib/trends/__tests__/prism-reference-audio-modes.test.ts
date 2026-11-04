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
  engineTakesPrismReferenceAudioId as engineTakesPrismReferenceAudioMode,
  prismReferenceAudioByResolutionOf,
  prismReferenceAudioRequirementsOf,
} from "../../../../lib/cast-swap-prism-reference-audio.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { PLATFORM_SUPPORTS, type EngineEnvironment } from "../../engine-environments.js"
import {
  environmentsThatCannotTakePrismReferenceAudio as environmentsThatCannotTakePrismReferenceAudioModes,
  environmentsWhosePlatformCannotTakePrismReferenceAudioPitch,
  prismReferenceAudioPlatformHold,
  prismReferenceAudioRefusalOf,
} from "../../nodaro-motion-prism-reference-audio-modes.js"
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
    expect(prismReferenceAudioRequirementsOf(prismReferenceAudioByResolutionOf({ "480p": "octave", "720p": "one-tone", "1080p": "octave" }))).toEqual(["one-tone", "octave"])
    expect(prismReferenceAudioRequirementsOf(prismReferenceAudioByResolutionOf({ "480p": "voice" }))).toEqual([])
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

/**
 * The two controls (a mode and a pitch shift per resolution) on a trend: a
 * value an id says is stored and sent as that id; any other is stored as
 * `{ mode, semitones }`, sent as the object form only to an engine that
 * declares `castSwap.prismReferenceAudioPitch`, and publishing needs that
 * flag (and a one-tone mode's listing) in every environment.
 */
describe("a trend's mode and pitch shift", () => {
  const PITCH_MODES = [...ALL, "full-one-tone", "voice-one-tone"]
  const PITCH = { ...ENGINE, prismReferenceAudioPitch: true, prismReferenceAudioModes: PITCH_MODES }
  const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-03T00:00:00Z",
  })
  const needs = (d: TrendVersionData, envs: EngineEnvironment[]) =>
    publishBlockers(d, envs, ["staging", "production"]).filter(
      (b) => b.code === "engine_unsupported" && (b.need?.startsWith("prismReferenceAudio:") || b.need === "prismReferenceAudioPitch"),
    )
  const stored = (value: unknown) => trendVersionDataSchema.safeParse(trend(value)).data?.prismReferenceAudio

  it("is stored as today's id where one says it, else as { mode, semitones }", () => {
    expect(stored({ "480p": { mode: "voice", semitones: 4 }, "720p": { mode: "full", semitones: 12 }, "1080p": { mode: "full-one-tone", semitones: 0 } })).toEqual({
      "480p": "voice",
      "720p": "octave",
      "1080p": "one-tone",
    })
    expect(stored({ "480p": "voice", "720p": { mode: "full", semitones: 7 }, "1080p": { mode: "voice-one-tone" } })).toEqual({
      "480p": "voice",
      "720p": { mode: "full", semitones: 7 },
      "1080p": { mode: "voice-one-tone", semitones: 0 },
    })
    expect(trendVersionDataSchema.safeParse(trend({ "720p": { mode: "full", semitones: 30 } })).success).toBe(false)
  })

  it("a run is sent the object form only by an engine with the pitch shift; any other the ids it says, the rest the full audio", () => {
    const d = trend({ "480p": { mode: "full", semitones: 7 }, "720p": "voice", "1080p": { mode: "voice-one-tone", semitones: -2 } })
    setPluginSupports({ castSwap: PITCH } as never)
    expect(sent(d)).toEqual({ "480p": { mode: "full", semitones: 7 }, "720p": { mode: "voice", semitones: 4 }, "1080p": { mode: "voice-one-tone", semitones: -2 } })
    // Shaping twice changes nothing.
    const r = composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
    withoutUnsupportedFields(r)
    const once = structuredClone(r.body.prismReferenceAudio)
    withoutUnsupportedFields(r)
    expect(r.body.prismReferenceAudio).toEqual(once)
    setPluginSupports({ castSwap: MODES } as never)
    expect(sent(d)).toEqual({ "720p": "voice" })
    setPluginSupports({ castSwap: { ...ENGINE, prismReferenceAudioPerResolution: false, prismReferenceAudioModes: ALL } } as never)
    expect(sent(d, { resolution: "720p" })).toBe("voice")
    expect(sent(d)).toBeUndefined()
  })

  it("a trend of today's ids is sent to an engine with the pitch shift as the values they always were", () => {
    setPluginSupports({ castSwap: PITCH } as never)
    expect(sent(trend({ "480p": "one-tone", "720p": "octave", "1080p": "none" }))).toEqual({
      "480p": { mode: "full-one-tone", semitones: 0 },
      "720p": { mode: "full", semitones: 12 },
      "1080p": { mode: "none" },
    })
    expect(sent(trend("full"))).toBeUndefined()
  })

  it("publishing a value no id says needs the pitch shift in every environment, and a one-tone mode its listing", () => {
    const d = trend({ "480p": { mode: "voice-one-tone", semitones: 4 }, "720p": { mode: "full", semitones: 7 } })
    expect(needs(d, [env("staging", PITCH), env("production", MODES)])).toEqual([
      { code: "engine_unsupported", env: "production", need: "prismReferenceAudio:voice-one-tone" },
      { code: "engine_unsupported", env: "production", need: "prismReferenceAudioPitch" },
    ])
    expect(needs(d, [env("staging", { ...PITCH, prismReferenceAudioModes: ALL }), env("production", PITCH)])).toEqual([
      { code: "engine_unsupported", env: "staging", need: "prismReferenceAudio:voice-one-tone" },
    ])
    expect(needs(d, [env("staging", PITCH), env("production", PITCH)])).toEqual([])
    // A Pulse trend never sends it.
    expect(needs(trend({ "720p": { mode: "full", semitones: 7 } }, "kling-4"), [env("staging", ENGINE), env("production", ENGINE)])).toEqual([])
  })

  it("today's values keep their needs: Full mix, one tone at 0 is one-tone's, the full mix at +12 octave's", () => {
    const d = trend({ "480p": { mode: "full-one-tone", semitones: 0 }, "720p": { mode: "full", semitones: 12 }, "1080p": { mode: "voice", semitones: 4 } })
    expect(needs(d, [env("staging", MODES), env("production", MODES)])).toEqual([])
    expect(needs(d, [env("staging", ENGINE), env("production", MODES)])).toEqual([
      { code: "engine_unsupported", env: "staging", need: "prismReferenceAudio:one-tone" },
      { code: "engine_unsupported", env: "staging", need: "prismReferenceAudio:octave" },
    ])
    // An engine with the pitch shift takes them as the object form.
    expect(needs(d, [env("staging", PITCH), env("production", PITCH)])).toEqual([])
  })

  it("the shared setting's environments: every one must take the pitch shift for a value no id says", () => {
    expect(environmentsThatCannotTakePrismReferenceAudioModes([env("production", PITCH), env("staging", MODES)], ["pitch"])).toEqual(["staging"])
    expect(environmentsThatCannotTakePrismReferenceAudioModes([env("production", PITCH), env("staging", PITCH)], ["voice-one-tone", "pitch"])).toEqual([])
    expect(environmentsThatCannotTakePrismReferenceAudioModes([env("production", PITCH)], ["pitch"])).toEqual(["staging"])
  })
})

/**
 * The hold on what older code cannot read (a value no id says): refused until
 * every environment's platform claim AND engine flag cover it, and only where
 * the value changed. An id is never refused by it.
 */
describe("the hold on a value no id says", () => {
  const PITCH_MODES = [...ALL, "full-one-tone", "voice-one-tone"]
  const PITCH = { ...ENGINE, prismReferenceAudioPitch: true, prismReferenceAudioModes: PITCH_MODES }
  const NOW = Date.parse("2026-11-03T12:00:00Z")
  const fresh = new Date(NOW - 60_000).toISOString()
  const stale = new Date(NOW - 20 * 60_000).toISOString()
  const env = (name: string, castSwap: Record<string, unknown>, claim?: { supports: Record<string, unknown>; at: string }): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-01T00:00:00Z",
    ...(claim ? { platformClaim: claim } : {}),
  })
  const TAKES = { supports: { prismReferenceAudioPitch: true }, at: fresh }

  it("this platform claims it, on the one heartbeat's claim", () => {
    expect(PLATFORM_SUPPORTS.prismReferenceAudioPitch).toBe(true)
  })

  it("a platform takes it only while its claim says so and is fresh", () => {
    const envs = [env("staging", PITCH, TAKES), env("production", PITCH, { supports: { faceMeshMinFaceHeightPct: true }, at: fresh })]
    expect(environmentsWhosePlatformCannotTakePrismReferenceAudioPitch(envs, NOW)).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakePrismReferenceAudioPitch([env("staging", PITCH, TAKES), env("production", PITCH, TAKES)], NOW)).toEqual([])
    expect(environmentsWhosePlatformCannotTakePrismReferenceAudioPitch([env("staging", PITCH, { ...TAKES, at: stale }), env("production", PITCH, TAKES)], NOW)).toEqual(["staging"])
    expect(environmentsWhosePlatformCannotTakePrismReferenceAudioPitch([env("production", PITCH)], NOW)).toEqual(["staging", "production"])
    expect(environmentsWhosePlatformCannotTakePrismReferenceAudioPitch([], NOW)).toEqual(["staging", "production"])
  })

  it("refuses the platform first (422), then the engine (409), naming the environments and what is missing", () => {
    const pitch = ["pitch"] as const
    expect(prismReferenceAudioRefusalOf(pitch, "trend", [env("staging", PITCH, TAKES), env("production", PITCH)], NOW)).toEqual({
      status: 422,
      error: {
        code: "platform_unsupported",
        envs: ["production"],
        message:
          "The platform in production does not take this Prism reference audio yet, and trends are shared by every environment: choose No audio, Full mix at +4, Voice only at +4, or Full mix, one tone at 0, or wait until production is updated.",
      },
    })
    expect(prismReferenceAudioRefusalOf(pitch, "setting", [env("staging", ENGINE), env("production", ENGINE)], NOW)).toEqual({
      status: 422,
      error: {
        code: "platform_unsupported",
        envs: ["staging", "production"],
        message:
          "The platform in staging and production does not take this Prism reference audio yet, and this setting is shared by every environment: choose No audio, Full mix at +4, Voice only at +4, or Full mix, one tone at 0, or wait until staging and production are updated.",
      },
    })
    expect(prismReferenceAudioRefusalOf(pitch, "trend", [env("staging", MODES, TAKES), env("production", PITCH, TAKES)], NOW)).toEqual({
      status: 409,
      error: {
        code: "engine_unsupported",
        envs: ["staging"],
        message:
          "The Cast Swap engine in staging cannot send the Prism reference audio with that pitch shift yet, and trends are shared by every environment: choose another mode or pitch shift, or wait for the engine.",
      },
    })
    expect(prismReferenceAudioRefusalOf(["voice-one-tone", "pitch"], "setting", [env("staging", PITCH, TAKES), env("production", { ...PITCH, prismReferenceAudioModes: ALL }, TAKES)], NOW)?.error).toMatchObject({
      code: "engine_unsupported",
      envs: ["production"],
    })
    expect(prismReferenceAudioRefusalOf(pitch, "setting", [env("staging", PITCH, TAKES), env("production", PITCH, TAKES)], NOW)).toBeNull()
  })

  it("an id alone never needs a claim: one-tone and octave keep their engine rule, and their sentence", () => {
    const envs = [env("staging", MODES), env("production", MODES)]
    expect(prismReferenceAudioRefusalOf(["one-tone", "octave"], "setting", envs, NOW)).toBeNull()
    expect(prismReferenceAudioRefusalOf([], "trend", [], NOW)).toBeNull()
    expect(prismReferenceAudioRefusalOf(["octave"], "setting", [env("staging", ENGINE), env("production", MODES)], NOW)).toEqual({
      status: 409,
      error: {
        code: "engine_unsupported",
        envs: ["staging"],
        message:
          "The Cast Swap engine in staging cannot send the Prism reference audio as octave yet, and this setting is shared by every environment: choose another mode, or wait for the engine.",
      },
    })
  })

  it("the publish hold names why, and only the platform (the publish checks hold the engine)", () => {
    expect(prismReferenceAudioPlatformHold(["pitch"], "publish", [env("staging", ENGINE, TAKES), env("production", ENGINE)], NOW)).toEqual({
      code: "platform_unsupported",
      envs: ["production"],
      message:
        "The platform in production does not take this Prism reference audio yet, so its runs of this trend would send the full audio: choose No audio, Full mix at +4, Voice only at +4, or Full mix, one tone at 0, or wait until production is updated.",
    })
    expect(prismReferenceAudioPlatformHold(["pitch"], "publish", [env("staging", ENGINE, TAKES), env("production", ENGINE, TAKES)], NOW)).toBeNull()
    expect(prismReferenceAudioPlatformHold(["one-tone"], "publish", [], NOW)).toBeNull()
  })

  describe("publishing, against the published version", () => {
    const ON_ALL = [env("staging", PITCH, TAKES), env("production", PITCH, TAKES)]
    const LACKING = [env("staging", MODES), env("production", MODES)]
    const needs = (d: TrendVersionData, envs: EngineEnvironment[], live?: unknown) =>
      publishBlockers(d, envs, ["staging", "production"], [], live).filter(
        (b) => b.code === "engine_unsupported" && (b.need?.startsWith("prismReferenceAudio:") || b.need === "prismReferenceAudioPitch"),
      )
    const SEVEN = { "720p": { mode: "full", semitones: 7 } }

    it("a value changed from the published version (or never published) still needs the engine", () => {
      expect(needs(trend(SEVEN), LACKING)).toEqual([
        { code: "engine_unsupported", env: "staging", need: "prismReferenceAudioPitch" },
        { code: "engine_unsupported", env: "production", need: "prismReferenceAudioPitch" },
      ])
      expect(needs(trend(SEVEN), LACKING, { "720p": { mode: "full", semitones: 8 } })).toHaveLength(2)
      expect(needs(trend(SEVEN), ON_ALL)).toEqual([])
    })

    it("a value the published version holds as it is needs nothing: it was not changed", () => {
      expect(needs(trend(SEVEN), LACKING, SEVEN)).toEqual([])
      // Only the resolution that moved counts.
      expect(needs(trend({ ...SEVEN, "1080p": { mode: "voice-one-tone", semitones: 0 } }), LACKING, SEVEN)).toEqual([
        { code: "engine_unsupported", env: "staging", need: "prismReferenceAudio:voice-one-tone" },
        { code: "engine_unsupported", env: "staging", need: "prismReferenceAudioPitch" },
        { code: "engine_unsupported", env: "production", need: "prismReferenceAudio:voice-one-tone" },
        { code: "engine_unsupported", env: "production", need: "prismReferenceAudioPitch" },
      ])
    })

    it("today's ids keep their publish needs, whatever the published version holds", () => {
      const NO_LIST = [env("staging", ENGINE), env("production", MODES)]
      expect(needs(trend({ "480p": "one-tone" }), NO_LIST, { "480p": "one-tone" })).toEqual([
        { code: "engine_unsupported", env: "staging", need: "prismReferenceAudio:one-tone" },
      ])
    })
  })
})
