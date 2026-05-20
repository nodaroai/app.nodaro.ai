import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { captionObject } from "../../lib/object-caption.js"
import { objectLlmCaptionRoutes } from "../object-llm-caption.js"

// captionObject is mocked at the helper boundary — the route only sees the
// helper's resolved `string | null`. Helper-internal tests live in the C1a
// helper test file (object-caption.test.ts).
vi.mock("../../lib/object-caption.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/object-caption.js")>(
    "../../lib/object-caption.js",
  )
  return {
    ...actual,
    captionObject: vi.fn(),
  }
})
vi.mock("../../lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// CI has no .env so config.ANTHROPIC_API_KEY / KIE_API_KEY would be empty,
// tripping the 503 provider_unavailable preflight. Mock as truthy.
vi.mock("../../lib/config.js", () => ({
  config: { ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "test-key" },
}))

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_OBJECT_ID = "00000000-0000-4000-8000-000000000020"
const SOURCE_IMAGE_URL = "https://r2.example.com/object-source.jpg"
const SAMPLE_CAPTION =
  "A polished brass nautical compass, the rim incised with cardinal directions in serif lettering. " +
  "A bevelled glass cover overlies a paper rose with delicate ink hatching."

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(captionObject).mockResolvedValue(SAMPLE_CAPTION)
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => {
    await objectLlmCaptionRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Mock builders — keep route-table chain shapes co-located.
// ---------------------------------------------------------------------------

// .from("objects").select("id, source_image_url").eq("id", ..).eq("user_id", ..).is("deleted_at", null).single()
function mockObjectFetch(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const is = vi.fn().mockReturnValue({ single })
  const eq2 = vi.fn().mockReturnValue({ is })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, eq1, eq2, is, single }
}

// .from("objects").update(..).eq("id", ..).eq("user_id", ..)
function mockObjectUpdate(result: { error: unknown }) {
  // The update chain in the route resolves at `.eq("user_id", ...)`
  // because the route doesn't call .select() afterward — it just awaits
  // the update.
  const eq2 = vi.fn().mockResolvedValue(result)
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  return { update, eq1, eq2 }
}

function wireSupabase(parts: {
  objectFetch?: ReturnType<typeof mockObjectFetch>
  objectUpdate?: ReturnType<typeof mockObjectUpdate>
}) {
  let objCall = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "objects") {
      objCall++
      if (objCall === 1) {
        if (!parts.objectFetch) throw new Error("test forgot to set objectFetch")
        return { select: parts.objectFetch.select } as never
      }
      if (!parts.objectUpdate) throw new Error("test forgot to set objectUpdate")
      return { update: parts.objectUpdate.update } as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/objects/:id/llm-caption", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/llm-caption`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on invalid id param", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/not-a-uuid/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 'not_found' when object is archived or cross-user (uniform code per Pass 10 F-90b)", async () => {
    const objectFetch = mockObjectFetch({ data: null, error: { code: "PGRST116" } })
    wireSupabase({ objectFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(vi.mocked(captionObject)).not.toHaveBeenCalled()
    // Verify the fetch enforced ownership + not-deleted.
    expect(objectFetch.eq1).toHaveBeenCalledWith("id", TEST_OBJECT_ID)
    expect(objectFetch.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(objectFetch.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 400 'main_image_required' when source_image_url is null (nothing to caption)", async () => {
    const objectFetch = mockObjectFetch({
      data: { id: TEST_OBJECT_ID, source_image_url: null },
      error: null,
    })
    wireSupabase({ objectFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("main_image_required")
    expect(vi.mocked(captionObject)).not.toHaveBeenCalled()
  })

  it("returns 502 'caption_failed' when LLM caption fails (FATAL — differs from approve-main-image's 200)", async () => {
    // captionObject() returns null on any LLM failure. This route — unlike
    // approve-main-image — treats null as FATAL because the frontend uses
    // it to RETRY a failed caption. There is no other side-effect to
    // preserve.
    vi.mocked(captionObject).mockResolvedValueOnce(null)
    const objectFetch = mockObjectFetch({
      data: { id: TEST_OBJECT_ID, source_image_url: SOURCE_IMAGE_URL },
      error: null,
    })
    const objectUpdate = mockObjectUpdate({ error: null })
    wireSupabase({ objectFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("caption_failed")
    // Critical contract: NO UPDATE was issued on caption failure.
    expect(objectUpdate.update).not.toHaveBeenCalled()
  })

  it("returns 200 with { canonicalDescription } on success — touches only canonical_description + updated_at", async () => {
    const objectFetch = mockObjectFetch({
      data: { id: TEST_OBJECT_ID, source_image_url: SOURCE_IMAGE_URL },
      error: null,
    })
    const objectUpdate = mockObjectUpdate({ error: null })
    wireSupabase({ objectFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ canonicalDescription: SAMPLE_CAPTION })
    // UPDATE must touch canonical_description + updated_at only (NOT
    // source_image_url — that's strictly an approval-route concern).
    expect(objectUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical_description: SAMPLE_CAPTION,
      }),
    )
    const updateCallArg = objectUpdate.update.mock.calls[0][0] as Record<string, unknown>
    expect(updateCallArg).not.toHaveProperty("source_image_url")
    expect(updateCallArg).toHaveProperty("updated_at")
    // Verify caption helper was invoked with the object's source image url.
    expect(vi.mocked(captionObject)).toHaveBeenCalledWith(SOURCE_IMAGE_URL)
  })

  it("returns 500 'update_failed' when persist UPDATE fails", async () => {
    const objectFetch = mockObjectFetch({
      data: { id: TEST_OBJECT_ID, source_image_url: SOURCE_IMAGE_URL },
      error: null,
    })
    const objectUpdate = mockObjectUpdate({ error: { message: "DB write failed" } })
    wireSupabase({ objectFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("update_failed")
  })
})
