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

const { registerCharacterTools } = await import("../characters.js")
const { supabase } = await import("../../../supabase.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const KIRA_ID = "11111111-1111-4111-8111-111111111111"
const SHIRA_ID = "22222222-2222-4222-8222-222222222222"
const OTHER_USER_CHAR_ID = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Chainable supabase stub. Every builder method returns `this`; `maybeSingle`
 * resolves `result`, and the builder itself is awaitable for the list path
 * (`select → eq → eq → is → order → limit` resolves the array).
 */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "order", "limit"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
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

/**
 * Build a chainable supabase stub mirroring the workflows test helper. Every
 * builder method returns `this`, terminal `single`/`maybeSingle` resolve
 * `result`, and the builder itself is awaitable for the non-single path.
 */
function buildChain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of [
    "select",
    "eq",
    "is",
    "in",
    "order",
    "limit",
    "insert",
    "update",
    "filter",
    "gte",
    "lt",
  ]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

// ── list_characters ─────────────────────────────────────────────────────────

describe("list_characters tool", () => {
  it("returns the caller's characters scoped by user_id with asset counts", async () => {
    // The SUMMARY_COLUMNS projection runs `jsonb_array_length` SQL-side so
    // each asset bucket arrives as `<bucket>_count: number | null` rather
    // than the full array. Mock the DB shape accordingly. (NULL counts are
    // tolerated by `summarize()` — see the `angles_count: null` below.)
    const builder = chain({
      data: [
        {
          id: KIRA_ID,
          name: "Kira",
          description: "freckled redhead protagonist",
          canonical_description: "young woman with auburn hair and green eyes",
          source_image_url: "https://example.com/kira.png",
          seed_prompt: "kira portrait",
          gender: "female",
          style: "photoreal",
          base_outfit: "denim jacket",
          expressions: [
            { name: "smile", url: "https://example.com/kira-smile.png" },
            { name: "frown", url: "https://example.com/kira-frown.png" },
          ],
          poses: [{ name: "standing", url: "https://example.com/kira-standing.png" }],
          motions: [],
          angles: null, // null array tolerated
          body_angles: [],
          lighting_variations: [],
          updated_at: "2026-05-10T00:00:00Z",
        },
        {
          id: SHIRA_ID,
          name: "Shira",
          description: null,
          canonical_description: null,
          source_image_url: "https://example.com/shira.png",
          seed_prompt: null,
          gender: null,
          style: null,
          base_outfit: null,
          expressions: [{ name: "smile", url: "https://example.com/shira-smile.png" }],
          poses: [],
          motions: [],
          angles: [],
          body_angles: [],
          lighting_variations: [],
          updated_at: "2026-05-09T00:00:00Z",
        },
      ],
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "list_characters", {})
    expect(result.isError).toBeUndefined()

    // Critical: the query was scoped to the caller's user_id and excluded archived.
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
    const isMock = builder.is as ReturnType<typeof vi.fn>
    expect(isMock).toHaveBeenCalledWith("deleted_at", null)

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: Array<{
        id: string
        name: string
        portraitUrl: string
        canonicalDescription: string | null
        assetCounts: Record<string, number>
      }>
    }
    expect(payload.data).toHaveLength(2)
    expect(payload.data[0]).toMatchObject({
      id: KIRA_ID,
      name: "Kira",
      portraitUrl: "https://example.com/kira.png",
      canonicalDescription: "young woman with auburn hair and green eyes",
      assetCounts: {
        expressions: 2,
        poses: 1,
        motions: 0,
        angles: 0, // null array tolerated
        bodyAngles: 0,
        lightingVariations: 0,
      },
    })
    expect(payload.data[1]).toMatchObject({
      id: SHIRA_ID,
      name: "Shira",
      assetCounts: { expressions: 1, poses: 0 },
    })
  })

  it("respects the limit parameter", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "list_characters", { limit: 5 })
    expect(result.isError).toBeUndefined()

    const limitMock = builder.limit as ReturnType<typeof vi.fn>
    expect(limitMock).toHaveBeenCalledWith(5)
  })

  it("defaults to limit=50 when not supplied", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    await callTool(server, "list_characters", {})

    const limitMock = builder.limit as ReturnType<typeof vi.fn>
    expect(limitMock).toHaveBeenCalledWith(50)
  })

  it("orders by updated_at desc", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    await callTool(server, "list_characters", {})

    const orderMock = builder.order as ReturnType<typeof vi.fn>
    expect(orderMock).toHaveBeenCalledWith("updated_at", { ascending: false })
  })

  it("returns isError on supabase error", async () => {
    fromMock.mockReturnValue(
      chain({ data: null, error: { message: "boom" } }),
    )
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "list_characters", {})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("boom")
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerCharacterTools(
      server,
      newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" }),
    )
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_characters")
    expect(tools.map((t) => t.name)).not.toContain("get_character")
  })
})

// ── get_character ───────────────────────────────────────────────────────────

describe("get_character tool", () => {
  it("returns full detail for an owned character", async () => {
    const builder = chain({
      data: {
        id: KIRA_ID,
        name: "Kira",
        description: "freckled redhead protagonist",
        canonical_description: "young woman with auburn hair",
        source_image_url: "https://example.com/kira.png",
        seed_prompt: "kira portrait",
        gender: "female",
        style: "photoreal",
        base_outfit: "denim jacket",
        expressions: [
          { name: "smile", url: "https://example.com/kira-smile.png" },
          { name: "frown", url: "https://example.com/kira-frown.png" },
        ],
        poses: [{ name: "standing", url: "https://example.com/kira-stand.png" }],
        motions: [{ name: "wave", url: "https://example.com/kira-wave.mp4" }],
        angles: [{ name: "profile-left", url: "https://example.com/kira-profile.png" }],
        body_angles: [],
        lighting_variations: [
          { name: "golden-hour", url: "https://example.com/kira-golden.png" },
        ],
        reference_photos: [
          { url: "https://example.com/ref1.jpg", kind: "frontFace" },
        ],
        real_life_refs_by_variant: {
          smile: ["https://example.com/laugh-ref.jpg"],
        },
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-05-10T00:00:00Z",
      },
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: KIRA_ID })
    expect(result.isError).toBeUndefined()

    // Scoped by id + user_id + not archived.
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("id", KIRA_ID)
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
    const isMock = builder.is as ReturnType<typeof vi.fn>
    expect(isMock).toHaveBeenCalledWith("deleted_at", null)

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: {
        id: string
        name: string
        portraitUrl: string
        expressions: Array<{ name: string; url: string }>
        poses: Array<{ name: string; url: string }>
        motions: Array<{ name: string; url: string }>
        angles: Array<{ name: string; url: string }>
        bodyAngles: Array<{ name: string; url: string }>
        lightingVariations: Array<{ name: string; url: string }>
        referencePhotos: Array<{ url: string; kind: string }>
        realLifeRefsByVariant: Record<string, string[]>
      }
    }
    expect(payload.data.id).toBe(KIRA_ID)
    expect(payload.data.name).toBe("Kira")
    expect(payload.data.portraitUrl).toBe("https://example.com/kira.png")
    expect(payload.data.expressions).toHaveLength(2)
    expect(payload.data.expressions[0]).toEqual({
      name: "smile",
      url: "https://example.com/kira-smile.png",
    })
    expect(payload.data.poses).toHaveLength(1)
    expect(payload.data.motions).toHaveLength(1)
    expect(payload.data.angles).toHaveLength(1)
    expect(payload.data.bodyAngles).toEqual([])
    expect(payload.data.lightingVariations).toHaveLength(1)
    expect(payload.data.referencePhotos).toHaveLength(1)
    expect(payload.data.realLifeRefsByVariant).toEqual({
      smile: ["https://example.com/laugh-ref.jpg"],
    })
  })

  it("returns isError 'not found' for unknown id", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: SHIRA_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })

  it("returns isError 'not found' for a character owned by another user (manual scope)", async () => {
    // The DB returns null because the eq("user_id", "u1") filter excluded the
    // row. From the caller's perspective: indistinguishable from non-existence.
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: OTHER_USER_CHAR_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })

  it("returns isError on supabase error", async () => {
    fromMock.mockReturnValue(
      chain({ data: null, error: { message: "db down" } }),
    )
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: KIRA_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("db down")
  })

  it("tolerates null asset arrays in the DB row", async () => {
    fromMock.mockReturnValue(
      chain({
        data: {
          id: KIRA_ID,
          name: "Kira",
          description: null,
          canonical_description: null,
          source_image_url: null,
          seed_prompt: null,
          gender: null,
          style: null,
          base_outfit: null,
          expressions: null,
          poses: null,
          motions: null,
          angles: null,
          body_angles: null,
          lighting_variations: null,
          reference_photos: null,
          real_life_refs_by_variant: null,
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-05-10T00:00:00Z",
        },
        error: null,
      }),
    )
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: KIRA_ID })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: Record<string, unknown>
    }
    expect(payload.data.expressions).toEqual([])
    expect(payload.data.poses).toEqual([])
    expect(payload.data.referencePhotos).toEqual([])
    expect(payload.data.realLifeRefsByVariant).toEqual({})
  })
})

// ── create_character ────────────────────────────────────────────────────────

describe("create_character tool", () => {
  it("inserts a new row scoped to the session user and returns the new id", async () => {
    const builder = buildChain({ data: { id: KIRA_ID, name: "Kira" }, error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "create_character", {
      name: "Kira",
      description: "freckled redhead protagonist",
      gender: "female",
      style: "realistic",
      base_outfit: "denim jacket",
      seed_prompt: "kira portrait",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.id).toBe(KIRA_ID)
    // The insert payload should carry the session userId, the synthetic
    // node_id, and the camelCase → snake_case-translated identity fields.
    const insertMock = builder.insert as ReturnType<typeof vi.fn>
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(row.user_id).toBe("u1")
    expect(row.node_id).toBe("mcp-managed")
    expect(row.name).toBe("Kira")
    expect(row.description).toBe("freckled redhead protagonist")
    expect(row.gender).toBe("female")
    expect(row.style).toBe("realistic")
    expect(row.base_outfit).toBe("denim jacket")
    expect(row.seed_prompt).toBe("kira portrait")
    // Asset buckets default to empty arrays so DAG-aware downstream code
    // doesn't break on null.
    expect(row.expressions).toEqual([])
    expect(row.motions).toEqual([])
  })

  it("returns a name-taken error on 23505", async () => {
    fromMock.mockReturnValue(
      buildChain({ data: null, error: { code: "23505", message: "duplicate" } }),
    )
    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "create_character", { name: "Kira" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("already exists")
  })

  it("does NOT register without assets:write scope", async () => {
    const server = buildServer()
    registerCharacterTools({ server, session: readSession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("create_character")
  })
})

// ── update_character ────────────────────────────────────────────────────────

describe("update_character tool", () => {
  it("writes only the supplied fields and scopes the UPDATE by user_id", async () => {
    const builder = buildChain({
      data: { id: KIRA_ID, name: "Kira Updated", updated_at: "2026-05-11T00:00:00Z" },
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "update_character", {
      id: KIRA_ID,
      name: "Kira Updated",
      description: "new visual notes",
    })

    expect(result.isError).toBeUndefined()
    const updateMock = builder.update as ReturnType<typeof vi.fn>
    expect(updateMock).toHaveBeenCalledTimes(1)
    const patch = updateMock.mock.calls[0][0] as Record<string, unknown>
    expect(patch.name).toBe("Kira Updated")
    expect(patch.description).toBe("new visual notes")
    // Untouched fields are NOT in the patch.
    expect(patch.gender).toBeUndefined()
    expect(patch.style).toBeUndefined()
    // Always set updated_at.
    expect(patch.updated_at).toEqual(expect.any(String))

    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
  })

  it("rejects a payload with no fields besides id", async () => {
    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "update_character", { id: KIRA_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("Nothing to update")
  })

  it("enforces optimistic concurrency when expected_updated_at is supplied", async () => {
    // The UPDATE includes `.eq("updated_at", expected_updated_at)` so when
    // the row has moved on, the UPDATE matches zero rows and `.maybeSingle()`
    // resolves `{ data: null, error: null }`. The handler distinguishes
    // "stale token" from "row missing" by checking whether
    // `expected_updated_at` was supplied. Result text says "modified since".
    const builder = buildChain({ data: null, error: null })
    fromMock.mockReturnValueOnce(builder)

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "update_character", {
      id: KIRA_ID,
      name: "Kira Stale",
      expected_updated_at: "2026-05-10T00:00:00Z",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("modified since")

    // The UPDATE included the `updated_at` filter for atomic concurrency.
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("updated_at", "2026-05-10T00:00:00Z")
  })

  it("succeeds and atomically refreshes updated_at when expected_updated_at matches", async () => {
    const builder = buildChain({
      data: { id: KIRA_ID, name: "Kira Updated", updated_at: "2026-05-12T00:00:00Z" },
      error: null,
    })
    fromMock.mockReturnValueOnce(builder)

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "update_character", {
      id: KIRA_ID,
      name: "Kira Updated",
      expected_updated_at: "2026-05-11T00:00:00Z",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.id).toBe(KIRA_ID)
    expect(result.structuredContent?.updated_at).toBe("2026-05-12T00:00:00Z")
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("updated_at", "2026-05-11T00:00:00Z")
  })
})

// ── destructive tools are intentionally NOT exposed via MCP ─────────────────
//
// `delete_character` and `restore_character` are explicitly absent from the
// MCP surface — destructive (or destructive-adjacent) operations driven by an
// LLM are too risky. Users still archive + restore through REST/SDK/CLI; see
// `scope gating` block below for the actual absence assertions.

// ── approve_portrait ────────────────────────────────────────────────────────

describe("approve_portrait tool", () => {
  it("proxies to /v1/characters/:id/approve-portrait with candidate_job_id", async () => {
    const fastify = Fastify()
    const PORTRAIT_URL = "https://r2/portrait.png"
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/characters/:id/approve-portrait", async (req) => {
      received = req.body as Record<string, unknown>
      return { portraitUrl: PORTRAIT_URL, canonicalDescription: "a young protagonist" }
    })

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "approve_portrait", {
      character_id: KIRA_ID,
      candidate_job_id: "00000000-0000-0000-0000-000000000099",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.portraitUrl).toBe(PORTRAIT_URL)
    expect(result.structuredContent?.canonicalDescription).toBe("a young protagonist")
    expect(received?.candidateJobId).toBe("00000000-0000-0000-0000-000000000099")
    expect(received?.userId).toBe("u1")
  })

  it("surfaces the candidate-not-ready 400 from the route", async () => {
    const fastify = Fastify()
    fastify.post("/v1/characters/:id/approve-portrait", async (_req, reply) => {
      return reply
        .status(400)
        .send({ error: { code: "candidate_not_ready", message: "Candidate not ready" } })
    })

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "approve_portrait", {
      character_id: KIRA_ID,
      candidate_job_id: "00000000-0000-0000-0000-000000000099",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("candidate_not_ready")
  })
})

// ── recaption_character ─────────────────────────────────────────────────────

describe("recaption_character tool", () => {
  it("proxies to /v1/characters/:id/llm-caption", async () => {
    const fastify = Fastify()
    fastify.post("/v1/characters/:id/llm-caption", async () => {
      return { canonicalDescription: "fresh caption" }
    })

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "recaption_character", { id: KIRA_ID })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.canonicalDescription).toBe("fresh caption")
  })

  it("surfaces 502 LLM failures from the route", async () => {
    const fastify = Fastify()
    fastify.post("/v1/characters/:id/llm-caption", async (_req, reply) => {
      return reply
        .status(502)
        .send({ error: { code: "llm_failure", message: "LLM caption failed" } })
    })

    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "recaption_character", { id: KIRA_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("llm_failure")
  })
})

// ── generate_character_motion ───────────────────────────────────────────────

describe("generate_character_motion tool", () => {
  it("proxies to /v1/generate-character-motion with attach + provider fields", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/generate-character-motion", async (req) => {
      received = req.body as Record<string, unknown>
      return { jobId: "job-motion-1" }
    })

    const server = buildServer()
    registerCharacterTools({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_character_motion", {
      motion_prompt: "slow head turn",
      name: "Kira",
      attach_to_character_id: KIRA_ID,
      attach_name: "head turn",
      provider: "kling",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.jobId).toBe("job-motion-1")
    expect(received?.motionPrompt).toBe("slow head turn")
    expect(received?.attachToCharacterId).toBe(KIRA_ID)
    expect(received?.attachName).toBe("head turn")
    expect(received?.provider).toBe("kling")
    expect(received?.userId).toBe("u1")
    expect(received?.mcp_client).toBe("Claude")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("generate_character_motion")
  })
})

// ── generate_character_asset is intentionally NOT registered here ───────────
//
// Asset variant generation (expressions / poses / angles / headAngles /
// bodyAngles / lighting / custom) lives in
// `verbs-clo.ts::generate_character` (kind="asset") — see
// `__tests__/verbs.test.ts` for the asset-mode payload + attach-field tests.
// This file deliberately exposes only motion (`generate_character_motion`)
// because the motion route has its own input shape.

// ── scope-gating cross-check ────────────────────────────────────────────────

describe("scope gating", () => {
  it("read-only session sees list_characters + get_character but no write tools", async () => {
    const server = buildServer()
    registerCharacterTools({ server, session: readSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("list_characters")).toBe(true)
    expect(names.has("get_character")).toBe(true)
    expect(names.has("create_character")).toBe(false)
    expect(names.has("update_character")).toBe(false)
    expect(names.has("approve_portrait")).toBe(false)
    expect(names.has("recaption_character")).toBe(false)
    expect(names.has("generate_character_motion")).toBe(false)
    // Asset generation lives in verbs-clo.ts — registerCharacterTools
    // must NOT register `generate_character_asset` regardless of session
    // scope; if it ever reappears the registry has duplicate tools.
    expect(names.has("generate_character_asset")).toBe(false)
  })

  it("write session adds CRUD + studio tools but no generation", async () => {
    const server = buildServer()
    registerCharacterTools({ server, session: writeSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("create_character")).toBe(true)
    expect(names.has("update_character")).toBe(true)
    expect(names.has("approve_portrait")).toBe(true)
    expect(names.has("recaption_character")).toBe(true)
    expect(names.has("generate_character_motion")).toBe(false)
    expect(names.has("generate_character_asset")).toBe(false)
  })

  it("execute session adds generate_character_motion (asset gen is in verbs-clo)", async () => {
    const server = buildServer()
    registerCharacterTools({ server, session: executeSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("generate_character_motion")).toBe(true)
    // Asset variant generation is exposed by verbs-clo.ts under the
    // existing `generate_character` (kind=asset) tool — characters.ts
    // must not register a separate `generate_character_asset`.
    expect(names.has("generate_character_asset")).toBe(false)
  })

  // Destructive-tool safety net — `delete_character` and `restore_character`
  // must NEVER appear in the MCP surface, regardless of session scopes. An
  // LLM with `assets:write` + `workflows:execute` is the broadest scope
  // possible and still must not see them. Adding these tools back would
  // break this test.
  it("destructive tools (delete_character / restore_character) are absent under EVERY session", async () => {
    for (const session of [readSession(), writeSession(), executeSession()]) {
      const server = buildServer()
      registerCharacterTools({ server, session, fastify: Fastify() })
      const tools = await listTools(server)
      const names = new Set(tools.map((t) => t.name))
      expect(names.has("delete_character")).toBe(false)
      expect(names.has("restore_character")).toBe(false)
    }
  })
})
