import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * GET /v1/shots/:id — a Cine shot's share link — on a deployment that does not
 * allow public outputs (`outputs.allowPublic: false`).
 *
 * The read takes no sign-in: the unguessable id is the capability, and a shot
 * its owner made public (prompt and result links) is read by anyone holding
 * it. Such a deployment has no work shared by link, so every shot reads as a
 * private one does — 404 to everyone but its signed-in owner, with nothing
 * that tells a public shot from a private or missing one. The owner's read is
 * unchanged, and with the switch on nothing changes.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/middleware/rate-limit.js", () => ({ rateLimiter: () => async () => undefined }))

import { shotsRoutes } from "../shots.js"
import { supabase } from "../../lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const ID = "AbCdEfGhIjKl"

function shot(visibility: "public" | "private") {
  return {
    id: ID,
    mode: "single",
    selection_state: {},
    free_text: "a forest at dawn",
    negative_prompt: null,
    assembled_prompt: "a lush forest at dawn",
    per_model_prompts: null,
    models: ["veo3"],
    entity_refs: [],
    result_urls: ["https://cdn.example/forest.mp4"],
    visibility,
    schema_version: 1,
    owner_id: OWNER,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
  }
}

function serve(row: unknown) {
  vi.mocked(supabase.from).mockImplementation((() => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    return { select: vi.fn().mockReturnValue({ eq }) }
  }) as never)
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  setProfile({ outputs: { allowPublic: false } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => { await shotsRoutes(instance) })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
})

const read = (userId?: string) => app.inject({ method: "GET", url: `/v1/shots/${ID}`, headers: userId ? { "x-user-id": userId } : {} })

describe("GET /v1/shots/:id with outputs.allowPublic false", () => {
  it.each([
    ["a signed-out caller", undefined],
    ["a signed-in caller who is not the owner", OTHER],
  ])("%s gets a public shot exactly as a private or missing one", async (_who, userId) => {
    serve(shot("private"))
    const privateShot = await read(userId)
    serve(null)
    const missing = await read(userId)
    serve(shot("public"))
    const publicShot = await read(userId)

    expect(publicShot.statusCode).toBe(404)
    expect(publicShot.body).toBe(privateShot.body)
    expect(publicShot.body).toBe(missing.body)
    expect(publicShot.body).not.toContain("forest")
  })

  it("the signed-in owner still reads it", async () => {
    serve(shot("public"))
    const res = await read(OWNER)
    expect(res.statusCode).toBe(200)
    expect(res.json().shot).toMatchObject({ id: ID, visibility: "public", resultUrls: ["https://cdn.example/forest.mp4"] })
  })
})

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("GET /v1/shots/:id with public outputs allowed: %s", (_label, profile) => {
  beforeEach(() => setProfile(profile))

  it("anyone holding the id reads a public shot as before", async () => {
    serve(shot("public"))
    const res = await read()
    expect(res.statusCode).toBe(200)
    expect(res.json().shot).toMatchObject({ id: ID, freeText: "a forest at dawn", resultUrls: ["https://cdn.example/forest.mp4"] })
  })

  it("a private shot is still the owner's alone", async () => {
    serve(shot("private"))
    expect((await read(OTHER)).statusCode).toBe(404)
    serve(shot("private"))
    expect((await read(OWNER)).statusCode).toBe(200)
  })
})
