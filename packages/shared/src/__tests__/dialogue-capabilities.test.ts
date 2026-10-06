import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import { DIALOGUE_PROVIDERS, DEFAULT_DIALOGUE_PROVIDER, TTS_PROVIDERS, getMaxTtsChars } from "../model-constants.js"
import {
  findDialogueCapabilities,
  getDialogueCapabilities,
  dialogueProviderOf,
  dialogueHasLever,
  dialogueStabilityAccepted,
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
      expect(entry.series, `${id} series`).toBe("ElevenLabs")
    }
  })

  it("the default is v3's dialogue model", () => {
    expect(DEFAULT_DIALOGUE_PROVIDER).toBe("elevenlabs-dialogue")
    expect(DIALOGUE_PROVIDERS).toContain(DEFAULT_DIALOGUE_PROVIDER)
  })

  it("no id is both a text-to-speech provider and a dialogue provider", () => {
    for (const id of DIALOGUE_PROVIDERS) expect(TTS_PROVIDERS as readonly string[], id).not.toContain(id)
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

  it("a text-to-speech id is not a dialogue model — and a dialogue id is not a text-to-speech model", () => {
    for (const id of TTS_PROVIDERS) {
      expect(findDialogueCapabilities(id), id).toBeUndefined()
      expect(dialogueProviderOf(id), id).toBe(DEFAULT_DIALOGUE_PROVIDER)
    }
    for (const id of DIALOGUE_PROVIDERS) expect(findTtsCapabilities(id), id).toBeUndefined()
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
