/**
 * POST /v1/text-to-dialogue under a voice lock (`voice.allowedGenders`):
 * every line's voice must be one whose gender the platform can vouch for as
 * allowed, judged by the voice's id alone (lib/voice-gender.ts). Before, only
 * a premade voice NAME was judged, so a library or custom id, or a premade
 * voice sent by its id, went through unjudged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }),
  })
  return { supabase: { from: mockFrom } }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
  speechLengthPricingEnabled: () => false,
}))
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractNodeId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))
// The lock's lookups: the library record and the live premade catalog (each
// tested in its own module). No clone row exists here.
const libraryGenders = vi.hoisted(() => new Map<string, string>())
vi.mock("@/lib/library-voice-genders.js", () => ({
  recordedLibraryVoiceGender: vi.fn(async (voiceId: string) => libraryGenders.get(voiceId)),
  recordLibraryVoiceGenders: vi.fn(async () => {}),
}))
vi.mock("@/lib/premade-voice-catalog.js", () => ({ getPremadeVoices: vi.fn(async () => []) }))

import { textToDialogueRoutes } from "../text-to-dialogue.js"
import { videoQueue } from "@/lib/queue.js"
import { supabase } from "@/lib/supabase.js"
import { recordedLibraryVoiceGender } from "@/lib/library-voice-genders.js"
import { __resetSurfaceProfileCacheForTests } from "@/lib/surface-profile.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
/** The factory's `jobs` insert chain, captured once. */
const jobsTable = vi.mocked(supabase.from).getMockImplementation()!

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  libraryGenders.clear()
  // Nothing is a clone of this user: every voice_clones read finds no row.
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table !== "voice_clones") return jobsTable(table)
    const chain = { select: () => chain, eq: () => chain, limit: async () => ({ data: [], error: null }) }
    return chain
  }) as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => { await textToDialogueRoutes(instance) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const talk = (voices: string[]) =>
  app.inject({
    method: "POST",
    url: "/v1/text-to-dialogue",
    payload: { dialogue: voices.map((voice, i) => ({ text: `Line ${i}.`, voice })), userId: USER_ID },
  })

function maleOnly(): void {
  // The gate is open (config mock: isCloud → true); the profile is read fresh.
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

describe("POST /v1/text-to-dialogue — the voice lock", () => {
  it("refuses a line whose premade voice is of a disallowed gender, by name or by id", async () => {
    maleOnly()
    for (const female of ["Rachel", "21m00Tcm4TlvDq8ikWAM"]) {
      const res = await talk(["George", female])
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toEqual({ code: "voice_not_available", message: "A selected voice is not available on this deployment." })
    }
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses a line whose voice it cannot vouch for", async () => {
    maleOnly()

    const res = await talk(["George", "W3C2vBPukr5b5jvoXhPK"])

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("voice_not_available")
  })

  it("runs a script whose every voice is of an allowed gender, library voices included", async () => {
    maleOnly()
    libraryGenders.set("LibMale00000000000001", "male")

    const res = await talk(["George", "LibMale00000000000001"])

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("with no lock, looks nothing up and runs any voice as before", async () => {
    const res = await talk(["Rachel", "W3C2vBPukr5b5jvoXhPK"])

    expect(res.statusCode).toBe(200)
    expect(recordedLibraryVoiceGender).not.toHaveBeenCalled()
    expect(vi.mocked(supabase.from).mock.calls.map(([table]) => table)).toEqual(["jobs"])
  })
})
