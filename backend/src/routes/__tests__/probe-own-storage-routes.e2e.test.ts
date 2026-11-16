// @test-reads-none reads only the clips its media server renders into a temp dir
/**
 * A self-host's own storage sits behind the app's origin on a loopback or
 * private address, which the probe's link guard refuses. Every probing node
 * now reads such a file the one shared way (`readProbeSource`): only a file
 * strictly in this install's storage subtree is downloaded (at most 2 GiB) and
 * probed on disk. Before, only Trim, Loop and Combine Videos did, and Mask
 * Composite, Pitch & Tempo and the other probing nodes refused the run.
 *
 * Driven through two of those routes with the REAL probe (ffprobe, the guard,
 * the download) against a local storage host at `R2_PUBLIC_URL`; only the
 * database, the queue and the credit ledger are stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { renderClip, startMediaServer, type MediaServer } from "../../providers/video/__tests__/probe-media-server.js"

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
import { execFileSync } from "node:child_process"
import { measureVideoUtilityCharge } from "../../lib/video-utility-length.js"
import { MEDIA_LINK_BAD_HOST, NOT_A_MEDIA_FILE } from "../../providers/video/probe-guard.js"

/** The demuxers the installed ffprobe has (Homebrew's has no `dash`). */
const DEMUXERS = new Set(
  execFileSync("ffprobe", ["-hide_banner", "-demuxers"], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => /^\s*D\S*\s+(\S+)/.exec(line)?.[1]?.split(",") ?? []),
)

const STORAGE = "/storage/nodaro-assets"
let media: MediaServer
let app: FastifyInstance
const savedStorage = process.env.R2_PUBLIC_URL
const own = (path: string) => `${media.origin}${STORAGE}${path}`

beforeAll(async () => {
  media = await startMediaServer()
  media.route(`${STORAGE}/videos/fg.mp4`, { file: renderClip("video", 7), type: "video/mp4" })
  media.route(`${STORAGE}/videos/bg.mp4`, { file: renderClip("video", 7), type: "video/mp4" })
  media.route(`${STORAGE}/videos/mask.mp4`, { file: renderClip("video", 7), type: "video/mp4" })
  media.route(`${STORAGE}/audio/voice.mp3`, { file: renderClip("audio", 3), type: "audio/mpeg" })
  media.route("/elsewhere/voice.mp3", { file: renderClip("audio", 3), type: "audio/mpeg" })
  // Files in own storage that are not ordinary media: a GIF saved as a video, and a DASH manifest naming a clip.
  media.route(`${STORAGE}/videos/not-a-video.mp4`, { file: renderClip("gif", 2), type: "video/mp4" })
  media.route(`${STORAGE}/videos/manifest.mp4`, {
    type: "video/mp4",
    text: `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT7S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period><AdaptationSet mimeType="video/mp4"><Representation id="1" bandwidth="1000"><BaseURL>${media.origin}${STORAGE}/videos/fg.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`,
  })
})

afterAll(async () => {
  await media.close()
  if (savedStorage === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedStorage
})

beforeEach(async () => {
  // A self-host: storage at the app's own loopback origin.
  process.env.R2_PUBLIC_URL = `${media.origin}${STORAGE}`
  media.hits.length = 0
  state.guardIds.length = 0
  state.guardedCredits.length = 0
  state.inserts.length = 0
  state.queued.length = 0
  app = Fastify({ logger: false })
  await app.register(async (i) => {
    await maskCompositeRoutes(i)
    await pitchTempoRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

/** The storage host was read by a plain download, never by ffprobe over the network. */
const downloadedOnly = (path: string) => {
  const reads = media.hits.filter((h) => h.path === `${STORAGE}${path}`)
  return reads.length === 1 && reads[0]!.range === undefined && !/^Lavf/.test(reads[0]!.userAgent ?? "")
}

describe("a self-host's own storage, on a private address, is measured on every probing node", () => {
  it("Mask Composite: the foreground in its own storage is measured (7 s → 2 units) and the run is queued", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/mask-composite",
      payload: { foregroundUrl: own("/videos/fg.mp4"), backgroundUrl: own("/videos/bg.mp4"), maskUrl: own("/videos/mask.mp4") },
    })
    expect(res.statusCode).toBe(200)
    expect(state.guardedCredits).toEqual([20])
    expect(state.queued[0]).toMatchObject({ name: "mask-composite", data: { billedUnits: 2 } })
    expect(downloadedOnly("/videos/fg.mp4")).toBe(true)
  })

  it("Pitch & Tempo: the audio in its own storage is measured (3 s → the 1-minute id) and the run is queued", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/pitch-tempo", payload: { audioUrl: own("/audio/voice.mp3"), semitones: 2 } })
    expect(res.statusCode).toBe(200)
    expect(state.guardIds).toContain("pitch-tempo:1m")
    expect(state.inserts[0]!.input_data).toMatchObject({ bucketKey: "pitch-tempo:1m" })
    expect(Number((state.inserts[0]!.input_data as { duration_seconds?: number }).duration_seconds)).toBeCloseTo(3, 0)
    expect(downloadedOnly("/audio/voice.mp3")).toBe(true)
  })

  it("only a file strictly in the subtree: a link the route's schema takes but the strict own-file check does not is refused, nothing read or charged", async () => {
    // `safeUrlSchema` exempts the subtree by prefix; an escape in the path is not
    // strictly a stored file (another reader may decode it), so it is never downloaded.
    const res = await app.inject({ method: "POST", url: "/v1/pitch-tempo", payload: { audioUrl: own("/audio/voice%2Emp3"), semitones: 2 } })
    expect(res.statusCode).toBe(400)
    // Read as any other link on a private address: the link's to fix.
    expect(res.json().error.code).toBe(MEDIA_LINK_BAD_HOST)
    expect(state.inserts).toEqual([])
    expect(media.hits).toEqual([])
  })
})

describe("the local copy of an own-stored file is held to the container rule a link gets", () => {
  it("Mask Composite: an own-stored GIF (or manifest) is refused as not a media file, as on Cloud", async () => {
    for (const path of ["/videos/not-a-video.mp4", ...(DEMUXERS.has("dash") ? ["/videos/manifest.mp4"] : [])]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/mask-composite",
        payload: { foregroundUrl: own(path), backgroundUrl: own("/videos/bg.mp4"), maskUrl: own("/videos/mask.mp4") },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe(NOT_A_MEDIA_FILE.code)
    }
    expect(state.inserts).toEqual([])
  })

  it("Trim: the same through its own measure's fallback", async () => {
    await expect(measureVideoUtilityCharge("trim-video", { videoUrl: own("/videos/not-a-video.mp4"), trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 }))
      .resolves.toMatchObject({ ok: false, code: NOT_A_MEDIA_FILE.code })
  })
})
