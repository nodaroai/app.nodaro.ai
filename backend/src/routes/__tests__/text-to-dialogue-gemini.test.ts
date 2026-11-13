import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const guardIds = vi.hoisted(() => ({ value: [] as string[] }))

// The mocks of voice-routes-validation.test.ts, verbatim, except the credit
// guard, which records the identifier its resolver returns.
vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }),
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "user-123", tier: "pro" }, error: null }) }) }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  })
  return {
    supabase: {
      from: mockFrom,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // Record what the guard would price, exactly as the real preHandler calls it (raw body, before Zod).
  creditGuard: (resolver: (req: unknown) => string) => async (req: unknown) => { guardIds.value.push(resolver(req)) },
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
  extractProvider: vi.fn((body: any, fallback: string) => body?.provider ?? fallback),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))

// A one-off clone's recordings (lib/voice-replica.ts has its own tests): judged here by a stand-in.
const replicaJudge = vi.hoisted(() => ({ refuse: false }))
vi.mock("@/lib/voice-replica.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/voice-replica.js")>()
  return {
    ...real,
    readReplica: vi.fn(async () => {
      if (replicaJudge.refuse) throw new real.ReplicaRecordingError("replica_not_wav", "consent", "The consent recording must be a WAV file (24 kHz, mono, 16-bit is best)")
      return { source: { bytes: Buffer.alloc(0), seconds: 15 }, consent: { bytes: Buffer.alloc(0), seconds: 6 } }
    }),
  }
})

import { textToDialogueRoutes } from "../text-to-dialogue.js"
import { videoQueue } from "@/lib/queue.js"
import { supabase } from "@/lib/supabase.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

/** The `input_data` the route wrote on the job row (the real insertJob reaches the mocked insert). */
function insertedInputData(): Record<string, unknown> {
  const insert = (supabase.from as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value.insert as ReturnType<typeof vi.fn>
  return insert.mock.calls.at(-1)![0].input_data as Record<string, unknown>
}

const USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  guardIds.value = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => { await textToDialogueRoutes(instance) })
  await app.ready()
})
afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { userId: USER_ID, ...payload } })

describe("POST /v1/text-to-dialogue — Gemini, two speakers (decided 2026-11-12)", () => {
  it("runs on its own model with its fields: priced, reserved and queued as the Gemini model, the job row recording them", async () => {
    const dialogue = [
      { text: "Did it work? [laughs]", voice: "Fola", styleDirection: "Excited host" },
      { text: "It did.", voice: "Puck" },
    ]
    const res = await post({ provider: "gemini-3-8-flash-tts", dialogue, fillerWords: true })
    expect(res.statusCode).toBe(200)
    expect(guardIds.value).toEqual(["gemini-3-8-flash-tts"])
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "gemini-3-8-flash-tts")
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-dialogue", expect.objectContaining({ provider: "gemini-3-8-flash-tts", dialogue, fillerWords: true }))
    expect(insertedInputData()).toMatchObject({ provider: "gemini-3-8-flash-tts", resolvedModel: "gemini-3-8-flash-tts", dialogue, fillerWords: true })
  })

  it("3.1: each speaker's direction rides to the worker", async () => {
    const speakers = [{ voice: "Kore", styleDirection: "Vocal Smile", pace: "Rapid Fire", accent: "American (Gen)" }, { voice: "Puck", audioProfile: "A tired engineer" }]
    const res = await post({ provider: "gemini-3-1-flash-tts", dialogue: [{ text: "Hi.", voice: "Kore" }, { text: "Hey.", voice: "Puck" }], speakers })
    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-dialogue", expect.objectContaining({ speakers }))
  })

  it("one speaker runs too", async () => {
    const res = await post({ provider: "gemini-2-5-pro-tts", dialogue: [{ text: "Just me.", voice: "Kore" }] })
    expect(res.statusCode).toBe(200)
  })

  it("refuses before any hold: a third voice, a voice not of the model, a line style too long, a speaker's choice not on its list", async () => {
    const three = await post({ provider: "gemini-3-8-flash-tts", dialogue: [{ text: "a", voice: "Fola" }, { text: "b", voice: "Puck" }, { text: "c", voice: "Kore" }] })
    expect(three.statusCode).toBe(400)
    expect(three.body).toContain("at most 2 unique voices")
    const foreign = await post({ provider: "gemini-3-1-flash-tts", dialogue: [{ text: "a", voice: "Kore" }, { text: "b", voice: "Rachel" }] })
    expect(foreign.statusCode).toBe(400)
    expect(foreign.body).toContain("Rachel is not a voice of gemini-3-1-flash-tts")
    const style = await post({ provider: "gemini-3-8-flash-lite-tts", dialogue: [{ text: "a", voice: "Fola", styleDirection: "x".repeat(1001) }] })
    expect(style.statusCode).toBe(400)
    const pace = await post({ provider: "gemini-3-1-flash-tts", dialogue: [{ text: "a", voice: "Kore" }], speakers: [{ voice: "Kore", pace: "Warp" }] })
    expect(pace.statusCode).toBe(400)
    expect(pace.body).toContain("pace must be one of")
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("the total cap is measured as the model takes each line: on 3.8 after its tags are rewritten", async () => {
    // 1,250 × " [pause]" is 10,000 characters as written and 17,500 once each tag is 3.8's <short pause>.
    const grown = " [pause]".repeat(1250)
    const res = await post({ provider: "gemini-3-8-flash-tts", dialogue: [{ text: grown, voice: "Fola" }] })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("Total dialogue text must not exceed 10000 characters")
    // On 3.1, which keeps its [square] tags as written, the same script is exactly the cap.
    const kept = await post({ provider: "gemini-3-1-flash-tts", dialogue: [{ text: grown, voice: "Kore" }] })
    expect(kept.statusCode).toBe(200)
  })

  it("ElevenLabs dialogue keeps its ten voices and its own fields; the Gemini fields are not sent to it", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ text: `l${i}`, voice: `v${i}` }))
    expect((await post({ dialogue: lines })).statusCode).toBe(200)
    const eleven = await post({ dialogue: [...lines, { text: "x", voice: "v10" }] })
    expect(eleven.statusCode).toBe(400)
    expect(eleven.body).toContain("at most 10 unique voices")
  })
})

describe("POST /v1/text-to-dialogue — the file (decided 2026-11-13)", () => {
  it("a Gemini model takes any speech file format and passes it to the worker; none asked is none sent", async () => {
    const ok = await post({ provider: "gemini-3-1-flash-tts", dialogue: [{ text: "Hi.", voice: "Kore" }], outputFormat: "wav_24000" })
    expect(ok.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("text-to-dialogue", expect.objectContaining({ outputFormat: "wav_24000" }))
    await post({ provider: "gemini-3-1-flash-tts", dialogue: [{ text: "Hi.", voice: "Kore" }] })
    expect((vi.mocked(videoQueue.add).mock.calls.at(-1)![1] as Record<string, unknown>).outputFormat).toBeUndefined()
  })

  it("an ElevenLabs dialogue model delivers the default MP3 only: another format is refused before any hold, the default is accepted", async () => {
    const wav = await post({ dialogue: [{ text: "Hi.", voice: "Rachel" }], outputFormat: "wav_24000" })
    expect(wav.statusCode).toBe(400)
    expect(wav.body).toContain("outputFormat on elevenlabs-dialogue must be one of: mp3_44100_128")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect((await post({ dialogue: [{ text: "Hi.", voice: "Rachel" }], outputFormat: "mp3_44100_128" })).statusCode).toBe(200)
  })
})

describe("POST /v1/text-to-dialogue — a cloned speaker (replica, decided 2026-11-13)", () => {
  const REPLICA = { sourceAudioUrl: "https://media.example/s.wav", consentAudioUrl: "https://media.example/c.wav", consent: true }
  afterEach(() => {
    replicaJudge.refuse = false
  })

  it("3.8 Flash: a label spoken in the cloned voice beside a named one; recordings judged, sent, and kept off the job row", async () => {
    const dialogue = [{ text: "Hi, it's me.", voice: "Me" }, { text: "Hey.", voice: "Puck" }]
    const speakers = [{ voice: "Me", replica: REPLICA }]
    const res = await post({ provider: "gemini-3-8-flash-tts", dialogue, speakers })
    expect(res.statusCode).toBe(200)
    const { readReplica } = await import("../../lib/voice-replica.js")
    expect(vi.mocked(readReplica)).toHaveBeenCalledWith({ sourceAudioUrl: REPLICA.sourceAudioUrl, consentAudioUrl: REPLICA.consentAudioUrl })
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-dialogue", expect.objectContaining({ speakers }))
    const row = insertedInputData()
    expect(JSON.stringify(row)).not.toContain("media.example")
    expect(row.speakers).toEqual([{ voice: "Me", oneOffClone: true }])
  })

  it("a model that does not clone refuses a cloned speaker; so does 3.8 Flash-Lite", async () => {
    for (const provider of ["gemini-3-8-flash-lite-tts", "gemini-2-5-pro-tts"]) {
      const res = await post({ provider, dialogue: [{ text: "Hi.", voice: "Kore" }], speakers: [{ voice: "Kore", replica: REPLICA }] })
      expect(res.statusCode, provider).toBe(400)
      expect(res.body).toContain("does not clone a voice")
    }
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("a cloned speaker without the caller's consent is a 400 before anything is read or held", async () => {
    const res = await post({ provider: "gemini-3-8-flash-tts", dialogue: [{ text: "Hi.", voice: "Me" }], speakers: [{ voice: "Me", replica: { ...REPLICA, consent: undefined } }] })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("replica.consent must be true")
    const { readReplica } = await import("../../lib/voice-replica.js")
    expect(vi.mocked(readReplica)).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("a recording the platform cannot take is a 400 with its sentence, before any hold", async () => {
    replicaJudge.refuse = true
    const res = await post({ provider: "gemini-3-8-flash-tts", dialogue: [{ text: "Hi.", voice: "Me" }], speakers: [{ voice: "Me", replica: REPLICA }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("replica_not_wav")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

describe("POST /v1/text-to-dialogue — a speaker listed twice (decided 2026-11-13)", () => {
  it("is a 400 naming the voice, before any hold", async () => {
    const res = await post({
      provider: "gemini-3-1-flash-tts",
      dialogue: [{ text: "Hi.", voice: "Kore" }],
      speakers: [{ voice: "Kore", pace: "Natural" }, { voice: "Kore", pace: "Staccato" }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('speakers lists the voice \\"Kore\\" more than once')
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

