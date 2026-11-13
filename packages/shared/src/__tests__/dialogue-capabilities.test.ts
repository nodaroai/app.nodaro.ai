import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, SPEECH_UNIT_PRICE_NOTE } from "../model-catalog.js"
import { DIALOGUE_PROVIDERS, DEFAULT_DIALOGUE_PROVIDER, TTS_PROVIDERS, getMaxTtsChars } from "../model-constants.js"
import {
  findDialogueCapabilities,
  getDialogueCapabilities,
  dialogueProviderOf,
  dialogueHasLever,
  dialogueStabilityAccepted,
  dialogueSupportsTimestamps,
  dialogueMaxSpeakers,
  dialogueTakesFillerWords,
  dialogueVoicesForModel,
  ELEVENLABS_DIALOGUE_MAX_VOICES,
  dialogueLineStyleMaxChars,
  dialogueLineStyleFor,
  dialogueTakesSpeakerDirection,
  dialogueSpeakerDirectionFor,
  dialogueVoicesOf,
  dialogueProblem,
  dialogueOutputFormats,
  dialogueOutputFormatFor,
  dialogueReplicaVoices,
  dialogueReplicaOf,
} from "../dialogue-capabilities.js"
import { findTtsCapabilities } from "../tts-capabilities.js"

const V3_DIALOGUE_SHEET = MODEL_CATALOG["elevenlabs-dialogue"]!.tts!

describe("dialogue lane — totality", () => {
  it("DIALOGUE_PROVIDERS is exactly the catalog's dialogue-mode models", () => {
    const fromCatalog = Object.values(MODEL_CATALOG).filter((m) => m.modes.includes("dialogue")).map((m) => m.id).sort()
    expect([...DIALOGUE_PROVIDERS].sort()).toEqual(fromCatalog)
  })

  it("every dialogue model has a sheet, a price row under its own id, and a Models-tab series", () => {
    for (const id of DIALOGUE_PROVIDERS) {
      const entry = MODEL_CATALOG[id]!
      expect(entry.tts, `${id} sheet`).toBeDefined()
      expect(entry.pricing[0]?.identifier, `${id} price identifier`).toBe(id)
      expect(entry.series, `${id} series`).toBe(id.startsWith("gemini-") ? "Gemini" : "ElevenLabs")
    }
  })

  it("the default is v3's dialogue model", () => {
    expect(DEFAULT_DIALOGUE_PROVIDER).toBe("elevenlabs-dialogue")
    expect(DIALOGUE_PROVIDERS).toContain(DEFAULT_DIALOGUE_PROVIDER)
  })

  it("an id in both lanes is exactly a model that takes one speaker and a script under one id (Gemini: priced on its one-speaker row by construction); the ElevenLabs dialogue ids are dialogue only", () => {
    const both = DIALOGUE_PROVIDERS.filter((id) => (TTS_PROVIDERS as readonly string[]).includes(id))
    expect(both).toEqual(["gemini-3-8-flash-lite-tts", "gemini-3-8-flash-tts", "gemini-3-1-flash-tts", "gemini-2-5-pro-tts"])
    for (const id of both) expect(MODEL_CATALOG[id]!.modes).toEqual(["tts", "dialogue"])
    for (const id of DIALOGUE_PROVIDERS.filter((d) => d.startsWith("elevenlabs-"))) expect(TTS_PROVIDERS as readonly string[], id).not.toContain(id)
  })

  it("stabilitySteps, when declared, are unique, ascending values within 0..1 — and no text-to-speech model declares any", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      const steps = m.tts?.stabilitySteps
      if (!steps) continue
      expect(m.modes, `${m.id}: only a dialogue model may restrict stability to steps`).toContain("dialogue")
      expect(steps.length, `${m.id} steps`).toBeGreaterThan(1)
      expect([...steps].sort((a, b) => a - b), `${m.id} ascending`).toEqual([...steps])
      expect(new Set(steps).size, `${m.id} unique`).toBe(steps.length)
      for (const s of steps) expect(s >= 0 && s <= 1, `${m.id} step ${s}`).toBe(true)
    }
  })
})

describe("dialogue lane — what v3 dialogue does today", () => {
  it("tags, stability only, in the steps 0 / 0.5 / 1, 5,000 characters in total, v3's languages", () => {
    const c = getDialogueCapabilities("elevenlabs-dialogue")
    expect(c.audioTags).toBe(true)
    expect(c.levers).toEqual(["stability"])
    expect(c.stabilitySteps).toEqual([0, 0.5, 1])
    expect(c.languageCode).toBe(true)
    expect(c.maxChars).toBe(5000)
    expect(getMaxTtsChars("elevenlabs-dialogue")).toBe(5000) // the old reader still agrees
    expect(c.languages).toHaveLength(46)
  })
})

describe("dialogue lane — lookups", () => {
  it("a missing, empty, unknown, non-string or inherited-member id runs as the default and has no sheet of its own", () => {
    const odd = [undefined, null, "", "not-a-model", "constructor", "__proto__", "toString", "hasOwnProperty", ["elevenlabs-dialogue"], 3, {}, true] as unknown[]
    for (const id of odd) {
      expect(findDialogueCapabilities(id), JSON.stringify(id)).toBeUndefined()
      expect(dialogueProviderOf(id), JSON.stringify(id)).toBe(DEFAULT_DIALOGUE_PROVIDER)
      expect(getDialogueCapabilities(id), JSON.stringify(id)).toBe(V3_DIALOGUE_SHEET)
    }
  })

  it("a text-to-speech-only id is not a dialogue model — and an ElevenLabs dialogue id is not a text-to-speech model", () => {
    for (const id of TTS_PROVIDERS.filter((t) => !(DIALOGUE_PROVIDERS as readonly string[]).includes(t))) {
      expect(findDialogueCapabilities(id), id).toBeUndefined()
      expect(dialogueProviderOf(id), id).toBe(DEFAULT_DIALOGUE_PROVIDER)
    }
    for (const id of DIALOGUE_PROVIDERS.filter((d) => !(TTS_PROVIDERS as readonly string[]).includes(d))) expect(findTtsCapabilities(id), id).toBeUndefined()
    // A model in both lanes has ONE sheet, the same in each.
    expect(findDialogueCapabilities("gemini-3-8-flash-tts")).toBe(findTtsCapabilities("gemini-3-8-flash-tts"))
  })

  it("a real dialogue id runs as itself", () => {
    for (const id of DIALOGUE_PROVIDERS) {
      expect(dialogueProviderOf(id)).toBe(id)
      expect(getDialogueCapabilities(id)).toBe(MODEL_CATALOG[id]!.tts)
    }
  })

  it("levers come from the sheet", () => {
    expect(dialogueHasLever("elevenlabs-dialogue", "stability")).toBe(true)
    expect(dialogueHasLever("elevenlabs-dialogue", "similarity")).toBe(false)
    expect(dialogueHasLever(undefined, "similarity")).toBe(false) // runs as v3 dialogue
  })

  it("stability: v3 dialogue accepts its three steps and nothing else", () => {
    for (const v of [0, 0.5, 1]) expect(dialogueStabilityAccepted("elevenlabs-dialogue", v), String(v)).toBe(true)
    for (const v of [0.3, 0.25, 0.75, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dialogueStabilityAccepted("elevenlabs-dialogue", v), String(v)).toBe(false)
    }
    // An unknown id is judged as the model it runs as.
    expect(dialogueStabilityAccepted("constructor", 0.3)).toBe(false)
  })
})

describe("elevenlabs-dialogue-v4 — added beside v3 dialogue", () => {
  it("is a dialogue provider and a dialogue-mode catalog model, never a text-to-speech one", () => {
    expect(DIALOGUE_PROVIDERS).toContain("elevenlabs-dialogue-v4")
    expect(MODEL_CATALOG["elevenlabs-dialogue-v4"]?.modes).toEqual(["dialogue"])
    expect(TTS_PROVIDERS as readonly string[]).not.toContain("elevenlabs-dialogue-v4")
    expect(findTtsCapabilities("elevenlabs-dialogue-v4")).toBeUndefined()
  })

  it("tags, stability (any 0–1) and similarity, the probed total cap, v3's languages", () => {
    const c = getDialogueCapabilities("elevenlabs-dialogue-v4")
    expect(c.audioTags).toBe(true)
    expect(c.ssmlBreaks).toBe(false)
    expect(c.levers).toEqual(["stability", "similarity"])
    expect(c.stabilitySteps).toBeUndefined()
    expect(c.languageCode).toBe(true)
    // The live-probe number: a 10,000-character v4 dialogue voiced whole in 130 s (measured 2026-10-06).
    expect(c.maxChars).toBe(10000)
    expect(getDialogueCapabilities("elevenlabs-dialogue").maxChars).toBe(5000) // v3 dialogue did not move
    expect(c.languages).toEqual(getDialogueCapabilities("elevenlabs-dialogue").languages)
  })

  it("takes any stability from 0 to 1; v3 dialogue keeps its steps", () => {
    for (const v of [0, 0.3, 0.55, 1]) expect(dialogueStabilityAccepted("elevenlabs-dialogue-v4", v), String(v)).toBe(true)
    expect(dialogueStabilityAccepted("elevenlabs-dialogue-v4", 1.01)).toBe(false)
    expect(dialogueStabilityAccepted("elevenlabs-dialogue", 0.3)).toBe(false)
  })

  it("its flat row is 25 credits with no note, beside its per-100-characters row, on either dialogue model; v3 dialogue stays the default", () => {
    expect(MODEL_CATALOG["elevenlabs-dialogue-v4"]!.pricing).toEqual([
      { identifier: "elevenlabs-dialogue-v4", credits: 25 },
      { identifier: "elevenlabs-dialogue-v4:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ])
    // Decided 2026-10-06: the flat row carries no note (the old "per 1K chars"
    // described a scaling that never existed); the length rule is its own row.
    expect(MODEL_CATALOG["elevenlabs-dialogue"]!.pricing).toEqual([
      { identifier: "elevenlabs-dialogue", credits: 25 },
      { identifier: "elevenlabs-dialogue:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ])
    expect(DEFAULT_DIALOGUE_PROVIDER).toBe("elevenlabs-dialogue")
    expect(dialogueProviderOf(undefined)).toBe("elevenlabs-dialogue")
  })
})

describe("Gemini dialogue — two speakers on all four (decided 2026-11-12)", () => {
  const GEMINI = ["gemini-3-8-flash-lite-tts", "gemini-3-8-flash-tts", "gemini-3-1-flash-tts", "gemini-2-5-pro-tts"]

  it("two speakers at most, no ElevenLabs lever, no timings; filler words on 3.8 only; v3 dialogue stays the default", () => {
    for (const id of GEMINI) {
      expect(dialogueMaxSpeakers(id), id).toBe(2)
      expect(dialogueSupportsTimestamps(id), id).toBe(false)
      expect(getDialogueCapabilities(id).levers, id).toEqual([])
      // Priced on the same row as one speaker: its one per-1,000-characters row.
      expect(MODEL_CATALOG[id]!.pricing.map((p) => p.identifier)).toEqual([id, `${id}:per-1k-chars`])
    }
    expect(dialogueTakesFillerWords("gemini-3-8-flash-lite-tts")).toBe(true)
    expect(dialogueTakesFillerWords("gemini-3-8-flash-tts")).toBe(true)
    expect(dialogueTakesFillerWords("gemini-3-1-flash-tts")).toBe(false)
    expect(dialogueTakesFillerWords("elevenlabs-dialogue")).toBe(false)
    expect(dialogueMaxSpeakers("elevenlabs-dialogue")).toBe(ELEVENLABS_DIALOGUE_MAX_VOICES)
    expect(DEFAULT_DIALOGUE_PROVIDER).toBe("elevenlabs-dialogue")
  })

  it("dialogueVoicesForModel: a voice the model speaks stays; others move onto its voices the script does not use, default first, so two speakers stay two", () => {
    expect(dialogueVoicesForModel("gemini-3-8-flash-tts", ["Zephyr", "Puck", "Zephyr"])).toEqual(["Zephyr", "Puck", "Zephyr"])
    // Two ElevenLabs voices → the default, then the first unused voice of the list.
    const moved = dialogueVoicesForModel("gemini-3-8-flash-tts", ["Rachel", "George", "Rachel"])
    expect(moved[0]).toBe("Fola")
    expect(moved[2]).toBe("Fola")
    expect(moved[1]).not.toBe("Fola")
    expect(getDialogueCapabilities("gemini-3-8-flash-tts").voices!.some((v) => v.id === moved[1])).toBe(true)
    // A kept voice is never reused for a moved one.
    expect(dialogueVoicesForModel("gemini-3-1-flash-tts", ["Kore", "Rachel"])).toEqual(["Kore", "Achernar"])
    // On an ElevenLabs dialogue model a Gemini voice becomes "" (the deployment's default); its own voices stay.
    expect(dialogueVoicesForModel("elevenlabs-dialogue", ["Fola", "Rachel"])).toEqual(["", "Rachel"])
  })
})

describe("Gemini dialogue — direction and the one validation rule", () => {
  it("3.8 takes a style per line; 3.1 / 2.5 a style, pace, accent and profile per speaker; ElevenLabs neither", () => {
    expect(dialogueLineStyleMaxChars("gemini-3-8-flash-tts")).toBe(1000)
    expect(dialogueLineStyleMaxChars("gemini-3-1-flash-tts")).toBeUndefined()
    expect(dialogueLineStyleMaxChars("elevenlabs-dialogue")).toBeUndefined()
    expect(dialogueTakesSpeakerDirection("gemini-3-8-flash-lite-tts")).toBe(false)
    expect(dialogueTakesSpeakerDirection("gemini-2-5-pro-tts")).toBe(true)
    expect(dialogueTakesSpeakerDirection("elevenlabs-dialogue-v4")).toBe(false)
    expect(dialogueLineStyleFor("gemini-3-8-flash-tts", "  calm  ")).toBe("calm")
    expect(dialogueLineStyleFor("gemini-3-1-flash-tts", "calm")).toBeUndefined()
    expect(dialogueSpeakerDirectionFor("gemini-3-1-flash-tts", { styleDirection: "Whisper", pace: "Natural", accent: "nope", audioProfile: " a host " }))
      .toEqual({ styleDirection: "Whisper", pace: "Natural", audioProfile: "a host" })
    expect(dialogueSpeakerDirectionFor("gemini-3-8-flash-tts", { styleDirection: "calm" })).toEqual({})
  })

  it("dialogueVoicesOf: the distinct voices in the order they first speak", () => {
    expect(dialogueVoicesOf([{ voice: "B" }, { voice: "A" }, { voice: "B" }, { text: "x" }, null])).toEqual(["B", "A"])
    expect(dialogueVoicesOf("nope")).toEqual([])
  })

  it("dialogueProblem: two voices at most on Gemini, each of its own; ten on ElevenLabs", () => {
    const line = (voice: string) => ({ text: "hi", voice })
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: [line("Fola"), line("Puck"), line("Fola")] })).toBeUndefined()
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: [line("Fola")] })).toBeUndefined()
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: [line("Fola"), line("Puck"), line("Kore")] })?.message)
      .toBe("A dialogue can use at most 2 unique voices — reuse voices across lines or split the script into two nodes")
    const off = dialogueProblem("gemini-3-1-flash-tts", { dialogue: [line("Kore"), line("Rachel")] })
    expect(off?.path).toEqual(["dialogue", 1, "voice"])
    expect(off?.message).toMatch(/^Rachel is not a voice of gemini-3-1-flash-tts\. Its voices: /)
    // ElevenLabs: any id, up to ten distinct.
    const ten = Array.from({ length: 10 }, (_, i) => line(`v${i}`))
    expect(dialogueProblem("elevenlabs-dialogue", { dialogue: ten })).toBeUndefined()
    expect(dialogueProblem("elevenlabs-dialogue", { dialogue: [...ten, line("v10")] })?.message).toMatch(/at most 10 unique voices/)
  })

  it("dialogueProblem refuses a speaker listed twice (which entry applies would be chance)", () => {
    const problem = dialogueProblem("gemini-3-1-flash-tts", { dialogue: [{ text: "hi", voice: "Kore" }], speakers: [{ voice: "Kore", pace: "Natural" }, { voice: "Kore", pace: "Staccato" }] })
    expect(problem).toEqual({ path: ["speakers", 1, "voice"], message: 'speakers lists the voice "Kore" more than once; give each speaker one entry' })
  })

  it("dialogueProblem: a line's style on 3.8 within 1,000 characters; a speaker's direction on 3.1 within its choices; untaken fields are no problem", () => {
    const d = [{ text: "hi", voice: "Fola", styleDirection: "x".repeat(1001) }]
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: d })).toEqual({ path: ["dialogue", 0, "styleDirection"], message: "styleDirection must be at most 1000 characters" })
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: [{ text: "hi", voice: "Fola", styleDirection: 3 }] })?.message).toBe("styleDirection must be a string")
    // 3.8 takes no direction per speaker: never sent, no problem.
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: [{ text: "hi", voice: "Fola" }], speakers: [{ voice: "Fola", pace: "Warp" }] })).toBeUndefined()
    const bad = dialogueProblem("gemini-3-1-flash-tts", { dialogue: [{ text: "hi", voice: "Kore" }], speakers: [{ voice: "Kore", pace: "Warp" }] })
    expect(bad?.path).toEqual(["speakers", 0, "pace"])
    expect(bad?.message).toMatch(/^pace must be one of: /)
    // 3.1 takes no style per line: never sent, no problem.
    expect(dialogueProblem("gemini-3-1-flash-tts", { dialogue: [{ text: "hi", voice: "Kore", styleDirection: "x".repeat(2000) }] })).toBeUndefined()
  })
})

describe("a dialogue's file (decided 2026-11-13)", () => {
  it("a Gemini model delivers every speech file format; an ElevenLabs dialogue model the default MP3 only", () => {
    for (const id of ["gemini-3-8-flash-lite-tts", "gemini-3-8-flash-tts", "gemini-3-1-flash-tts", "gemini-2-5-pro-tts"]) {
      expect(dialogueOutputFormats(id), id).toEqual(["mp3_44100_128", "mp3_44100_192", "wav_24000"])
    }
    expect(dialogueOutputFormats("elevenlabs-dialogue")).toEqual(["mp3_44100_128"])
    expect(dialogueOutputFormats("elevenlabs-dialogue-v4")).toEqual(["mp3_44100_128"])
    expect(dialogueOutputFormatFor("gemini-3-1-flash-tts", "wav_24000")).toBe("wav_24000")
    expect(dialogueOutputFormatFor("elevenlabs-dialogue", "wav_24000")).toBeUndefined()
    expect(dialogueOutputFormatFor("gemini-3-1-flash-tts", "flac")).toBeUndefined()
  })

  it("dialogueProblem refuses a file the model does not deliver, with its list", () => {
    const dialogue = [{ text: "hi", voice: "Rachel" }]
    expect(dialogueProblem("elevenlabs-dialogue", { dialogue, outputFormat: "wav_24000" }))
      .toEqual({ path: ["outputFormat"], message: "outputFormat on elevenlabs-dialogue must be one of: mp3_44100_128" })
    expect(dialogueProblem("elevenlabs-dialogue", { dialogue, outputFormat: "mp3_44100_128" })).toBeUndefined()
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: [{ text: "hi", voice: "Fola" }], outputFormat: "wav_24000" })).toBeUndefined()
  })
})

describe("a one-off clone in a dialogue (decided 2026-11-13)", () => {
  const replica = { sourceAudioUrl: "https://cdn.example/a.wav", consentAudioUrl: "https://cdn.example/b.wav" }

  it("dialogueReplicaVoices: the labels with a replica, on 3.8 Flash only", () => {
    const speakers = [{ voice: "Me", replica }, { voice: "Puck" }, { voice: "Bad", replica: { sourceAudioUrl: "http://x/a.wav", consentAudioUrl: "https://x/b.wav" } }]
    expect([...dialogueReplicaVoices("gemini-3-8-flash-tts", speakers)]).toEqual(["Me"])
    expect(dialogueReplicaVoices("gemini-3-8-flash-lite-tts", speakers).size).toBe(0)
    expect(dialogueReplicaVoices("gemini-3-1-flash-tts", speakers).size).toBe(0)
    expect(dialogueReplicaOf("gemini-3-8-flash-tts", speakers, "Me")).toEqual(replica)
    expect(dialogueReplicaOf("gemini-3-8-flash-tts", speakers, "Puck")).toBeUndefined()
  })

  it("dialogueVoicesForModel keeps a cloned speaker on 3.8 Flash and moves it like any foreign voice elsewhere", () => {
    const speakers = [{ voice: "Me", replica }]
    expect(dialogueVoicesForModel("gemini-3-8-flash-tts", ["Me", "Puck"], speakers)).toEqual(["Me", "Puck"])
    expect(dialogueVoicesForModel("gemini-3-8-flash-lite-tts", ["Me", "Puck"], speakers)).toEqual(["Fola", "Puck"])
    expect(dialogueVoicesForModel("elevenlabs-dialogue", ["Me", "Rachel"], speakers)).toEqual(["Me", "Rachel"])
  })

  it("dialogueProblem: a clone's label is a voice on 3.8 Flash; a replica on a model that does not clone is refused, never dropped", () => {
    const dialogue = [{ text: "hi", voice: "Me" }, { text: "yo", voice: "Puck" }]
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue, speakers: [{ voice: "Me", replica }] })).toBeUndefined()
    const lite = dialogueProblem("gemini-3-8-flash-lite-tts", { dialogue, speakers: [{ voice: "Me", replica }] })
    expect(lite?.path).toEqual(["speakers", 0, "replica"])
    expect(lite?.message).toBe("gemini-3-8-flash-lite-tts does not clone a voice; a one-off clone runs on gemini-3-8-flash-tts")
    expect(dialogueProblem("elevenlabs-dialogue", { dialogue: [{ text: "hi", voice: "Rachel" }], speakers: [{ voice: "Rachel", replica }] })?.path).toEqual(["speakers", 0, "replica"])
    // A malformed replica on 3.8 Flash is refused with the shape it needs.
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue, speakers: [{ voice: "Me", replica: { sourceAudioUrl: "ftp://x" } }] })?.message).toMatch(/needs sourceAudioUrl and consentAudioUrl/)
    // Clones count as speakers: two at most.
    expect(dialogueProblem("gemini-3-8-flash-tts", { dialogue: [...dialogue, { text: "x", voice: "Fola" }], speakers: [{ voice: "Me", replica }] })?.message).toMatch(/at most 2 unique voices/)
  })
})

describe("dialogueSupportsTimestamps", () => {
  it("both dialogue models return timings (measured 2026-10-06); an unknown id runs as v3 dialogue, so it does too", () => {
    expect(dialogueSupportsTimestamps("elevenlabs-dialogue-v4")).toBe(true)
    expect(dialogueSupportsTimestamps("elevenlabs-dialogue")).toBe(true)
    for (const id of [undefined, "", "nope", "constructor", ["elevenlabs-dialogue-v4"], "elevenlabs-v4"] as unknown[]) {
      expect(dialogueSupportsTimestamps(id), JSON.stringify(id)).toBe(true)
    }
  })
})
