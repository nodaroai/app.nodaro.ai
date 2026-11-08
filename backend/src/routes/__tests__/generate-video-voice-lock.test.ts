/**
 * POST /v1/generate-video with a character voice (the `voiced-video` lane)
 * under a voice lock (`voice.allowedGenders`). The run speaks in its cast's
 * voices: on an `audio_driven` model the voices of the lines it voices, on a
 * `native_speech` model the cast's first voice, which the spoken clip is
 * revoiced to. Each must be one whose gender the platform can vouch for as
 * allowed (lib/voice-gender.ts), judged before any job row or reservation.
 * Before, none of them was judged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
          return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-voiced" }, error: null }) }) }
        }),
      }
    }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, probeMediaDuration: vi.fn() }
})
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", ELEVENLABS_API_KEY: "k" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  speechLengthPricingEnabled: () => false,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/video-schemas.js", async () => {
  const { z } = await import("zod")
  return {
    shotsSchema: z.array(z.object({ prompt: z.string(), duration: z.number() })),
    elementsSchema: z.array(z.object({ name: z.string() })),
  }
})
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: vi.fn(async () => ({ creditCost: 10, isEnabled: true, tierRestriction: null })),
}))
// The lock's lookups: the library record and the live premade catalog (each
// tested in its own module).
const libraryGenders = vi.hoisted(() => new Map<string, string>())
vi.mock("@/lib/library-voice-genders.js", () => ({
  recordedLibraryVoiceGender: vi.fn(async (voiceId: string) => libraryGenders.get(voiceId)),
  recordLibraryVoiceGenders: vi.fn(async () => {}),
}))
vi.mock("@/lib/premade-voice-catalog.js", () => ({ getPremadeVoices: vi.fn(async () => []) }))

import { generateVideoRoutes } from "../generate-video.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { recordedLibraryVoiceGender } from "../../lib/library-voice-genders.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"
const GEORGE = { voiceId: "George", speaker: "Bob" } // premade, male
const RACHEL = { voiceId: "Rachel", speaker: "Anna" } // premade, female
const LIB_MALE = { voiceId: "LibMale00000000000001", speaker: "Cal", voiceType: "library" as const }
const UNKNOWN = { voiceId: "W3C2vBPukr5b5jvoXhPK", speaker: "Dee", voiceType: "library" as const }

function voicedBody(provider: string, characterVoices: unknown[], dialogue: Array<{ speaker: string; line: string }>) {
  return { imageUrl: "https://example.com/face.png", prompt: "they talk", userId: USER, provider, duration: 8, characterVoices, dialogue }
}

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
  await app.register(async (i) => { await generateVideoRoutes(i) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

function maleOnly(): void {
  // The gate is open (config mock: isCloud → true); the profile is read fresh.
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

const post = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/generate-video", payload: body })

function expectRefusedBeforeAnything(res: Awaited<ReturnType<typeof post>>): void {
  expect(res.statusCode, res.body).toBe(400)
  expect(res.json().error).toEqual({ code: "voice_not_available", message: "A selected voice is not available on this deployment." })
  expect(db.inserts).toBe(0)
  expect(reserveCreditsForJob).not.toHaveBeenCalled()
  expect(videoQueue.add).not.toHaveBeenCalled()
}

describe("POST /v1/generate-video (voiced) — the voice lock", () => {
  it("audio_driven: refuses when a line is voiced in a voice of a disallowed gender", async () => {
    maleOnly()
    expectRefusedBeforeAnything(await post(voicedBody("seedance-2", [GEORGE, RACHEL], [
      { speaker: "Bob", line: "Hello." },
      { speaker: "Anna", line: "Hi." },
    ])))
  })

  it("audio_driven: refuses a voice it cannot vouch for", async () => {
    maleOnly()
    expectRefusedBeforeAnything(await post(voicedBody("seedance-2", [UNKNOWN], [{ speaker: "Dee", line: "Hello." }])))
  })

  it("audio_driven: judges the voices the run speaks in, so a cast voice with no line is not one of them", async () => {
    maleOnly()
    libraryGenders.set(LIB_MALE.voiceId, "male")

    const res = await post(voicedBody("seedance-2", [GEORGE, LIB_MALE, RACHEL], [
      { speaker: "Bob", line: "Hello." },
      { speaker: "Cal", line: "Hey." },
    ]))

    expect(res.statusCode, res.body).toBe(200)
    expect(vi.mocked(videoQueue.add).mock.calls[0]![0]).toBe("voiced-video")
  })

  it("native_speech: refuses when the voice the spoken clip is revoiced to is of a disallowed gender", async () => {
    maleOnly()
    expectRefusedBeforeAnything(await post(voicedBody("veo3", [RACHEL, GEORGE], [{ speaker: "Bob", line: "Hello." }])))
  })

  it("native_speech: revoices to an allowed first voice", async () => {
    maleOnly()

    const res = await post(voicedBody("veo3", [GEORGE, RACHEL], [{ speaker: "Anna", line: "Hello." }]))

    expect(res.statusCode, res.body).toBe(200)
    expect(vi.mocked(videoQueue.add).mock.calls[0]![0]).toBe("voiced-video")
  })

  it("a model that cannot voice dialogue drops the cast (nothing is spoken in it), so nothing is judged", async () => {
    maleOnly()

    const res = await post(voicedBody("minimax", [RACHEL], [{ speaker: "Anna", line: "Hello." }]))

    expect(res.statusCode, res.body).toBe(200)
    expect(vi.mocked(videoQueue.add).mock.calls[0]![0]).toBe("image-to-video")
    expect(recordedLibraryVoiceGender).not.toHaveBeenCalled()
  })

  it("with no lock, looks nothing up and voices any cast as before", async () => {
    const res = await post(voicedBody("seedance-2", [RACHEL, UNKNOWN], [
      { speaker: "Anna", line: "Hello." },
      { speaker: "Dee", line: "Hi." },
    ]))

    expect(res.statusCode, res.body).toBe(200)
    expect(vi.mocked(videoQueue.add).mock.calls[0]![0]).toBe("voiced-video")
    expect(recordedLibraryVoiceGender).not.toHaveBeenCalled()
    expect(db.tables).not.toContain("voice_clones")
  })
})
