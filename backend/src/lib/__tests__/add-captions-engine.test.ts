/**
 * The engine an Add Captions run transcribes on (decided 2026-11-15): the one
 * named, else the first engine the deployment offers in the default order —
 * one rule (`captionTranscribeEngine`, `@nodaro/render-rules`) for the editor,
 * the route, the workflow build and the estimates, judged only where the
 * deployment restricts models.
 */
import { describe, it, expect, afterEach } from "vitest"
import { CAPTION_TRANSCRIBE_LANES } from "@nodaro/shared/models"
import { CAPTION_ENGINE_DEFAULT_ORDER, CAPTION_ENGINE_UNRESTRICTED_DEFAULT, captionTranscribeEngine } from "@nodaro/render-rules"
import { addCaptionsEngine, addCaptionsRunModel, captionEngineWithheld } from "../add-captions-engine.js"
import { addCaptionsBuiltEngine, estimatedCaptionEngine } from "../add-captions-transcription.js"
import { ADD_CAPTIONS_DEFAULT_TRANSCRIBE_PROVIDER } from "../transcribe-lane-key.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../availability-override.js"

afterEach(() => __resetAvailabilityOverridesForTests())

function withhold(...withheld: string[]): void {
  __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((m) => !withheld.includes(m))) })
}

describe("the default order", () => {
  it("names every engine once, today's default first", () => {
    expect([...CAPTION_ENGINE_DEFAULT_ORDER].sort()).toEqual([...CAPTION_TRANSCRIBE_LANES].sort())
    expect(new Set(CAPTION_ENGINE_DEFAULT_ORDER).size).toBe(CAPTION_TRANSCRIBE_LANES.length)
    expect(CAPTION_ENGINE_DEFAULT_ORDER[0]).toBe("incredibly-fast-whisper")
    expect(CAPTION_ENGINE_UNRESTRICTED_DEFAULT).toBe(ADD_CAPTIONS_DEFAULT_TRANSCRIBE_PROVIDER)
  })

  it("every engine is a model a restriction can name", () => {
    expect(CAPTION_TRANSCRIBE_LANES.filter((e) => !GATEABLE_MODEL_IDS.has(e))).toEqual([])
  })
})

describe("captionTranscribeEngine", () => {
  it("a named engine is returned as named, withheld or not", () => {
    expect(captionTranscribeEngine("whisper", () => true)).toBe("whisper")
  })

  it("an unnamed (or empty) engine is the first the predicate does not withhold, or none", () => {
    expect(captionTranscribeEngine(undefined, () => false)).toBe("incredibly-fast-whisper")
    expect(captionTranscribeEngine("", (e) => e === "incredibly-fast-whisper")).toBe("elevenlabs-stt")
    expect(captionTranscribeEngine(42, (e) => e !== "whisper")).toBe("whisper")
    expect(captionTranscribeEngine(undefined, () => true)).toBeUndefined()
  })
})

describe("on this server", () => {
  it("with nothing restricted, nothing is withheld and the default is today's", () => {
    expect(CAPTION_TRANSCRIBE_LANES.filter(captionEngineWithheld)).toEqual([])
    expect(addCaptionsEngine(undefined)).toBe("incredibly-fast-whisper")
  })

  it("where models are restricted, the first offered", () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt")
    expect(addCaptionsEngine(undefined)).toBe("nemotron-3-5-transcribe")
    expect(addCaptionsEngine("elevenlabs-stt")).toBe("elevenlabs-stt")
  })

  it("the run model answers the engine only when the render transcribes, and every engine where none is offered", () => {
    expect(addCaptionsRunModel({ text: "Hello there" })).toBeUndefined()
    expect(addCaptionsRunModel({ style: "karaoke" })).toBe("incredibly-fast-whisper")
    withhold(...CAPTION_TRANSCRIBE_LANES)
    expect(addCaptionsRunModel({ style: "karaoke" })).toEqual(CAPTION_TRANSCRIBE_LANES)
    // A built job that carries no engine is judged on the worker's default (the build refuses this render first).
    expect(addCaptionsBuiltEngine({ style: "karaoke" })).toBe("incredibly-fast-whisper")
    expect(addCaptionsBuiltEngine({ style: "karaoke", transcribe_provider: "whisper" })).toBe("whisper")
    expect(addCaptionsBuiltEngine({ text: "Hello there" })).toBeUndefined()
  })
})

describe("the estimates ask the run's resolver", () => {
  it("loading the server rule hands it to the estimates: under a restriction they pick the engine the run picks", () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt")
    expect(estimatedCaptionEngine(undefined)).toBe(addCaptionsEngine(undefined))
    expect(estimatedCaptionEngine(undefined)).toBe("nemotron-3-5-transcribe")
    expect(estimatedCaptionEngine("whisper")).toBe("whisper")
  })
})
