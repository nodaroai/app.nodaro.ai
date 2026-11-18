/**
 * Pulse reference audio ("audio in"): a mode and a pitch shift per Pulse
 * output resolution, a resolution left out following the audio out (the full
 * mix at +4 with the original audio, unpitched with Kling's own). Only the
 * resolutions off that default are stored or sent, and nothing at all when none
 * is; one wire shape, only on a Pulse run, only to an engine declaring
 * `castSwap.pulseReferenceAudio`.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  CAST_SWAP_PULSE_REFERENCE_AUDIO_MODES,
  CAST_SWAP_PULSE_RESOLUTIONS,
  NODARO_MOTION_PULSE_REFERENCE_AUDIO_KEY,
  castSwapPulseReferenceAudioSchema,
  engineTakesPulseReferenceAudio,
  isDefaultPulseReferenceAudio,
  parseNodaroMotionPulseReferenceAudio,
  pulseAudioOutOf,
  pulseReferenceAudioChangedFrom,
  pulseReferenceAudioChangesToOffDefault,
  pulseReferenceAudioDefault,
  pulseReferenceAudioNotDefault,
  pulseReferenceAudioSent,
} from "../cast-swap-pulse-reference-audio.js"
import { CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES } from "../cast-swap-prism-reference-audio.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../private-plugins/supports-registry.js"

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const, "1080p" as const], trendRun: true }

afterEach(() => _resetPluginSupportsForTests())

describe("the values", () => {
  it("has Prism's five modes, Pulse's two resolutions and its own row", () => {
    expect(CAST_SWAP_PULSE_REFERENCE_AUDIO_MODES).toBe(CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES)
    expect(CAST_SWAP_PULSE_RESOLUTIONS).toEqual(["720p", "1080p"])
    expect(NODARO_MOTION_PULSE_REFERENCE_AUDIO_KEY).toBe("nodaro_motion_pulse_reference_audio")
  })

  it("defaults by the audio out: full at +4 with the original (or none named), unpitched with Kling's own", () => {
    expect(pulseReferenceAudioDefault("original")).toEqual({ mode: "full", semitones: 4 })
    expect(pulseReferenceAudioDefault(undefined)).toEqual({ mode: "full", semitones: 4 })
    expect(pulseReferenceAudioDefault(null)).toEqual({ mode: "full", semitones: 4 })
    expect(pulseReferenceAudioDefault("generated")).toEqual({ mode: "full", semitones: 0 })
    expect(pulseAudioOutOf("generated")).toBe("generated")
    for (const v of [undefined, "original", "loud", 1]) expect(pulseAudioOutOf(v)).toBe("original")
  })

  it("reads absent semitones as 0: { mode: full } is the default only with Kling's own audio out", () => {
    expect(isDefaultPulseReferenceAudio({ mode: "full" }, "generated")).toBe(true)
    expect(isDefaultPulseReferenceAudio({ mode: "full" }, "original")).toBe(false)
    expect(isDefaultPulseReferenceAudio({ mode: "full", semitones: 4 }, "original")).toBe(true)
    expect(isDefaultPulseReferenceAudio({ mode: "full", semitones: 4 }, "generated")).toBe(false)
    expect(isDefaultPulseReferenceAudio({ mode: "none" }, "original")).toBe(false)
    expect(isDefaultPulseReferenceAudio({ mode: "voice", semitones: 4 }, "original")).toBe(false)
  })
})

describe("castSwapPulseReferenceAudioSchema", () => {
  it("takes the two resolutions as strict { mode, semitones? }, in their written form", () => {
    expect(castSwapPulseReferenceAudioSchema.parse({})).toEqual({})
    expect(castSwapPulseReferenceAudioSchema.parse({ "720p": { mode: "voice" }, "1080p": { mode: "none", semitones: 3 } })).toEqual({
      "720p": { mode: "voice", semitones: 0 },
      "1080p": { mode: "none" },
    })
    expect(castSwapPulseReferenceAudioSchema.parse({ "720p": { mode: "voice-one-tone", semitones: -12.5 } })).toEqual({ "720p": { mode: "voice-one-tone", semitones: -12.5 } })
  })

  it("refuses ids, a plain string, other resolutions, unknown keys and a pitch out of range or step", () => {
    for (const bad of [
      "voice",
      { "720p": "voice" },
      { "480p": { mode: "full" } },
      { "720p": { mode: "full", extra: 1 } },
      { "720p": { mode: "octave" } },
      { "720p": { mode: "full", semitones: 25 } },
      { "720p": { mode: "full", semitones: 1.25 } },
      { "720p": { mode: "full" }, other: {} },
    ]) {
      expect(castSwapPulseReferenceAudioSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("parses a stored row tolerantly: the object, else null", () => {
    expect(parseNodaroMotionPulseReferenceAudio({ "1080p": { mode: "full", semitones: 7 } })).toEqual({ "1080p": { mode: "full", semitones: 7 } })
    expect(parseNodaroMotionPulseReferenceAudio({})).toEqual({})
    for (const v of [null, undefined, "full", { "720p": "voice" }, 3]) expect(parseNodaroMotionPulseReferenceAudio(v)).toBeNull()
  })
})

describe("pulseReferenceAudioNotDefault", () => {
  it("keeps only the resolutions off the default of the audio out, else undefined", () => {
    const choice = { "720p": { mode: "full" as const, semitones: 4 }, "1080p": { mode: "full" as const, semitones: 0 } }
    expect(pulseReferenceAudioNotDefault(choice, "original")).toEqual({ "1080p": { mode: "full", semitones: 0 } })
    expect(pulseReferenceAudioNotDefault(choice, "generated")).toEqual({ "720p": { mode: "full", semitones: 4 } })
    expect(pulseReferenceAudioNotDefault({ "720p": { mode: "full", semitones: 4 } }, undefined)).toBeUndefined()
    expect(pulseReferenceAudioNotDefault({}, "original")).toBeUndefined()
    expect(pulseReferenceAudioNotDefault(null, "original")).toBeUndefined()
    expect(pulseReferenceAudioNotDefault({ "720p": { mode: "none", semitones: 2 } }, "generated")).toEqual({ "720p": { mode: "none" } })
  })
})

describe("pulseReferenceAudioChangedFrom", () => {
  it("is what a save changes to a value off the default, each side against its own audio out", () => {
    const voice = { mode: "voice" as const, semitones: 4 }
    expect(pulseReferenceAudioChangedFrom({ "720p": voice }, "original", null, "original")).toEqual({ "720p": voice })
    expect(pulseReferenceAudioChangedFrom({ "720p": voice }, "original", { "720p": voice }, "original")).toEqual({})
    // Taken back to the default: nothing a hold waits for.
    expect(pulseReferenceAudioChangedFrom({}, "original", { "720p": voice }, "original")).toEqual({})
    expect(pulseReferenceAudioChangedFrom({ "720p": { mode: "full", semitones: 4 } }, "original", { "720p": voice }, "original")).toEqual({})
    // Another value at the same resolution is a change.
    expect(pulseReferenceAudioChangedFrom({ "720p": { mode: "none" } }, "original", { "720p": voice }, "original")).toEqual({ "720p": { mode: "none" } })
  })

  it("compares what is stored, not what it sounds like: full at +4 newly stored under Kling's own audio is a change", () => {
    const full4 = { "720p": { mode: "full" as const, semitones: 4 } }
    expect(pulseReferenceAudioChangedFrom(full4, "generated", null, "original")).toEqual(full4)
    expect(pulseReferenceAudioChangesToOffDefault(full4, "generated", null, "original")).toBe(true)
    // The audio out moving alone stores nothing new.
    expect(pulseReferenceAudioChangesToOffDefault(null, "generated", null, "original")).toBe(false)
    expect(pulseReferenceAudioChangesToOffDefault(full4, "generated", full4, "generated")).toBe(false)
  })
})

describe("pulseReferenceAudioSent", () => {
  const stored = { "720p": { mode: "voice" as const, semitones: 4 }, "1080p": { mode: "full" as const, semitones: 4 } }

  it("sends only on a Pulse run, to an engine declaring castSwap.pulseReferenceAudio, only off the default", () => {
    setPluginSupports({ castSwap: { ...CS, pulseReferenceAudio: true } })
    expect(engineTakesPulseReferenceAudio()).toBe(true)
    expect(pulseReferenceAudioSent({ engine: "kling-4" }, stored, "original")).toEqual({ pulseReferenceAudio: { "720p": { mode: "voice", semitones: 4 } } })
    expect(pulseReferenceAudioSent({ engine: "nodaro-pulse" }, stored, "generated")).toEqual({ pulseReferenceAudio: stored })
    expect(pulseReferenceAudioSent({ engine: "nodaro-prism" }, stored, "original")).toEqual({})
    expect(pulseReferenceAudioSent({}, stored, "original")).toEqual({})
    expect(pulseReferenceAudioSent({ engine: "kling-4" }, { "1080p": { mode: "full", semitones: 4 } }, "original")).toEqual({})
    expect(pulseReferenceAudioSent({ engine: "kling-4" }, null, "original")).toEqual({})
  })

  it("sends nothing to an engine from before the setting", () => {
    for (const castSwap of [CS, { ...CS, pulseReferenceAudio: false }, { ...CS, pulseAudio: true, prismReferenceAudioPitch: true }]) {
      setPluginSupports({ castSwap })
      expect(engineTakesPulseReferenceAudio()).toBe(false)
      expect(pulseReferenceAudioSent({ engine: "kling-4" }, stored, "original")).toEqual({})
    }
  })
})
