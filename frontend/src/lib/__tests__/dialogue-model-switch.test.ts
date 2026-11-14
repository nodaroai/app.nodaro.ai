// @vitest-environment node
import { describe, it, expect } from "vitest"
import { dialogueModelSwitchPatch, nearestStabilityStep } from "../dialogue-model-switch"

describe("nearestStabilityStep", () => {
  it.each([
    [0.3, 0.5], [0.2, 0], [0.25, 0.5], [0.75, 1], [0.74, 0.5], [0, 0], [1, 1],
  ])("%s → %s on the steps 0 / 0.5 / 1 (a tie goes up)", (value, expected) => {
    expect(nearestStabilityStep(value, [0, 0.5, 1])).toBe(expected)
  })
})

describe("dialogueModelSwitchPatch — what a user's dialogue model switch writes", () => {
  it("to v3 dialogue: similarity goes, a stability off v3's steps snaps to the nearest step", () => {
    const patch = dialogueModelSwitchPatch("elevenlabs-dialogue", { stability: 0.3, similarityBoost: 0.8 })
    expect(patch).toStrictEqual({ stability: 0.5, similarityBoost: undefined })
    expect(Object.keys(patch).sort()).toEqual(["similarityBoost", "stability"])
  })

  it("to v3 dialogue: a stability already on a step stays (no key)", () => {
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue", { stability: 1 })).toStrictEqual({})
  })

  it("to v4 dialogue: nothing to clear — every v3 value is a valid v4 value", () => {
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue-v4", { stability: 0.5 })).toStrictEqual({})
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue-v4", { stability: 0.3, similarityBoost: 0.8 })).toStrictEqual({})
  })

  it("an unknown or missing id reads as v3 dialogue", () => {
    for (const next of ["nope", "constructor", "elevenlabs-v4", ""]) {
      expect(dialogueModelSwitchPatch(next, { stability: 0.3, similarityBoost: 0.8 }), next).toStrictEqual({ stability: 0.5, similarityBoost: undefined })
    }
  })

  it("a node that carries neither setting yields an empty patch", () => {
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue", {})).toStrictEqual({})
  })
})

describe("dialogueModelSwitchPatch — the Gemini dialogue models (decided 2026-11-12)", () => {
  const line = (id: string, voice: string, extra: Record<string, unknown> = {}) => ({ id, text: `line ${id}`, voice, ...extra })

  it("ElevenLabs → Gemini 3.1: two ElevenLabs speakers become two of the model's voices (its default first), each line named by its voice", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-1-flash-tts", {
      dialogue: [line("1", "Sarah", { voiceLabel: "Sarah" }), line("2", "Rachel"), line("3", "Sarah", { voiceLabel: "Sarah" })],
    })
    expect(patch.dialogue).toEqual([
      line("1", "Kore", { voiceLabel: "Kore" }),
      line("2", "Achernar", { voiceLabel: "Achernar" }),
      line("3", "Kore", { voiceLabel: "Kore" }),
    ])
  })

  it("ElevenLabs → Gemini: the language resets to auto-detect (the model is offered in none); stability waits for the way back", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-8-flash-tts", { languageCode: "en", stability: 0.5 })
    expect(patch).toStrictEqual({ languageCode: "" })
  })

  it("Gemini → ElevenLabs: a Gemini voice becomes none (the deployment's default) and loses its name; filler words and the speakers go", () => {
    const patch = dialogueModelSwitchPatch("elevenlabs-dialogue", {
      dialogue: [line("1", "Kore", { voiceLabel: "Kore", styleDirection: "Warm" }), line("2", "Puck", { voiceLabel: "Puck" })],
      speakers: [{ voice: "Kore", pace: "Natural" }],
      fillerWords: true,
    })
    expect(patch.dialogue).toEqual([{ id: "1", text: "line 1", voice: "" }, { id: "2", text: "line 2", voice: "" }])
    expect(Object.keys(patch.dialogue![0]!)).not.toContain("voiceLabel")
    expect(patch).toHaveProperty("speakers", undefined)
    expect(patch).toHaveProperty("fillerWords", undefined)
  })

  it("Gemini 3.8 → 3.1: the per-line styles go (3.1 directs each speaker), the voices both speak stay", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-1-flash-tts", {
      dialogue: [line("1", "Kore", { styleDirection: "Warm" }), line("2", "Puck")],
      fillerWords: false,
    })
    expect(patch.dialogue).toEqual([line("1", "Kore"), line("2", "Puck")])
    expect(Object.keys(patch.dialogue![0]!)).not.toContain("styleDirection")
    expect(patch).toHaveProperty("fillerWords", undefined)
  })

  it("Gemini 3.1 → 3.8: each line keeps its style-less self, and the speakers' direction goes (3.8 directs each line)", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-8-flash-tts", {
      dialogue: [line("1", "Kore"), line("2", "Puck")],
      speakers: [{ voice: "Kore", styleDirection: "Whisper", pace: "Natural", audioProfile: "A radio host" }],
    })
    expect(patch).toStrictEqual({ speakers: undefined })
  })

  it("Gemini 3.1 → 2.5: what both take is kept as it is — nothing to write", () => {
    expect(dialogueModelSwitchPatch("gemini-2-5-pro-tts", {
      dialogue: [line("1", "Kore"), line("2", "Puck")],
      speakers: [{ voice: "Kore", styleDirection: "Whisper", pace: "Natural" }],
    })).toStrictEqual({})
  })

  it("the speakers follow their voices when the voices move, and keep only what the model takes", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-1-flash-tts", {
      dialogue: [line("1", "Sarah"), line("2", "Puck")],
      speakers: [{ voice: "Sarah", pace: "Natural", accent: "Not an accent" }, { voice: "Puck", audioProfile: "A tired detective" }],
    })
    expect(patch.speakers).toEqual([{ voice: "Kore", pace: "Natural" }, { voice: "Puck", audioProfile: "A tired detective" }])
  })

  it("a node that already fits the Gemini model yields an empty patch", () => {
    expect(dialogueModelSwitchPatch("gemini-3-8-flash-tts", {
      dialogue: [line("1", "Kore", { voiceLabel: "Kore", styleDirection: "Warm" }), line("2", "Puck", { voiceLabel: "Puck" })],
      fillerWords: true,
    })).toStrictEqual({})
  })
})

describe("dialogueModelSwitchPatch — the file format (decided 2026-11-13)", () => {
  it("Gemini → ElevenLabs: a WAV or a 192 kbps MP3 goes (ElevenLabs dialogue delivers MP3 128 kbps only)", () => {
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue", { outputFormat: "wav_24000" })).toStrictEqual({ outputFormat: undefined })
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue-v4", { outputFormat: "mp3_44100_192" })).toStrictEqual({ outputFormat: undefined })
  })

  it("a format the new model delivers stays (no key)", () => {
    expect(dialogueModelSwitchPatch("gemini-3-1-flash-tts", { outputFormat: "wav_24000" })).toStrictEqual({})
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue", { outputFormat: "mp3_44100_128" })).toStrictEqual({})
  })
})

describe("dialogueModelSwitchPatch — a cloned speaker (decided 2026-11-13)", () => {
  const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }
  const lines = [{ id: "1", text: "Hello", voice: "Me", voiceLabel: "Me" }, { id: "2", text: "Hi", voice: "Kore", voiceLabel: "Kore" }]

  it("to a model that does not clone: the clone goes (its entry with it), and its label moves onto one of the model's voices", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-8-flash-lite-tts", { dialogue: lines, speakers: [{ voice: "Me", replica }] })
    expect(patch).toHaveProperty("speakers", undefined)
    expect(patch.dialogue!.map((l) => l.voice)).toEqual(["Fola", "Kore"])
  })

  it("to a model that does not clone: an entry that also holds a direction the model takes keeps it, under its new voice", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-1-flash-tts", { dialogue: lines, speakers: [{ voice: "Me", replica, pace: "Natural" }] })
    const moved = patch.dialogue![0]!.voice
    expect(moved).not.toBe("Me")
    expect(patch.speakers).toEqual([{ voice: moved, pace: "Natural" }])
  })

  it("on the model that clones the cloned label stays and nothing is written", () => {
    expect(dialogueModelSwitchPatch("gemini-3-8-flash-tts", { dialogue: lines, speakers: [{ voice: "Me", replica }] })).toStrictEqual({})
  })
})

describe("dialogueModelSwitchPatch — a clone's consent (decided 2026-11-13)", () => {
  const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }
  const consent = { userId: "u1", signature: "sig-u1" }
  const lines = [{ id: "1", text: "Hello", voice: "Me", voiceLabel: "Me" }, { id: "2", text: "Hi", voice: "Kore", voiceLabel: "Kore" }]

  it("goes with the clone to a model that does not clone; an entry keeping a direction keeps neither", () => {
    const patch = dialogueModelSwitchPatch("gemini-3-1-flash-tts", { dialogue: lines, speakers: [{ voice: "Me", replica, replicaConsent: consent, pace: "Natural" }] })
    expect(patch.speakers).toHaveLength(1)
    expect(patch.speakers![0]).not.toHaveProperty("replica")
    expect(patch.speakers![0]).not.toHaveProperty("replicaConsent")
  })

  it("on the model that clones the clone and its consent stay as they are", () => {
    expect(dialogueModelSwitchPatch("gemini-3-8-flash-tts", { dialogue: lines, speakers: [{ voice: "Me", replica, replicaConsent: consent }] })).toStrictEqual({})
  })
})
