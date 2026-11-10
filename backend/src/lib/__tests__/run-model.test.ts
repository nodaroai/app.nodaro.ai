import { describe, it, expect, vi } from "vitest"
import type { FastifyRequest } from "fastify"

/**
 * The run-model builders (`lib/run-model.ts`) and the image, caption run
 * models: each reads the same field the route reads and falls back to the
 * same default the route fills in after the credit guard.
 */

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
const lora = vi.hoisted(() => ({ enabled: false }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>()
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, prop) => (prop === "CHARACTER_LORA_ROUTING_ENABLED" ? lora.enabled : Reflect.get(target, prop)),
    }),
  }
})

import {
  adAnalysisRunModel,
  fixedRunModel,
  jobRunModel,
  llmFeatureDefault,
  llmRunModel,
  providerRunModel,
  rawBodyRecord,
  videoRunModel,
} from "../run-model.js"
import { resolveImageRunModel } from "../../routes/generate-image-credit-id.js"
import { resolveImageToImageRunModel } from "../../routes/image-to-image-credit-id.js"
import { resolveAddCaptionsRunModel } from "../../routes/add-captions.js"
import { ADD_CAPTIONS_DEFAULT_TRANSCRIBE_PROVIDER } from "../transcribe-lane-key.js"
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { DEFAULT_VIDEO_PROVIDER, FLUX_LORA_CHARACTER_MODEL_ID, IMAGE_ASPECT_RATIO_VALUES } from "@nodaro/shared/models"
import { defaultImageModel } from "@nodaro/shared/model-catalog"

const req = (body: unknown) => ({ body }) as FastifyRequest

describe("rawBodyRecord", () => {
  it("is the body for an object, and empty for anything else", () => {
    expect(rawBodyRecord(req({ a: 1 }))).toEqual({ a: 1 })
    for (const body of [undefined, null, [], 3, "x"]) expect(rawBodyRecord(req(body))).toEqual({})
  })
})

describe("providerRunModel / fixedRunModel", () => {
  it("the named provider, else the route's default; a value of the wrong type reads as absent", () => {
    const run = providerRunModel("gpt-image-2")
    expect(run(req({ provider: "nano-banana-pro" }))).toBe("nano-banana-pro")
    for (const provider of [undefined, "", 3, null]) expect(run(req({ provider }))).toBe("gpt-image-2")
  })

  it("a fixed model whatever the body", () => {
    expect(fixedRunModel("elevenlabs-isolation")(req({ provider: "x" }))).toBe("elevenlabs-isolation")
  })
})

describe("jobRunModel — the job's own resolved-model rule", () => {
  it("refuses a job the registry does not know, at registration", () => {
    expect(() => jobRunModel("not-a-job")).toThrow(/no resolved-model entry/)
  })

  it("maps a provider option to the catalog's id, default included", () => {
    expect(jobRunModel("motion-transfer")(req({}))).toBe("motion-transfer")
    expect(jobRunModel("video-upscale")(req({}))).toBe("topaz-video")
    expect(jobRunModel("video-upscale")(req({ provider: "topaz" }))).toBe("topaz-video")
    expect(jobRunModel("suno-generate")(req({}))).toBe("suno-v6")
    expect(jobRunModel("suno-generate")(req({ model: "V5" }))).toBe("suno-v5")
  })

  it("an edit of a 3D scene that carries its operations runs no planner", () => {
    expect(jobRunModel("edit-3d-scene")(req({ operations: [] }))).toBeUndefined()
    expect(jobRunModel("edit-3d-scene")(req({}))).toBe(LLM_FEATURE_DEFAULTS["3d-scene"])
  })
})

describe("llmRunModel — the body's llmModel, else the feature's default", () => {
  it("refuses a fixed feature with no default, at registration", () => {
    expect(() => llmRunModel("not-a-feature")).toThrow(/no default model/)
  })

  it("defaults by feature, through the features that borrow another's default", () => {
    expect(llmRunModel("llm-chat")(req({}))).toBe(LLM_FEATURE_DEFAULTS["llm-chat"])
    expect(llmRunModel("llm-structured")(req({}))).toBe(LLM_FEATURE_DEFAULTS["llm-chat"])
    expect(llmRunModel("text-to-picker")(req({}))).toBe(LLM_FEATURE_DEFAULTS["describe-to-picker"])
    expect(llmFeatureDefault("reduce:pick-best-llm")).toBe(LLM_FEATURE_DEFAULTS["pick-best-llm"])
  })

  it("a named model wins; a feature can be read off the body", () => {
    expect(llmRunModel("llm-chat")(req({ llmModel: "claude-sonnet-5" }))).toBe("claude-sonnet-5")
    const byEngine = llmRunModel((body) => (body.engine === "lottie" ? "motion-graphics-lottie" : "motion-graphics"))
    expect(byEngine(req({ engine: "lottie" }))).toBe(LLM_FEATURE_DEFAULTS["motion-graphics-lottie"])
  })
})

describe("videoRunModel / adAnalysisRunModel", () => {
  it("video: the named provider, else the platform default", () => {
    expect(videoRunModel(req({}))).toBe(DEFAULT_VIDEO_PROVIDER)
    expect(videoRunModel(req({ provider: "veo3" }))).toBe("veo3")
  })

  it("a scrape's analysis model only when analysis is asked for", () => {
    expect(adAnalysisRunModel(req({}))).toBeUndefined()
    expect(adAnalysisRunModel(req({ analyze: "true" }))).toBeUndefined()
    expect(adAnalysisRunModel(req({ analyze: true }))).toBe(LLM_FEATURE_DEFAULTS["meta-ads-analysis"])
    expect(adAnalysisRunModel(req({ analyze: true, analysisModel: "claude-sonnet-5" }))).toBe("claude-sonnet-5")
  })
})

describe("the image routes judge the default they fill in, ratio by ratio", () => {
  it("generate-image: every ratio's general default; a named model; nothing for a fan-out", () => {
    for (const ratio of IMAGE_ASPECT_RATIO_VALUES) {
      expect(resolveImageRunModel(req({ aspectRatio: ratio })), ratio).toBe(defaultImageModel("general", ratio))
    }
    expect(resolveImageRunModel(req({}))).toBe(defaultImageModel("general"))
    expect(resolveImageRunModel(req({ provider: "nano-banana-pro", aspectRatio: "4:5" }))).toBe("nano-banana-pro")
    expect(resolveImageRunModel(req({ models: ["nano-banana-pro", "gpt-image-2"] }))).toBeUndefined()
  })

  it("generate-image: a Character LoRA run runs the LoRA model, as the credit check prices it", () => {
    lora.enabled = true
    try {
      expect(resolveImageRunModel(req({ _internalLora: { characterId: "c" } }))).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
    } finally {
      lora.enabled = false
    }
    expect(resolveImageRunModel(req({ _internalLora: { characterId: "c" } }))).toBe(defaultImageModel("general"))
  })

  it("image-to-image: every ratio's edit default; a named model", () => {
    for (const ratio of IMAGE_ASPECT_RATIO_VALUES) {
      expect(resolveImageToImageRunModel(req({ aspectRatio: ratio })), ratio).toBe(defaultImageModel("edit", ratio))
    }
    expect(resolveImageToImageRunModel(req({ provider: "nano-banana-pro" }))).toBe("nano-banana-pro")
  })
})

describe("add-captions judges its transcription model only when it transcribes", () => {
  it("auto-transcribes on the default lane, or the one named", () => {
    expect(resolveAddCaptionsRunModel(req({}))).toBe(ADD_CAPTIONS_DEFAULT_TRANSCRIBE_PROVIDER)
    expect(resolveAddCaptionsRunModel(req({ style: "word-pop" }))).toBe(ADD_CAPTIONS_DEFAULT_TRANSCRIBE_PROVIDER)
    expect(resolveAddCaptionsRunModel(req({ transcribe_provider: "elevenlabs-stt" }))).toBe("elevenlabs-stt")
    expect(resolveAddCaptionsRunModel(req({ segments: [{ text: "own" }, { start: 1 }] }))).toBe(ADD_CAPTIONS_DEFAULT_TRANSCRIBE_PROVIDER)
  })

  it("runs no model when the request brings its own captions", () => {
    expect(resolveAddCaptionsRunModel(req({ captions: [{ text: "hi", startMs: 0, endMs: 500 }] }))).toBeUndefined()
    expect(resolveAddCaptionsRunModel(req({ transcript: { words: [] } }))).toBeUndefined()
    expect(resolveAddCaptionsRunModel(req({ text: "a static line" }))).toBeUndefined()
    expect(resolveAddCaptionsRunModel(req({ auto_transcribe: false }))).toBeUndefined()
    expect(resolveAddCaptionsRunModel(req({ segments: [{ text: "one" }, { captions: [{ text: "two" }] }] }))).toBeUndefined()
  })
})
