/**
 * Pulse reference audio ("audio in") on a trend: stored only on a Kling 4
 * draft and only the resolutions off the default of the trend's own audio out
 * (`pulseAudio`); sent by its runs only on Kling 4, only off that default, only
 * to an engine declaring `castSwap.pulseReferenceAudio`; publishing needs that
 * flag in every environment; and a change to a value off the default waits for
 * every environment's platform claim, then its engine (the holds).
 */
import { afterEach, describe, expect, it } from "vitest"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { PLATFORM_SUPPORTS, type EngineEnvironment } from "../../engine-environments.js"
import {
  environmentsThatCannotTakePulseReferenceAudio,
  environmentsWhosePlatformCannotTakePulseReferenceAudio,
  pulseReferenceAudioPlatformHold,
  pulseReferenceAudioRefusalOf,
} from "../../nodaro-motion-pulse-reference-audio-holds.js"
import { composeTrendRun } from "../compose.js"
import { PULSE_REFERENCE_AUDIO_NEED, publishBlockers, pulseReferenceAudioSet } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import { trendVersionDataSchema, withPulseReferenceAudioKept } from "../schemas.js"
import type { TrendVersionData } from "../types.js"

const ENGINE = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  engines: ["seedance-2-5", "kling-4"],
  pulseAudio: true,
}
const TAKES = { ...ENGINE, pulseReferenceAudio: true }
const VOICE = { mode: "voice", semitones: 4 } as const

function trend(pulseReferenceAudio: unknown, { engine = "kling-4", pulseAudio }: { engine?: "kling-4" | "seedance-2-5"; pulseAudio?: "original" | "generated" } = {}): TrendVersionData {
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
    ...(pulseReferenceAudio !== undefined ? { pulseReferenceAudio: pulseReferenceAudio as never } : {}),
    ...(pulseAudio ? { pulseAudio } : {}),
    engine,
  }
}
const composed = (d: TrendVersionData) => composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
const sent = (d: TrendVersionData) => {
  const r = composed(d)
  withoutUnsupportedFields(r)
  return r.body
}

afterEach(() => _resetPluginSupportsForTests())

describe("the trend field", () => {
  it("is a strict per-resolution object of { mode, semitones? }", () => {
    expect(trendVersionDataSchema.safeParse(trend({ "720p": VOICE, "1080p": { mode: "none" } })).success).toBe(true)
    for (const bad of ["voice", { "720p": "voice" }, { "480p": VOICE }, { "720p": { mode: "loud" } }]) {
      expect(trendVersionDataSchema.safeParse(trend(bad)).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("is kept only on Kling 4, only off the default of the trend's audio out, and never as {}", () => {
    expect(withPulseReferenceAudioKept(trend({ "720p": VOICE, "1080p": { mode: "full", semitones: 4 } })).pulseReferenceAudio).toEqual({ "720p": VOICE })
    expect(withPulseReferenceAudioKept(trend({ "720p": { mode: "full", semitones: 4 } }, { pulseAudio: "generated" })).pulseReferenceAudio).toEqual({
      "720p": { mode: "full", semitones: 4 },
    })
    for (const d of [
      trend({ "720p": { mode: "full", semitones: 4 } }),
      trend({ "720p": { mode: "full", semitones: 0 } }, { pulseAudio: "generated" }),
      trend({}),
      trend({ "720p": VOICE }, { engine: "seedance-2-5" }),
    ]) {
      expect("pulseReferenceAudio" in withPulseReferenceAudioKept(d), JSON.stringify(d.pulseReferenceAudio)).toBe(false)
    }
    // A draft without the key is the draft itself.
    const none = trend(undefined)
    expect(withPulseReferenceAudioKept(none)).toBe(none)
  })
})

describe("a trend run", () => {
  it("sends the resolutions off the default of the trend's audio out, on Kling 4, to an engine that declares it", () => {
    setPluginSupports({ castSwap: TAKES } as never)
    expect(sent(trend({ "720p": VOICE, "1080p": { mode: "full", semitones: 4 } })).pulseReferenceAudio).toEqual({ "720p": VOICE })
    const generated = sent(trend({ "720p": { mode: "full", semitones: 4 }, "1080p": { mode: "full", semitones: 0 } }, { pulseAudio: "generated" }))
    expect(generated.pulseAudio).toBe("generated")
    expect(generated.pulseReferenceAudio).toEqual({ "720p": { mode: "full", semitones: 4 } })
  })

  it("sends no key when every resolution is the default, on a Prism trend, or to an engine without the flag", () => {
    setPluginSupports({ castSwap: TAKES } as never)
    for (const d of [trend(undefined), trend({}), trend({ "720p": { mode: "full", semitones: 4 } }), trend({ "720p": VOICE }, { engine: "seedance-2-5" })]) {
      expect("pulseReferenceAudio" in sent(d), JSON.stringify(d.pulseReferenceAudio)).toBe(false)
    }
    setPluginSupports({ castSwap: ENGINE } as never)
    expect("pulseReferenceAudio" in sent(trend({ "720p": VOICE }))).toBe(false)
  })

  it("leaves a body without the key exactly as before the setting", () => {
    setPluginSupports({ castSwap: TAKES } as never)
    const withKey = composed(trend({ "720p": { mode: "full", semitones: 4 } }))
    const without = composed(trend(undefined))
    expect(withKey.body).toEqual(without.body)
  })

  it("reads the default again from the audio out the body is left with (an engine that drops pulseAudio)", () => {
    setPluginSupports({ castSwap: { ...TAKES, pulseAudio: false } } as never)
    const body = sent(trend({ "720p": { mode: "full", semitones: 4 }, "1080p": { mode: "full", semitones: 0 } }, { pulseAudio: "generated" }))
    expect(body.pulseAudio).toBeUndefined()
    // Full at +4 was off the default of Kling's own audio; with the original audio back it is the default, so not sent.
    expect("pulseReferenceAudio" in body).toBe(false)
    expect(sent(trend({ "720p": VOICE, "1080p": { mode: "full", semitones: 4 } }, { pulseAudio: "generated" })).pulseReferenceAudio).toEqual({ "720p": VOICE })
  })
})

describe("publishing", () => {
  const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-18T00:00:00Z",
  })
  const needs = (d: TrendVersionData, envs: EngineEnvironment[]) =>
    publishBlockers(d, envs, ["staging", "production"]).filter((b) => b.code === "engine_unsupported" && b.need === PULSE_REFERENCE_AUDIO_NEED)

  it("needs castSwap.pulseReferenceAudio in every environment for a Kling 4 trend off the default", () => {
    expect(PULSE_REFERENCE_AUDIO_NEED).toBe("pulseReferenceAudio")
    const d = trend({ "1080p": { mode: "none" } })
    expect(pulseReferenceAudioSet(d)).toBe(true)
    expect(needs(d, [env("staging", TAKES), env("production", ENGINE)])).toEqual([{ code: "engine_unsupported", env: "production", need: "pulseReferenceAudio" }])
    expect(needs(d, [env("staging", TAKES), env("production", TAKES)])).toEqual([])
  })

  it("needs nothing for the default (against the trend's audio out) or a Prism trend", () => {
    for (const d of [
      trend(undefined),
      trend({ "720p": { mode: "full", semitones: 4 } }),
      trend({ "720p": { mode: "full", semitones: 0 } }, { pulseAudio: "generated" }),
      trend({ "720p": VOICE }, { engine: "seedance-2-5" }),
    ]) {
      expect(pulseReferenceAudioSet(d)).toBe(false)
      expect(needs(d, [env("staging", ENGINE), env("production", ENGINE)]), JSON.stringify(d.pulseReferenceAudio)).toEqual([])
    }
  })
})

describe("the holds", () => {
  const NOW = Date.parse("2026-11-18T12:00:00Z")
  const fresh = new Date(NOW - 60_000).toISOString()
  const stale = new Date(NOW - 60 * 60_000).toISOString()
  const CLAIM = { supports: { pulseReferenceAudio: true }, at: fresh }
  const env = (name: string, castSwap: Record<string, unknown>, claim?: { supports: Record<string, unknown>; at: string }): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-18T00:00:00Z",
    ...(claim ? { platformClaim: claim } : {}),
  })

  it("this platform claims it", () => {
    expect(PLATFORM_SUPPORTS.pulseReferenceAudio).toBe(true)
  })

  it("a platform takes it only while its claim says so and is fresh; an engine only when it declares it", () => {
    expect(environmentsWhosePlatformCannotTakePulseReferenceAudio([env("staging", TAKES, CLAIM), env("production", TAKES, CLAIM)], NOW)).toEqual([])
    expect(environmentsWhosePlatformCannotTakePulseReferenceAudio([env("staging", TAKES, { ...CLAIM, at: stale }), env("production", TAKES, CLAIM)], NOW)).toEqual(["staging"])
    expect(
      environmentsWhosePlatformCannotTakePulseReferenceAudio([env("staging", TAKES, { supports: { prismReferenceAudioPitch: true }, at: fresh }), env("production", TAKES, CLAIM)], NOW),
    ).toEqual(["staging"])
    expect(environmentsWhosePlatformCannotTakePulseReferenceAudio([], NOW)).toEqual(["staging", "production"])
    expect(environmentsThatCannotTakePulseReferenceAudio([env("staging", TAKES), env("production", ENGINE)])).toEqual(["production"])
    expect(environmentsThatCannotTakePulseReferenceAudio([env("production", TAKES)])).toEqual(["staging"])
  })

  it("refuses the platform first (422), then the engine (409), naming the environments", () => {
    expect(pulseReferenceAudioRefusalOf("trend", [env("staging", TAKES, CLAIM), env("production", TAKES)], NOW)).toEqual({
      status: 422,
      error: {
        code: "platform_unsupported",
        envs: ["production"],
        message:
          "The platform in production does not take the Pulse reference audio yet, and trends are shared by every environment: keep the default for the audio out, or wait until production is updated.",
      },
    })
    expect(pulseReferenceAudioRefusalOf("setting", [env("staging", ENGINE, CLAIM), env("production", TAKES, CLAIM)], NOW)).toEqual({
      status: 409,
      error: {
        code: "engine_unsupported",
        envs: ["staging"],
        message:
          "The Cast Swap engine in staging cannot send the Pulse reference audio yet, and this setting is shared by every environment: keep the default for the audio out, or wait for the engine.",
      },
    })
    expect(pulseReferenceAudioRefusalOf("setting", [env("staging", TAKES, CLAIM), env("production", TAKES, CLAIM)], NOW)).toBeNull()
  })

  it("the publish hold names why, and only the platform (the publish checks hold the engine)", () => {
    expect(pulseReferenceAudioPlatformHold("publish", [env("staging", ENGINE, CLAIM), env("production", ENGINE)], NOW)).toEqual({
      code: "platform_unsupported",
      envs: ["production"],
      message:
        "The platform in production does not take the Pulse reference audio yet, so its runs of this trend would send the default: keep the default for the audio out, or wait until production is updated.",
    })
    expect(pulseReferenceAudioPlatformHold("publish", [env("staging", ENGINE, CLAIM), env("production", ENGINE, CLAIM)], NOW)).toBeNull()
  })
})
