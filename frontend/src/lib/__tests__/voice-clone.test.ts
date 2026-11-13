// @vitest-environment node
import { describe, it, expect } from "vitest"
import { REPLICA_CONSENT_SENTENCE, REPLICA_MAX_BYTES } from "@nodaro/shared/models"
import { en } from "@/lib/i18n/en"
import {
  PENDING_REPLICA,
  cloneLabelProblem,
  cloneRunProblem,
  dialogueCloneLabels,
  dialogueCloneRunProblem,
  nextCloneLabel,
  panelDialogueVoices,
  recordingFileProblem,
  removeClone,
  renameClone,
  ttsCloneRunProblem,
  withRecording,
} from "../voice-clone"

const FLASH = "gemini-3-8-flash-tts"
const LITE = "gemini-3-8-flash-lite-tts"
const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }

describe("the consent sentence (decided 2026-11-13)", () => {
  it("English reads the platform's sentence, character for character", () => {
    expect(en["audiocfg.cloneConsentSentence"]).toBe(REPLICA_CONSENT_SENTENCE)
  })
})

describe("the recordings", () => {
  it("withRecording sets one link, keeps the other, and always clears the consent", () => {
    expect(withRecording(undefined, "source", "https://x/a.wav")).toStrictEqual({ replica: { sourceAudioUrl: "https://x/a.wav", consentAudioUrl: "" }, replicaConsent: undefined })
    expect(withRecording(replica, "consent", "")).toStrictEqual({ replica: { sourceAudioUrl: replica.sourceAudioUrl, consentAudioUrl: "" }, replicaConsent: undefined })
  })

  it("recordingFileProblem: a WAV (by name or type) up to the platform's size", () => {
    expect(recordingFileProblem({ name: "me.WAV", type: "", size: 1000 })).toBeUndefined()
    expect(recordingFileProblem({ name: "me", type: "audio/x-wav", size: 1000 })).toBeUndefined()
    expect(recordingFileProblem({ name: "me.mp3", type: "audio/mpeg", size: 1000 })).toBe("not-wav")
    expect(recordingFileProblem({ name: "me.wav", type: "audio/wav", size: REPLICA_MAX_BYTES + 1 })).toBe("too-large")
  })
})

describe("whether a clone runs: the runner's own consent (decided 2026-11-13)", () => {
  const OWN = { userId: "u1", signature: "sig-u1" }
  const COPY = { userId: "someone-else", signature: "sig-other" }

  it("cloneRunProblem: both recordings first, then the runner's own consent record", () => {
    expect(cloneRunProblem(PENDING_REPLICA, OWN, "u1")).toBe("recordings")
    expect(cloneRunProblem({ ...replica, consentAudioUrl: "" }, OWN, "u1")).toBe("recordings")
    expect(cloneRunProblem(replica, undefined, "u1")).toBe("consent")
    expect(cloneRunProblem(replica, true, "u1")).toBe("consent")
    expect(cloneRunProblem(replica, COPY, "u1")).toBe("consent")
    expect(cloneRunProblem(replica, OWN, undefined)).toBe("consent")
    expect(cloneRunProblem(replica, OWN, "u1")).toBeUndefined()
  })

  it("ttsCloneRunProblem: nothing without a clone; the model first", () => {
    expect(ttsCloneRunProblem(FLASH, {}, "u1")).toBeUndefined()
    expect(ttsCloneRunProblem(LITE, { replica, replicaConsent: OWN }, "u1")).toBe("model")
    expect(ttsCloneRunProblem(undefined, { replica: PENDING_REPLICA }, "u1")).toBe("model")
    expect(ttsCloneRunProblem(FLASH, { replica: PENDING_REPLICA }, "u1")).toBe("recordings")
    expect(ttsCloneRunProblem(FLASH, { replica, replicaConsent: COPY }, "u1")).toBe("consent")
    expect(ttsCloneRunProblem(FLASH, { replica, replicaConsent: OWN }, "u1")).toBeUndefined()
  })

  it("dialogueCloneRunProblem: only a clone a line speaks with is judged", () => {
    const speakers = [{ voice: "Me", replica: PENDING_REPLICA }, { voice: "You", replica }]
    expect(dialogueCloneRunProblem(FLASH, speakers, ["Kore"], "u1")).toBeUndefined()
    expect(dialogueCloneRunProblem(FLASH, speakers, ["Me", "Kore"], "u1")).toBe("recordings")
    expect(dialogueCloneRunProblem(FLASH, speakers, ["You"], "u1")).toBe("consent")
    expect(dialogueCloneRunProblem(FLASH, [{ voice: "You", replica, replicaConsent: COPY }], ["You"], "u1")).toBe("consent")
    expect(dialogueCloneRunProblem(FLASH, [{ voice: "You", replica, replicaConsent: OWN }], ["You"], "u1")).toBeUndefined()
    expect(dialogueCloneRunProblem(LITE, speakers, ["Me"], "u1")).toBeUndefined()
  })
})

describe("a dialogue's clones in the panel", () => {
  it("dialogueCloneLabels: every entry holding a clone, set up or ready, on a model that clones", () => {
    const speakers = [{ voice: "Me", replica: PENDING_REPLICA }, { voice: "Kore", pace: "Natural" }, { voice: "You", replica }]
    expect(dialogueCloneLabels(FLASH, speakers)).toEqual(["Me", "You"])
    expect(dialogueCloneLabels(LITE, speakers)).toEqual([])
  })

  it("panelDialogueVoices: a clone still waiting for its recordings keeps its label on its lines", () => {
    expect(panelDialogueVoices(FLASH, ["Me", "Kore"], [{ voice: "Me", replica: PENDING_REPLICA }])).toEqual(["Me", "Kore"])
    expect(panelDialogueVoices(FLASH, ["Me", "Kore"], [{ voice: "Me", replica }])).toEqual(["Me", "Kore"])
    // Without a clone entry the label is any foreign voice and moves.
    expect(panelDialogueVoices(FLASH, ["Me", "Kore"], [])).toEqual(["Fola", "Kore"])
  })

  it("nextCloneLabel and cloneLabelProblem", () => {
    const labelFor = (n: number) => `Cloned voice ${n}`
    expect(nextCloneLabel(labelFor, [])).toBe("Cloned voice 1")
    expect(nextCloneLabel(labelFor, ["Cloned voice 1"])).toBe("Cloned voice 2")
    expect(cloneLabelProblem(FLASH, "  ", [])).toBe("empty")
    expect(cloneLabelProblem(FLASH, "Kore", [])).toBe("taken")
    expect(cloneLabelProblem(FLASH, "Me", ["Me"])).toBe("taken")
    expect(cloneLabelProblem(FLASH, "Ana", ["Me"])).toBeUndefined()
  })

  it("renameClone rewrites the entry and every line that speaks with it", () => {
    const out = renameClone(
      [{ id: "1", text: "a", voice: "Me", voiceLabel: "Me" }, { id: "2", text: "b", voice: "Kore" }],
      [{ voice: "Me", replica }],
      "Me",
      "Ana",
    )
    expect(out.dialogue.map((l) => l.voice)).toEqual(["Ana", "Kore"])
    expect(out.speakers).toEqual([{ voice: "Ana", replica }])
  })

  it("removeClone drops the entry and moves its lines onto the model's voices", () => {
    const out = removeClone(FLASH, [{ id: "1", text: "a", voice: "Me" }, { id: "2", text: "b", voice: "Kore" }], [{ voice: "Me", replica }], "Me")
    expect(out.speakers).toBeUndefined()
    expect(out.dialogue.map((l) => l.voice)).toEqual(["Fola", "Kore"])
  })
})
