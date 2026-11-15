// @test-reads-none reads only the clips its media server renders into a temp dir
/**
 * A probing node takes a link only to an ordinary video or audio file (the
 * owner's decision: refuse remote manifests). A streaming playlist, a stream
 * manifest or a concat script (HLS, DASH, IMF, ffconcat) is refused before
 * anything is charged, with a 400 that says what to do: `media_link_not_a_file`,
 * "…not a streaming playlist. Upload the file instead." MCP forwards a route's
 * 400 message as it is (`errorResult`).
 *
 * Driven through two routes (Mask Composite, Pitch & Tempo) with the REAL probe
 * (ffprobe and the probe guard) against a local media host standing in for a
 * public one; only the database, the queue and the credit ledger are stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import Fastify, { type FastifyInstance } from "fastify"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { renderClip, startMediaServer, type MediaServer } from "../../providers/video/__tests__/probe-media-server.js"
import { NOT_A_MEDIA_FILE, probeNetwork } from "../../providers/video/probe-guard.js"
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
  creditGuard: (id: unknown, opts?: { computeCredits?: (body: unknown) => Promise<number> }) => async (req: { body: unknown; userId?: string }) => {
    state.guardIds.push(typeof id === "function" ? (id as (r: unknown) => string)(req) : String(id))
    if (opts?.computeCredits) state.guardedCredits.push(await opts.computeCredits(req.body))
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

/** The demuxers the installed ffprobe has (a build without libxml2 has no `dash` or `imf`: such a link is then unreadable, never read). */
const DEMUXERS = new Set(
  execFileSync("ffprobe", ["-hide_banner", "-demuxers"], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => /^\s*D\S*\s+(\S+)/.exec(line)?.[1]?.split(",") ?? []),
)

const MANIFESTS: ReadonlyArray<readonly [label: string, path: string, demuxer: string]> = [
  ["an HLS playlist", "/hls.m3u8", "hls"],
  ["a DASH manifest", "/dash.mpd", "dash"],
  ["an IMF composition playlist", "/cpl.xml", "imf"],
  ["a concat script", "/list.ffconcat", "concat"],
]

let media: MediaServer
let app: FastifyInstance
const at = (path: string) => `http://cdn.test:${media.port}${path}`

beforeAll(async () => {
  media = await startMediaServer()
  media.route("/clip.mp4", { file: renderClip("video", 7), type: "video/mp4" })
  media.route("/clip.webm", { file: renderClip("webm", 7), type: "video/webm" })
  media.route("/clip.mp3", { file: renderClip("audio", 3), type: "audio/mpeg" })
  media.route("/hls.m3u8", { type: "application/vnd.apple.mpegurl", text: `#EXTM3U\n#EXT-X-TARGETDURATION:7\n#EXTINF:7,\n${at("/clip.mp4")}\n#EXT-X-ENDLIST\n` })
  media.route("/dash.mpd", {
    type: "application/dash+xml",
    text: `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT7S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period><AdaptationSet mimeType="video/mp4"><Representation id="1" bandwidth="1000"><BaseURL>${at("/clip.mp4")}</BaseURL></Representation></AdaptationSet></Period></MPD>`,
  })
  media.route("/cpl.xml", {
    type: "application/xml",
    text: `<?xml version="1.0" encoding="UTF-8"?><CompositionPlaylist xmlns="http://www.smpte-ra.org/schemas/2067-3/2016"><Id>urn:uuid:aaaaaaaa-0000-0000-0000-000000000001</Id><ContentTitle>t</ContentTitle><EditRate>24 1</EditRate><SegmentList></SegmentList></CompositionPlaylist>`,
  })
  media.route("/list.ffconcat", { type: "text/plain", text: `ffconcat version 1.0\nfile ${at("/clip.mp4")}\n` })
})

afterAll(async () => {
  await media.close()
})

beforeEach(async () => {
  vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1" && isPrivateOrReservedIP(ip))
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
  vi.restoreAllMocks()
})

const maskComposite = (foregroundUrl: string) =>
  app.inject({ method: "POST", url: "/v1/mask-composite", payload: { foregroundUrl, backgroundUrl: at("/clip.mp4"), maskUrl: at("/clip.mp4") } })
const pitchTempo = (url: string, kind: "audioUrl" | "videoUrl" = "audioUrl") =>
  app.inject({ method: "POST", url: "/v1/pitch-tempo", payload: { [kind]: url, semitones: 2 } })

describe("a link to a manifest is refused with the plain 400, before anything is charged", () => {
  it.each(MANIFESTS)("%s: Mask Composite and Pitch & Tempo answer 400 media_link_not_a_file", async (_label, path, demuxer) => {
    for (const res of [await maskComposite(at(path)), await pitchTempo(at(path), "videoUrl")]) {
      expect(res.statusCode).toBe(400)
      // A build that cannot recognise the manifest refuses it as unreadable; the pinned one says what it is.
      if (DEMUXERS.has(demuxer)) expect(res.json().error).toEqual({ code: NOT_A_MEDIA_FILE.code, message: NOT_A_MEDIA_FILE.message })
    }
    expect(state.inserts).toEqual([])
    expect(state.queued).toEqual([])
  })

  it("MCP passes the route's 400 message to the agent as it is", () => {
    const body = JSON.stringify({ error: { code: NOT_A_MEDIA_FILE.code, message: NOT_A_MEDIA_FILE.message } })
    expect(errorResult(400, body).content[0]!.text).toContain(NOT_A_MEDIA_FILE.message)
  })
})

describe("an ordinary media file is still read", () => {
  it("an MP4 or a WebM foreground (7 s → 2 units) and an MP3 (3 s → the 1-minute id)", async () => {
    expect((await maskComposite(at("/clip.mp4"))).statusCode).toBe(200)
    expect((await maskComposite(at("/clip.webm"))).statusCode).toBe(200)
    expect(state.guardedCredits).toEqual([20, 20])
    const res = await pitchTempo(at("/clip.mp3"))
    expect(res.statusCode).toBe(200)
    expect(state.guardIds).toContain("pitch-tempo:1m")
  })
})
