import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const guardIds = vi.hoisted(() => ({ value: [] as string[] }))

// The mocks of voice-routes-validation.test.ts, verbatim, except the credit
// guard, which records the identifier its resolver returns.
vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }),
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "user-123", tier: "pro" }, error: null }) }) }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  })
  return {
    supabase: {
      from: mockFrom,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // Record what the guard would price, exactly as the real preHandler calls it (raw body, before Zod).
  creditGuard: (resolver: (req: unknown) => string) => async (req: unknown) => { guardIds.value.push(resolver(req)) },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractNodeId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
  extractProvider: vi.fn((body: any, fallback: string) => body?.provider ?? fallback),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))

import { textToDialogueRoutes } from "../text-to-dialogue.js"
import { videoQueue } from "@/lib/queue.js"
import { supabase } from "@/lib/supabase.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

/** The `input_data` the route wrote on the job row (the real insertJob reaches the mocked insert). */
function insertedInputData(): Record<string, unknown> {
  const insert = (supabase.from as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value.insert as ReturnType<typeof vi.fn>
  return insert.mock.calls.at(-1)![0].input_data as Record<string, unknown>
}

const USER_ID = "00000000-0000-4000-8000-000000000001"
const LINES = [{ text: "Hi.", voice: "Rachel" }, { text: "Hello.", voice: "George" }]

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  guardIds.value = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => { await textToDialogueRoutes(instance) })
  await app.ready()
})
afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { dialogue: LINES, userId: USER_ID, ...payload } })

describe("POST /v1/text-to-dialogue — the model", () => {
  it("an omitted provider is v3 dialogue: priced, reserved and queued as elevenlabs-dialogue", async () => {
    const res = await post({})
    expect(res.statusCode).toBe(200)
    expect(guardIds.value).toEqual(["elevenlabs-dialogue"])
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "elevenlabs-dialogue")
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-dialogue", expect.objectContaining({ provider: "elevenlabs-dialogue" }))
  })

  it("an explicit elevenlabs-dialogue is the same", async () => {
    expect((await post({ provider: "elevenlabs-dialogue" })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-dialogue", expect.objectContaining({ provider: "elevenlabs-dialogue" }))
  })

  it("the job row records the model the run renders on, whether or not the caller named it (the orchestrator path stores the same shape)", async () => {
    expect((await post({})).statusCode).toBe(200)
    expect(insertedInputData()).toEqual(expect.objectContaining({ type: "text-to-dialogue", provider: "elevenlabs-dialogue" }))
    expect((await post({ provider: "elevenlabs-dialogue" })).statusCode).toBe(200)
    expect(insertedInputData().provider).toBe("elevenlabs-dialogue")
  })

  it("a text-to-speech id or an unknown id is refused (and the guard priced the default, never a TTS row)", async () => {
    for (const provider of ["elevenlabs-v3", "elevenlabs-v4", "nope", "constructor"]) {
      guardIds.value = []
      const res = await post({ provider })
      expect(res.statusCode, provider).toBe(400)
      expect(guardIds.value, provider).toEqual(["elevenlabs-dialogue"])
    }
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("v3 dialogue still refuses a stability off its steps, with the old message", async () => {
    const res = await post({ stability: 0.3 })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("Stability must be 0, 0.5, or 1")
  })

  it("the total-length cap is the model's own (5,000 on v3 dialogue), with the old message", async () => {
    expect((await post({ dialogue: [{ text: "a".repeat(5000), voice: "Rachel" }] })).statusCode).toBe(200)
    const over = await post({ dialogue: [{ text: "a".repeat(4000), voice: "Rachel" }, { text: "b".repeat(1001), voice: "George" }] })
    expect(over.statusCode).toBe(400)
    expect(over.body).toContain("Total dialogue text must not exceed 5000 characters")
  })

  it("a malformed line is refused as a validation error, never a crash in the model's length check", async () => {
    expect((await post({ dialogue: [{ voice: "Rachel" }] })).statusCode).toBe(400)
    expect((await post({ dialogue: [{ text: "Hello" }] })).statusCode).toBe(400)
    expect((await post({ dialogue: "not an array" })).statusCode).toBe(400)
    expect((await post({ dialogue: [{ text: 42, voice: "Rachel" }] })).statusCode).toBe(400)
  })

  it("similarityBoost is accepted in 0..1 and forwarded (the funnel decides whether the model takes it)", async () => {
    expect((await post({ similarityBoost: 0.8 })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-dialogue", expect.objectContaining({ similarityBoost: 0.8 }))
    expect((await post({ similarityBoost: 1.2 })).statusCode).toBe(400)
  })
})
