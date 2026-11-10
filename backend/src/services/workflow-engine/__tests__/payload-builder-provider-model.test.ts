/**
 * buildPayload: a workflow node's `provider` is judged as a model id only when
 * it IS the model the node runs (lib/provider-model.ts). Generate Music's
 * `minimax` (the music engine), Motion Transfer's `kling` (the catalog's
 * `motion-transfer`) and Generate Script's legacy `gemini` (an LLM alias) used
 * to be judged as the models that share those names — refusing the node where
 * an unrelated model was withheld or switched off, while the model it runs went
 * unjudged. The model an engine name runs is now judged after the build, with
 * the default-model judge, on a deployment that restricts models; Video Retake,
 * which runs LTX 2.3 Pro whatever its node says, is judged on it.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests } from "../../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../../lib/model-switch.js"
import { deniedModelRejectionMessage } from "../../../lib/surface-deny.js"
import { resolvedModelOfJob } from "../../../lib/job-resolved-model.js"
import { VIDEO_RETAKE_MODEL } from "../../../workers/handlers/default-models.js"
import { SCRIPT_LEGACY_PROVIDER_MODELS } from "@nodaro/shared/llm-models"

const IMG = "https://cdn.example.com/a.png"
const VID = "https://cdn.example.com/a.mp4"
const WIRED = { prompt: "a quiet harbour at dawn", imageUrl: IMG, videoUrl: VID, imageUrls: [IMG], startFrameUrl: IMG }

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}
const allow = (...ids: string[]) => setProfile({ models: { allow: ids } })

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const node = (type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id: `${type}-1`, type, data: { label: "My Node", ...data } })
const build = (n: SimpleNode, inputs: Record<string, unknown> = WIRED) =>
  buildPayload(n, "job-1", { ...inputs } as ResolvedInputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
const refusalOf = (fn: () => unknown): { code?: unknown; message: string } | undefined => {
  try {
    fn()
    return undefined
  } catch (e) {
    return { code: (e as { code?: unknown }).code, message: (e as Error).message }
  }
}
const refused = (id: string) => ({ code: "model_not_available", message: deniedModelRejectionMessage([id]) })

const music = () => node("generate-music", { provider: "minimax", prompt: "a calm piano", referenceSource: "upload", referenceAudioUrl: "https://cdn.example.com/a.mp3" })
const motion = (provider: string) => node("motion-transfer", { provider })
const script = (data: Record<string, unknown> = {}) => node("generate-script", { provider: "gemini", ...data })
const retake = (data: Record<string, unknown> = {}) =>
  node("video-retake", { retakeStartTime: 0, retakeDuration: 2, retakeMode: "replace_video", aspectRatio: "16:9", fps: 24, generateAudio: false, ...data })

describe("without a model restriction: an engine name never stands in for a switched-off model", () => {
  it("Generate Music builds although the minimax VIDEO model is switched off", () => {
    __resetModelSwitchForTests(["minimax"])
    expect(refusalOf(() => build(music()))).toBeUndefined()
  })

  it("Motion Transfer builds although the kling video model is switched off", () => {
    __resetModelSwitchForTests(["kling", "kling-3.0"])
    expect(refusalOf(() => build(motion("kling")))).toBeUndefined()
    expect(refusalOf(() => build(motion("kling-3.0")))).toBeUndefined()
  })

  it("adds no refusal: the model an engine name runs is not judged where nothing is restricted", () => {
    __resetModelSwitchForTests(["motion-transfer", SCRIPT_LEGACY_PROVIDER_MODELS.gemini])
    expect(refusalOf(() => build(motion("kling")))).toBeUndefined()
    expect(refusalOf(() => build(script()))).toBeUndefined()
  })

  it("a provider that IS the model is still judged as before", () => {
    __resetModelSwitchForTests([VIDEO_RETAKE_MODEL])
    expect(refusalOf(() => build(retake({ provider: VIDEO_RETAKE_MODEL })))).toEqual(refused(VIDEO_RETAKE_MODEL))
  })
})

describe("under a model restriction: the model an engine name runs is judged", () => {
  it("Motion Transfer on the model its option runs, never on the kling video model", () => {
    const runs = resolvedModelOfJob("motion-transfer", { provider: "kling" })!
    expect(runs).toBe("motion-transfer")
    allow("kling")
    expect(refusalOf(() => build(motion("kling")))).toEqual(refused(runs))
    allow(runs)
    expect(refusalOf(() => build(motion("kling")))).toBeUndefined()
  })

  it("Generate Music builds where the minimax video model is withheld", () => {
    allow("seedance-2-fast")
    expect(refusalOf(() => build(music()))).toBeUndefined()
  })

  it("Generate Script on the LLM its legacy provider or llmModel resolves (it went unjudged before)", () => {
    allow("gpt-5.5")
    expect(refusalOf(() => build(script()))).toEqual(refused(SCRIPT_LEGACY_PROVIDER_MODELS.gemini))
    expect(refusalOf(() => build(script({ llmModel: "claude-sonnet-5.5" })))).toEqual(refused("claude-sonnet-5.5"))
    expect(refusalOf(() => build(script({ llmModel: "gpt-5.5" })))).toBeUndefined()
  })

  it("Video Retake on LTX 2.3 Pro, whether or not its node names it", () => {
    allow("seedance-2-fast")
    expect(refusalOf(() => build(retake()))).toEqual(refused(VIDEO_RETAKE_MODEL))
    expect(refusalOf(() => build(retake({ provider: VIDEO_RETAKE_MODEL })))).toEqual(refused(VIDEO_RETAKE_MODEL))
    allow(VIDEO_RETAKE_MODEL)
    expect(refusalOf(() => build(retake()))).toBeUndefined()
  })
})
