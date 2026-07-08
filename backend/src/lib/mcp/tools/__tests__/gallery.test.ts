import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerGallery } = await import("../gallery.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

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
    scopes: ["assets:write"] as Scope[],
    clientName: "Claude",
  })
}

// The by-id tools guard the uuid PK before querying (see _id-guard.ts), so
// tool inputs must be UUID-shaped. The chain-agnostic mocks ignore the value,
// so these constants stand in for any id; assertions still key off the mock
// rows' own ids.
const JOB_UUID = "11111111-1111-4111-8111-111111111111"
const JOB_UUID_2 = "22222222-2222-4222-8222-222222222222"

/**
 * Chain-agnostic supabase mock: returns a Proxy that pretends every
 * method (select / eq / neq / not / in / order / limit / lt / ilike /
 * etc.) is itself a chainable noop, AND is also a thenable resolving
 * to `{ data, error: null }` when `await`-ed at any point. Lets handler
 * code reorder its query chain without breaking tests.
 */
function makeChainable(rows: unknown[]) {
  const result = { data: rows, error: null }
  let chain: unknown
  const promise: Promise<typeof result> = Promise.resolve(result)
  // eslint-disable-next-line prefer-const
  chain = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return promise.then.bind(promise)
      if (prop === "catch") return promise.catch.bind(promise)
      if (prop === "finally") return promise.finally.bind(promise)
      return () => chain
    },
    apply() {
      return chain
    },
  })
  return chain
}

describe("browse_gallery tool", () => {
  it("formats rows as one line per item with cursor footer", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable([
        {
          id: "g1",
          job_type: "generate-image",
          input_data: { prompt: "knight", provider: "nano-banana" },
          output_data: { imageUrl: "https://r2/x.png" },
          completed_at: "2026-04-29T12:00:00Z",
          created_at: "2026-04-29T12:00:00Z",
          provider: "nano-banana",
          status: "completed",
        },
      ]),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_gallery", { limit: 1 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("g1: image")
    expect(result.content[0]?.text).toContain("nano-banana")
    expect(result.content[0]?.text).toContain("2026-04-29")
    // Per MCP Apps: text + structuredContent (iframe template at
    // ui://nodaro/widget/gallery consumes the items array).
    expect(result.content.length).toBe(1)
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(Array.isArray(sc?.items)).toBe(true)
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("browse_gallery")
  })
})

describe("browse_uploads tool", () => {
  it("returns uploaded assets mapped into the gallery widget shape", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable([
        {
          id: "asset-1",
          type: "image",
          filename: "cat.jpg",
          mime_type: "image/jpeg",
          size_bytes: 1234,
          r2_url: "https://cdn/cat.jpg",
          metadata: { thumbnail_url: "https://cdn/thumb-cat.jpg" },
          created_at: "2026-05-04T10:00:00Z",
        },
      ]),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_uploads", { limit: 10 })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(Array.isArray(sc?.items)).toBe(true)
    const items = sc?.items as Array<Record<string, unknown>>
    expect(items[0]?.jobId).toBe("asset-1")
    expect(items[0]?.kind).toBe("image")
    expect(items[0]?.assetUrl).toBe("https://cdn/cat.jpg")
    expect(items[0]?.thumbnailUrl).toBe("https://cdn/thumb-cat.jpg")
    expect(sc?.loadMoreTool).toBe("browse_uploads")
  })

  it("hands a loadMoreTool hint to the gallery widget", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainable([]),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_uploads", { kind: "image" })
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(sc?.loadMoreTool).toBe("browse_uploads")
  })
})

describe("list_favorites tool", () => {
  it("returns favorited job_ids", async () => {
    // Two from() calls: first hits gallery_favorites, second hydrates jobs.
    const favoritesChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { job_id: "f1", created_at: "2026-04-29T12:00:00Z" },
                { job_id: "f2", created_at: "2026-04-29T11:00:00Z" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    const jobsChain = {
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          // #4: hydration now applies a visibility .or() filter before resolving.
          or: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(favoritesChain)
      .mockReturnValueOnce(jobsChain)
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "list_favorites", {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"f1\"")
    expect(result.content[0]?.text).toContain("\"f2\"")
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_favorites")
  })
})

/**
 * Chain-agnostic supabase mock used for `get_asset`. The query chain is
 * `.from().select().eq().or().maybeSingle()` — refactor-friendly to use
 * the same Proxy pattern as `browse_gallery` so adding/reordering filters
 * doesn't break tests. `maybeSingle()` resolves to `{data: rows[0]|null, error: null}`.
 */
function makeChainableSingle(row: unknown) {
  const result = { data: row, error: null }
  let chain: unknown
  const promise: Promise<typeof result> = Promise.resolve(result)
  // eslint-disable-next-line prefer-const
  chain = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return promise.then.bind(promise)
      if (prop === "catch") return promise.catch.bind(promise)
      if (prop === "finally") return promise.finally.bind(promise)
      if (prop === "maybeSingle") return () => promise
      return () => chain
    },
    apply() {
      return chain
    },
  })
  return chain
}

describe("get_asset tool", () => {
  it("returns asset data when owned", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "g1",
        user_id: "u1",
        status: "completed",
        output_data: { imageUrl: "https://r2/x.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"g1\"")
  })

  it("returns asset when owned by another user but public + completed", async () => {
    // Visibility now mirrors browse_gallery: any user's public-completed
    // job is fetchable. Caller is u1; row's user_id is u2.
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "pub1",
        user_id: "u2",
        status: "completed",
        is_public: true,
        output_data: { imageUrl: "https://r2/pub.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"pub1\"")
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.outputUrl).toBe("https://r2/pub.png")
  })

  it("returns isError when not found", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle(null),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBe(true)
  })

  it("returns a clean not-found for a non-UUID id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: "not-a-uuid" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("surfaces the failure reason + retryable=false for a content-policy failure", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "failed1",
        user_id: "u1",
        status: "failed",
        job_type: "generate-image",
        output_data: {},
        error_message:
          "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.",
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    // The model reads content text — it must state the reason and that
    // re-running is pointless, so it stops retrying a permanent block.
    expect(result.content[0]?.text).toMatch(/Content policy violation/)
    expect(result.content[0]?.text).toMatch(/do NOT retry/)
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.status).toBe("failed")
    expect(sc?.retryable).toBe(false)
    expect(sc?.errorMessage).toMatch(/safety filter/)
  })

  it("marks a transient failure retryable", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "failed2",
        user_id: "u1",
        status: "failed",
        job_type: "image-to-video",
        output_data: {},
        error_message: "Generation failed. Please try again or contact support.",
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: JOB_UUID })
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.retryable).toBe(true)
  })
})

describe("display_asset tool", () => {
  it("returns image widget content for an image asset (own)", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "img1",
        user_id: "u1",
        status: "completed",
        job_type: "generate-image",
        input_data: {
          prompt: "a knight",
          provider: "nano-banana-pro",
          aspect_ratio: "16:9",
          resolution: "2K",
        },
        output_data: { imageUrl: "https://r2/img1.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.jobId).toBe("img1")
    expect(sc?.outputUrl).toBe("https://r2/img1.png")
    expect(sc?.assetKind).toBe("image")
    expect(sc?.model).toBe("nano-banana-pro")
    expect(sc?.aspectRatio).toBe("16:9")
    // Images opt into the widget's Animate / Edit / Recreate follow-ups.
    expect(sc?.imageActions).toBe(true)
  })

  it("renders a video asset through the widget (no image-only text fallback)", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "vid1",
        user_id: "u1",
        status: "completed",
        job_type: "image-to-video",
        input_data: { prompt: "knight on horse" },
        output_data: { videoUrl: "https://r2/vid1.mp4" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    // Video now returns widget structuredContent (job-auto renders <video>),
    // not the old "image-only right now" text punt.
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.jobId).toBe("vid1")
    expect(sc?.outputUrl).toBe("https://r2/vid1.mp4")
    expect(sc?.assetKind).toBe("video")
    // Image-only follow-ups are NOT offered for video.
    expect(sc?.imageActions).toBe(false)
    // Text content still carries the direct URL for non-widget hosts.
    expect(result.content[0]?.text).toContain("https://r2/vid1.mp4")
  })

  it("renders an audio asset through the widget", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "aud1",
        user_id: "u1",
        status: "completed",
        job_type: "text-to-speech",
        input_data: { prompt: "hello there" },
        output_data: { audioUrl: "https://r2/aud1.mp3" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.outputUrl).toBe("https://r2/aud1.mp3")
    expect(sc?.assetKind).toBe("audio")
    expect(sc?.imageActions).toBe(false)
  })

  it("returns asset owned by another user when public + completed", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "pub1",
        user_id: "u2",
        status: "completed",
        is_public: true,
        job_type: "generate-image",
        input_data: { prompt: "shared", provider: "flux" },
        output_data: { imageUrl: "https://r2/pub1.png" },
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.outputUrl).toBe("https://r2/pub1.png")
  })

  it("returns isError when asset has no output URL yet", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle({
        id: "pending1",
        user_id: "u1",
        status: "processing",
        job_type: "generate-image",
        input_data: { prompt: "a knight" },
        output_data: {},
      }),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not viewable/)
  })

  it("returns isError when asset not found", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle(null),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: JOB_UUID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/)
  })

  it("returns a clean not-found for a non-UUID id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: "not-a-uuid" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("display_asset")
  })
})

describe("get_app_run tool", () => {
  it("returns a clean not-found for a non-UUID execution_id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_app_run", {
      execution_id: "not-a-uuid",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe("favorite_asset tool", () => {
  it("inserts a favorite when favorited=true", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>)
      // #4: favorite_asset now first verifies the job is visible to the caller
      // (own, or public+completed) before inserting.
      .mockReturnValueOnce(makeChainableSingle({ id: "g1" }))
      .mockReturnValueOnce({ insert: insertMock })
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: JOB_UUID,
      favorited: true,
    })
    expect(result.isError).toBeUndefined()
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "u1",
      job_id: JOB_UUID,
    })
  })

  it("rejects favoriting a job the caller cannot see (cross-tenant guard)", async () => {
    // Visibility check returns null → the job is neither owned nor public.
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      makeChainableSingle(null),
    )
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: JOB_UUID_2,
      favorited: true,
    })
    expect(result.isError).toBe(true)
  })

  it("deletes a favorite when favorited=false", async () => {
    const eqMock2 = vi.fn().mockResolvedValue({ error: null })
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 })
    const deleteMock = vi.fn().mockReturnValue({ eq: eqMock1 })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      delete: deleteMock,
    })
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: JOB_UUID,
      favorited: false,
    })
    expect(result.isError).toBeUndefined()
    expect(deleteMock).toHaveBeenCalled()
  })

  it("returns a clean not-found for a non-UUID id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: "not-a-uuid",
      favorited: true,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("does NOT register without assets:write scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["assets:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("favorite_asset")
  })
})
