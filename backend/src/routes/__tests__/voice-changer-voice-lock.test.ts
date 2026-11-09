/**
 * POST /v1/voice-changer under a voice lock (`voice.allowedGenders`): the
 * voice a clip is converted INTO must be one whose gender the platform can
 * vouch for as allowed, judged by the voice's id alone (lib/voice-gender.ts),
 * before any job row or reservation. Before, the target voice was not judged
 * at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const db = vi.hoisted(() => ({ inserts: 0, tables: [] as string[] }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      db.tables.push(table)
      if (table === "voice_clones") {
        // Nothing is a clone of this user: every voice_clones read finds no row.
        const chain = { select: () => chain, eq: () => chain, limit: async () => ({ data: [], error: null }) }
        return chain
      }
      return {
        insert: vi.fn(() => {
          db.inserts++
          return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }
        }),
      }
    }),
  },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractNodeId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))
vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  return { ...(await importOriginal<Record<string, unknown>>()), safeUrlSchema: z.string().url() }
})
// The lock's lookups: the library record and the live premade catalog (each
// tested in its own module).
const libraryGenders = vi.hoisted(() => new Map<string, string>())
vi.mock("@/lib/library-voice-genders.js", () => ({
  recordedLibraryVoiceGender: vi.fn(async (voiceId: string) => libraryGenders.get(voiceId)),
  recordLibraryVoiceGenders: vi.fn(async () => {}),
}))
vi.mock("@/lib/premade-voice-catalog.js", () => ({ getPremadeVoices: vi.fn(async () => []) }))

import { voiceChangerRoutes } from "../voice-changer.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"
import { recordedLibraryVoiceGender } from "@/lib/library-voice-genders.js"
import { __resetSurfaceProfileCacheForTests } from "@/lib/surface-profile.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  db.inserts = 0
  db.tables.length = 0
  libraryGenders.clear()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => { await voiceChangerRoutes(instance) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const convert = (voiceId: string, source: Record<string, string> = { audioUrl: "https://example.com/a.mp3" }) =>
  app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...source, voiceId, userId: USER_ID } })

function maleOnly(): void {
  // The gate is open (config mock: isCloud → true); the profile is read fresh.
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

describe("POST /v1/voice-changer — the voice lock judges the target voice", () => {
  it("refuses a premade target voice of a disallowed gender, by name or by id, before any job row or reservation", async () => {
    maleOnly()
    for (const female of ["Rachel", "21m00Tcm4TlvDq8ikWAM"]) {
      const res = await convert(female)
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toEqual({ code: "voice_not_available", message: "The selected voice is not available on this deployment." })
    }
    expect(db.inserts).toBe(0)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses a target voice it cannot vouch for, in video mode too", async () => {
    maleOnly()

    const res = await convert("W3C2vBPukr5b5jvoXhPK", { videoUrl: "https://example.com/clip.mp4" })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("voice_not_available")
    expect(db.inserts).toBe(0)
  })

  it("converts into a voice of an allowed gender, a library voice this deployment listed included", async () => {
    maleOnly()
    libraryGenders.set("LibMale00000000000001", "male")

    for (const voice of ["George", "LibMale00000000000001"]) {
      const res = await convert(voice)
      expect(res.statusCode).toBe(200)
    }
    expect(videoQueue.add).toHaveBeenCalledTimes(2)
    expect(vi.mocked(videoQueue.add).mock.calls[1]![1]).toMatchObject({ voiceId: "LibMale00000000000001" })
  })

  it("with no lock, looks nothing up and converts into any voice as before", async () => {
    const res = await convert("Rachel")

    expect(res.statusCode).toBe(200)
    expect(recordedLibraryVoiceGender).not.toHaveBeenCalled()
    expect(db.tables).toEqual(["jobs"])
  })
})
