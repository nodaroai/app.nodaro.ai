/**
 * /v1/generate-image and the trained-character model under a deployment's
 * model restriction (decided 2026-11-12). The trained model
 * (`flux-lora-character`) has a hidden catalog entry, so a restriction names
 * it. Where the deployment withholds it, the editor's trained-character hint
 * (`_internalLora`) is ignored: the request runs, and is charged as, the model
 * it names, with nothing looked up about the trained model. A request that
 * names the trained model itself is refused `model_not_available` before the
 * credit check, like any named withheld model. Offered, or with no
 * restriction, the hint runs the trained model as before.
 *
 * The real route and the real credit guard (Cloud edition); the credit check
 * itself is replaced by spies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  creditCheck: vi.fn(),
  reserve: vi.fn(),
  insert: vi.fn(),
  queueAdd: vi.fn(),
  charLookup: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", CHARACTER_LORA_ROUTING_ENABLED: true },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => {
  const charChain = { eq: () => charChain, is: () => charChain, single: () => h.charLookup() }
  return {
    supabase: {
      from: vi.fn((table: string) =>
        table === "characters"
          ? { select: () => charChain }
          : { insert: h.insert, update: () => ({ eq: async () => ({ error: null }) }) },
      ),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: h.queueAdd }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  creditGuardImpl: () => h.creditCheck,
  reserveCreditsForJobImpl: h.reserve,
  checkPayerCanAffordImpl: vi.fn(),
  blockPaygOnConsumerSurface: vi.fn(),
  isWebFreeModeCandidate: vi.fn(() => false),
}))

import { generateImageRoutes } from "../generate-image.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { deniedModelRejectionMessage } from "../../lib/surface-deny.js"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"

const USER = "00000000-0000-4000-8000-000000000001"
const HINT = { characterId: "00000000-0000-4000-8000-0000000000bb" }
/** The model a node names; the deployment offers it. */
const PICKED = "gpt-image-2"
const OFFERED = [PICKED, "gpt-image-2-i2i"]

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 22, watermark: false })
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  h.charLookup.mockResolvedValue({ data: { lora_replicate_version: "owner/char-kira:abc123", lora_trigger_word: "TOK_kira", lora_training_status: "succeeded" }, error: null })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => generateImageRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const run = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/generate-image", payload: { prompt: "Kira walking on a beach", aspectRatio: "1:1", ...body } })

function expectRanTrainedModel(): void {
  expect(h.charLookup).toHaveBeenCalledTimes(1)
  expect(h.reserve.mock.calls[0]![3]).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
  expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider: FLUX_LORA_CHARACTER_MODEL_ID, model: FLUX_LORA_CHARACTER_MODEL_ID })
}

describe("/v1/generate-image's trained-character hint where the trained model is withheld", () => {
  it("is ignored: the request runs, and is charged as, the model it names, and nothing is looked up about the trained model", async () => {
    setProfile({ models: { allow: OFFERED } })
    const res = await run({ provider: PICKED, _internalLora: HINT })
    expect(res.statusCode).toBe(200)
    expect(h.charLookup).not.toHaveBeenCalled()
    expect(h.creditCheck).toHaveBeenCalledTimes(1)
    expect(h.reserve.mock.calls[0]![3]).toBe(PICKED)
    const queued = h.queueAdd.mock.calls[0]![1] as Record<string, unknown>
    expect(queued.provider).toBe(PICKED)
    expect(queued.model).toBeUndefined()
    expect(queued.extraParams).toBeUndefined()
  })

  it("charges and runs exactly what the same request without the hint does", async () => {
    setProfile({ models: { allow: OFFERED } })
    await run({ provider: PICKED, _internalLora: HINT })
    const withHint = { debit: h.reserve.mock.calls[0]![3], queued: { ...(h.queueAdd.mock.calls[0]![1] as object), jobId: undefined } }
    vi.clearAllMocks()
    h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 22, watermark: false })
    h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
    await run({ provider: PICKED })
    expect({ debit: h.reserve.mock.calls[0]![3], queued: { ...(h.queueAdd.mock.calls[0]![1] as object), jobId: undefined } }).toEqual(withHint)
  })

  it("a request that names the trained model itself is refused model_not_available, before the credit check, the job row or the queue", async () => {
    setProfile({ models: { allow: OFFERED } })
    const res = await run({ provider: FLUX_LORA_CHARACTER_MODEL_ID, _internalLora: HINT })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: "model_not_available", message: deniedModelRejectionMessage([FLUX_LORA_CHARACTER_MODEL_ID]) } })
    expect(h.creditCheck).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("an explicit deny withholds it the same way", async () => {
    setProfile({ models: { deny: [FLUX_LORA_CHARACTER_MODEL_ID] } })
    const res = await run({ provider: PICKED, _internalLora: HINT })
    expect(res.statusCode).toBe(200)
    expect(h.reserve.mock.calls[0]![3]).toBe(PICKED)
    expect(h.charLookup).not.toHaveBeenCalled()
  })

  it("so does an Admin → Availability models override saved before the trained model was listed", async () => {
    __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => id !== FLUX_LORA_CHARACTER_MODEL_ID)) })
    const res = await run({ provider: PICKED, _internalLora: HINT })
    expect(res.statusCode).toBe(200)
    expect(h.reserve.mock.calls[0]![3]).toBe(PICKED)
  })
})

describe("/v1/generate-image's trained-character hint where the trained model is offered", () => {
  it("an allow list that names it runs the trained model, as before", async () => {
    setProfile({ models: { allow: [...OFFERED, FLUX_LORA_CHARACTER_MODEL_ID] } })
    const res = await run({ provider: FLUX_LORA_CHARACTER_MODEL_ID, _internalLora: HINT })
    expect(res.statusCode).toBe(200)
    expectRanTrainedModel()
  })

  it("a deployment that restricts nothing runs the trained model, as before", async () => {
    const res = await run({ provider: FLUX_LORA_CHARACTER_MODEL_ID, _internalLora: HINT })
    expect(res.statusCode).toBe(200)
    expectRanTrainedModel()
  })
})
