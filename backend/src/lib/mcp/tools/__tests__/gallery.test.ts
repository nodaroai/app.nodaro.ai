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
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
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
    const result = await callTool(server, "get_asset", { job_id: "g1" })
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
    const result = await callTool(server, "get_asset", { job_id: "pub1" })
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
    const result = await callTool(server, "get_asset", { job_id: "missing" })
    expect(result.isError).toBe(true)
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
    const result = await callTool(server, "display_asset", { job_id: "img1" })
    expect(result.isError).toBeUndefined()
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc?.jobId).toBe("img1")
    expect(sc?.outputUrl).toBe("https://r2/img1.png")
    expect(sc?.assetKind).toBe("image")
    expect(sc?.model).toBe("nano-banana-pro")
    expect(sc?.aspectRatio).toBe("16:9")
  })

  it("returns text-only (no widget) for video assets", async () => {
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
    const result = await callTool(server, "display_asset", { job_id: "vid1" })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("vid1")
    expect(result.content[0]?.text).toContain("https://r2/vid1.mp4")
    // Video falls back to text — no widget structuredContent.
    const sc = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent
    expect(sc).toBeUndefined()
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
    const result = await callTool(server, "display_asset", { job_id: "pub1" })
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
    const result = await callTool(server, "display_asset", { job_id: "pending1" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not viewable/)
  })

  it("returns isError when asset not found", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChainableSingle(null),
    )
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "display_asset", { job_id: "missing" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/)
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

describe("favorite_asset tool", () => {
  it("inserts a favorite when favorited=true", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      insert: insertMock,
    })
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: "g1",
      favorited: true,
    })
    expect(result.isError).toBeUndefined()
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "u1",
      job_id: "g1",
    })
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
      job_id: "g1",
      favorited: false,
    })
    expect(result.isError).toBeUndefined()
    expect(deleteMock).toHaveBeenCalled()
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
