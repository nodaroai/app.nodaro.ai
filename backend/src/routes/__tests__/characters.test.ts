import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { characterRoutes, upsertCharacterBody } from "../characters.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_CHARACTER_ID = "00000000-0000-4000-8000-000000000020"

const DB_CHARACTER = {
  id: TEST_CHARACTER_ID,
  user_id: TEST_USER_ID,
  node_id: "node-1",
  project_id: TEST_PROJECT_ID,
  name: "Hero",
  description: "Main character",
  gender: "male",
  style: "realistic",
  base_outfit: "armor",
  source_image_url: "https://example.com/hero.png",
  expressions: [],
  poses: [],
  lighting_variations: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const CAMEL_CHARACTER = {
  id: TEST_CHARACTER_ID,
  userId: TEST_USER_ID,
  nodeId: "node-1",
  projectId: TEST_PROJECT_ID,
  name: "Hero",
  description: "Main character",
  gender: "male",
  style: "realistic",
  baseOutfit: "armor",
  sourceImageUrl: "https://example.com/hero.png",
  expressions: [],
  poses: [],
  lightingVariations: [],
  referenceVideosByVariant: {},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

// GET /v1/characters/:id now appends pendingJobs + portraitCandidates +
// previousCandidates; the listing endpoint does not.
const CAMEL_CHARACTER_WITH_PENDING = {
  ...CAMEL_CHARACTER,
  pendingJobs: [],
  portraitCandidates: [],
  previousCandidates: [],
}

/**
 * Build a chain for any of the GET /:id route's `jobs` queries
 * (pending-jobs, portrait-candidates, previous-candidates). Each supports the
 * union of chain methods used by the three queries (`eq`, `in`, `filter`,
 * `gte`, `order`, `limit`). The thenable resolves to `{ data, error }` so the
 * route can `await` it.
 */
function mockJobsPendingChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const chain: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  }
  ;(chain as { then: (resolve: (value: unknown) => unknown) => unknown }).then = (resolve) =>
    Promise.resolve(result).then(resolve)
  const mockSelect = vi.fn().mockReturnValue(chain)
  return { mockSelect, chain }
}

/**
 * Route the three sequential `from("jobs")` calls in the GET handler to three
 * separate chain mocks so each test can stub a distinct return value:
 *   1. pendingJobs (in-flight asset/motion jobs)
 *   2. portraitCandidates (pending/running generate-character jobs)
 *   3. previousCandidates (recent completed generate-character jobs)
 */
function mockGetByIdJobs(
  pending: { data: unknown; error: unknown } = { data: [], error: null },
  portrait: { data: unknown; error: unknown } = { data: [], error: null },
  previous: { data: unknown; error: unknown } = { data: [], error: null },
) {
  const pendingChain = mockJobsPendingChain(pending)
  const portraitChain = mockJobsPendingChain(portrait)
  const previousChain = mockJobsPendingChain(previous)
  let call = 0
  function next() {
    const c = [pendingChain, portraitChain, previousChain][call] ?? previousChain
    call++
    return { select: c.mockSelect }
  }
  return { pendingChain, portraitChain, previousChain, next }
}

/**
 * Build a thenable chain for `supabase.from().select().order().eq().is()` etc.
 * The list route now applies a `deleted_at IS NULL` filter via `.is()`, an
 * optional `.not()` for the archived view, and a `.limit()` for pagination.
 */
function mockListChain(result: { data: unknown; error: unknown }) {
  const chainable: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  }
  // Make chainable thenable so `await query` resolves
  chainable.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve(result).then(resolve)
  const mockOrder = vi.fn().mockReturnValue(chainable)
  const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
  return { mockSelect, mockOrder, chainable }
}

/**
 * Build a chain for the soft-delete UPDATE used by `DELETE /v1/characters/:id`:
 * `supabase.from("characters").update({ deleted_at: ... }).eq().eq()`.
 */
function mockSoftDeleteChain(result: { data?: unknown; error: unknown }) {
  const eq2 = vi.fn().mockResolvedValue(result)
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const mockUpdate = vi.fn().mockReturnValue({ eq: eq1 })
  return { mockUpdate, eq1, eq2 }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header or userId in body
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
    } else {
      const body = req.body as Record<string, unknown> | undefined
      if (body?.userId && typeof body.userId === "string") {
        req.userId = body.userId
      }
    }
  })
  await app.register(async (instance) => {
    await characterRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/characters
// ---------------------------------------------------------------------------

describe("GET /v1/characters", () => {
  it("returns 200 with empty list", async () => {
    const { mockSelect } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(200)
    expect(res.json().characters).toEqual([])
  })

  it("returns 200 with camelCase-transformed data", async () => {
    const { mockSelect } = mockListChain({ data: [DB_CHARACTER], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(200)
    expect(res.json().characters).toEqual([CAMEL_CHARACTER])
  })

  it("returns 200 filtered by projectId query param", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters?projectId=${TEST_PROJECT_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(chainable.eq).toHaveBeenCalledWith("project_id", TEST_PROJECT_ID)
  })

  // Scoping safety net — when a user is authenticated, the list query MUST
  // filter by user_id so one user can never see another's characters. The
  // route reads `req.userId` (set by the auth middleware) and applies it
  // unconditionally.
  it("scopes the query by user_id when authenticated", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/characters",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(chainable.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  // Default view (no `archived` flag) excludes soft-deleted rows via the
  // `deleted_at IS NULL` filter. The picker + library list both rely on this.
  it("excludes archived rows by default (deleted_at IS NULL)", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(200)
    expect(chainable.is).toHaveBeenCalledWith("deleted_at", null)
    expect(chainable.not).not.toHaveBeenCalled()
  })

  // `archived=true` flips the filter — the route should apply
  // `.not("deleted_at", "is", null)` instead of `.is("deleted_at", null)`.
  // Powers the editor's `/library/characters/archived` view.
  it("includes ONLY archived rows when ?archived=true", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/characters?archived=true",
    })

    expect(res.statusCode).toBe(200)
    expect(chainable.not).toHaveBeenCalledWith("deleted_at", "is", null)
    expect(chainable.is).not.toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 400 on invalid archived query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/characters?archived=maybe",
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  // The list route accepts `?limit=N` (Zod coerces from the query string).
  // Default is 100; cap is 500. Without the limit on the query builder a
  // misbehaving SDK consumer could drag the whole table across the wire.
  it("applies the default limit of 100 when ?limit is not supplied", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(200)
    expect(chainable.limit).toHaveBeenCalledWith(100)
  })

  it("forwards ?limit=N (coerced to number) to the query builder", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters?limit=5" })

    expect(res.statusCode).toBe(200)
    expect(chainable.limit).toHaveBeenCalledWith(5)
  })

  it("rejects ?limit > 500 with 400 validation_error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/characters?limit=9999",
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects ?limit <= 0 with 400 validation_error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/characters?limit=0",
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 500 on DB error", async () => {
    const { mockSelect } = mockListChain({
      data: null,
      error: { message: "DB down" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/characters/:id
// ---------------------------------------------------------------------------

describe("GET /v1/characters/:id", () => {
  function getByIdChain(result: { data: unknown; error: unknown }) {
    const mockSingle = vi.fn().mockResolvedValue(result)
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    const mockSelect = vi.fn().mockReturnValue(chain)
    return { mockSelect, chain, mockSingle }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 with camelCase data and scopes by user_id", async () => {
    // The handler issues four queries — characters row, then three jobs
    // queries (pending, portraitCandidates, previousCandidates). Mock by
    // table name + call-order so each `.from()` call gets its own chain.
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs()
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(CAMEL_CHARACTER_WITH_PENDING)
    expect(charsByIdChain.chain.eq).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(charsByIdChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    // Pending-jobs query scopes by user + status + character id.
    expect(jobs.pendingChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(jobs.pendingChain.chain.in).toHaveBeenCalledWith("status", ["pending", "running"])
    expect(jobs.pendingChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>attachToCharacterId",
      "eq",
      TEST_CHARACTER_ID,
    )
  })

  it("returns reference_videos_by_variant on the row (read round-trip)", async () => {
    const rowWithVideos = {
      ...DB_CHARACTER,
      reference_videos_by_variant: {
        angry: ["https://example.com/angry.mp4"],
        happy: ["https://example.com/happy-1.mp4", "https://example.com/happy-2.mp4"],
      },
    }
    const charsByIdChain = getByIdChain({ data: rowWithVideos, error: null })
    const jobs = mockGetByIdJobs()
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().referenceVideosByVariant).toEqual({
      angry: ["https://example.com/angry.mp4"],
      happy: ["https://example.com/happy-1.mp4", "https://example.com/happy-2.mp4"],
    })
  })

  it("maps in-flight jobs to assetType buckets for spinner rehydration", async () => {
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs(
      {
        data: [
          // Asset job, expressions column — should surface as assetType:"expressions"
          {
            id: "job-1",
            input_data: {
              type: "generate-character-asset",
              attachToCharacterId: TEST_CHARACTER_ID,
              attachToColumn: "expressions",
              attachName: "smile",
            },
          },
          // lighting_variations column → assetType:"lighting" (frontend name)
          {
            id: "job-2",
            input_data: {
              type: "generate-character-asset",
              attachToCharacterId: TEST_CHARACTER_ID,
              attachToColumn: "lighting_variations",
              attachName: "dramatic",
            },
          },
          // Motion job → assetType:"motions"
          {
            id: "job-3",
            input_data: {
              type: "generate-character-motion",
              attachToCharacterId: TEST_CHARACTER_ID,
              attachName: "walking",
            },
          },
          // Portrait → not surfaced (Appearance tab has its own poll)
          {
            id: "job-4",
            input_data: {
              type: "generate-character",
              attachToCharacterId: TEST_CHARACTER_ID,
              attachName: "portrait",
            },
          },
          // Missing attachName → skipped
          { id: "job-5", input_data: { type: "generate-character-asset", attachToCharacterId: TEST_CHARACTER_ID, attachToColumn: "poses" } },
        ],
        error: null,
      },
      { data: [], error: null },
      { data: [], error: null },
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pendingJobs).toEqual([
      { jobId: "job-1", assetType: "expressions", name: "smile" },
      { jobId: "job-2", assetType: "lighting", name: "dramatic" },
      { jobId: "job-3", assetType: "motions", name: "walking" },
    ])
  })

  // -------------------------------------------------------------------------
  // portraitCandidates: pending/running `generate-character` jobs scoped to
  // THIS character. The studio re-attaches spinners on reopen by polling
  // this bucket for in-flight portrait generations.
  // -------------------------------------------------------------------------
  it("returns portraitCandidates (pending/running generate-character jobs scoped to this character)", async () => {
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs(
      { data: [], error: null }, // pendingJobs
      {
        data: [
          {
            id: "job-portrait-1",
            status: "running",
            progress: 42,
            output_data: null,
            input_data: { type: "generate-character", attachToCharacterId: TEST_CHARACTER_ID },
          },
          {
            id: "job-portrait-2",
            status: "pending",
            progress: 0,
            output_data: null,
            input_data: { type: "generate-character", attachToCharacterId: TEST_CHARACTER_ID },
          },
        ],
        error: null,
      },
      { data: [], error: null }, // previousCandidates
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().portraitCandidates).toEqual([
      { jobId: "job-portrait-1", url: undefined, progress: 42, status: "running" },
      { jobId: "job-portrait-2", url: undefined, progress: 0, status: "pending" },
    ])
    // Scope: user + status set + type + character id.
    expect(jobs.portraitChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(jobs.portraitChain.chain.in).toHaveBeenCalledWith("status", ["pending", "running"])
    expect(jobs.portraitChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>type",
      "eq",
      "generate-character",
    )
    expect(jobs.portraitChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>attachToCharacterId",
      "eq",
      TEST_CHARACTER_ID,
    )
  })

  it("portraitCandidates surfaces output_data.imageUrl when worker has already written it", async () => {
    // The worker writes `output_data.imageUrl` mid-job (e.g. after R2 upload
    // but before final commit). Surfacing it lets the studio swap the spinner
    // for a thumbnail the moment the URL exists.
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs(
      { data: [], error: null },
      {
        data: [
          {
            id: "job-portrait-3",
            status: "running",
            progress: 90,
            output_data: { imageUrl: "https://r2/preview.png" },
            input_data: { type: "generate-character", attachToCharacterId: TEST_CHARACTER_ID },
          },
        ],
        error: null,
      },
      { data: [], error: null },
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().portraitCandidates).toEqual([
      { jobId: "job-portrait-3", url: "https://r2/preview.png", progress: 90, status: "running" },
    ])
  })

  it("portraitCandidates empty when no pending jobs", async () => {
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs() // all three empty
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().portraitCandidates).toEqual([])
  })

  // -------------------------------------------------------------------------
  // previousCandidates: completed generate-character jobs for THIS character
  // with URL ≠ current portrait, within 7 days, ORDER BY created_at DESC,
  // limit 5. The DB fetches 10; JS filters by URL and trims to 5.
  // -------------------------------------------------------------------------
  it("returns previousCandidates (completed generate-character jobs, URL != current portrait)", async () => {
    // The route now projects the imageUrl JSONB path directly via
    // `image_url:output_data->>imageUrl` so we don't drag the whole
    // output_data blob across the wire. Test fixtures mirror that shape.
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs(
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          { id: "job-prev-1", image_url: "https://r2/v1.png", created_at: "2026-05-13T12:00:00Z" },
          { id: "job-prev-2", image_url: "https://r2/v2.png", created_at: "2026-05-12T12:00:00Z" },
        ],
        error: null,
      },
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().previousCandidates).toEqual([
      { jobId: "job-prev-1", url: "https://r2/v1.png", createdAt: "2026-05-13T12:00:00Z" },
      { jobId: "job-prev-2", url: "https://r2/v2.png", createdAt: "2026-05-12T12:00:00Z" },
    ])
    // Scope: user + status=completed + type + character id + 7-day window +
    // ORDER BY created_at DESC + limit 10 (then JS-trim to 5).
    expect(jobs.previousChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(jobs.previousChain.chain.eq).toHaveBeenCalledWith("status", "completed")
    expect(jobs.previousChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>type",
      "eq",
      "generate-character",
    )
    expect(jobs.previousChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>attachToCharacterId",
      "eq",
      TEST_CHARACTER_ID,
    )
    expect(jobs.previousChain.chain.gte).toHaveBeenCalledWith("created_at", expect.any(String))
    expect(jobs.previousChain.chain.order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(jobs.previousChain.chain.limit).toHaveBeenCalledWith(10)
  })

  it("previousCandidates excludes the current portrait URL", async () => {
    // If a completed job's image URL is what's CURRENTLY set as
    // `characters.source_image_url`, it should NOT appear in previousCandidates
    // — the user-facing concept is "alternatives to the current portrait".
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const currentPortrait = DB_CHARACTER.source_image_url
    const jobs = mockGetByIdJobs(
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: "job-prev-current",
            // Same as DB_CHARACTER.source_image_url — must be filtered out.
            image_url: currentPortrait,
            created_at: "2026-05-13T12:00:00Z",
          },
          {
            id: "job-prev-alt",
            image_url: "https://r2/alt.png",
            created_at: "2026-05-12T12:00:00Z",
          },
        ],
        error: null,
      },
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().previousCandidates).toEqual([
      { jobId: "job-prev-alt", url: "https://r2/alt.png", createdAt: "2026-05-12T12:00:00Z" },
    ])
  })

  it("previousCandidates trims to 5 most recent after URL≠current filter", async () => {
    // DB returns up to 10 rows (DESC); after JS-filtering for URL≠current we
    // keep at most 5. Use 7 distinct URLs to prove the trim, not the order.
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      id: `job-prev-${i}`,
      image_url: `https://r2/v${i}.png`,
      created_at: `2026-05-${String(13 - i).padStart(2, "0")}T12:00:00Z`,
    }))
    const jobs = mockGetByIdJobs(
      { data: [], error: null },
      { data: [], error: null },
      { data: candidates, error: null },
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const prev = res.json().previousCandidates as unknown[]
    expect(prev).toHaveLength(5)
    // First 5 (DESC) should be job-prev-0..4
    expect((prev[0] as { jobId: string }).jobId).toBe("job-prev-0")
    expect((prev[4] as { jobId: string }).jobId).toBe("job-prev-4")
  })

  it("previousCandidates excludes rows whose image_url projection is null/missing", async () => {
    // Defensive: a completed job with no image URL (e.g. an edge-case provider
    // response where output_data lacks imageUrl) must not poison the bucket.
    // ->> projects to text|null so missing/non-string entries surface as null.
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs(
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          { id: "job-null", image_url: null, created_at: "2026-05-13T12:00:00Z" },
          { id: "job-missing-key", image_url: null, created_at: "2026-05-13T11:00:00Z" },
          { id: "job-ok", image_url: "https://r2/ok.png", created_at: "2026-05-13T09:00:00Z" },
        ],
        error: null,
      },
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().previousCandidates).toEqual([
      { jobId: "job-ok", url: "https://r2/ok.png", createdAt: "2026-05-13T09:00:00Z" },
    ])
  })

  it("previousCandidates empty when no completed jobs in window", async () => {
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs() // all three empty
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().previousCandidates).toEqual([])
  })

  it("portraitCandidates and previousCandidates both scope by THIS character id (not all user's chars)", async () => {
    // Security/scope check: even if the DB returned jobs whose
    // `attachToCharacterId` doesn't match the URL param (shouldn't happen
    // because we filter server-side, but defensive against a query that
    // forgets to filter), the route MUST issue the right scope filter.
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobs = mockGetByIdJobs()
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return jobs.next() as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    // Both buckets must filter by THIS character id (not just user_id).
    expect(jobs.portraitChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>attachToCharacterId",
      "eq",
      TEST_CHARACTER_ID,
    )
    expect(jobs.previousChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>attachToCharacterId",
      "eq",
      TEST_CHARACTER_ID,
    )
    // And both must be user-scoped — never leak another user's jobs.
    expect(jobs.portraitChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(jobs.previousChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("returns 404 on PGRST116 (not found OR not owned)", async () => {
    // PGRST116 is returned both when the row doesn't exist and when the
    // user_id scope excludes it — the two cases must be indistinguishable.
    const { mockSelect } = getByIdChain({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 on DB error", async () => {
    const { mockSelect } = getByIdChain({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/characters (upsert)
// ---------------------------------------------------------------------------

describe("POST /v1/characters", () => {
  it("returns 400 when name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { nodeId: "node-1", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when nodeId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when userId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on insert (no id in body)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_CHARACTER_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(TEST_CHARACTER_ID)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Hero", node_id: "node-1", user_id: TEST_USER_ID }),
    )
  })

  it("returns 200 on update (id in body) and scopes by user_id", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_CHARACTER_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        id: TEST_CHARACTER_ID,
        name: "Hero Updated",
        nodeId: "node-1",
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(TEST_CHARACTER_ID)
    expect(mockUpdate).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("returns 500 on DB error (insert)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "insert failed" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  // -------------------------------------------------------------------------
  // Identity foundation fields (PR 1 / Task 10): reference_photos, seed_prompt,
  // canonical_description, real_life_refs_by_variant. Validates Zod refinements
  // (duplicate-kind reject, length caps, per-variant key/value caps) AND the
  // handler's lowercase+trim normalization of variant keys before INSERT.
  // -------------------------------------------------------------------------

  /**
   * Captures the row passed to `supabase.from("characters").insert(row)` so
   * the test can assert on its shape. Returns success so the route resolves 200.
   */
  function mockInsertCapture() {
    const captured: { row: Record<string, unknown> | null } = { row: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_CHARACTER_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn((row: Record<string, unknown>) => {
      captured.row = row
      return { select: mockSelect }
    })
    return { mockInsert, captured }
  }

  it("rejects reference_photos with duplicate non-`other` kinds (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        referencePhotos: [
          { url: "https://example.com/a.png", kind: "frontFace" },
          { url: "https://example.com/b.png", kind: "frontFace" },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("accepts multiple `other` kind entries", async () => {
    const { mockInsert } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        referencePhotos: [
          { url: "https://example.com/a.png", kind: "other" },
          { url: "https://example.com/b.png", kind: "other" },
          { url: "https://example.com/c.png", kind: "other" },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it("rejects seed_prompt > 2000 chars (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        seedPrompt: "x".repeat(2001),
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects canonical_description > 4000 chars (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        canonicalDescription: "x".repeat(4001),
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("normalizes real_life_refs_by_variant keys to lowercased+trimmed", async () => {
    const { mockInsert, captured } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        realLifeRefsByVariant: {
          "  Smile ": ["https://example.com/s1.png"],
          WALKING: ["https://example.com/w1.png", "https://example.com/w2.png"],
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(captured.row).not.toBeNull()
    expect(captured.row?.real_life_refs_by_variant).toEqual({
      smile: ["https://example.com/s1.png"],
      walking: ["https://example.com/w1.png", "https://example.com/w2.png"],
    })
  })

  it("rejects real_life_refs_by_variant with > 20 keys (400)", async () => {
    const variants: Record<string, string[]> = {}
    for (let i = 0; i < 21; i++) {
      variants[`variant${i}`] = ["https://example.com/x.png"]
    }
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        realLifeRefsByVariant: variants,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects real_life_refs_by_variant with > 5 urls per key (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        realLifeRefsByVariant: {
          smile: [
            "https://example.com/1.png",
            "https://example.com/2.png",
            "https://example.com/3.png",
            "https://example.com/4.png",
            "https://example.com/5.png",
            "https://example.com/6.png",
          ],
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("normalizes reference_videos_by_variant keys to lowercased+trimmed (insert)", async () => {
    const { mockInsert, captured } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        referenceVideosByVariant: {
          "  Angry ": ["https://example.com/a1.mp4"],
          HAPPY: ["https://example.com/h1.mp4", "https://example.com/h2.mp4"],
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(captured.row).not.toBeNull()
    expect(captured.row?.reference_videos_by_variant).toEqual({
      angry: ["https://example.com/a1.mp4"],
      happy: ["https://example.com/h1.mp4", "https://example.com/h2.mp4"],
    })
  })

  it("persists reference_videos_by_variant on update with normalized keys", async () => {
    // Inline update-chain capture: .update(patch).eq().eq().select().single()
    const captured: { patch: Record<string, unknown> | null } = { patch: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_CHARACTER_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const eq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const mockUpdate = vi.fn((patch: Record<string, unknown>) => {
      captured.patch = patch
      return { eq: eq1 }
    })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        id: TEST_CHARACTER_ID,
        nodeId: "node-1",
        userId: TEST_USER_ID,
        referenceVideosByVariant: { " Tired ": ["https://example.com/t.mp4"] },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(captured.patch?.reference_videos_by_variant).toEqual({
      tired: ["https://example.com/t.mp4"],
    })
  })

  it("rejects reference_videos_by_variant with > 20 keys (400)", async () => {
    const variants: Record<string, string[]> = {}
    for (let i = 0; i < 21; i++) {
      variants[`take${i}`] = ["https://example.com/x.mp4"]
    }
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        referenceVideosByVariant: variants,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects reference_videos_by_variant with > 5 urls per key (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        referenceVideosByVariant: {
          angry: [
            "https://example.com/1.mp4",
            "https://example.com/2.mp4",
            "https://example.com/3.mp4",
            "https://example.com/4.mp4",
            "https://example.com/5.mp4",
            "https://example.com/6.mp4",
          ],
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("accepts reference_photos with all 7 kinds + one extra `other` (8 photos)", async () => {
    const { mockInsert } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        referencePhotos: [
          { url: "https://example.com/1.png", kind: "frontFace" },
          { url: "https://example.com/2.png", kind: "sideLeft" },
          { url: "https://example.com/3.png", kind: "sideRight" },
          { url: "https://example.com/4.png", kind: "threeQuarterLeft" },
          { url: "https://example.com/5.png", kind: "threeQuarterRight" },
          { url: "https://example.com/6.png", kind: "frontBody" },
          { url: "https://example.com/7.png", kind: "other" },
          { url: "https://example.com/8.png", kind: "other" },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it("persists reference_photos to insert row", async () => {
    const { mockInsert, captured } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const photos = [
      { url: "https://example.com/front.png", kind: "frontFace" },
      { url: "https://example.com/side.png", kind: "sideLeft" },
    ]
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1", userId: TEST_USER_ID, referencePhotos: photos },
    })

    expect(res.statusCode).toBe(200)
    expect(captured.row?.reference_photos).toEqual(photos)
  })

  it("persists seed_prompt to insert row", async () => {
    const { mockInsert, captured } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        seedPrompt: "young warrior with dark hair",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(captured.row?.seed_prompt).toBe("young warrior with dark hair")
  })

  it("persists canonical_description to insert row", async () => {
    const { mockInsert, captured } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        name: "Hero",
        nodeId: "node-1",
        userId: TEST_USER_ID,
        canonicalDescription: "A 25-year-old warrior with short dark hair, green eyes, scar on left cheek...",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(captured.row?.canonical_description).toBe(
      "A 25-year-old warrior with short dark hair, green eyes, scar on left cheek...",
    )
  })

  // voiceType records the selected voice's KIND (premade | library | custom)
  // so text-to-speech can resolve a library/custom voice by id at speak time.
  // It must survive Zod validation (the object strips unknown keys by default)
  // and ride through into the persisted `voice` JSON blob unchanged.
  it("persists voice.voiceType to insert row", async () => {
    const { mockInsert, captured } = mockInsertCapture()
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const voice = { voiceId: "el_lib_123", voiceName: "Aria", traits: "warm", voiceType: "library" }
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1", userId: TEST_USER_ID, voice },
    })

    expect(res.statusCode).toBe(200)
    expect(captured.row?.voice).toEqual(voice)
  })

  it("upsertCharacterBody preserves voice.voiceType through validation", () => {
    const parsed = upsertCharacterBody.parse({
      nodeId: "node-1",
      voice: { voiceId: "el_lib_123", voiceName: "Aria", traits: "warm", voiceType: "library" },
    })
    expect(parsed.voice?.voiceType).toBe("library")
  })

  it("upsertCharacterBody rejects an invalid voice.voiceType", () => {
    const result = upsertCharacterBody.safeParse({
      nodeId: "node-1",
      voice: { voiceId: "el_lib_123", voiceName: "Aria", traits: "warm", voiceType: "bogus" },
    })
    expect(result.success).toBe(false)
  })

  it("upsertCharacterBody still accepts a voice WITHOUT voiceType (backward-compat)", () => {
    const parsed = upsertCharacterBody.parse({
      nodeId: "node-1",
      voice: { voiceId: "Rachel", voiceName: "Rachel", traits: "calm" },
    })
    expect(parsed.voice).toEqual({ voiceId: "Rachel", voiceName: "Rachel", traits: "calm" })
    expect(parsed.voice?.voiceType).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/characters/:id
// ---------------------------------------------------------------------------

// DELETE is now a SOFT delete (sets `deleted_at`), so the test asserts the
// route issues an UPDATE rather than a DELETE, and the response payload
// carries `archived: true` for callers that want to distinguish.
describe("DELETE /v1/characters/:id (soft delete)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on success and scopes by user_id; sets deleted_at via UPDATE", async () => {
    const { mockUpdate, eq1, eq2 } = mockSoftDeleteChain({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, archived: true })
    // Verify the update payload sets deleted_at (don't pin to exact timestamp).
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String), updated_at: expect.any(String) }),
    )
    expect(eq1).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("returns 500 on DB error", async () => {
    const { mockUpdate } = mockSoftDeleteChain({ error: { message: "constraint violation" } })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  // Cross-user safety net: when caller A tries to delete user B's character,
  // the `.eq("user_id", caller)` scope on the UPDATE means zero rows are
  // affected. Supabase doesn't surface a row-count for UPDATE, so the
  // response is still 200/success — that's the documented contract. The
  // critical guarantee is that B's row is untouched, which we verify by
  // asserting the UPDATE includes the user_id scope.
  it("scopes the UPDATE by user_id so cross-user delete is a no-op", async () => {
    const { mockUpdate, eq1, eq2 } = mockSoftDeleteChain({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const ATTACKER_ID = "00000000-0000-4000-8000-0000000000aa"
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": ATTACKER_ID },
    })

    // Same contract as the happy path — supabase doesn't return row counts on
    // UPDATE, so we get 200/success regardless of whether a row matched.
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, archived: true })
    // The critical assertion: the UPDATE was scoped to the caller's user_id,
    // NOT the owner's — so B's row is provably untouched.
    expect(eq1).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(eq2).toHaveBeenCalledWith("user_id", ATTACKER_ID)
  })
})

// ---------------------------------------------------------------------------
// POST /v1/characters/:id/restore
// ---------------------------------------------------------------------------

describe("POST /v1/characters/:id/restore", () => {
  /**
   * Build a chain that mirrors the restore handler:
   *   1. SELECT(id, name, deleted_at) → maybeSingle: lookup the archived row
   *   2. SELECT(id) → ilike conflict check
   *   3. UPDATE(deleted_at=null, name=…) → maybeSingle / single result
   *
   * We route by call-order via mockImplementation so each step gets a stub.
   */
  function mockRestoreChains(opts: {
    archived?: { data: unknown; error: unknown }
    conflict?: { data: unknown; error: unknown }
    update?: { data: unknown; error: unknown }
  }) {
    const archived = opts.archived ?? {
      data: { id: TEST_CHARACTER_ID, name: "Hero", deleted_at: "2026-05-01T00:00:00Z" },
      error: null,
    }
    const conflict = opts.conflict ?? { data: [], error: null }
    const update = opts.update ?? {
      data: { id: TEST_CHARACTER_ID, name: "Hero" },
      error: null,
    }

    const archivedChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(archived),
    }
    const archivedSelect = vi.fn().mockReturnValue(archivedChain)

    const conflictChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockResolvedValue(conflict),
    }
    const conflictSelect = vi.fn().mockReturnValue(conflictChain)

    const updateChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(update),
    }
    const updateFn = vi.fn().mockReturnValue(updateChain)

    let call = 0
    function next() {
      const c = call++
      if (c === 0) return { select: archivedSelect } as never
      if (c === 1) return { select: conflictSelect } as never
      return { update: updateFn } as never
    }
    return { next, archivedChain, conflictChain, updateChain, updateFn }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/restore`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 and un-archives the row (clears deleted_at)", async () => {
    const stubs = mockRestoreChains({})
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_CHARACTER_ID, name: "Hero" })

    // The UPDATE must clear deleted_at and re-stamp updated_at.
    const updatePayload = stubs.updateFn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.deleted_at).toBe(null)
    expect(updatePayload.name).toBe("Hero")
    expect(updatePayload.updated_at).toEqual(expect.any(String))

    // Scoping: the UPDATE is keyed on both id AND user_id so a stale
    // session can't restore someone else's row.
    const updateEq = stubs.updateChain.eq as ReturnType<typeof vi.fn>
    expect(updateEq).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(updateEq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("returns 404 when the character isn't found or isn't owned by the caller", async () => {
    const stubs = mockRestoreChains({
      archived: { data: null, error: { message: "no rows" } },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns the row as-is when already active (no-op)", async () => {
    // `deleted_at: null` → row is already active; route returns the existing
    // id/name without re-running the UPDATE.
    const stubs = mockRestoreChains({
      archived: {
        data: { id: TEST_CHARACTER_ID, name: "Hero", deleted_at: null },
        error: null,
      },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_CHARACTER_ID, name: "Hero" })
    // No UPDATE was issued.
    expect(stubs.updateFn).not.toHaveBeenCalled()
  })
})
