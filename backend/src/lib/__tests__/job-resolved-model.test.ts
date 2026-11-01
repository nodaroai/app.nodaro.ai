/**
 * `resolvedModelOfJob` — the model a queued job runs, decided as its handler
 * decides, in the catalog's / the LLM registry's vocabulary.
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS, resolveScriptModelId } from "@nodaro/shared/llm-models"
import { DEFAULT_SUNO_MODEL, T2I_TO_I2I_VARIANT } from "@nodaro/shared/models"
import { DEFAULT_VIDEO_MASK_PROVIDER } from "@nodaro/shared/media"
import { RESOLVED_MODEL_OF_JOB, resolvedModelOfJob, withResolvedModel } from "../job-resolved-model.js"
import { ROUTED_JOBS } from "../concurrency-lanes/provider-of.js"
import { resolveOmittedTtsProvider } from "../omitted-tts-provider.js"
import { LIP_SYNC_DEFAULT_PROVIDER } from "../../workers/handlers/default-models.js"

const isKnownModel = (id: string) => Object.hasOwn(MODEL_CATALOG, id) || LLM_MODELS.some((m) => m.id === id)

describe("resolvedModelOfJob", () => {
  it("every job whose provider follows from its payload has an entry (provider-of's ROUTED_JOBS)", () => {
    // speech-to-video runs one fixed model that has no catalog id; web-scrape
    // runs a scraping actor or an RSS fetch, no model at all.
    const NO_MODEL = new Set(["speech-to-video", "web-scrape"])
    const missing = Object.keys(ROUTED_JOBS).filter((j) => !NO_MODEL.has(j) && !Object.hasOwn(RESOLVED_MODEL_OF_JOB, j))
    expect(missing).toEqual([])
  })

  it("every default — the model a payload naming none runs — is a catalog or LLM id", () => {
    // Models the catalog does not list keep their own id: video-mask's SAM; extend-video has no default.
    const notInCatalog = new Set<string>([DEFAULT_VIDEO_MASK_PROVIDER])
    const offenders = Object.keys(RESOLVED_MODEL_OF_JOB).flatMap((job) => {
      const id = resolvedModelOfJob(job, { text: "hello" })
      if (id === undefined) return job === "extend-video" ? [] : [`${job}: none`]
      return isKnownModel(id) || notInCatalog.has(id) ? [] : [`${job}: ${id}`]
    })
    expect(offenders).toEqual([])
  })

  it("maps a UI or vendor value onto the catalog model it runs", () => {
    expect(resolvedModelOfJob("motion-transfer", {})).toBe("motion-transfer")
    expect(resolvedModelOfJob("motion-transfer", { provider: "kling" })).toBe("motion-transfer")
    expect(resolvedModelOfJob("motion-transfer", { provider: "kling-3.0" })).toBe("kling-3.0-motion")
    expect(resolvedModelOfJob("video-upscale", {})).toBe("topaz-video")
    expect(resolvedModelOfJob("video-upscale", { provider: "veo-4k" })).toBe("veo-4k")
    expect(resolvedModelOfJob("suno-generate", { model: "V5" })).toBe("suno-v5")
    expect(MODEL_CATALOG[resolvedModelOfJob("suno-generate", {})!]?.dataValue).toBe(DEFAULT_SUNO_MODEL)
    expect(resolvedModelOfJob("text-to-speech", { provider: "elevenlabs", text: "hi" })).toBe("elevenlabs-turbo")
    expect(resolvedModelOfJob("generate-script", { provider: "claude" })).toBe(resolveScriptModelId("claude", undefined))
  })

  it("records the handler's default when the payload names no model", () => {
    expect(resolvedModelOfJob("lip-sync", {})).toBe(LIP_SYNC_DEFAULT_PROVIDER)
    expect(resolvedModelOfJob("text-to-speech", { text: "hi" })).toBe(resolveOmittedTtsProvider("hi"))
    expect(resolvedModelOfJob("generate-3d-scene", {})).toBe(LLM_FEATURE_DEFAULTS["3d-scene"])
  })

  it("generate-image records the model after the handler's image-to-image swap", () => {
    const [t2i, i2i] = Object.entries(T2I_TO_I2I_VARIANT)[0]!
    expect(resolvedModelOfJob("generate-image", { provider: t2i })).toBe(t2i)
    expect(resolvedModelOfJob("generate-image", { provider: t2i, baseImageUrl: "https://x/y.png" })).toBe(i2i)
  })

  it("names nothing for a run that calls no model, or a job it does not know", () => {
    expect(resolvedModelOfJob("edit-3d-scene", { operations: [{ op: "move" }] })).toBeUndefined()
    expect(resolvedModelOfJob("combine-videos", { provider: "anything" })).toBeUndefined()
  })

  it("withResolvedModel adds the key only when there is a model to record", () => {
    expect(withResolvedModel({ type: "lip-sync" }, "lip-sync")).toEqual({ type: "lip-sync", resolvedModel: LIP_SYNC_DEFAULT_PROVIDER })
    expect(withResolvedModel({ type: "combine-videos" }, "combine-videos")).toEqual({ type: "combine-videos" })
  })
})
