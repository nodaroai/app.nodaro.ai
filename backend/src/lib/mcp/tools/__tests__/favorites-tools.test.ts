/**
 * Favorites for everything over MCP: `favorite_catalog_option` (assets:write)
 * stars a picker option through its route; `list_favorites` with `kinds` reads
 * the combined list (GET /v1/favorites) for the kinds the connection may read;
 * `favorite_asset` stars a library file by its asset id (an upload too)
 * through POST /v1/library/:id/favorite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

const { registerFavoriteTools } = await import("../favorites.js")
const { registerGallery } = await import("../gallery.js")
const { supabase } = await import("../../../supabase.js")
const { setFavoritesTablesPresentForTests } = await import("../../../favorites-tables.js")

const USER = "u1"
const ASSET = "44444444-4444-4444-8444-444444444444"
const textOf = (res: { content: Array<{ text?: string }> }): string => res.content[0]?.text ?? ""
const session = (scopes: Scope[]) => newSession({ userId: USER, scopes, clientName: "Claude" })

type Received = { method: string; url: string; query: unknown; body: unknown }
function routes(): { fastify: FastifyInstance; received: Received[] } {
  const fastify = Fastify()
  const received: Received[] = []
  const handler = (status: number, body: unknown) => async (req: FastifyRequest, reply: FastifyReply) => {
    received.push({ method: req.method, url: req.url.split("?")[0]!, query: req.query, body: req.body })
    return reply.status(status).send(body)
  }
  fastify.put("/v1/favorites/catalog/:catalog/:optionId", handler(200, { data: { catalog: "music-genre", optionId: "genre:jazz", label: "Jazz", favorited: true } }))
  fastify.delete("/v1/favorites/catalog/:catalog/:optionId", handler(200, { data: { catalog: "music-genre", optionId: "genre:jazz", favorited: false } }))
  fastify.get(
    "/v1/favorites",
    handler(200, {
      data: [
        { kind: "asset", id: ASSET, favoritedAt: "2026-11-23T10:00:01+00:00", asset: { id: ASSET, type: "image", filename: "up.png", url: "https://cdn.test/up.png", thumbnailUrl: null, createdAt: "2026-11-23T09:00:00+00:00" } },
        { kind: "catalog", id: "music-genre/genre:jazz", favoritedAt: "2026-11-23T10:00:00+00:00", catalog: { catalog: "music-genre", optionId: "genre:jazz", label: "Jazz" } },
      ],
      nextCursor: "next-page",
    }),
  )
  fastify.post("/v1/library/:id/favorite", handler(200, { favorited: true, jobId: null }))
  return { fastify, received }
}

beforeEach(() => {
  vi.clearAllMocks()
  setFavoritesTablesPresentForTests(false)
})

describe("favorite_catalog_option", () => {
  function server(scopes: Scope[], fastify: FastifyInstance = Fastify()) {
    const s = buildServer()
    registerFavoriteTools({ server: s, session: session(scopes), fastify })
    return s
  }

  it("registers under assets:write only", async () => {
    expect((await listTools(server(["assets:write"]))).map((t) => t.name)).toEqual(["favorite_catalog_option"])
    for (const scopes of [[], ["assets:read"], ["jobs:read"]] as Scope[][]) {
      expect((await listTools(server(scopes))).map((t) => t.name), scopes.join(",")).toEqual([])
    }
  })

  it("stars through PUT and unstars through DELETE, the ids encoded", async () => {
    const r = routes()
    const s = server(["assets:write"], r.fastify)
    const starred = await callTool(s, "favorite_catalog_option", { catalog: "music-genre", option_id: "genre:jazz" })
    expect(starred.isError).toBeFalsy()
    expect(textOf(starred)).toContain("Starred Jazz")
    const unstarred = await callTool(s, "favorite_catalog_option", { catalog: "music-genre", option_id: "genre:jazz", favorite: false })
    expect(unstarred.isError).toBeFalsy()
    expect(r.received.map((x) => [x.method, x.url])).toEqual([
      ["PUT", "/v1/favorites/catalog/music-genre/genre%3Ajazz"],
      ["DELETE", "/v1/favorites/catalog/music-genre/genre%3Ajazz"],
    ])
  })

  it("refuses a slash in either id before any call", async () => {
    const r = routes()
    const s = server(["assets:write"], r.fastify)
    expect((await callTool(s, "favorite_catalog_option", { catalog: "style/../x", option_id: "a" })).isError).toBe(true)
    expect((await callTool(s, "favorite_catalog_option", { catalog: "style", option_id: "a/b" })).isError).toBe(true)
    expect(r.received).toEqual([])
  })

  it("passes the route's refusal on (an unknown option is the route's 400)", async () => {
    const fastify = Fastify()
    fastify.put("/v1/favorites/catalog/:catalog/:optionId", async (_req, reply) =>
      reply.status(400).send({ error: { code: "validation_error", message: 'style has no option "nope"' } }),
    )
    const res = await callTool(server(["assets:write"], fastify), "favorite_catalog_option", { catalog: "style", option_id: "nope" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("nope")
  })
})

describe("list_favorites with kinds", () => {
  function server(scopes: Scope[], fastify: FastifyInstance) {
    const s = buildServer()
    registerGallery({ server: s, session: session(scopes), fastify })
    return s
  }

  it("reads GET /v1/favorites with the kinds, the page size and the cursor", async () => {
    const r = routes()
    const res = await callTool(server(["assets:read"], r.fastify), "list_favorites", { kinds: ["asset", "catalog"], limit: 10, cursor: "c0" })
    expect(res.isError).toBeFalsy()
    expect(r.received).toEqual([{ method: "GET", url: "/v1/favorites", query: { kinds: "asset,catalog", limit: "10", cursor: "c0" }, body: undefined }])
    const parsed = JSON.parse(textOf(res)) as { data: Array<{ kind: string }>; next_cursor: string }
    expect(parsed.data.map((d) => d.kind)).toEqual(["asset", "catalog"])
    expect(parsed.next_cursor).toBe("next-page")
    const structured = (res as { structuredContent?: { items: Array<{ jobId: string }>; favorites: unknown[] } }).structuredContent!
    // The widget shows what has media: the upload; the option rides in `favorites`.
    expect(structured.items.map((i) => i.jobId)).toEqual([ASSET])
    expect(structured.favorites).toHaveLength(2)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("claims no total count: a page's length is not the list's (a page can be short, even empty, with a cursor)", async () => {
    const r = routes()
    const res = await callTool(server(["assets:read"], r.fastify), "list_favorites", { kinds: ["asset", "catalog"] })
    const structured = (res as { structuredContent?: Record<string, unknown> }).structuredContent!
    expect(structured).not.toHaveProperty("totalCount")
    expect(structured.nextCursor).toBe("next-page")
    const tool = (await listTools(server(["assets:read"], r.fastify))).find((t) => t.name === "list_favorites")!
    expect(tool.description).toMatch(/fewer items than `limit`, even none, while next_cursor is set/)
  })

  it("refuses a kind the connection may not read (presets need presets:read), before any call", async () => {
    const r = routes()
    const res = await callTool(server(["assets:read"], r.fastify), "list_favorites", { kinds: ["preset"] })
    expect(res.isError).toBe(true)
    expect(r.received).toEqual([])
  })

  it("rejects an unknown kind in the schema", async () => {
    const r = routes()
    const res = await callTool(server(["assets:read"], r.fastify), "list_favorites", { kinds: ["albums"] })
    expect(res.isError).toBe(true)
    expect(r.received).toEqual([])
  })
})

describe("browse_uploads' favorited flag", () => {
  const UPLOAD_2 = "55555555-5555-4555-8555-555555555555"
  /** Any chain resolves to the two uploads (the page, and the count). */
  function seedUploads() {
    const rows = [ASSET, UPLOAD_2].map((id) => ({ id, type: "image", filename: `${id}.png`, r2_url: `https://cdn.test/${id}.png`, metadata: {}, created_at: "2026-11-23T10:00:00Z", job_id: null }))
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "eq", "is", "not", "neq", "order", "limit", "or", "in", "lt"]) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: null, error: null })
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null, count: rows.length })
      return chain as never
    })
  }
  const items = (res: unknown) => (res as { structuredContent: { items: Array<Record<string, unknown>> } }).structuredContent.items

  function browse() {
    const s = buildServer()
    registerGallery({ server: s, session: session(["assets:read"]), fastify: Fastify() })
    return callTool(s, "browse_uploads", { limit: 10 })
  }

  it("answers each file's favorite, by the database's predicate", async () => {
    setFavoritesTablesPresentForTests(true)
    seedUploads()
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [ASSET], error: null } as never)
    const res = await browse()
    expect(items(res).map((i) => [i.jobId, i.favorited])).toEqual([[ASSET, true], [UPLOAD_2, false]])
  })

  it("leaves the flag OUT when it cannot be read — never `false` for a file that may be starred", async () => {
    setFavoritesTablesPresentForTests(true)
    seedUploads()
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } } as never)
    const res = await browse()
    expect(res.isError).toBeFalsy()
    expect(items(res)).toHaveLength(2)
    for (const item of items(res)) expect(item).not.toHaveProperty("favorited")
  })
})

describe("favorite_asset by asset id", () => {
  it("stars a library file through POST /v1/library/:id/favorite with the wanted state", async () => {
    const r = routes()
    const s = buildServer()
    registerGallery({ server: s, session: session(["assets:write"]), fastify: r.fastify })
    const res = await callTool(s, "favorite_asset", { asset_id: ASSET, favorited: true })
    expect(res.isError).toBeFalsy()
    expect(r.received).toEqual([{ method: "POST", url: `/v1/library/${ASSET}/favorite`, query: {}, body: { favorited: true } }])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("favorited=true on a job already favorited (an earlier or concurrent call) is success, and never deletes", async () => {
    const calls: string[] = []
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "is", "eq", "or"]) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: { id: ASSET }, error: null })
      chain.insert = async () => (calls.push(`insert ${table}`), { error: { code: "23505", message: "duplicate key" } })
      chain.delete = () => (calls.push(`delete ${table}`), chain)
      return chain as never
    })
    const s = buildServer()
    registerGallery({ server: s, session: session(["assets:write"]), fastify: Fastify() })
    const res = await callTool(s, "favorite_asset", { job_id: ASSET, favorited: true })
    expect(res.isError).toBeFalsy()
    expect(textOf(res)).toBe(`Favorited asset ${ASSET}`)
    expect(calls).toEqual(["insert gallery_favorites"])
  })

  it("needs a job_id or an asset_id", async () => {
    const s = buildServer()
    registerGallery({ server: s, session: session(["assets:write"]), fastify: Fastify() })
    expect((await callTool(s, "favorite_asset", { favorited: true })).isError).toBe(true)
  })
})
