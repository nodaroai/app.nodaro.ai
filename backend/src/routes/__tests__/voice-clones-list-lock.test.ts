/**
 * GET /v1/voice-clones under a voice lock: the list offers only the clones the
 * lock would let a run use — a clone whose recorded gender is allowed. One of
 * another gender, or with no recorded gender, is refused at use time
 * (lib/voice-gender.ts), so it is not offered either. Inert with no lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const USER_ID = "00000000-0000-4000-8000-000000000001"

const rows = vi.hoisted(() => [
  { id: "c1", user_id: "u", name: "Him", description: null, elevenlabs_voice_id: "CloneMale000000000001", sample_audio_url: null, preview_url: null, gender: "male", accent: null, created_at: "t", updated_at: "t" },
  { id: "c2", user_id: "u", name: "Her", description: null, elevenlabs_voice_id: "CloneFemale0000000001", sample_audio_url: null, preview_url: null, gender: "female", accent: null, created_at: "t", updated_at: "t" },
  { id: "c3", user_id: "u", name: "Unrecorded", description: null, elevenlabs_voice_id: "CloneNoGender00000001", sample_audio_url: null, preview_url: null, gender: null, accent: null, created_at: "t", updated_at: "t" },
])

vi.mock("@/lib/supabase.js", () => {
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: rows, error: null }) }
  return { supabase: { from: vi.fn(() => chain) } }
})

import { voiceCloneRoutes } from "../voice-clones.js"
import { config } from "@/lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "@/lib/surface-profile.js"

const prevEdition = config.EDITION
let app: FastifyInstance

beforeEach(async () => {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(voiceCloneRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
  config.EDITION = prevEdition
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

async function listedNames(): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: "/v1/voice-clones" })
  expect(res.statusCode).toBe(200)
  return (res.json() as { voiceClones: Array<{ name: string }> }).voiceClones.map((c) => c.name)
}

describe("GET /v1/voice-clones and the voice lock", () => {
  it("lists every clone when no lock is set", async () => {
    expect(await listedNames()).toEqual(["Him", "Her", "Unrecorded"])
  })

  it("under a male-only lock, lists only the clones recorded as male", async () => {
    config.EDITION = "business" // surfaceGateOpen() → true (read live)
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
    __resetSurfaceProfileCacheForTests()

    expect(await listedNames()).toEqual(["Him"])
  })
})
