import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("../../../config.js", () => ({
  config: { INTERNAL_ORCHESTRATOR_SECRET: "test-secret" },
  hasCredits: () => true,
  hasAdmin: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))

const { registerLocationTools } = await import("../locations.js")
const { supabase } = await import("../../../supabase.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const ALLEY_ID = "11111111-1111-4111-8111-111111111111"
const ROOFTOP_ID = "22222222-2222-4222-8222-222222222222"
const CANDIDATE_JOB_ID = "00000000-0000-0000-0000-000000000099"

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Chainable supabase stub. Every builder method returns `this`; `maybeSingle`
 * and `single` resolve `result`, and the builder itself is awaitable for the
 * list path (`select → eq → not/is → order` resolves the array). Mirrors the
 * pattern used in `characters.test.ts`.
 */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of [
    "select",
    "eq",
    "is",
    "not",
    "order",
    "limit",
    "insert",
    "update",
    "filter",
  ]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return obj
}

function readSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read"] as Scope[],
    clientName: "Claude",
  })
}

function writeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read", "assets:write"] as Scope[],
    clientName: "Claude",
  })
}

function executeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read", "assets:write", "workflows:execute"] as Scope[],
    clientName: "Claude",
  })
}

// ── list_locations ──────────────────────────────────────────────────────────

describe("list_locations tool", () => {
  it("returns the caller's locations scoped by user_id with asset counts", async () => {
    const builder = chain({
      data: [
        {
          id: ALLEY_ID,
          name: "Rainy Tokyo Alley",
          description: "narrow neon-lit alley after rain",
          canonical_description: "moody cinematic urban exterior",
          source_image_url: "https://example.com/alley.png",
          category: "exterior",
          style: "cinematic",
          style_lock: true,
          time_of_day: [
            { name: "night", url: "https://example.com/alley-night.png" },
            { name: "dusk", url: "https://example.com/alley-dusk.png" },
          ],
          weather: [{ name: "rain", url: "https://example.com/alley-rain.png" }],
          angles: null,
          lighting: [],
          seasons: [],
          atmosphere_motions: [],
          updated_at: "2026-05-10T00:00:00Z",
        },
        {
          id: ROOFTOP_ID,
          name: "Rooftop",
          description: null,
          canonical_description: null,
          source_image_url: null,
          category: null,
          style: null,
          style_lock: false,
          time_of_day: [],
          weather: [],
          angles: [],
          lighting: [],
          seasons: [],
          atmosphere_motions: [],
          updated_at: "2026-05-09T00:00:00Z",
        },
      ],
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerLocationTools({ server, session: readSession() })
    const result = await callTool(server, "list_locations", {})
    expect(result.isError).toBeUndefined()

    // Critical: scoped to caller's user_id and excludes archived.
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
    const isMock = builder.is as ReturnType<typeof vi.fn>
    expect(isMock).toHaveBeenCalledWith("deleted_at", null)

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: Array<{
        id: string
        name: string
        sourceImageUrl: string | null
        assetCounts: Record<string, number>
      }>
    }
    expect(payload.data).toHaveLength(2)
    expect(payload.data[0]).toMatchObject({
      id: ALLEY_ID,
      name: "Rainy Tokyo Alley",
      sourceImageUrl: "https://example.com/alley.png",
      assetCounts: {
        timeOfDay: 2,
        weather: 1,
        angles: 0, // null tolerated
        lighting: 0,
        seasons: 0,
        atmosphereMotions: 0,
      },
    })
    expect(payload.data[1].id).toBe(ROOFTOP_ID)
  })

  it("flips the filter to archived when archived=true", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerLocationTools({ server, session: readSession() })
    await callTool(server, "list_locations", { archived: true })

    // `not("deleted_at", "is", null)` — archived view.
    const notMock = builder.not as ReturnType<typeof vi.fn>
    expect(notMock).toHaveBeenCalledWith("deleted_at", "is", null)
  })

  it("returns isError on supabase error", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: "boom" } }))
    const server = buildServer()
    registerLocationTools({ server, session: readSession() })
    const result = await callTool(server, "list_locations", {})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("boom")
  })
})

// ── get_location ────────────────────────────────────────────────────────────

describe("get_location tool", () => {
  it("returns full detail for an owned location", async () => {
    const builder = chain({
      data: {
        id: ALLEY_ID,
        name: "Rainy Tokyo Alley",
        description: "narrow neon-lit alley",
        canonical_description: "moody cinematic urban exterior",
        source_image_url: "https://example.com/alley.png",
        category: "exterior",
        style: "cinematic",
        style_lock: true,
        time_of_day: [{ name: "night", url: "https://example.com/alley-night.png" }],
        weather: [{ name: "rain", url: "https://example.com/alley-rain.png" }],
        angles: [],
        lighting: [],
        seasons: [],
        atmosphere_motions: [],
        reference_photos: [
          { url: "https://example.com/ref1.jpg", kind: "moodBoard" },
        ],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-05-10T00:00:00Z",
      },
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerLocationTools({ server, session: readSession() })
    const result = await callTool(server, "get_location", { id: ALLEY_ID })
    expect(result.isError).toBeUndefined()

    // Scoped by id + user_id + not archived.
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("id", ALLEY_ID)
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
    const isMock = builder.is as ReturnType<typeof vi.fn>
    expect(isMock).toHaveBeenCalledWith("deleted_at", null)

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: {
        id: string
        name: string
        sourceImageUrl: string
        timeOfDay: Array<{ name: string; url: string }>
        referencePhotos: Array<{ url: string; kind: string }>
      }
    }
    expect(payload.data.id).toBe(ALLEY_ID)
    expect(payload.data.name).toBe("Rainy Tokyo Alley")
    expect(payload.data.timeOfDay).toHaveLength(1)
    expect(payload.data.referencePhotos[0]).toEqual({
      url: "https://example.com/ref1.jpg",
      kind: "moodBoard",
    })
  })

  it("returns isError 'not found' for unknown id", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const server = buildServer()
    registerLocationTools({ server, session: readSession() })
    const result = await callTool(server, "get_location", { id: ROOFTOP_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })
})

// ── create_location ─────────────────────────────────────────────────────────

describe("create_location tool", () => {
  it("inserts a new row scoped to the session user and returns the new id", async () => {
    const builder = chain({
      data: { id: ALLEY_ID, name: "Rainy Tokyo Alley" },
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "create_location", {
      name: "Rainy Tokyo Alley",
      description: "narrow neon-lit alley",
      category: "exterior",
      style: "cinematic",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.id).toBe(ALLEY_ID)

    const insertMock = builder.insert as ReturnType<typeof vi.fn>
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(row.user_id).toBe("u1")
    expect(row.node_id).toBe("mcp-managed")
    expect(row.name).toBe("Rainy Tokyo Alley")
    expect(row.description).toBe("narrow neon-lit alley")
    expect(row.category).toBe("exterior")
    expect(row.style).toBe("cinematic")
    // Asset buckets default to empty arrays.
    expect(row.time_of_day).toEqual([])
    expect(row.weather).toEqual([])
    expect(row.angles).toEqual([])
    expect(row.style_lock).toBe(true)
  })

  it("does NOT register without assets:write scope", async () => {
    const server = buildServer()
    registerLocationTools({ server, session: readSession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("create_location")
  })
})

// ── update_location ─────────────────────────────────────────────────────────

describe("update_location tool", () => {
  it("writes only the supplied fields and scopes the UPDATE by user_id", async () => {
    const builder = chain({
      data: { id: ALLEY_ID, name: "Alley Updated", updated_at: "2026-05-11T00:00:00Z" },
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "update_location", {
      id: ALLEY_ID,
      name: "Alley Updated",
      description: "new notes",
    })

    expect(result.isError).toBeUndefined()
    const updateMock = builder.update as ReturnType<typeof vi.fn>
    expect(updateMock).toHaveBeenCalledTimes(1)
    const patch = updateMock.mock.calls[0][0] as Record<string, unknown>
    expect(patch.name).toBe("Alley Updated")
    expect(patch.description).toBe("new notes")
    expect(patch.category).toBeUndefined()
    expect(patch.style).toBeUndefined()
    expect(patch.updated_at).toEqual(expect.any(String))

    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
  })

  it("rejects a payload with no fields besides id", async () => {
    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "update_location", { id: ALLEY_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("Nothing to update")
  })

  it("enforces optimistic concurrency when expectedUpdatedAt is supplied", async () => {
    const builder = chain({ data: null, error: null })
    fromMock.mockReturnValueOnce(builder)

    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "update_location", {
      id: ALLEY_ID,
      name: "Stale",
      expectedUpdatedAt: "2026-05-10T00:00:00Z",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("modified since")

    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("updated_at", "2026-05-10T00:00:00Z")
  })
})

// ── destructive tools are intentionally NOT exposed via MCP ─────────────────
//
// `delete_location` and `restore_location` are explicitly absent from the
// MCP surface — destructive (or destructive-adjacent) operations driven by an
// LLM are too risky. Users still archive + restore through REST/SDK/CLI; see
// `scope gating` block below for the actual absence assertions.

// ── approve_main_image ──────────────────────────────────────────────────────

describe("approve_main_image tool", () => {
  it("proxies to /v1/locations/:id/approve-main-image with candidate_job_id", async () => {
    const fastify = Fastify()
    const MAIN_URL = "https://r2/main.png"
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/locations/:id/approve-main-image", async (req) => {
      received = req.body as Record<string, unknown>
      return { sourceImageUrl: MAIN_URL, canonicalDescription: "cinematic alley scene" }
    })

    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "approve_main_image", {
      location_id: ALLEY_ID,
      candidate_job_id: CANDIDATE_JOB_ID,
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.sourceImageUrl).toBe(MAIN_URL)
    expect(result.structuredContent?.canonicalDescription).toBe(
      "cinematic alley scene",
    )
    expect(received?.candidateJobId).toBe(CANDIDATE_JOB_ID)
    expect(received?.userId).toBe("u1")
  })

  it("surfaces 400 errors from the route", async () => {
    const fastify = Fastify()
    fastify.post("/v1/locations/:id/approve-main-image", async (_req, reply) => {
      return reply
        .status(400)
        .send({ error: { code: "candidate_not_completed", message: "Not done" } })
    })

    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "approve_main_image", {
      location_id: ALLEY_ID,
      candidate_job_id: CANDIDATE_JOB_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("candidate_not_completed")
  })
})

// ── recaption_location ──────────────────────────────────────────────────────

describe("recaption_location tool", () => {
  it("proxies to /v1/locations/:id/llm-caption", async () => {
    const fastify = Fastify()
    fastify.post("/v1/locations/:id/llm-caption", async () => {
      return { canonicalDescription: "fresh caption" }
    })

    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "recaption_location", {
      location_id: ALLEY_ID,
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.canonicalDescription).toBe("fresh caption")
  })

  it("surfaces 502 LLM failures from the route", async () => {
    const fastify = Fastify()
    fastify.post("/v1/locations/:id/llm-caption", async (_req, reply) => {
      return reply
        .status(502)
        .send({ error: { code: "caption_failed", message: "LLM failed" } })
    })

    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "recaption_location", {
      location_id: ALLEY_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("caption_failed")
  })
})

// ── generate_location_motion ────────────────────────────────────────────────

describe("generate_location_motion tool", () => {
  const MOTION_SOURCE_URL = "https://r2/locations/alley-main.png"

  it("proxies to /v1/generate-location-motion with motion + provider + attach fields", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/generate-location-motion", async (req) => {
      received = req.body as Record<string, unknown>
      return { jobId: "job-loc-motion-1" }
    })

    const server = buildServer()
    registerLocationTools({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_location_motion", {
      motion_prompt: "slow dolly-in",
      source_image_url: MOTION_SOURCE_URL,
      provider: "kling",
      name: "Rainy Tokyo Alley",
      category: "exterior",
      style: "realistic",
      canonical_description: "moody cinematic urban exterior",
      attach_to_location_id: ALLEY_ID,
      attach_name: "dolly-in",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.jobId).toBe("job-loc-motion-1")
    expect(received?.motionPrompt).toBe("slow dolly-in")
    expect(received?.sourceImageUrl).toBe(MOTION_SOURCE_URL)
    expect(received?.provider).toBe("kling")
    expect(received?.name).toBe("Rainy Tokyo Alley")
    expect(received?.category).toBe("exterior")
    expect(received?.style).toBe("realistic")
    expect(received?.canonicalDescription).toBe("moody cinematic urban exterior")
    expect(received?.attachToLocationId).toBe(ALLEY_ID)
    expect(received?.attachName).toBe("dolly-in")
    expect(received?.userId).toBe("u1")
  })

  it("forwards the default provider when none supplied (Zod default fires on route side)", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/generate-location-motion", async (req) => {
      received = req.body as Record<string, unknown>
      return { jobId: "job-loc-motion-2" }
    })

    const server = buildServer()
    registerLocationTools({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_location_motion", {
      motion_prompt: "drone fly-over",
      source_image_url: MOTION_SOURCE_URL,
      name: "Rooftop",
    })

    expect(result.isError).toBeUndefined()
    // Zod schema defaults `provider` to "kling" — tool surface passes the
    // explicit default through to the route so logs reflect the actual model.
    expect(received?.provider).toBe("kling")
  })

  it("rejects an invalid provider at the Zod boundary", async () => {
    const server = buildServer()
    registerLocationTools({ server, session: executeSession(), fastify: Fastify() })
    const result = await callTool(server, "generate_location_motion", {
      motion_prompt: "slow dolly-in",
      source_image_url: MOTION_SOURCE_URL,
      provider: "not-a-real-provider",
      name: "Rainy Tokyo Alley",
    })
    expect(result.isError).toBe(true)
  })

  it("surfaces 502 / backend errors via errorResult", async () => {
    const fastify = Fastify()
    fastify.post("/v1/generate-location-motion", async (_req, reply) => {
      return reply
        .status(502)
        .send({ error: { code: "provider_error", message: "kling fail" } })
    })

    const server = buildServer()
    registerLocationTools({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_location_motion", {
      motion_prompt: "slow dolly-in",
      source_image_url: MOTION_SOURCE_URL,
      provider: "kling",
      name: "Rainy Tokyo Alley",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("provider_error")
  })
})

// ── scope-gating cross-check ────────────────────────────────────────────────

describe("scope gating", () => {
  it("read-only session sees list_locations + get_location but no write tools", async () => {
    const server = buildServer()
    registerLocationTools({ server, session: readSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("list_locations")).toBe(true)
    expect(names.has("get_location")).toBe(true)
    expect(names.has("create_location")).toBe(false)
    expect(names.has("update_location")).toBe(false)
    expect(names.has("approve_main_image")).toBe(false)
    expect(names.has("recaption_location")).toBe(false)
    expect(names.has("generate_location_motion")).toBe(false)
  })

  it("write session adds CRUD + studio tools but NOT generate_location_motion", async () => {
    const server = buildServer()
    registerLocationTools({ server, session: writeSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("list_locations")).toBe(true)
    expect(names.has("get_location")).toBe(true)
    expect(names.has("create_location")).toBe(true)
    expect(names.has("update_location")).toBe(true)
    expect(names.has("approve_main_image")).toBe(true)
    expect(names.has("recaption_location")).toBe(true)
    // workflows:execute is required for motion gen, NOT assets:write.
    expect(names.has("generate_location_motion")).toBe(false)
  })

  it("execute session adds generate_location_motion on top of CRUD + studio tools", async () => {
    const server = buildServer()
    registerLocationTools({ server, session: executeSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("generate_location_motion")).toBe(true)
  })

  // Destructive-tool safety net — `delete_location` and `restore_location`
  // must NEVER appear in the MCP surface, regardless of session scopes.
  it("destructive tools (delete_location / restore_location) are absent under EVERY session", async () => {
    for (const session of [readSession(), writeSession(), executeSession()]) {
      const server = buildServer()
      registerLocationTools({ server, session, fastify: Fastify() })
      const tools = await listTools(server)
      const names = new Set(tools.map((t) => t.name))
      expect(names.has("delete_location")).toBe(false)
      expect(names.has("restore_location")).toBe(false)
    }
  })
})
