import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The route's model deny reads the id the request RUNS on, not only the raw body.
 *
 * `POST /v1/text-to-speech` runs a request that names no model on the default speech
 * model (`elevenlabs-v4`, or turbo once the text outgrows v4's cap), and maps the
 * legacy `elevenlabs` alias to turbo. The deny used to read the raw `body.provider`
 * alone, so a deployment that denied the default model was bypassed by omitting the
 * field. This drives the REAL creditGuard on the REAL route (business edition: the
 * surface profile applies, the cloud credit impl never loads).
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  })
  return { supabase: { from: mockFrom, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) } } }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { textToSpeechRoutes } from "../text-to-speech.js"
import { videoQueue } from "@/lib/queue.js"
import { getMaxTtsChars, DEFAULT_TTS_PROVIDER } from "@nodaro/shared"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

function setProfile(json: string | null): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = json
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => { await textToSpeechRoutes(instance) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
})

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hello there.", voice: "Rachel", userId: USER_ID, ...payload } })

const deny = (...ids: string[]) => setProfile(JSON.stringify({ models: { deny: ids } }))

describe("POST /v1/text-to-speech — models.deny reads the resolved model", () => {
  it("403 model_not_available: an omitted provider when the default speech model is denied", async () => {
    expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
    deny("elevenlabs-v4")
    const res = await post({})
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expect(res.json().error.message).toContain("elevenlabs-v4")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("403: an explicit denied provider is still refused", async () => {
    deny("elevenlabs-v4")
    expect((await post({ provider: "elevenlabs-v4" })).statusCode).toBe(403)
  })

  it("403: the legacy `elevenlabs` alias is refused when turbo (the model it runs on) is denied", async () => {
    deny("elevenlabs-turbo")
    const res = await post({ provider: "elevenlabs" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain("elevenlabs-turbo")
  })

  it("403: long omitted-provider text runs on turbo, so denying turbo refuses it", async () => {
    deny("elevenlabs-turbo")
    const long = "a".repeat(getMaxTtsChars(DEFAULT_TTS_PROVIDER) + 1)
    expect((await post({ text: long })).statusCode).toBe(403)
  })

  it("an omitted provider is NOT refused by a deny of turbo when it runs on v4", async () => {
    deny("elevenlabs-turbo")
    expect((await post({})).statusCode).toBe(200)
  })
})

describe("POST /v1/text-to-speech — nothing else changes", () => {
  it("a deny of another model does not touch the request, named or omitted", async () => {
    deny("veo3")
    expect((await post({})).statusCode).toBe(200)
    expect((await post({ provider: "elevenlabs-v3" })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(2)
  })

  it("is inert with no surface profile at all", async () => {
    setProfile(null)
    expect((await post({})).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })
})
