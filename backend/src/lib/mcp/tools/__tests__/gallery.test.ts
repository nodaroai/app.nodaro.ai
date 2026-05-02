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
