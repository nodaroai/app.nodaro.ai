import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { llmComplete } from "../../lib/llm-client.js"
import { characterPortraitApprovalRoutes } from "../character-portrait-approval.js"

vi.mock("../../lib/llm-client.js", () => ({
  llmComplete: vi.fn(),
}))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// CI has no .env so config.KIE_API_KEY / ANTHROPIC_API_KEY are empty strings,
// which trips the route's 503 provider_unavailable preflight before any test
// logic runs. Mock the keys as truthy so the preflight passes.
vi.mock("../../lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", ANTHROPIC_API_KEY: "test-key" },
}))

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
const TEST_CHARACTER_ID = "00000000-0000-0000-0000-000000000002"
const TEST_JOB_ID = "00000000-0000-0000-0000-000000000003"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(llmComplete).mockResolvedValue({
    text: "Kira: late 20s, dark hair, designer glasses, warm presence",
    model: "claude-sonnet-4.6",
  } as Awaited<ReturnType<typeof llmComplete>>)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => { await characterPortraitApprovalRoutes(i) })
  await app.ready()
})
afterEach(async () => { await app.close() })

describe("POST /v1/characters/:id/approve-portrait", () => {
  // Helper: stub the chained
  //   .from("jobs").select("...").eq("id", ...).eq("user_id", ...).single()
  // pattern — defense-in-depth scoping by user_id (tenant-scope lint).
  function mockJobFetch(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result)
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    return { select, eq1, eq2, single }
  }

  // Helper: stub the chained
  //   .from("characters").select("id").eq("id", ...).eq("user_id", ...).is("deleted_at", null).single()
  // pattern used by the approve-portrait pre-fetch.
  function mockCharPreFetch(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result)
    const is = vi.fn().mockReturnValue({ single })
    const eq2 = vi.fn().mockReturnValue({ is })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    return { select, eq1, eq2, is, single }
  }

  // Helper: stub the chained .from("characters").update(...).eq().eq() pattern
  function mockCharUpdate(result: { error: unknown } = { error: null }) {
    const eq2 = vi.fn().mockResolvedValue(result)
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const update = vi.fn().mockReturnValue({ eq: eq1 })
    return { update, eq1, eq2 }
  }

  it("returns 401 unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 when candidate is not completed", async () => {
    const jobChain = mockJobFetch({
      data: { id: TEST_JOB_ID, user_id: TEST_USER_ID, status: "running", output_data: null },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: jobChain.select } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("candidate_not_ready")
  })

  it("returns 404 when candidate belongs to another user", async () => {
    // The route scopes the lookup by user_id in the WHERE clause, so a
    // cross-user candidateJobId returns no row (semantically identical to
    // "not found" from the caller's POV — defense-in-depth tenant scope).
    const jobChain = mockJobFetch({ data: null, error: { code: "PGRST116" } })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: jobChain.select } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
    // Cross-user candidate must short-circuit BEFORE the LLM is called and
    // BEFORE we touch the characters table. Verify the WHERE chain enforced
    // user_id scoping.
    expect(jobChain.eq1).toHaveBeenCalledWith("id", TEST_JOB_ID)
    expect(jobChain.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled()
    expect(vi.mocked(supabase.from)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith("jobs")
  })

  it("returns 404 when candidate doesn't exist", async () => {
    const jobChain = mockJobFetch({ data: null, error: { code: "PGRST116" } })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: jobChain.select } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 404 when character belongs to another user and skips LLM + UPDATE", async () => {
    // Valid candidate the caller owns, but the target characterId is owned by
    // someone else (or soft-deleted). Pre-fetch returns null -> 404. The LLM
    // and the characters UPDATE must NOT run — that's the soft-IDOR fix.
    const portraitUrl = "https://r2.example.com/portrait.jpg"
    const jobChain = mockJobFetch({
      data: { id: TEST_JOB_ID, user_id: TEST_USER_ID, status: "completed", output_data: { imageUrl: portraitUrl } },
      error: null,
    })
    const charPreFetch = mockCharPreFetch({ data: null, error: { code: "PGRST116" } })
    const charUpdate = mockCharUpdate({ error: null })
    let charCall = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return { select: jobChain.select } as never
      // Two possible characters interactions: the pre-fetch (select) and the
      // update. The pre-fetch must come first; the update must NOT happen.
      charCall++
      if (charCall === 1) return { select: charPreFetch.select } as never
      return { update: charUpdate.update } as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled()
    expect(charUpdate.update).not.toHaveBeenCalled()
    // Verify the pre-fetch enforced ownership + not-deleted.
    expect(charPreFetch.eq1).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(charPreFetch.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(charPreFetch.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 200 with { portraitUrl, canonicalDescription } on success", async () => {
    const portraitUrl = "https://r2.example.com/portrait.jpg"
    const jobChain = mockJobFetch({
      data: { id: TEST_JOB_ID, user_id: TEST_USER_ID, status: "completed", output_data: { imageUrl: portraitUrl } },
      error: null,
    })
    const charPreFetch = mockCharPreFetch({ data: { id: TEST_CHARACTER_ID }, error: null })
    const charUpdate = mockCharUpdate({ error: null })
    let charCall = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return { select: jobChain.select } as never
      charCall++
      if (charCall === 1) return { select: charPreFetch.select } as never
      return { update: charUpdate.update } as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().portraitUrl).toBe(portraitUrl)
    expect(res.json().canonicalDescription).toMatch(/Kira/)
  })

  it("returns 200 with canonicalDescription: null when LLM caption fails", async () => {
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM down"))
    const portraitUrl = "https://r2.example.com/portrait.jpg"
    const jobChain = mockJobFetch({
      data: { id: TEST_JOB_ID, user_id: TEST_USER_ID, status: "completed", output_data: { imageUrl: portraitUrl } },
      error: null,
    })
    const charPreFetch = mockCharPreFetch({ data: { id: TEST_CHARACTER_ID }, error: null })
    const charUpdate = mockCharUpdate({ error: null })
    let charCall = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return { select: jobChain.select } as never
      charCall++
      if (charCall === 1) return { select: charPreFetch.select } as never
      return { update: charUpdate.update } as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ portraitUrl, canonicalDescription: null })
    // Contract: on LLM failure the portrait IS still persisted; only the
    // description is null. The frontend retries via /llm-caption.
    expect(charUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        source_image_url: portraitUrl,
        canonical_description: null,
      }),
    )
  })
})

describe("POST /v1/characters/:id/llm-caption", () => {
  function mockCharFetch(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result)
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    return { select }
  }
  function mockCharUpdate(result: { error: unknown } = { error: null }) {
    const eq2 = vi.fn().mockResolvedValue(result)
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const update = vi.fn().mockReturnValue({ eq: eq1 })
    return { update }
  }

  it("returns 200 with { canonicalDescription } on success", async () => {
    const charFetch = mockCharFetch({ data: { source_image_url: "https://r2/portrait.jpg" }, error: null })
    const charUpdate = mockCharUpdate({ error: null })
    let firstCall = true
    vi.mocked(supabase.from).mockImplementation((_table: string) => {
      if (firstCall) {
        firstCall = false
        return { select: charFetch.select } as never
      }
      return { update: charUpdate.update } as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().canonicalDescription).toMatch(/Kira/)
  })

  it("returns 400 no_portrait when source_image_url is null", async () => {
    const charFetch = mockCharFetch({ data: { source_image_url: null }, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: charFetch.select } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("no_portrait")
  })

  it("returns 502 when LLM fails", async () => {
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM down"))
    const charFetch = mockCharFetch({ data: { source_image_url: "https://r2/portrait.jpg" }, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: charFetch.select } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(502)
  })
})
