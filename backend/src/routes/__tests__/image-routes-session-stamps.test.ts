/**
 * `sessionId` and `origin` on image-to-image, edit-image and generate-mask.
 *
 * None of these route bodies declares either field: the job funnel
 * (`insertJob` → `requestStamps`) reads both off the RAW body, checks the
 * session is the caller's own, and stamps `session_id` + `input_data.origin`
 * on the job — on every job-creating route. The SDK types both on these
 * routes' params (`GenerationSessionParams`), so this pins that the funnel
 * really stamps them here, through the real `insertJob`: a route that one day
 * inserted its job some other way would silently drop them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  sessionLookups: [] as Array<{ id: unknown; userId: unknown }>,
}))

const SESSION = "00000000-0000-4000-8000-0000000000aa"

vi.mock("@/lib/supabase.js", () => {
  /** `generation_sessions`: select("id").eq("id", …).eq("user_id", …).is("workspace_id", null).maybeSingle() */
  function sessionsTable() {
    const filters: Record<string, unknown> = {}
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return chain
      },
      is: () => chain,
      maybeSingle: async () => {
        h.sessionLookups.push({ id: filters.id, userId: filters.user_id })
        return { data: filters.id === SESSION ? { id: SESSION } : null, error: null }
      },
    }
    return chain
  }
  /** `jobs`: insert(row).select(cols).single() */
  function jobsTable() {
    return {
      insert: (row: Record<string, unknown>) => {
        h.inserted.push(row)
        return { select: () => ({ single: async () => ({ data: { id: `job-${h.inserted.length}` }, error: null }) }) }
      },
    }
  }
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "generation_sessions") return sessionsTable()
        if (table === "jobs") return jobsTable()
        throw new Error(`unexpected table ${table}`)
      }),
      auth: { getUser: vi.fn() },
    },
  }
})
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => false),
}))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { imageToImageRoutes } from "../image-to-image.js"
import { editImageRoutes } from "../edit-image.js"
import { generateMaskRoutes } from "../generate-mask.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.inserted.length = 0
  h.sessionLookups.length = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await imageToImageRoutes(instance)
    await editImageRoutes(instance)
    await generateMaskRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const ROUTES: Array<[string, Record<string, unknown>]> = [
  ["/v1/image-to-image", { imageUrl: "https://example.com/a.png", prompt: "watercolor", provider: "flux-fill" }],
  ["/v1/edit-image", { imageUrl: "https://example.com/a.png", provider: "recraft-upscale" }],
  ["/v1/generate-mask", { imageUrl: "https://example.com/a.png", prompt: "the red car" }],
]

describe.each(ROUTES)("%s stamps the request's session and origin on its job", (url, body) => {
  it("session_id and input_data.origin ride the inserted row", async () => {
    const res = await app.inject({ method: "POST", url, payload: { ...body, userId: USER, sessionId: SESSION, origin: "create-image" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(h.sessionLookups).toEqual([{ id: SESSION, userId: USER }])
    expect(h.inserted).toHaveLength(1)
    expect(h.inserted[0]!.session_id).toBe(SESSION)
    expect((h.inserted[0]!.input_data as Record<string, unknown>).origin).toBe("create-image")
  })

  it("without them the row carries neither", async () => {
    const res = await app.inject({ method: "POST", url, payload: { ...body, userId: USER } })
    expect(res.statusCode).toBe(200)
    expect(h.sessionLookups).toEqual([])
    expect(h.inserted[0]).not.toHaveProperty("session_id")
    expect(h.inserted[0]!.input_data as Record<string, unknown>).not.toHaveProperty("origin")
  })

  it("a session that is not the caller's is a 404, before any job exists", async () => {
    const res = await app.inject({ method: "POST", url, payload: { ...body, userId: USER, sessionId: "00000000-0000-4000-8000-0000000000bb" } })
    expect(res.statusCode).toBe(404)
    expect(h.inserted).toEqual([])
  })
})
