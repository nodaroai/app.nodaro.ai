import { describe, it, expect } from "vitest"

import {
  RECAST_VOICE_DEFAULTS,
  buildWireOrderedVoices,
  pruneVoiceSettings,
  recastActiveVoices,
} from "../recast"

/**
 * The voice-changer-pro WIRE mapping (VCP-app parity): a keep-slot rides as
 * `null`, a tuned voice as a per-voice settings object, an untouched voice as
 * its bare id — and settings equal to the defaults prune away entirely.
 */

describe("pruneVoiceSettings", () => {
  it("drops values equal to the defaults; undefined when nothing diverges", () => {
    expect(
      pruneVoiceSettings({
        stability: RECAST_VOICE_DEFAULTS.stability,
        similarityBoost: RECAST_VOICE_DEFAULTS.similarityBoost,
        style: RECAST_VOICE_DEFAULTS.style,
        useSpeakerBoost: RECAST_VOICE_DEFAULTS.useSpeakerBoost,
        volumeMode: RECAST_VOICE_DEFAULTS.volumeMode,
      }),
    ).toBeUndefined()
  })

  it("keeps only the diverging levers", () => {
    expect(
      pruneVoiceSettings({ stability: 0.8, style: 0, useSpeakerBoost: false }),
    ).toEqual({ stability: 0.8, useSpeakerBoost: false })
  })

  it("a seed always rides (there is no default seed)", () => {
    expect(pruneVoiceSettings({ seed: 42 })).toEqual({ seed: 42 })
  })

  it("volume rides only in manual mode and only off-default", () => {
    // Manual + 100% (the default level) → mode alone survives.
    expect(pruneVoiceSettings({ volumeMode: "manual", volume: 100 })).toEqual({
      volumeMode: "manual",
    })
    expect(pruneVoiceSettings({ volumeMode: "manual", volume: 60 })).toEqual({
      volumeMode: "manual",
      volume: 60,
    })
    // Not manual → a stray volume never leaks onto the wire.
    expect(pruneVoiceSettings({ volume: 60 })).toBeUndefined()
  })
})

describe("buildWireOrderedVoices", () => {
  const NAT = { voiceId: "v-nat", voiceName: "Natalie" }
  const GEO = { voiceId: "v-geo", voiceName: "George" }

  it("bare voices ride as ids; keep-slots as null; tuned voices as objects", () => {
    expect(
      buildWireOrderedVoices([
        { ...NAT, keep: true },
        GEO,
        { ...NAT, settings: { stability: 0.9 } },
      ]),
    ).toEqual([null, "v-geo", { voiceId: "v-nat", stability: 0.9 }])
  })

  it("settings equal to the defaults collapse back to a bare id", () => {
    expect(
      buildWireOrderedVoices([
        { ...GEO, settings: { stability: RECAST_VOICE_DEFAULTS.stability } },
      ]),
    ).toEqual(["v-geo"])
  })
})

describe("recastActiveVoices", () => {
  it("filters keep-slots — drives the ≥1-non-null guard + the provenance label", () => {
    const active = recastActiveVoices([
      { voiceId: "a", voiceName: "A", keep: true },
      { voiceId: "b", voiceName: "B" },
    ])
    expect(active).toEqual([{ voiceId: "b", voiceName: "B" }])
  })
})
