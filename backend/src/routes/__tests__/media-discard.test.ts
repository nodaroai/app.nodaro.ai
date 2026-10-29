import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const R2_PREFIX = "https://pub-test.r2.dev/"

vi.mock("@/lib/storage.js", () => ({
  r2KeyFromOurUrl: vi.fn((url: string) =>
    url.startsWith(R2_PREFIX) ? url.slice(R2_PREFIX.length) : null,
  ),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// One output path keeps the supabase call order fixed whatever the shared-bucket flag says.
vi.mock("@/lib/job-output-urls.js", () => ({
  jobOutputReferrerPaths: () => ["output_data->>videoUrl"],
}))

// The cleanup itself is media-process's (its own tests pin it); here only WHETHER it runs.
vi.mock("../media-process.js", () => ({
  deleteSourceAfterProcess: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { mediaDiscardRoutes, DISCARD_WINDOW_MS } from "../media-discard.js"
import { deleteSourceAfterProcess } from "../media-process.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const KEY = "uploads/video/cut-1.mp4"
const URL = `${R2_PREFIX}${KEY}`

type ChainResult = { data?: unknown; error?: unknown; count?: number | null }

/** Thenable supabase chain stub: every method returns the chain; awaiting it resolves the result. */
function chain(result: ChainResult) {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: ChainResult) => void) =>
            resolve({ data: null, error: null, count: null, ...result })
        }
        return () => proxy
      },
    },
  )
  return proxy
}

/** Each supabase.from() call consumes the next queued result (last one repeats). */
function queue(...results: ChainResult[]) {
  const q = [...results]
  vi.mocked(supabase.from).mockImplementation(
    () => chain(q.length > 1 ? q.shift()! : q[0] ?? {}) as never,
  )
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const row = (over: Record<string, unknown> = {}) => ({
  data: { id: "asset-1", upload_source: "social_download", created_at: hoursAgo(1), ...over },
  error: null,
})
const none = { count: 0, error: null }

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await mediaDiscardRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function post(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/media/discard", payload: { userId: USER, url: URL, ...body } })
}

describe("POST /v1/media/discard", () => {
  it("401 without a signed-in user", async () => {
    const res = await post({ userId: undefined })
    expect(res.statusCode).toBe(401)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("400 validation_error for a non-URL", async () => {
    const res = await post({ url: "not a url" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("a foreign URL → discarded: false, nothing looked up or touched", async () => {
    const res = await post({ url: "https://elsewhere.example/clip.mp4" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { discarded: false } })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("no row of this user (gone, or someone else's) → discarded: false, untouched", async () => {
    queue({ data: null, error: null })
    const res = await post({})
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { discarded: false } })
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("a plain upload → 409 not_discardable, untouched", async () => {
    queue(row({ upload_source: "manual_upload" }))
    const res = await post({})
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_discardable")
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("older than the window → 409, untouched", async () => {
    expect(DISCARD_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    queue(row({ created_at: hoursAgo(25) }))
    const res = await post({})
    expect(res.statusCode).toBe(409)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("a row with no created_at → 409 (age unknown), untouched", async () => {
    queue(row({ created_at: null }))
    expect((await post({})).statusCode).toBe(409)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("the row lookup fails → 409, untouched (fail safe toward keeping data)", async () => {
    queue({ data: null, error: { message: "boom" } })
    expect((await post({})).statusCode).toBe(409)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("a job's output is the file → 409, untouched", async () => {
    queue(row(), { count: 1, error: null })
    expect((await post({})).statusCode).toBe(409)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("a started run uses it as its videoUrl → 409, untouched", async () => {
    queue(row(), none, { count: 1, error: null })
    expect((await post({})).statusCode).toBe(409)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("a job uses it as its sourceUrl → 409, untouched", async () => {
    queue(row(), none, none, { count: 1, error: null })
    expect((await post({})).statusCode).toBe(409)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("a referrer lookup fails → 409, untouched", async () => {
    queue(row(), { count: null, error: { message: "boom" } })
    expect((await post({})).statusCode).toBe(409)
    expect(deleteSourceAfterProcess).not.toHaveBeenCalled()
  })

  it("a fresh link download nobody uses → discarded through the shared cleanup", async () => {
    queue(row(), none, none, none)
    const res = await post({})
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { discarded: true } })
    expect(deleteSourceAfterProcess).toHaveBeenCalledTimes(1)
    expect(deleteSourceAfterProcess).toHaveBeenCalledWith(URL, USER)
  })

  it("a fresh picture imported from a link nobody uses → discarded", async () => {
    queue(row({ upload_source: "url_import" }), none, none, none)
    expect((await post({})).json()).toEqual({ data: { discarded: true } })
  })

  it("a fresh cut nobody uses → discarded", async () => {
    queue(row({ upload_source: "media_process" }), none, none, none)
    const res = await post({})
    expect(res.json()).toEqual({ data: { discarded: true } })
    expect(deleteSourceAfterProcess).toHaveBeenCalledWith(URL, USER)
  })
})
