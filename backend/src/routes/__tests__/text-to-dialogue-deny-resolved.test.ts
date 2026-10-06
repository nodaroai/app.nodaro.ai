import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The route's model deny reads the id the request RUNS on, not only the raw body.
 *
 * `POST /v1/text-to-dialogue` runs a request that names no model (or a model it does
 * not know) on `elevenlabs-dialogue`. The deny used to read the raw `body.provider`
 * alone, so a deployment that denied that model was bypassed by simply omitting the
 * field. This drives the REAL creditGuard on the REAL route (business edition: the
 * surface profile applies, the cloud credit impl never loads), so the deny is the
 * only thing that can 403.
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
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractNodeId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
  extractProvider: vi.fn((body: any, fallback: string) => body?.provider ?? fallback),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))

import { textToDialogueRoutes } from "../text-to-dialogue.js"
import { videoQueue } from "@/lib/queue.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const LINES = [{ text: "Hi.", voice: "Rachel" }, { text: "Hello.", voice: "George" }]

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
  await app.register(async (instance) => { await textToDialogueRoutes(instance) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
})

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { dialogue: LINES, userId: USER_ID, ...payload } })

describe("POST /v1/text-to-dialogue — models.deny reads the resolved model", () => {
  beforeEach(() => setProfile(JSON.stringify({ models: { deny: ["elevenlabs-dialogue"] } })))

  const refused = [
    ["an omitted provider", {}],
    ["an explicit provider", { provider: "elevenlabs-dialogue" }],
    ["an unknown provider (it runs on the default)", { provider: "nope" }],
    ["a provider that is an Object.prototype key", { provider: "constructor" }],
    ["a non-string provider", { provider: 7 }],
  ] as const

  for (const [label, extra] of refused) {
    it(`403 model_not_available: ${label}`, async () => {
      const res = await post({ ...extra })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("model_not_available")
      expect(res.json().error.message).toContain("elevenlabs-dialogue")
      expect(videoQueue.add).not.toHaveBeenCalled()
    })
  }
})

describe("POST /v1/text-to-dialogue — nothing else changes", () => {
  it("a deny of another model does not touch the request, named or omitted", async () => {
    setProfile(JSON.stringify({ models: { deny: ["veo3"] } }))
    expect((await post({})).statusCode).toBe(200)
    expect((await post({ provider: "elevenlabs-dialogue" })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(2)
  })

  it("is inert with no surface profile at all", async () => {
    setProfile(null)
    expect((await post({})).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })
})
