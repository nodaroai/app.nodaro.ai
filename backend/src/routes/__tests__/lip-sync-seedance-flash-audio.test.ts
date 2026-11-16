/**
 * Seedance 2.5 Flash takes reference audio as WAV or MP3, 2-30 s a clip and
 * 30 s together (`VIDEO_REF_AUDIO_RULES`), and on Lip Sync its voice line IS
 * its reference audio. /v1/lip-sync holds the line's LENGTH to that rule after
 * the credit guard and before anything is reserved; a line in another format
 * (an M4A) runs, and the provider converts it to MP3 before sending (decided
 * 2026-11-16). Seedance 2.5 (no such rule) is never probed.
 *
 * The real route and the real credit guard (Cloud edition), with the credit
 * check itself replaced by spies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  creditCheck: vi.fn(),
  reserve: vi.fn(),
  insert: vi.fn(),
  queueAdd: vi.fn(),
  probe: vi.fn(),
  reachable: true,
}))
// Whether the provider can fetch our stored files (a converted copy): on, unless a case says not.
vi.mock("@/lib/own-media-reachability.js", () => ({ providersCanFetchOwnMedia: () => h.reachable }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", CHARACTER_LORA_ROUTING_ENABLED: true },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({ insert: h.insert, update: () => ({ eq: async () => ({ error: null }) }) })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))
// The balance check before the audio is measured (lib/lip-sync-floor-check.ts, its own test): the payer can afford it.
vi.mock("@/lib/lip-sync-floor-check.js", () => ({ lipSyncFloorRefusal: async () => undefined }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: h.queueAdd }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  creditGuardImpl: () => h.creditCheck,
  reserveCreditsForJobImpl: h.reserve,
  checkPayerCanAffordImpl: vi.fn(),
  blockPaygOnConsumerSurface: vi.fn(),
  isWebFreeModeCandidate: vi.fn(() => false),
}))

// Lip Sync measures the audio of every model priced by its length before the
// guard (decided 2026-11-13): a 10 s file here, read with no network.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The reference-audio rule's probe: what the voice line measures.
  probeMediaFormatAndDuration: h.probe,
  downloadFile: async (_url: string, path: string) => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
  },
}))
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  measureDecodedAudio: async () => ({ overCap: false, samples: 441_000, seconds: 10 }),
}))

import { lipSyncRoutes } from "../lip-sync.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"

const USER = "00000000-0000-4000-8000-000000000001"
const BODY = {
  imageUrl: "https://cdn.example.com/face.png",
  audioUrl: "https://cdn.example.com/line.m4a",
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.reachable = true
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 8, watermark: false })
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => lipSyncRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const run = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...BODY, ...body } })

describe("/v1/lip-sync holds Seedance 2.5 Flash's voice line to its audio rule", () => {
  it("runs an M4A voice line on Flash (converted to MP3 by the provider, never refused for its format)", async () => {
    h.probe.mockResolvedValue({ formatNames: ["mov", "mp4", "m4a"], durationSec: 6 })
    const res = await run({ provider: "seedance-2-5-flash" })
    expect(res.statusCode).toBe(200)
    expect(h.probe).toHaveBeenCalledWith("https://cdn.example.com/line.m4a")
  })

  it("on an install no provider can fetch from, refuses an M4A voice line on Flash with the format message, before anything is reserved", async () => {
    h.reachable = false
    h.probe.mockResolvedValue({ formatNames: ["mov", "mp4", "m4a"], durationSec: 6 })
    const res = await run({ provider: "seedance-2-5-flash" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_format_unsupported")
    expect(h.reserve).not.toHaveBeenCalled()
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("refuses a voice line under 2 s on Flash before anything is reserved", async () => {
    h.probe.mockResolvedValue({ formatNames: ["mov", "mp4", "m4a"], durationSec: 1.5 })
    const res = await run({ provider: "seedance-2-5-flash" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_too_short")
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("refuses a voice line over 30 s on Flash", async () => {
    h.probe.mockResolvedValue({ formatNames: ["mp3"], durationSec: 31 })
    const res = await run({ provider: "seedance-2-5-flash", audioUrl: "https://cdn.example.com/line.mp3" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_too_long")
  })

  it("runs an MP3 voice line on Flash, priced on Flash's own plain row (no reference video)", async () => {
    h.probe.mockResolvedValue({ formatNames: ["mp3"], durationSec: 6 })
    const res = await run({ provider: "seedance-2-5-flash", audioUrl: "https://cdn.example.com/line.mp3", resolution: "1080p" })
    expect(res.statusCode).toBe(200)
    expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider: "seedance-2-5-flash" })
    // 1080p is not a Flash tier: the top one, 720p, is priced — and sent.
    expect(h.reserve.mock.calls[0]![3]).toBe("seedance-2-5-flash:8s:720p")
  })

  it("never probes the line on Seedance 2.5, which has no such rule", async () => {
    const res = await run({ provider: "seedance-2-5" })
    expect(res.statusCode).toBe(200)
    expect(h.probe).not.toHaveBeenCalled()
  })
})
