/**
 * Prism reference audio as two controls per output resolution: a mode
 * ("none", "full", "voice", "full-one-tone", "voice-one-tone") and a pitch
 * shift in semitones (-24 to 24 in steps of 0.5; 0 skips the pitch step).
 *
 * Every value stored today reads as the value it always sounded like (the
 * carry-over), is STORED as it was (an id where a value is one), and is sent
 * to every engine exactly as before. Only an engine that declares
 * `castSwap.prismReferenceAudioPitch` is sent the object form; any other is
 * sent the id a value is, and a value no id can say is the full audio there.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT,
  CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS,
  CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES,
  castSwapPrismReferenceAudioSchema,
  engineMeetsPrismReferenceAudioRequirement,
  engineTakesPrismReferenceAudioModeAtAll,
  engineTakesPrismReferenceAudioValue,
  parseNodaroMotionPrismReferenceAudio,
  prismReferenceAudioByResolutionOf,
  prismReferenceAudioChangedFrom,
  prismReferenceAudioIdOf,
  prismReferenceAudioNotDefault,
  prismReferenceAudioRequirementsOf,
  prismReferenceAudioSent,
  prismReferenceAudioStoredOf,
  prismReferenceAudioUnreadableRequirementsOf,
  prismReferenceAudioValueOfId,
  type CastSwapPrismReferenceAudioValue,
} from "../cast-swap-prism-reference-audio.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../private-plugins/supports-registry.js"

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true }
/** An engine from before the newer ids (takes "voice" / "none" per resolution). */
const PER_RESOLUTION = { ...CS, prismReferenceAudioPerResolution: true }
/** The engine at 0.426.0: lists "one-tone" and "octave". */
const MODES_0426 = { ...PER_RESOLUTION, prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave"] as const }
/** An engine that takes the pitch shift and lists both one-tone modes (and keeps the old ids). */
const PITCH = {
  ...PER_RESOLUTION,
  prismReferenceAudioPitch: true,
  prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave", "full-one-tone", "voice-one-tone"] as const,
}
/** An engine that takes one mode only (the run's own resolution's). */
const ONE_MODE = { ...CS, prismReferenceAudio: true, prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave"] as const }

const v = (mode: CastSwapPrismReferenceAudioValue["mode"], semitones?: number): CastSwapPrismReferenceAudioValue =>
  semitones === undefined ? { mode } : { mode, semitones }
const every = <const T>(x: T) => ({ "480p": x, "720p": x, "1080p": x })

afterEach(() => _resetPluginSupportsForTests())

describe("the two controls", () => {
  it("has five modes and today's five ids", () => {
    expect(CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES).toEqual(["none", "full", "voice", "full-one-tone", "voice-one-tone"])
    expect(CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS).toEqual(["full", "voice", "none", "one-tone", "octave"])
    expect(CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT).toEqual({ mode: "full", semitones: 4 })
  })

  it("reads today's ids as the values they always sounded like (the carry-over)", () => {
    expect(prismReferenceAudioValueOfId("full")).toEqual({ mode: "full", semitones: 4 })
    expect(prismReferenceAudioValueOfId("voice")).toEqual({ mode: "voice", semitones: 4 })
    expect(prismReferenceAudioValueOfId("one-tone")).toEqual({ mode: "full-one-tone", semitones: 0 })
    expect(prismReferenceAudioValueOfId("octave")).toEqual({ mode: "full", semitones: 12 })
    expect(prismReferenceAudioValueOfId("none")).toEqual({ mode: "none" })
    expect(prismReferenceAudioByResolutionOf({ "480p": "one-tone", "720p": "octave", "1080p": "none" })).toEqual({
      "480p": { mode: "full-one-tone", semitones: 0 },
      "720p": { mode: "full", semitones: 12 },
      "1080p": { mode: "none" },
    })
    expect(prismReferenceAudioByResolutionOf("voice")).toEqual(every({ mode: "voice", semitones: 4 }))
    expect(prismReferenceAudioByResolutionOf({})).toEqual({})
  })

  it("says a value as an id only where the id sounds exactly like it", () => {
    for (const id of CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS) expect(prismReferenceAudioIdOf(prismReferenceAudioValueOfId(id)), id).toBe(id)
    expect(prismReferenceAudioIdOf(v("none", 7))).toBe("none")
    for (const value of [v("full", 7), v("full", 0), v("full"), v("voice", 0), v("voice", 12), v("full-one-tone", 4), v("voice-one-tone", 4), v("voice-one-tone", 0), v("full", -3.5)]) {
      expect(prismReferenceAudioIdOf(value), JSON.stringify(value)).toBeUndefined()
    }
  })
})

describe("the setting as stored", () => {
  it("stores every form saved today exactly as it is", () => {
    for (const stored of [
      { "480p": "full", "720p": "voice", "1080p": "none" },
      { "720p": "none" },
      { "480p": "one-tone", "720p": "octave" },
      {},
    ]) {
      expect(castSwapPrismReferenceAudioSchema.parse(stored), JSON.stringify(stored)).toEqual(stored)
      expect(parseNodaroMotionPrismReferenceAudio(stored), JSON.stringify(stored)).toEqual(stored)
    }
    for (const id of CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS) expect(castSwapPrismReferenceAudioSchema.parse(id), id).toEqual(every(id))
  })

  it("takes a { mode, semitones } per resolution, stored as today's id where one says it, else as the value", () => {
    expect(
      castSwapPrismReferenceAudioSchema.parse({
        "480p": { mode: "voice", semitones: 4 },
        "720p": { mode: "full-one-tone", semitones: 0 },
        "1080p": { mode: "none", semitones: 5 },
      }),
    ).toEqual({ "480p": "voice", "720p": "one-tone", "1080p": "none" })
    expect(castSwapPrismReferenceAudioSchema.parse({ "480p": { mode: "full", semitones: 12 }, "720p": { mode: "full", semitones: 4 } })).toEqual({
      "480p": "octave",
      "720p": "full",
    })
    expect(
      castSwapPrismReferenceAudioSchema.parse({
        "480p": { mode: "full", semitones: 7 },
        "720p": { mode: "voice-one-tone", semitones: -3.5 },
        "1080p": { mode: "full-one-tone", semitones: 24 },
      }),
    ).toEqual({ "480p": { mode: "full", semitones: 7 }, "720p": { mode: "voice-one-tone", semitones: -3.5 }, "1080p": { mode: "full-one-tone", semitones: 24 } })
    // Absent semitones mean 0: full at 0 is not the default, and no id says it.
    expect(castSwapPrismReferenceAudioSchema.parse({ "720p": { mode: "full" } })).toEqual({ "720p": { mode: "full", semitones: 0 } })
    expect(castSwapPrismReferenceAudioSchema.parse({ "720p": { mode: "voice-one-tone" } })).toEqual({ "720p": { mode: "voice-one-tone", semitones: 0 } })
    // Stored once, read the same again.
    const once = castSwapPrismReferenceAudioSchema.parse({ "480p": { mode: "full", semitones: -24 }, "720p": "voice" })
    expect(castSwapPrismReferenceAudioSchema.parse(once)).toEqual(once)
  })

  it("refuses a pitch out of range or off the half-semitone steps, an unknown mode or key, and a value object for every resolution", () => {
    for (const bad of [
      { "720p": { mode: "full", semitones: 24.5 } },
      { "720p": { mode: "full", semitones: -25 } },
      { "720p": { mode: "full", semitones: 0.3 } },
      { "720p": { mode: "full", semitones: "4" } },
      { "720p": { mode: "full", semitones: null } },
      { "720p": { mode: "one-tone", semitones: 0 } },
      { "720p": { mode: "loud" } },
      { "720p": { mode: "full", semitones: 4, gain: 2 } },
      { "720p": {} },
      { mode: "full", semitones: 4 },
      { "4k": "none" },
      "two-tone",
      "",
      null,
      ["voice"],
    ]) {
      expect(castSwapPrismReferenceAudioSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
      expect(prismReferenceAudioByResolutionOf(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it("leaves out the resolutions at the default, the rest as stored", () => {
    expect(prismReferenceAudioNotDefault(prismReferenceAudioByResolutionOf({ "480p": "full", "720p": "none", "1080p": "voice" }))).toEqual({
      "720p": "none",
      "1080p": "voice",
    })
    expect(prismReferenceAudioNotDefault(prismReferenceAudioByResolutionOf({ "480p": { mode: "full", semitones: 4 }, "720p": { mode: "full", semitones: 7 } }))).toEqual({
      "720p": { mode: "full", semitones: 7 },
    })
    expect(prismReferenceAudioNotDefault(prismReferenceAudioByResolutionOf(every("full")))).toBeUndefined()
    expect(prismReferenceAudioNotDefault(null)).toBeUndefined()
    expect(prismReferenceAudioStoredOf(v("full", 0))).toEqual({ mode: "full", semitones: 0 })
    expect(prismReferenceAudioStoredOf(v("none"))).toBe("none")
  })
})

/** One table of which engine takes which value, the frontend's offer holds the same (prism-reference-audio-modes.test.tsx). */
const TAKES: ReadonlyArray<readonly [CastSwapPrismReferenceAudioValue, { before: boolean; at0426: boolean; pitch: boolean }]> = [
  [v("full", 4), { before: true, at0426: true, pitch: true }],
  [v("voice", 4), { before: true, at0426: true, pitch: true }],
  [v("none"), { before: true, at0426: true, pitch: true }],
  [v("full-one-tone", 0), { before: false, at0426: true, pitch: true }],
  [v("full", 12), { before: false, at0426: true, pitch: true }],
  [v("full", 7), { before: false, at0426: false, pitch: true }],
  [v("full", -3.5), { before: false, at0426: false, pitch: true }],
  [v("voice", 0), { before: false, at0426: false, pitch: true }],
  [v("full-one-tone", 4), { before: false, at0426: false, pitch: true }],
  [v("voice-one-tone", 0), { before: false, at0426: false, pitch: true }],
  [v("voice-one-tone", 4), { before: false, at0426: false, pitch: true }],
]

describe("which engine takes which value", () => {
  it.each(TAKES)("%j", (value, expected) => {
    expect(engineTakesPrismReferenceAudioValue(PER_RESOLUTION, value)).toBe(expected.before)
    expect(engineTakesPrismReferenceAudioValue(MODES_0426, value)).toBe(expected.at0426)
    expect(engineTakesPrismReferenceAudioValue(PITCH, value)).toBe(expected.pitch)
  })

  it("a pitch engine takes a one-tone mode only where it lists it", () => {
    const unlisted = { ...PITCH, prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave"] as const }
    expect(engineTakesPrismReferenceAudioValue(unlisted, v("full", 7))).toBe(true)
    expect(engineTakesPrismReferenceAudioValue(unlisted, v("full-one-tone", 0))).toBe(false)
    expect(engineTakesPrismReferenceAudioValue(unlisted, v("voice-one-tone", 4))).toBe(false)
  })

  it("an engine that takes no reference audio takes the default alone", () => {
    for (const [value] of TAKES) {
      expect(engineTakesPrismReferenceAudioValue({}, value), JSON.stringify(value)).toBe(value.mode === "full" && value.semitones === 4)
    }
  })

  it("answers the modes an engine takes at some pitch", () => {
    const modes = (cs: Parameters<typeof engineTakesPrismReferenceAudioModeAtAll>[0]) =>
      CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES.filter((m) => engineTakesPrismReferenceAudioModeAtAll(cs, m))
    expect(modes({})).toEqual(["full"])
    expect(modes(PER_RESOLUTION)).toEqual(["none", "full", "voice"])
    expect(modes(MODES_0426)).toEqual(["none", "full", "voice", "full-one-tone"])
    expect(modes(PITCH)).toEqual(["none", "full", "voice", "full-one-tone", "voice-one-tone"])
  })
})

describe("what a value needs of an engine", () => {
  it("today's values need what they needed: one-tone and octave their ids, the rest nothing", () => {
    expect(prismReferenceAudioRequirementsOf(prismReferenceAudioByResolutionOf({ "480p": "voice", "720p": "none", "1080p": "full" }))).toEqual([])
    expect(prismReferenceAudioRequirementsOf(prismReferenceAudioByResolutionOf({ "480p": "octave", "720p": "one-tone", "1080p": "octave" }))).toEqual([
      "one-tone",
      "octave",
    ])
    expect(prismReferenceAudioRequirementsOf(null)).toEqual([])
  })

  it("a value no id says needs the pitch shift, and a one-tone mode its own listing", () => {
    const of = (choice: Record<string, unknown>) => prismReferenceAudioRequirementsOf(prismReferenceAudioByResolutionOf(choice))
    expect(of({ "720p": { mode: "full", semitones: 7 } })).toEqual(["pitch"])
    expect(of({ "720p": { mode: "voice-one-tone", semitones: 4 } })).toEqual(["voice-one-tone", "pitch"])
    expect(of({ "480p": { mode: "full-one-tone", semitones: 4 }, "720p": "octave" })).toEqual(["octave", "full-one-tone", "pitch"])
    // Full mix, one tone at 0 is today's "one-tone": it needs what one-tone needs.
    expect(of({ "720p": { mode: "full-one-tone", semitones: 0 } })).toEqual(["one-tone"])
  })

  it("an engine meets a need as it takes the values behind it", () => {
    expect(engineMeetsPrismReferenceAudioRequirement(MODES_0426, "one-tone")).toBe(true)
    expect(engineMeetsPrismReferenceAudioRequirement(PER_RESOLUTION, "octave")).toBe(false)
    expect(engineMeetsPrismReferenceAudioRequirement(MODES_0426, "pitch")).toBe(false)
    expect(engineMeetsPrismReferenceAudioRequirement(MODES_0426, "voice-one-tone")).toBe(false)
    for (const need of ["one-tone", "octave", "full-one-tone", "voice-one-tone", "pitch"] as const) {
      expect(engineMeetsPrismReferenceAudioRequirement(PITCH, need), need).toBe(true)
    }
    expect(engineMeetsPrismReferenceAudioRequirement({ ...PITCH, prismReferenceAudioModes: ["full-one-tone"] }, "voice-one-tone")).toBe(false)
  })
})

describe("what changed, and what older code cannot read", () => {
  const read = prismReferenceAudioByResolutionOf

  it("is nothing when every resolution reads the same, however each is written", () => {
    for (const [next, before] of [
      [{ "480p": "voice" }, { "480p": { mode: "voice", semitones: 4 } }],
      [every("octave"), "octave"],
      [{ "720p": "full" }, {}],
      [{ "720p": { mode: "full", semitones: 4 } }, null],
      [{ "720p": { mode: "none", semitones: 9 } }, { "720p": "none" }],
      [{ "720p": { mode: "full", semitones: 7 } }, { "720p": { mode: "full", semitones: 7 } }],
      [{ "480p": { mode: "voice-one-tone" } }, { "480p": { mode: "voice-one-tone", semitones: 0 } }],
    ] as const) {
      expect(prismReferenceAudioChangedFrom(read(next), read(before)), JSON.stringify(next)).toEqual({})
    }
    expect(prismReferenceAudioChangedFrom(null, null)).toEqual({})
    expect(prismReferenceAudioChangedFrom(undefined, read(every("full")))).toEqual({})
  })

  it("is each resolution whose value moved, as it reads now, an untouched one left out", () => {
    expect(
      prismReferenceAudioChangedFrom(
        read({ "480p": { mode: "full", semitones: 7 }, "720p": "none", "1080p": { mode: "full", semitones: 8 } }),
        read({ "480p": { mode: "full", semitones: 7 }, "1080p": { mode: "full", semitones: 7 } }),
      ),
    ).toEqual({ "720p": { mode: "none" }, "1080p": { mode: "full", semitones: 8 } })
    // Taken back to the default: changed, and the default.
    expect(prismReferenceAudioChangedFrom(read({}), read({ "720p": "voice" }))).toEqual({ "720p": { mode: "full", semitones: 4 } })
    // Never saved: everything off the default is new.
    expect(prismReferenceAudioChangedFrom(read({ "720p": { mode: "full", semitones: 7 } }), null)).toEqual({ "720p": { mode: "full", semitones: 7 } })
  })

  it("older code cannot read a value no id says: the pitch shift, and a one-tone mode's listing; an id never counts", () => {
    const of = (choice: unknown) => prismReferenceAudioUnreadableRequirementsOf(read(choice))
    expect(of({ "480p": "one-tone", "720p": "octave", "1080p": "voice" })).toEqual([])
    expect(of("none")).toEqual([])
    expect(of({ "720p": { mode: "full-one-tone", semitones: 0 }, "1080p": { mode: "full", semitones: 12 } })).toEqual([])
    expect(of({ "720p": { mode: "full", semitones: 7 } })).toEqual(["pitch"])
    expect(of({ "720p": { mode: "voice-one-tone", semitones: 0 }, "1080p": "octave" })).toEqual(["voice-one-tone", "pitch"])
    expect(of({ "480p": { mode: "full-one-tone", semitones: 4 }, "720p": "one-tone" })).toEqual(["full-one-tone", "pitch"])
    expect(prismReferenceAudioUnreadableRequirementsOf(null)).toEqual([])
  })
})

describe("on the wire", () => {
  /** Every value stored today, as the run of each resolution was sent it before the pitch shift. */
  const STORED_TODAY = [
    { "480p": "full", "720p": "voice", "1080p": "none" },
    { "480p": "one-tone", "720p": "octave", "1080p": "voice" },
    { "720p": "none" },
    every("octave"),
    every("full"),
    {},
  ] as const

  it("an engine without the pitch shift is sent exactly what it was sent before, whatever is stored", () => {
    setPluginSupports({ castSwap: MODES_0426 })
    expect(prismReferenceAudioSent({ resolution: "720p" }, STORED_TODAY[0])).toEqual({ prismReferenceAudio: { "720p": "voice", "1080p": "none" } })
    expect(prismReferenceAudioSent({}, STORED_TODAY[1])).toEqual({ prismReferenceAudio: { "480p": "one-tone", "720p": "octave", "1080p": "voice" } })
    expect(prismReferenceAudioSent({}, STORED_TODAY[2])).toEqual({ prismReferenceAudio: { "720p": "none" } })
    expect(prismReferenceAudioSent({}, STORED_TODAY[3])).toEqual({ prismReferenceAudio: every("octave") })
    expect(prismReferenceAudioSent({}, STORED_TODAY[4])).toEqual({})
    expect(prismReferenceAudioSent({}, STORED_TODAY[5])).toEqual({})
    expect(prismReferenceAudioSent({}, null)).toEqual({})
    setPluginSupports({ castSwap: PER_RESOLUTION })
    expect(prismReferenceAudioSent({}, STORED_TODAY[1])).toEqual({ prismReferenceAudio: { "1080p": "voice" } })
    setPluginSupports({ castSwap: ONE_MODE })
    expect(prismReferenceAudioSent({ resolution: "720p" }, STORED_TODAY[1])).toEqual({ prismReferenceAudio: "octave" })
    expect(prismReferenceAudioSent({ draft: true }, STORED_TODAY[0])).toEqual({})
    setPluginSupports({ castSwap: CS })
    for (const stored of STORED_TODAY) expect(prismReferenceAudioSent({}, stored)).toEqual({})
  })

  it("an engine without the pitch shift is sent the id a value is, and the full audio where no id says it", () => {
    const stored = castSwapPrismReferenceAudioSchema.parse({
      "480p": { mode: "voice", semitones: 4 },
      "720p": { mode: "full", semitones: 7 },
      "1080p": { mode: "voice-one-tone", semitones: 0 },
    })
    setPluginSupports({ castSwap: MODES_0426 })
    expect(prismReferenceAudioSent({}, stored)).toEqual({ prismReferenceAudio: { "480p": "voice" } })
    setPluginSupports({ castSwap: ONE_MODE })
    expect(prismReferenceAudioSent({ resolution: "720p" }, stored)).toEqual({})
    expect(prismReferenceAudioSent({ draft: true }, stored)).toEqual({ prismReferenceAudio: "voice" })
  })

  it("an engine with the pitch shift is sent the object form: { mode, semitones } per resolution off the default, { mode } for none", () => {
    setPluginSupports({ castSwap: PITCH })
    expect(prismReferenceAudioSent({ resolution: "720p" }, STORED_TODAY[0])).toEqual({
      prismReferenceAudio: { "720p": { mode: "voice", semitones: 4 }, "1080p": { mode: "none" } },
    })
    expect(prismReferenceAudioSent({}, STORED_TODAY[1])).toEqual({
      prismReferenceAudio: {
        "480p": { mode: "full-one-tone", semitones: 0 },
        "720p": { mode: "full", semitones: 12 },
        "1080p": { mode: "voice", semitones: 4 },
      },
    })
    const stored = castSwapPrismReferenceAudioSchema.parse({ "480p": { mode: "full", semitones: 4 }, "720p": { mode: "voice-one-tone", semitones: -2.5 } })
    expect(prismReferenceAudioSent({}, stored)).toEqual({ prismReferenceAudio: { "720p": { mode: "voice-one-tone", semitones: -2.5 } } })
    // Every resolution at the default: no key, as before.
    expect(prismReferenceAudioSent({}, STORED_TODAY[4])).toEqual({})
    // Never on a Pulse run.
    expect(prismReferenceAudioSent({ engine: "motion-pulse" }, STORED_TODAY[0])).toEqual({})
  })

  it("a pitch engine that does not list a one-tone mode is sent the full audio for it", () => {
    setPluginSupports({ castSwap: { ...PITCH, prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave"] as const } })
    const stored = castSwapPrismReferenceAudioSchema.parse({ "480p": { mode: "voice-one-tone", semitones: 4 }, "720p": { mode: "full", semitones: 7 } })
    expect(prismReferenceAudioSent({}, stored)).toEqual({ prismReferenceAudio: { "720p": { mode: "full", semitones: 7 } } })
  })
})
