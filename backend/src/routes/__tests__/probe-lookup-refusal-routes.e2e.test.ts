// @test-reads-none reads only the clips its media server renders into a temp dir
/**
 * One meaning for a probe failure that is not about the file itself, on every
 * route that measures a link before its charge (`probeLinkRefusal`):
 * - a host whose lookup failed for now (the resolver timed out or failed, at
 *   the first hop or any later one) → 503 `source_unreachable`, retryable — as
 *   Trim, Loop and Combine Videos already answered;
 * - a host that does not exist → 400, for good.
 * Nothing is reserved either way, and no route prices a fallback length for a
 * link it could not read (Video SFX used to price its 8-second bucket).
 *
 * Driven through Mask Composite, Pitch & Tempo and Video SFX with the REAL
 * probe and a stubbed resolver; the database, the queue and the credit ledger
 * are stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { renderClip, startMediaServer, type MediaServer } from "../../providers/video/__tests__/probe-media-server.js"
import { LINK_HOST_UNREACHABLE, probeNetwork } from "../../providers/video/probe-guard.js"
import { errorResult } from "../../lib/mcp/tools/_verb-helpers.js"

const USER = "00000000-0000-4000-8000-000000000001"
const state = vi.hoisted(() => ({
  guardIds: [] as string[],
  guardedCredits: [] as number[],
  inserts: [] as Array<Record<string, unknown>>,
  queued: [] as Array<{ name: string; data: Record<string, unknown> }>,
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.inserts.push(row)
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) }
      },
    }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  },
}))
vi.mock("../../lib/insert-job.js", () => ({
  insertJob: async (_req: unknown, row: Record<string, unknown>) => {
    state.inserts.push(row)
    return { data: { id: "job-1" }, error: null }
  },
}))
vi.mock("../../lib/queue.js", () => ({
  videoQueue: {
    add: async (name: string, data: Record<string, unknown>) => {
      state.queued.push({ name, data })
      return { id: "q-1" }
    },
  },
  redis: {},
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  // Records what the real guard would price: the id (or its resolver's answer) and the hook's base credits.
  creditGuard: (id: unknown, opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number> }) => async (req: { body: unknown; userId?: string }) => {
    state.guardIds.push(typeof id === "function" ? (id as (r: unknown) => string)(req) : String(id))
    // As the real guard calls it: the body and the request (a measured row lives on the request, never the body).
    if (opts?.computeCredits) state.guardedCredits.push(await opts.computeCredits(req.body, req))
    req.userId = USER
  },
  reserveCreditsForJob: async () => ({ usageLogId: "u-1", creditsReserved: 10, watermark: false }),
}))
vi.mock("../../lib/credit-base-cost.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/credit-base-cost.js")>()
  const baseCreditCostFor = async (id: string) => (id === "mask-composite" ? 10 : 0)
  return {
    ...real,
    baseCreditCostFor,
    unitRateBaseCredits: async (id: string, units: number) => real.quoteBaseCredits(await baseCreditCostFor(id), units),
  }
})
vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { maskCompositeRoutes } from "../mask-composite.js"
import { pitchTempoRoutes } from "../pitch-tempo.js"
import videoSfxRoutes from "../video-sfx.js"

let media: MediaServer
let app: FastifyInstance
const at = (host: string, path: string) => `http://${host}:${media.port}${path}`

beforeAll(async () => {
  media = await startMediaServer()
  media.route("/clip.mp4", { file: renderClip("video", 7), type: "video/mp4" })
  media.route("/clip.mp3", { file: renderClip("audio", 3), type: "audio/mpeg" })
})

afterAll(async () => {
  await media.close()
})

beforeEach(async () => {
  // cdn.test is public (the local server stands in); flaky.test's resolver fails for now; gone.test does not exist.
  vi.spyOn(probeNetwork, "lookup").mockImplementation(async (host: string) => {
    if (host === "flaky.test") throw Object.assign(new Error("getaddrinfo EAI_AGAIN flaky.test"), { code: "EAI_AGAIN" })
    if (host === "gone.test") throw Object.assign(new Error("getaddrinfo ENOTFOUND gone.test"), { code: "ENOTFOUND" })
    return [{ address: "127.0.0.1", family: 4 }]
  })
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1")
  state.guardIds.length = 0
  state.guardedCredits.length = 0
  state.inserts.length = 0
  state.queued.length = 0
  app = Fastify({ logger: false })
  await app.register(async (i) => {
    await maskCompositeRoutes(i)
    await pitchTempoRoutes(i)
    await videoSfxRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.restoreAllMocks()
})

const ROUTES: ReadonlyArray<readonly [name: string, send: (url: string) => Promise<{ statusCode: number; json: () => unknown }>]> = [
  ["Mask Composite", (url) => app.inject({ method: "POST", url: "/v1/mask-composite", payload: { foregroundUrl: url, backgroundUrl: at("cdn.test", "/clip.mp4"), maskUrl: at("cdn.test", "/clip.mp4") } })],
  ["Pitch & Tempo", (url) => app.inject({ method: "POST", url: "/v1/pitch-tempo", payload: { videoUrl: url, semitones: 2 } })],
  ["Video SFX", (url) => app.inject({ method: "POST", url: "/v1/video-sfx", payload: { videoUrl: url, prompt: "rain" } })],
]

/** A route's error code, in either envelope (`{ error: { code } }`, or Video SFX's flat `{ error: code }`). */
const codeOf = (body: unknown): unknown => {
  const error = (body as { error?: unknown }).error
  return typeof error === "string" ? error : (error as { code?: unknown } | undefined)?.code
}

describe("a link whose host could not be looked up for now is the same retryable 503 on every measuring route", () => {
  it.each(ROUTES)("%s: 503 source_unreachable, nothing reserved", async (_name, send) => {
    const res = await send(at("flaky.test", "/clip.mp4"))
    expect(res.statusCode).toBe(503)
    expect(codeOf(res.json())).toBe(LINK_HOST_UNREACHABLE.code)
    expect(state.inserts).toEqual([])
    expect(state.guardedCredits).toEqual([])
  })

  it.each(ROUTES)("%s: a host that does not exist is a 400, for good", async (_name, send) => {
    const res = await send(at("gone.test", "/clip.mp4"))
    expect(res.statusCode).toBe(400)
    expect(codeOf(res.json())).not.toBe(LINK_HOST_UNREACHABLE.code)
    expect(state.inserts).toEqual([])
  })

  it("MCP passes the 503's own message on ('run it again'), not a model-unavailable one", () => {
    const body = JSON.stringify({ error: { code: LINK_HOST_UNREACHABLE.code, message: LINK_HOST_UNREACHABLE.message } })
    expect(errorResult(503, body).content[0]!.text).toContain(LINK_HOST_UNREACHABLE.message)
  })

  it("a reachable link still runs on each route", async () => {
    expect((await ROUTES[0]![1](at("cdn.test", "/clip.mp4"))).statusCode).toBe(200)
    expect((await ROUTES[1]![1](at("cdn.test", "/clip.mp3"))).statusCode).toBe(200)
    expect((await ROUTES[2]![1](at("cdn.test", "/clip.mp4"))).statusCode).toBeLessThan(300)
  })
})
