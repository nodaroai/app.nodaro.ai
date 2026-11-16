// @test-reads-none reads only the clips its media server renders into a temp dir
/**
 * One meaning for a probe failure that is not about the file itself, on every
 * route that measures a link before its charge (`probeLinkRefusal`, and Trim,
 * Loop and Combine Videos' own measure):
 * - a host whose lookup failed for now (the resolver timed out or failed, at
 *   the first hop or any later one) → 503 `source_unreachable`, retryable;
 * - a host that does not exist → 400 `media_link_bad_host`, "its host was not
 *   found", for good;
 * - a host on a private or reserved address, or a link that redirects to one →
 *   400 `media_link_bad_host`, saying the server does not read such an address.
 * Neither 400 reads "the file may be corrupted". Nothing is reserved either
 * way, and no route prices a fallback length for a link it could not read
 * (Video SFX used to price its 8-second bucket).
 *
 * Driven through every measuring route with the REAL probe and a stubbed
 * resolver; the database, the queue and the credit ledger are stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { renderClip, startMediaServer, type MediaServer } from "../../providers/video/__tests__/probe-media-server.js"
import { LINK_HOST_NOT_FOUND, LINK_HOST_UNREACHABLE, LINK_NOT_PUBLIC, MEDIA_LINK_BAD_HOST, probeNetwork } from "../../providers/video/probe-guard.js"
import { errorResult } from "../../lib/mcp/tools/_verb-helpers.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"

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
import { maskEraseRoutes } from "../mask-erase.js"
import { maskOutlineRoutes } from "../mask-outline.js"
import { videoOverlayRoutes } from "../video-overlay.js"
import { videoMaskRoutes } from "../video-mask.js"
import { videoDepthRoutes } from "../video-depth.js"
import { videoFaceMeshRoutes } from "../video-face-mesh.js"
import { videoUpscaleRoutes } from "../video-upscale.js"
import { aiAvatarRoutes } from "../ai-avatar.js"
import { trimVideoRoutes } from "../trim-video.js"
import { loopVideoRoutes } from "../loop-video.js"
import { combineVideosRoutes } from "../combine-videos.js"
import { transcribeRoutes } from "../transcribe.js"
import { addCaptionsRoutes } from "../add-captions.js"

let media: MediaServer
let app: FastifyInstance
const at = (host: string, path: string) => `http://${host}:${media.port}${path}`

beforeAll(async () => {
  media = await startMediaServer()
  media.route("/clip.mp4", { file: renderClip("video", 7), type: "video/mp4" })
  media.route("/clip.mp3", { file: renderClip("audio", 3), type: "audio/mpeg" })
  media.route("/secret.mp4", { file: renderClip("video", 7), type: "video/mp4" })
  // A public link that redirects to a private one: the private host (`intranet.test`) is never read.
  media.route("/to-intranet", { redirect: `http://intranet.test:${media.port}/secret.mp4` })
})

afterAll(async () => {
  await media.close()
})

beforeEach(async () => {
  // cdn.test is public (the local server stands in); flaky.test's resolver fails for now; gone.test does not exist.
  vi.spyOn(probeNetwork, "lookup").mockImplementation(async (host: string) => {
    if (host === "flaky.test") throw Object.assign(new Error("getaddrinfo EAI_AGAIN flaky.test"), { code: "EAI_AGAIN" })
    if (host === "gone.test") throw Object.assign(new Error("getaddrinfo ENOTFOUND gone.test"), { code: "ENOTFOUND" })
    // A public-looking name that resolves to a private address.
    if (host === "intranet.test") return [{ address: "10.0.0.7", family: 4 }]
    return [{ address: "127.0.0.1", family: 4 }]
  })
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1")
  state.guardIds.length = 0
  state.guardedCredits.length = 0
  state.inserts.length = 0
  state.queued.length = 0
  app = Fastify({ logger: false })
  // A stand-in for the auth hook: the user, with the credential kind a request names (the child-only routes take `internal`).
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    const kind = req.headers["x-test-auth"]
    req.authKind = (typeof kind === "string" ? kind : "jwt") as never
  })
  await app.register(async (i) => {
    await maskCompositeRoutes(i)
    await pitchTempoRoutes(i)
    await videoSfxRoutes(i)
    await maskEraseRoutes(i)
    await maskOutlineRoutes(i)
    await videoOverlayRoutes(i)
    await videoMaskRoutes(i)
    await videoDepthRoutes(i)
    await videoFaceMeshRoutes(i)
    await videoUpscaleRoutes(i)
    await aiAvatarRoutes(i)
    await trimVideoRoutes(i)
    await loopVideoRoutes(i)
    await combineVideosRoutes(i)
    await transcribeRoutes(i)
    await addCaptionsRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.restoreAllMocks()
})

type Sent = Promise<{ statusCode: number; json: () => unknown }>
const post = (url: string, payload: Record<string, unknown>): Sent => app.inject({ method: "POST", url, payload })
/** As the plugin's worker-side child request reaches a child-only route: internal, with a parent job in its scope. */
const asChild = (url: string, payload: Record<string, unknown>): Sent =>
  withJobSubmissionContext({ userId: USER, method: "POST", url, parentJobId: "00000000-0000-4000-8000-0000000000aa", trustedPluginCaller: true }, () =>
    app.inject({ method: "POST", url, payload, headers: { "x-test-auth": "internal" } }),
  )
const BOX = { fromFrame: 0, toFrame: 99, leftPct: 10, topPct: 10, rightPct: 40, bottomPct: 50 }

/** Every route that measures a link before its charge, sent `url` where it measures. */
const ROUTES: ReadonlyArray<readonly [name: string, send: (url: string) => Sent]> = [
  ["Mask Composite", (url) => post("/v1/mask-composite", { foregroundUrl: url, backgroundUrl: at("cdn.test", "/clip.mp4"), maskUrl: at("cdn.test", "/clip.mp4") })],
  ["Pitch & Tempo", (url) => post("/v1/pitch-tempo", { videoUrl: url, semitones: 2 })],
  ["Video SFX", (url) => post("/v1/video-sfx", { videoUrl: url, prompt: "rain" })],
  ["Mask Erase", (url) => asChild("/v1/mask-erase", { maskUrl: url, erase: [BOX], forcePrivate: true })],
  ["Mask Outline", (url) => asChild("/v1/mask-outline", { videoUrl: url, maskUrl: at("cdn.test", "/clip.mp4"), outlines: [{ colour: "#FF00FF", boxes: [BOX] }], forcePrivate: true })],
  ["Video Face Mesh", (url) => asChild("/v1/video-face-mesh", { videoUrl: url, forcePrivate: true })],
  ["Video Overlay", (url) => post("/v1/video-overlay", { videoUrl: url, layers: [{ videoUrl: at("cdn.test", "/clip.mp4"), start: 0 }] })],
  ["Video Mask", (url) => post("/v1/video-mask", { videoUrl: url, prompt: "the face" })],
  ["Video Depth", (url) => post("/v1/video-depth", { videoUrl: url })],
  ["Video Upscale (Topaz)", (url) => post("/v1/video-upscale", { provider: "topaz", videoUrl: url, targetResolution: "1080p", targetFps: 30 })],
  ["AI Avatar (audio mode)", (url) => post("/v1/ai-avatar", { speechMode: "audio", audioUrl: url, imageUrl: at("cdn.test", "/clip.png") })],
  ["Trim Video", (url) => post("/v1/trim-video", { videoUrl: url, startTime: 0, endTime: 1 })],
  ["Loop Video", (url) => post("/v1/loop-video", { videoUrl: url, mode: "repeat", repeatCount: 2 })],
  ["Combine Videos", (url) => post("/v1/combine-videos", { videoUrls: [at("cdn.test", "/clip.mp4"), url] })],
]
/** The routes that check the balance at their one-unit floor before they measure, so their guard prices that floor; nothing is reserved either way. */
const FLOOR_FIRST = new Set(["Trim Video", "Loop Video", "Combine Videos"])

/** A route's error code, in either envelope (`{ error: { code } }`, or Video SFX's flat `{ error: code }`). */
const codeOf = (body: unknown): unknown => {
  const error = (body as { error?: unknown }).error
  return typeof error === "string" ? error : (error as { code?: unknown } | undefined)?.code
}

describe("a link whose host could not be looked up for now is the same retryable 503 on every measuring route", () => {
  it.each(ROUTES)("%s: 503 source_unreachable, nothing reserved", async (name, send) => {
    const res = await send(at("flaky.test", "/clip.mp4"))
    expect(res.statusCode).toBe(503)
    expect(codeOf(res.json())).toBe(LINK_HOST_UNREACHABLE.code)
    expect(state.inserts).toEqual([])
    expect(state.queued).toEqual([])
    // Priced only at a route's one-unit floor, never at a measured length.
    expect(state.guardedCredits).toHaveLength(FLOOR_FIRST.has(name) ? 1 : 0)
  })

})

/** A route's error message, in either envelope. */
const messageOf = (body: unknown): unknown => {
  const b = body as { error?: unknown; message?: unknown }
  return typeof b.error === "string" ? b.message : (b.error as { message?: unknown } | undefined)?.message
}

describe("a link whose host the server will not read is its own 400, saying what to fix, on every measuring route", () => {
  it.each(ROUTES)("%s: a host that does not exist is 400 media_link_bad_host, its host was not found", async (_name, send) => {
    const res = await send(at("gone.test", "/clip.mp4"))
    expect(res.statusCode).toBe(400)
    expect(codeOf(res.json())).toBe(MEDIA_LINK_BAD_HOST)
    expect(messageOf(res.json())).toMatch(/its host was not found\. Check the link\.$/)
    expect(state.inserts).toEqual([])
    expect(state.queued).toEqual([])
  })

  it.each(ROUTES)("%s: a host on a private address, and a link that redirects to one, are 400 media_link_bad_host; nothing private is read", async (_name, send) => {
    for (const link of [at("intranet.test", "/secret.mp4"), at("cdn.test", "/to-intranet")]) {
      media.hits.length = 0
      const res = await send(link)
      expect(res.statusCode).toBe(400)
      expect(codeOf(res.json())).toBe(MEDIA_LINK_BAD_HOST)
      expect(messageOf(res.json())).toMatch(/private or reserved address, which the server does not read\. Use a link to a public host, or upload the file\.$/)
      expect(messageOf(res.json())).not.toMatch(/corrupted/)
      expect(media.hits.filter((h) => h.path === "/secret.mp4")).toEqual([])
    }
    expect(state.inserts).toEqual([])
    expect(state.queued).toEqual([])
  })

  it("MCP passes the 400's own code and message on, as it does every 400", () => {
    for (const refusal of [LINK_HOST_NOT_FOUND, LINK_NOT_PUBLIC]) {
      const text = errorResult(400, JSON.stringify({ error: refusal })).content[0]!.text
      expect(text).toContain(`400 ${MEDIA_LINK_BAD_HOST}`)
      expect(text).toContain(refusal.message)
    }
  })
})

/**
 * Transcribe and Add Captions on Nemotron 3.5 Transcribe take only an https
 * link, so their link's host is refused at the first hop (a redirect a probe
 * follows is the same refusal: `nemotron-transcribe-input.test.ts`).
 */
const NEMOTRON_ROUTES: ReadonlyArray<readonly [name: string, send: (url: string) => Sent]> = [
  ["Transcribe (Nemotron)", (url) => post("/v1/transcribe", { audioUrl: url, provider: "nemotron-3-5-transcribe" })],
  ["Add Captions (Nemotron)", (url) => post("/v1/add-captions", { videoUrl: url, style: "word-highlight", transcribe_provider: "nemotron-3-5-transcribe" })],
]

describe("Transcribe and Add Captions on Nemotron answer the same refusals", () => {
  it.each(NEMOTRON_ROUTES)("%s: a host that does not exist and a private address are 400 media_link_bad_host; a failed lookup the retryable 503", async (_name, send) => {
    for (const [host, status, code, message] of [
      ["gone.test", 400, MEDIA_LINK_BAD_HOST, LINK_HOST_NOT_FOUND.message],
      ["intranet.test", 400, MEDIA_LINK_BAD_HOST, LINK_NOT_PUBLIC.message],
      ["flaky.test", 503, LINK_HOST_UNREACHABLE.code, LINK_HOST_UNREACHABLE.message],
    ] as const) {
      const res = await send(`https://${host}/a.mp3`)
      expect(res.statusCode, host).toBe(status)
      expect(codeOf(res.json()), host).toBe(code)
      expect(messageOf(res.json()), host).toBe(message)
    }
    expect(state.inserts).toEqual([])
    expect(state.queued).toEqual([])
  })
})

describe("a reachable link", () => {

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
