import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The credit guard judges a request's raw `provider` at its door only when it
 * IS the model the route's node runs (lib/provider-model.ts). Engine names
 * shared with other models — Generate Music's `minimax` (the music engine; the
 * catalog's `minimax` is a video model), Motion Transfer's `kling` (it runs the
 * catalog's `motion-transfer`), Generate Script's legacy `gemini` — were judged
 * as those other models, so the node was refused wherever an unrelated model
 * was withheld or an admin switched it off. The model an engine name runs is
 * judged with the run's own model (`runModel`), on a deployment that restricts
 * models. Without a restriction the door refuses strictly less than before.
 *
 * Every route here declares the `runModel` its real route declares, built by
 * the same helper.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: async () => false, warmAdminCache: vi.fn() }))

import { creditGuard } from "../credit-guard.js"
import { fixedRunModel, jobRunModel, videoRunModel } from "../../lib/run-model.js"
import { VIDEO_RETAKE_MODEL } from "../../workers/handlers/default-models.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { MUSIC_CREDIT_ID } from "@nodaro/shared/models"
import { LTX_RETAKE_PER_SECOND_CREDIT_ID } from "@nodaro/shared/credits"
import { SCRIPT_LEGACY_PROVIDER_MODELS } from "@nodaro/shared/llm-models"

const USER = "00000000-0000-4000-8000-000000000001"
const GEMINI_SCRIPT = SCRIPT_LEGACY_PROVIDER_MODELS.gemini

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}
const allow = (...ids: string[]) => setProfile({ models: { allow: ids } })

let app: FastifyInstance
let handled: number

beforeEach(async () => {
  handled = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = USER
  })
  const ok = async () => {
    handled += 1
    return { ok: true }
  }
  // As the real routes guard them (routes/generate-music.ts, motion-transfer.ts, generate-script.ts, video-retake.ts, generate-video.ts).
  app.post("/v1/generate-music", { preHandler: creditGuard(() => MUSIC_CREDIT_ID) }, ok)
  app.post("/v1/motion-transfer", { preHandler: creditGuard(() => "motion-transfer:5s", { runModel: jobRunModel("motion-transfer") }) }, ok)
  app.post("/v1/generate-script", { preHandler: creditGuard(() => "generate-script", { runModel: jobRunModel("generate-script") }) }, ok)
  app.post("/v1/video-retake", { preHandler: creditGuard(() => LTX_RETAKE_PER_SECOND_CREDIT_ID, { runModel: fixedRunModel(VIDEO_RETAKE_MODEL) }) }, ok)
  app.post("/v1/generate-video", { preHandler: creditGuard(() => "seedance-2-fast", { runModel: videoRunModel }) }, ok)
  await app.ready()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload: { prompt: "a quiet harbour", ...payload } })
const refusedFor = async (url: string, payload: Record<string, unknown>) => {
  const res = await post(url, payload)
  return res.statusCode === 403 ? (res.json() as { error: { code: string; message: string } }).error : undefined
}

describe("without a model restriction: an engine name never stands in for a switched-off model", () => {
  it("Generate Music's minimax runs although the minimax VIDEO model is switched off", async () => {
    __resetModelSwitchForTests(["minimax"])
    expect(await refusedFor("/v1/generate-music", { provider: "minimax" })).toBeUndefined()
    expect(handled).toBe(1)
    // A request that names the video model itself is still judged on it.
    expect((await refusedFor("/v1/generate-video", { provider: "minimax" }))?.code).toBe("model_not_available")
  })

  it("Motion Transfer's kling runs although the kling video model is switched off", async () => {
    __resetModelSwitchForTests(["kling", "kling-3.0"])
    expect(await refusedFor("/v1/motion-transfer", { provider: "kling" })).toBeUndefined()
    expect(await refusedFor("/v1/motion-transfer", { provider: "kling-3.0" })).toBeUndefined()
  })

  it("adds no refusal: the model an engine name runs is not judged at the door where nothing is restricted", async () => {
    __resetModelSwitchForTests(["motion-transfer", GEMINI_SCRIPT, VIDEO_RETAKE_MODEL])
    expect(await refusedFor("/v1/motion-transfer", { provider: "kling" })).toBeUndefined()
    expect(await refusedFor("/v1/generate-script", { provider: "gemini" })).toBeUndefined()
    expect(await refusedFor("/v1/video-retake", {})).toBeUndefined()
    expect(handled).toBe(3)
  })
})

describe("under a model restriction: the model an engine name runs is judged, and only that", () => {
  it("Motion Transfer is refused when the model its kling option runs is withheld — and runs when only the kling video model is", async () => {
    allow("kling")
    expect(await refusedFor("/v1/motion-transfer", { provider: "kling" })).toEqual({
      code: "model_not_available",
      message: "This workflow uses a model that is not available on this deployment: motion-transfer. Switch to an available model to run this workflow.",
    })
    allow("motion-transfer")
    expect(await refusedFor("/v1/motion-transfer", { provider: "kling" })).toBeUndefined()
  })

  it("Generate Music runs where the minimax video model is withheld", async () => {
    allow("seedance-2-fast")
    expect(await refusedFor("/v1/generate-music", { provider: "minimax" })).toBeUndefined()
  })

  it("Generate Script is judged on the LLM its legacy provider or llmModel resolves", async () => {
    allow("gpt-5.5")
    expect((await refusedFor("/v1/generate-script", { provider: "gemini" }))?.message).toContain(GEMINI_SCRIPT)
    expect(await refusedFor("/v1/generate-script", { provider: "gemini", llmModel: "gpt-5.5" })).toBeUndefined()
  })

  it("Video Retake is judged on LTX 2.3 Pro, the model it runs", async () => {
    allow("seedance-2-fast")
    expect((await refusedFor("/v1/video-retake", {}))?.message).toContain(VIDEO_RETAKE_MODEL)
    allow(VIDEO_RETAKE_MODEL)
    expect(await refusedFor("/v1/video-retake", {})).toBeUndefined()
  })
})
