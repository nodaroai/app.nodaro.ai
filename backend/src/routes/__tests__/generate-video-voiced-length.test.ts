/**
 * The voiced-video audio add-on on `POST /v1/generate-video`: while
 * SPEECH_LENGTH_PRICING_ENABLED is on, an audio_driven run reserves the add-on
 * by length on the row of the model actually synthesised, and the SAME number
 * rides the queue as `voicedAudioAddon` (what the worker commits or refunds).
 * Flag off: the flat dialogue row at both sites, as today. The flag is read at
 * call time here, so each describe registers its own app under its own value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

type ComputeCredits = (body: unknown, req: unknown) => number | Promise<number>

const flag = vi.hoisted(() => ({ on: false }))
const guard = vi.hoisted(() => ({ pending: [] as Array<{ computeCredits?: ComputeCredits } | undefined> }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) } },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (_resolver: unknown, opts?: { computeCredits?: ComputeCredits }) => {
    guard.pending.push(opts)
    return async () => {}
  },
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
  speechLengthPricingEnabled: () => flag.on,
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

/** The seeded video composite answers VIDEO_BASE; the speech rows are the plan's. */
const VIDEO_BASE = 100
const ROWS: Record<string, number> = {
  "elevenlabs-dialogue": 25,
  "elevenlabs-dialogue-v4": 25,
  "elevenlabs-voice-changer": 40,
  "elevenlabs-v4:per-100-chars": 4,
  "elevenlabs-turbo:per-100-chars": 2,
  "elevenlabs-dialogue:per-100-chars": 4,
  "elevenlabs-dialogue-v4:per-100-chars": 4,
}
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: vi.fn(async (id: string) => ({ creditCost: ROWS[id] ?? VIDEO_BASE, isEnabled: true, tierRestriction: null })),
}))

import { generateVideoRoutes } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { getModelCreditBaseCost } from "../../ee/billing/credits.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ANNA = { voiceId: "anna-voice", ttsProvider: "elevenlabs-v4", speaker: "Anna" }
const BOB = { voiceId: "bob-voice", speaker: "Bob" }
const CARA = { voiceId: "cara-voice", ttsProvider: "elevenlabs-v4", speaker: "Cara" }
/** The route caps a line at 500 characters; longer scripts are more lines. */
const line = (speaker: string, chars: number) => ({ speaker, line: "a".repeat(chars) })
/** Ten 500-character lines, Anna and Bob alternating: a 5,000-character two-voice script. */
const TEN_LINES = Array.from({ length: 10 }, (_, i) => line(i % 2 === 0 ? "Anna" : "Bob", 500))

function voicedBody(characterVoices: unknown[], dialogue: Array<{ speaker: string; line: string }>) {
  return { imageUrl: "https://example.com/face.png", prompt: "she greets the room", userId: USER, provider: "seedance-2", duration: 8, characterVoices, dialogue }
}

let app: FastifyInstance
let computeCredits: ComputeCredits

async function registerWith(on: boolean) {
  flag.on = on
  guard.pending.length = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (i) => { await generateVideoRoutes(i) })
  await app.ready()
  const withCompute = guard.pending.filter((o) => typeof o?.computeCredits === "function")
  expect(withCompute).toHaveLength(1)
  computeCredits = withCompute[0]!.computeCredits!
}

function mockJobInsert(id: string) {
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null })
  vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }) } as never)
}

async function post(body: Record<string, unknown>) {
  mockJobInsert("job-voiced")
  const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: body })
  expect(res.statusCode, res.body).toBe(200)
  const call = vi.mocked(videoQueue.add).mock.calls.at(-1)!
  expect(call[0]).toBe("voiced-video")
  return call[1] as { voicedAudioAddon?: number; dialogueProvider?: string }
}

afterEach(async () => { await app?.close() })
beforeEach(() => { vi.clearAllMocks() })

describe("flag ON — the audio_driven add-on is by length on the model actually synthesised", () => {
  beforeEach(async () => { await registerWith(true) })

  it.each([
    // Two 500-character lines on one voice are sent joined by a space: 1,001 characters → 11 units × 4.
    ["a sole v4 voice, two 500-character lines → 11 units × 4", [ANNA], [line("Anna", 500), line("Anna", 500)], 44],
    ["a sole voice naming no model runs as turbo, 100 characters → the 8-unit minimum × 2", [BOB], [line("Bob", 100)], 16],
    ["a two-voice cast is a dialogue track, 5,000 characters → 50 units × 4", [ANNA, BOB], TEN_LINES, 200],
  ])("%s: the guard reserves it and the queue carries the same number", async (_label, voices, dialogue, addon) => {
    const body = voicedBody(voices, dialogue)
    expect(await computeCredits(body, {})).toBe(VIDEO_BASE + addon)
    expect((await post(body)).voicedAudioAddon).toBe(addon)
  })

  it("a multi-voice cast whose every voice is on v4 is priced on the v4 dialogue unit row, and the queue forwards the same model (5,000 characters → 50 units × 4)", async () => {
    const dialogue = Array.from({ length: 10 }, (_, i) => line(i % 2 === 0 ? "Anna" : "Cara", 500))
    const body = voicedBody([ANNA, CARA], dialogue)
    expect(await computeCredits(body, {})).toBe(VIDEO_BASE + 200)
    expect(getModelCreditBaseCost).toHaveBeenCalledWith("elevenlabs-dialogue-v4:per-100-chars")
    expect(getModelCreditBaseCost).not.toHaveBeenCalledWith("elevenlabs-dialogue:per-100-chars")
    const queued = await post(body)
    expect(queued.voicedAudioAddon).toBe(200)
    expect(queued.dialogueProvider).toBe("elevenlabs-dialogue-v4")
  })

  it("a mixed cast (one voice names no model) stays on v3 dialogue's unit row", async () => {
    const body = voicedBody([ANNA, BOB], TEN_LINES)
    expect(await computeCredits(body, {})).toBe(VIDEO_BASE + 200)
    expect(getModelCreditBaseCost).toHaveBeenCalledWith("elevenlabs-dialogue:per-100-chars")
    expect(getModelCreditBaseCost).not.toHaveBeenCalledWith("elevenlabs-dialogue-v4:per-100-chars")
    expect((await post(body)).dialogueProvider).toBe("elevenlabs-dialogue")
  })

  it("a hostile pre-Zod body never makes the guard reject: it prices the floor, and Zod then answers 400", async () => {
    const hostile = { ...voicedBody([{ voiceId: "anna-voice", speaker: 7 }], []), dialogue: [{ speaker: "Anna", line: 5 }, null, "x"] }
    await expect(computeCredits(hostile, {})).resolves.toBe(VIDEO_BASE + 16) // no usable line → turbo's 8-unit floor
    mockJobInsert("never-inserted")
    const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: hostile })
    expect(res.statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("native_speech (VEO) is unchanged: the flat voice-changer row", async () => {
    const body = { ...voicedBody([ANNA], [line("Anna", 400)]), provider: "veo3.1" }
    expect(await computeCredits(body, {})).toBe(VIDEO_BASE + 40)
    expect((await post(body)).voicedAudioAddon).toBe(40)
  })
})

describe("flag OFF — today's flat dialogue row at both sites", () => {
  beforeEach(async () => { await registerWith(false) })

  it("reserves and forwards 25 whatever the lines", async () => {
    const body = voicedBody([ANNA, BOB], TEN_LINES)
    expect(await computeCredits(body, {})).toBe(VIDEO_BASE + 25)
    expect((await post(body)).voicedAudioAddon).toBe(25)
  })

  it("a v4 cast reserves and forwards the same flat 25, read on the v4 dialogue model's row", async () => {
    const body = voicedBody([ANNA, CARA], TEN_LINES.map((l, i) => ({ ...l, speaker: i % 2 === 0 ? "Anna" : "Cara" })))
    expect(await computeCredits(body, {})).toBe(VIDEO_BASE + 25)
    expect(getModelCreditBaseCost).toHaveBeenCalledWith("elevenlabs-dialogue-v4")
    const queued = await post(body)
    expect(queued.voicedAudioAddon).toBe(25)
    expect(queued.dialogueProvider).toBe("elevenlabs-dialogue-v4")
  })
})
