// @test-reads-none reads only the recordings its media server renders into a temp dir
/**
 * A recording a browser made (MediaRecorder writes WebM live) carries no
 * length in its header. Video SFX and AI Avatar's audio mode measure it the
 * way Trim, Loop and Combine Videos do: from the header when it says, else
 * from the end of the stream's last packet, streamed, under the same guard and
 * the same bounds — so such a file is priced at its real length, never refused
 * as unreadable, and never priced at a guess.
 *
 * Driven through both routes with the REAL probe against a local media host
 * standing in for a public one; only the database, the queue and the credit
 * ledger are stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify, { type FastifyInstance } from "fastify"
import { renderLiveWebm, startMediaServer, type MediaServer } from "../../providers/video/__tests__/probe-media-server.js"
import { probeNetwork } from "../../providers/video/probe-guard.js"

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

import videoSfxRoutes from "../video-sfx.js"
import { aiAvatarRoutes } from "../ai-avatar.js"

let media: MediaServer
let app: FastifyInstance
const at = (path: string) => `http://cdn.test:${media.port}${path}`
const VIDEO_SEC = 12
const SOUND_SEC = 20

const fixtures = { vp8: renderLiveWebm("vp8", VIDEO_SEC), vp9: renderLiveWebm("vp9", VIDEO_SEC), voice: renderLiveWebm("opus", SOUND_SEC) }

beforeAll(async () => {
  media = await startMediaServer()
  media.route("/vp8.webm", { file: fixtures.vp8, type: "video/webm" })
  media.route("/vp9.webm", { file: fixtures.vp9, type: "video/webm" })
  media.route("/voice.webm", { file: fixtures.voice, type: "audio/webm" })
})

afterAll(async () => {
  await media.close()
})

beforeEach(async () => {
  vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1")
  state.guardIds.length = 0
  state.guardedCredits.length = 0
  state.inserts.length = 0
  state.queued.length = 0
  app = Fastify({ logger: false })
  await app.register(async (i) => {
    await videoSfxRoutes(i)
    await aiAvatarRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.restoreAllMocks()
})

describe("a browser recording (no length in its header) is priced at its real length", () => {
  it("the fixtures really carry no length in their header", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-webm-"))
    try {
      for (const [name, file] of Object.entries(fixtures)) {
        const local = join(dir, `${name}.webm`)
        writeFileSync(local, file)
        // A local copy: the media server runs in this process, and a synchronous ffprobe of it would block its answer.
        const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", local], { encoding: "utf8" })
        expect(out.trim(), name).toBe("N/A")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(["/vp8.webm", "/vp9.webm"])("Video SFX: a live %s of 12 s is measured at 12 s (the :15s row), not refused", async (path) => {
    const res = await app.inject({ method: "POST", url: "/v1/video-sfx", payload: { videoUrl: at(path), prompt: "rain" } })
    expect(res.statusCode).toBeLessThan(300)
    expect(state.guardIds).toContain("replicate-mmaudio:15s")
    expect(state.inserts[0]!.input_data).toMatchObject({ duration_seconds: VIDEO_SEC })
  })

  it("AI Avatar, audio mode: a live Opus WebM of 20 s is held at its 30-second bucket, not refused and not the 120 s guess", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: { avatarId: "avatar-123", engine: "avatar-iv", speechMode: "audio", audioUrl: at("/voice.webm"), resolution: "720p", userId: USER },
    })
    expect(res.statusCode).toBeLessThan(300)
    expect(state.guardIds).toContain("heygen-avatar-iv:720p:30s")
  })
})
