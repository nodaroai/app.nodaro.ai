/**
 * POST /v1/voice-changer-pro on a self-hosted install, under that install's own
 * voice lock (`voice.allowedGenders`). The route accepts the conversion and the
 * relay worker replays it on nodaro.ai, whose own route answers to nodaro.ai's
 * lock, not this install's. So every voice the conversion names is judged here
 * by the voice's id alone (lib/voice-gender.ts), before any job row. With no
 * lock nothing is looked up and the request is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const db = vi.hoisted(() => ({
  tables: [] as string[],
  clones: new Map<string, string>(),
  cloneLookupFails: false,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      db.tables.push(table)
      const filters: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        limit: async () => {
          if (db.cloneLookupFails) return { data: null, error: { message: "boom" } }
          const gender = db.clones.get(`${String(filters.user_id)}/${String(filters.elevenlabs_voice_id)}`)
          return { data: gender ? [{ gender }] : [], error: null }
        },
      }
      return chain
    }),
  },
}))
const mocks = vi.hoisted(() => ({
  insertJob: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
  queueAdd: vi.fn().mockResolvedValue({ id: "bull-1" }),
}))
vi.mock("@/lib/nodaro-connect.js", () => ({ isNodaroConnected: vi.fn().mockResolvedValue(true), nodaroCloudFetch: vi.fn() }))
vi.mock("@/providers/nodaro/client.js", () => ({ callCloudRoute: vi.fn(), rehostByteSize: vi.fn() }))
vi.mock("@/workers/shared.js", () => ({ requestJobStop: vi.fn() }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {} }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
// The lock's other lookups: the library record and the live premade catalog
// (each tested in its own module).
const libraryGenders = vi.hoisted(() => new Map<string, string>())
vi.mock("@/lib/library-voice-genders.js", () => ({
  recordedLibraryVoiceGender: vi.fn(async (voiceId: string) => libraryGenders.get(voiceId)),
  recordLibraryVoiceGenders: vi.fn(async () => {}),
}))
vi.mock("@/lib/premade-voice-catalog.js", () => ({ getPremadeVoices: vi.fn(async () => []) }))

import { nodaroExclusiveRoutes } from "../nodaro-exclusive.js"
import { recordedLibraryVoiceGender } from "@/lib/library-voice-genders.js"
import { __resetSurfaceProfileCacheForTests } from "@/lib/surface-profile.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const AUDIO = { audioUrl: "https://example.com/a.mp3" }

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  db.tables.length = 0
  db.clones.clear()
  db.cloneLookupFails = false
  libraryGenders.clear()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await nodaroExclusiveRoutes(instance)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const convert = (orderedVoices: unknown, extra: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: "/v1/voice-changer-pro", payload: { ...AUDIO, orderedVoices, ...extra, userId: USER_ID } })

function maleOnly(): void {
  // Open in the test edition; the profile is read fresh.
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

function expectRefused(res: Awaited<ReturnType<typeof convert>>): void {
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toEqual({ code: "voice_not_available", message: "The selected voice is not available on this deployment." })
  expect(mocks.insertJob).not.toHaveBeenCalled()
  expect(mocks.queueAdd).not.toHaveBeenCalled()
}

describe("POST /v1/voice-changer-pro — the install's voice lock, before the conversion is relayed", () => {
  it("refuses a premade voice of a disallowed gender, by name or by id, as a bare id or a slot object, before any job row", async () => {
    maleOnly()
    for (const slot of ["Rachel", "21m00Tcm4TlvDq8ikWAM", { voiceId: "Rachel" }, { voiceId: "21m00Tcm4TlvDq8ikWAM", engine: "v4" }]) {
      expectRefused(await convert([slot]))
    }
  })

  it("judges every slot, not only the first", async () => {
    maleOnly()
    expectRefused(await convert(["George", null, { voiceId: "Rachel" }]))
  })

  it("refuses a voice it cannot vouch for", async () => {
    maleOnly()
    expectRefused(await convert([{ voiceId: "W3C2vBPukr5b5jvoXhPK" }]))
  })

  it("judges a slot the request drops too: it does not interpret which voices nodaro.ai would use", async () => {
    maleOnly()
    expectRefused(await convert(["George", "Rachel"], { dropSpeakerIndexes: [1] }))
  })

  it("under a lock, refuses a voice list it cannot read: nothing in it can be vouched for", async () => {
    maleOnly()
    for (const orderedVoices of [undefined, "George", { 0: "George" }, [7], [{ voice: "George" }], [{ voiceId: 7 }]]) {
      expectRefused(await convert(orderedVoices))
    }
  })

  it("relays a conversion whose voices are all allowed: premade, a library voice this install listed, the caller's own clone", async () => {
    maleOnly()
    libraryGenders.set("LibMale00000000000001", "male")
    db.clones.set(`${USER_ID}/OwnClone000000000001`, "male")
    const orderedVoices = ["George", { voiceId: "LibMale00000000000001", engine: "v4" }, { voiceId: "OwnClone000000000001" }]

    const res = await convert(orderedVoices)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(mocks.insertJob).toHaveBeenCalledTimes(1)
    expect(mocks.queueAdd).toHaveBeenCalledWith("voice-changer-pro", expect.objectContaining({ orderedVoices, jobId: "job-1" }))
  })

  it("a clone counts only as the caller's own", async () => {
    maleOnly()
    db.clones.set("someone-else/OwnClone000000000001", "male")
    expectRefused(await convert([{ voiceId: "OwnClone000000000001" }]))
  })

  it("does not judge a null slot: that speaker keeps their own voice, and the slot names none", async () => {
    maleOnly()

    const res = await convert(["George", null])

    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1)
  })

  it("a failed lookup is a server error: never an allow, never a refusal that blames the voice", async () => {
    maleOnly()
    db.cloneLookupFails = true

    const res = await convert([{ voiceId: "W3C2vBPukr5b5jvoXhPK" }])

    expect(res.statusCode).toBe(500)
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("with no lock, looks nothing up and relays any voice, and any list the cloud's own schema will judge, as before", async () => {
    for (const orderedVoices of [["Rachel"], undefined, [7]]) {
      const res = await convert(orderedVoices)
      expect(res.statusCode).toBe(200)
    }
    expect(mocks.queueAdd).toHaveBeenCalledTimes(3)
    expect(recordedLibraryVoiceGender).not.toHaveBeenCalled()
    expect(db.tables).toEqual([])
  })

  it("under a lock, leaves the exclusive nodes that name no voice alone", async () => {
    maleOnly()

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-video-pro",
      payload: { videoUrl: "https://example.com/v.mp4", userId: USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1)
    expect(db.tables).toEqual([])
  })
})
