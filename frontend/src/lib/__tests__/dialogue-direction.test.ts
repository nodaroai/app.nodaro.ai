// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  dialogueFillerWordsFor,
  dialogueFillerWordsOffered,
  dialogueHoldsReplica,
  dialogueLineStyleFor,
  dialogueLineStyleMax,
  dialogueNewLineVoice,
  dialogueSpeakersFor,
  dialogueSpeakerVoices,
  dialogueTagProvider,
  dialogueTakesElevenLabsOptions,
  dialogueTakesReplica,
  replicaConsentIsYours,
  dialogueTakesSpeakerDirection,
  upsertDialogueSpeaker,
  withDialogueVoices,
} from "../dialogue-direction"

const G38 = "gemini-3-8-flash-tts"
const G31 = "gemini-3-1-flash-tts"
const V3 = "elevenlabs-dialogue"

describe("the shape of a dialogue model's direction, read from its sheet", () => {
  it("3.8 directs each line (free text), 3.1 / 2.5 each speaker, ElevenLabs neither", () => {
    expect(dialogueLineStyleMax(G38)).toBe(1000)
    expect(dialogueTakesSpeakerDirection(G38)).toBe(false)
    expect(dialogueLineStyleMax(G31)).toBeUndefined()
    expect(dialogueTakesSpeakerDirection(G31)).toBe(true)
    expect(dialogueTakesSpeakerDirection("gemini-2-5-pro-tts")).toBe(true)
    for (const p of [V3, "elevenlabs-dialogue-v4", undefined, "nope"]) {
      expect(dialogueLineStyleMax(p), String(p)).toBeUndefined()
      expect(dialogueTakesSpeakerDirection(p), String(p)).toBe(false)
    }
  })

  it("a line's style is sent trimmed on 3.8 only — never on 3.1, even one of its own style names", () => {
    expect(dialogueLineStyleFor(G38, "  Warm  ")).toBe("Warm")
    expect(dialogueLineStyleFor(G38, "")).toBeUndefined()
    expect(dialogueLineStyleFor(G38, "x".repeat(1001))).toBeUndefined()
    expect(dialogueLineStyleFor(G31, "Whisper")).toBeUndefined()
    expect(dialogueLineStyleFor(V3, "Warm")).toBeUndefined()
  })

  it("the ElevenLabs endpoint's own options are a model that speaks the ElevenLabs voices", () => {
    expect(dialogueTakesElevenLabsOptions(V3)).toBe(true)
    expect(dialogueTakesElevenLabsOptions(undefined)).toBe(true)
    expect(dialogueTakesElevenLabsOptions(G38)).toBe(false)
    expect(dialogueTakesElevenLabsOptions(G31)).toBe(false)
  })

  it("tags are judged by the model only where the text-to-speech lane reads it as itself (one id in both lanes)", () => {
    expect(dialogueTagProvider(G38)).toBe(G38)
    expect(dialogueTagProvider(G31)).toBe(G31)
    expect(dialogueTagProvider(V3)).toBeUndefined()
    expect(dialogueTagProvider(undefined)).toBeUndefined()
  })
})

describe("dialogueSpeakersFor — what the run sends as `speakers`", () => {
  it("3.1: each entry of a voice the script speaks, with only the fields 3.1 takes", () => {
    const speakers = [
      { voice: "Kore", styleDirection: "Whisper", pace: "Natural", accent: "Not one", audioProfile: "  A radio host " },
      { voice: "Charon", pace: "Natural" },
      { voice: "Puck", accent: "Not one" },
    ]
    expect(dialogueSpeakersFor(G31, speakers, ["Kore", "Puck"], ["Kore", "Puck"])).toEqual([
      { voice: "Kore", styleDirection: "Whisper", pace: "Natural", audioProfile: "A radio host" },
    ])
  })

  it("an entry follows its voice when the lines' voices move (a mapped model)", () => {
    expect(dialogueSpeakersFor(G31, [{ voice: "Sarah", pace: "Natural" }], ["Sarah", "Puck"], ["Kore", "Puck"])).toEqual([{ voice: "Kore", pace: "Natural" }])
  })

  it("nothing on 3.8 or ElevenLabs, nor from a malformed list", () => {
    const speakers = [{ voice: "Kore", styleDirection: "Warm" }]
    expect(dialogueSpeakersFor(G38, speakers, ["Kore"], ["Kore"])).toEqual([])
    expect(dialogueSpeakersFor(V3, speakers, ["Kore"], ["Kore"])).toEqual([])
    expect(dialogueSpeakersFor(G31, "nope" as never, ["Kore"], ["Kore"])).toEqual([])
    expect(dialogueSpeakersFor(G31, [null, 3, { pace: "Natural" }] as never, ["Kore"], ["Kore"])).toEqual([])
  })
})

describe("filler words", () => {
  it("offered and sent only on 3.8 with exactly two speakers", () => {
    expect(dialogueFillerWordsOffered(G38, ["Kore", "Puck", "Kore"])).toBe(true)
    expect(dialogueFillerWordsOffered(G38, ["Kore", "Kore"])).toBe(false)
    expect(dialogueFillerWordsOffered(G38, ["Kore", "Puck", "Fola"])).toBe(false)
    expect(dialogueFillerWordsOffered(G31, ["Kore", "Puck"])).toBe(false)
    expect(dialogueFillerWordsFor(G38, true, ["Kore", "Puck"])).toBe(true)
    expect(dialogueFillerWordsFor(G38, false, ["Kore", "Puck"])).toBe(false)
    expect(dialogueFillerWordsFor(G38, undefined, ["Kore", "Puck"])).toBeUndefined()
    expect(dialogueFillerWordsFor(G38, true, ["Kore"])).toBeUndefined()
    expect(dialogueFillerWordsFor(V3, true, ["Sarah", "Rachel"])).toBeUndefined()
  })
})

describe("dialogueNewLineVoice — a new line keeps the script within its speakers", () => {
  it("one voice so far: a voice the script does not use yet (the model's default first)", () => {
    expect(dialogueNewLineVoice(G31, ["Puck"])).toBe("Kore")
    expect(dialogueNewLineVoice(G31, ["Kore", "Kore"])).not.toBe("Kore")
  })

  it("two voices: the turns alternate (the most recent voice other than the last line's)", () => {
    expect(dialogueNewLineVoice(G31, ["Kore", "Puck"])).toBe("Kore")
    expect(dialogueNewLineVoice(G31, ["Kore", "Puck", "Puck"])).toBe("Kore")
    expect(dialogueNewLineVoice(G38, ["Kore", "Puck", "Kore"])).toBe("Puck")
  })

  it("none on a model that speaks the ElevenLabs voices", () => {
    expect(dialogueNewLineVoice(V3, ["Sarah"])).toBeUndefined()
  })
})

describe("the panel's writes", () => {
  it("withDialogueVoices: a moved line takes the voice and its name; an unmoved line is the same object; none drops the name", () => {
    const a = { id: "1", text: "a", voice: "Kore", voiceLabel: "Kore" }
    const b = { id: "2", text: "b", voice: "Sarah", voiceLabel: "Narrator" }
    const out = withDialogueVoices([a, b], ["Kore", "Puck"])
    expect(out[0]).toBe(a)
    expect(out[1]).toEqual({ id: "2", text: "b", voice: "Puck", voiceLabel: "Puck" })
    const none = withDialogueVoices([b], [""])
    expect(none[0]).toEqual({ id: "2", text: "b", voice: "" })
    expect(Object.keys(none[0]!)).not.toContain("voiceLabel")
  })

  it("dialogueSpeakerVoices: the distinct voices in line order, none skipped", () => {
    expect(dialogueSpeakerVoices(["Puck", "", "Kore", "Puck"])).toEqual(["Puck", "Kore"])
  })

  it("upsertDialogueSpeaker: adds, merges, clears a field, and drops an entry (then the list) with nothing set", () => {
    const one = upsertDialogueSpeaker(undefined, "Kore", { pace: "Natural" })
    expect(one).toEqual([{ voice: "Kore", pace: "Natural" }])
    const two = upsertDialogueSpeaker(one, "Puck", { audioProfile: "A host" })
    expect(two).toEqual([{ voice: "Kore", pace: "Natural" }, { voice: "Puck", audioProfile: "A host" }])
    const merged = upsertDialogueSpeaker(two, "Kore", { styleDirection: "Whisper" })
    expect(merged![0]).toEqual({ voice: "Kore", pace: "Natural", styleDirection: "Whisper" })
    const cleared = upsertDialogueSpeaker(merged, "Puck", { audioProfile: "" })
    expect(cleared).toEqual([{ voice: "Kore", pace: "Natural", styleDirection: "Whisper" }])
    const back = upsertDialogueSpeaker(cleared, "Kore", { pace: undefined, styleDirection: undefined })
    expect(back).toBeUndefined()
    expect(upsertDialogueSpeaker(undefined, "Kore", { pace: undefined })).toBeUndefined()
  })
})

describe("a cloned speaker (decided 2026-11-13)", () => {
  const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }
  const FLASH = "gemini-3-8-flash-tts"

  it("only Gemini 3.8 Flash clones", () => {
    expect(dialogueTakesReplica(FLASH)).toBe(true)
    for (const p of ["gemini-3-8-flash-lite-tts", G31, V3, undefined]) expect(dialogueTakesReplica(p), String(p)).toBe(false)
  })

  it("dialogueHoldsReplica: any entry holding one, whatever its shape", () => {
    expect(dialogueHoldsReplica([{ voice: "Me", replica }])).toBe(true)
    expect(dialogueHoldsReplica([{ voice: "Me", replica: { sourceAudioUrl: "nope" } }])).toBe(true)
    expect(dialogueHoldsReplica([{ voice: "Kore", pace: "Natural" }])).toBe(false)
    expect(dialogueHoldsReplica(undefined)).toBe(false)
  })

  it("3.8 Flash sends the cloned speaker's { voice, replica }; a malformed clone is sent as it is (refused, never dropped)", () => {
    expect(dialogueSpeakersFor(FLASH, [{ voice: "Me", replica }], ["Me", "Kore"], ["Me", "Kore"])).toEqual([{ voice: "Me", replica }])
    const broken = { sourceAudioUrl: "http://insecure/me.wav" }
    expect(dialogueSpeakersFor(FLASH, [{ voice: "Kore", replica: broken }], ["Kore"], ["Kore"])).toEqual([{ voice: "Kore", replica: broken }])
  })

  it("a model that does not clone sends no clone", () => {
    expect(dialogueSpeakersFor("gemini-3-8-flash-lite-tts", [{ voice: "Me", replica }], ["Me"], ["Fola"])).toEqual([])
    expect(dialogueSpeakersFor(G31, [{ voice: "Me", replica, pace: "Natural" }], ["Me"], ["Kore"])).toEqual([{ voice: "Kore", pace: "Natural" }])
  })

  it("upsertDialogueSpeaker keeps a cloned speaker's entry when its direction is cleared", () => {
    expect(upsertDialogueSpeaker([{ voice: "Me", replica, pace: "Natural" }], "Me", { pace: undefined })).toEqual([{ voice: "Me", replica }])
  })
})

describe("the speakers sent never carry the consent (decided 2026-11-13)", () => {
  it("a clone the runner consented to is sent as { voice, replica } with the consent the route asks (consent: true)", () => {
    const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }
    const own = { userId: "u1", signature: "sig" }
    expect(dialogueSpeakersFor("gemini-3-8-flash-tts", [{ voice: "Me", replica, replicaConsent: own }], ["Me"], ["Me"], "u1")).toEqual([{ voice: "Me", replica: { ...replica, consent: true } }])
    // Someone else's record (a copy) says no consent.
    expect(dialogueSpeakersFor("gemini-3-8-flash-tts", [{ voice: "Me", replica, replicaConsent: own }], ["Me"], ["Me"], "u2")).toEqual([{ voice: "Me", replica }])
  })

  it("replicaConsentIsYours: only a record issued to the viewer", () => {
    expect(replicaConsentIsYours({ userId: "u1", signature: "sig" }, "u1")).toBe(true)
    expect(replicaConsentIsYours({ userId: "u1", signature: "sig" }, "u2")).toBe(false)
    expect(replicaConsentIsYours({ userId: "u1", signature: "" }, "u1")).toBe(false)
    expect(replicaConsentIsYours(true, "u1")).toBe(false)
    expect(replicaConsentIsYours({ userId: "u1", signature: "sig" }, undefined)).toBe(false)
  })
})
