import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { llmComplete } from "../../lib/llm-client.js"
import { characterPortraitApprovalRoutes } from "../character-portrait-approval.js"

vi.mock("../../lib/llm-client.js", () => ({
  llmComplete: vi.fn(),
}))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

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
  // Helper: stub the chained .from("jobs").select("...").eq("id", ...).single() pattern
  function mockJobFetch(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result)
    const eq = vi.fn().mockReturnValue({ single })
    const select = vi.fn().mockReturnValue({ eq })
    return { select, eq, single }
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
    const jobChain = mockJobFetch({
      data: { id: TEST_JOB_ID, user_id: "other-user", status: "completed", output_data: { imageUrl: "x" } },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: jobChain.select } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/approve-portrait`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
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

  it("returns 200 with { portraitUrl, canonicalDescription } on success", async () => {
    const portraitUrl = "https://r2.example.com/portrait.jpg"
    const jobChain = mockJobFetch({
      data: { id: TEST_JOB_ID, user_id: TEST_USER_ID, status: "completed", output_data: { imageUrl: portraitUrl } },
      error: null,
    })
    const charUpdate = mockCharUpdate({ error: null })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return { select: jobChain.select } as never
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
    const charUpdate = mockCharUpdate({ error: null })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return { select: jobChain.select } as never
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
