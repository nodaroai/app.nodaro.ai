import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The model deny covers the provider a request RUNS on, named or omitted.
 *
 * `POST /v1/video-depth` runs a request that names no provider on the default
 * (`video-depth-anything`). creditGuard's deny reads the raw `body.provider`,
 * so the route's preHandler writes the resolved provider back onto the body.
 * This drives the REAL creditGuard on the REAL route (business edition: the
 * surface profile applies, the cloud credit impl never loads) — mirrors
 * text-to-speech-deny-resolved.test.ts.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
const insertSpy = vi.fn()
vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn((row: unknown) => {
      insertSpy(row)
      return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }
    }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  })
  return { supabase: { from: mockFrom, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) } } }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  probeVideoSource: vi.fn().mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 }),
}))

import { videoDepthRoutes } from "../video-depth.js"
import { videoQueue } from "@/lib/queue.js"
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
  await app.register(async (instance) => { await videoDepthRoutes(instance) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
})

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/video-depth", payload: { videoUrl: "https://example.com/v.mp4", userId: USER_ID, ...payload } })

const deny = (...ids: string[]) => setProfile(JSON.stringify({ models: { deny: ids } }))

describe("POST /v1/video-depth — models.deny", () => {
  it("403 model_not_available: an omitted provider when the default is denied — nothing created", async () => {
    deny("video-depth-anything")
    const res = await post({})
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expect(res.json().error.message).toContain("video-depth-anything")
    expect(insertSpy).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("403: an explicit denied provider is refused", async () => {
    deny("depth-anything-frames")
    const res = await post({ provider: "depth-anything-frames" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("a deny of the other provider leaves an omitted-provider request running", async () => {
    deny("depth-anything-frames")
    expect((await post({})).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("is inert with no surface profile", async () => {
    setProfile(null)
    expect((await post({})).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })
})
