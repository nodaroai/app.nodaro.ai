/**
 * Node presets over MCP, beyond discovery:
 *   - the write tools — save_node_preset (create / update), delete_node_preset,
 *     favorite_node_preset — registered under assets:write (the scope the REST
 *     write routes ask an OAuth app for), each a call to its route;
 *   - what list_node_presets / get_node_preset now say about each preset:
 *     needsImage + minReferences, favorite, and previewUrl — the last one
 *     withheld from an in-app (first-party) session, whose model is never
 *     handed a media address.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "order"]) chain[m] = () => chain
      chain.eq = (column: string, value: unknown) => {
        filters[column] = value
        return chain
      }
      const rows = () => {
        db.queries.push({ table, filters: { ...filters } })
        return (db.rows[table] ?? []).filter((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        )
      }
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve)
      return chain
    },
  },
}))

const { registerPresets } = await import("../node-presets.js")

/** The text of a tool result (its first content block). */
const textOf = (res: { content: Array<{ text?: string }> }): string => res.content[0]?.text ?? ""

const USER = "u1"
const CUSTOM_ID = "11111111-2222-4333-8444-555555555555"
const PREVIEW = "https://cdn.example.test/images/j1.png"

function server(scopes: Scope[], opts: { fastify?: FastifyInstance; firstParty?: boolean } = {}) {
  const s = buildServer()
  registerPresets({
    server: s,
    session: newSession({ userId: USER, scopes, clientName: "Claude", firstParty: opts.firstParty }),
    fastify: opts.fastify ?? Fastify(),
  })
  return s
}

type Received = { method: string; url: string; body: unknown }

/** A stand-in for the preset routes: records what each tool sent, answers like the route. */
function presetRoutes(answer: { status?: number; body?: unknown } = {}): { fastify: FastifyInstance; received: Received[] } {
  const fastify = Fastify()
  const received: Received[] = []
  const row = {
    id: CUSTOM_ID,
    nodeType: "generate-image",
    name: "Mine",
    data: { prompt: "{image:1:person} on a beach" },
    tags: [],
    sortOrder: 0,
    minReferences: 1,
    needsImage: true,
    previewUrl: PREVIEW,
    createdAt: "",
    updatedAt: "2026-10-15T10:00:00Z",
  }
  const handler = (status: number, body: unknown) => async (req: FastifyRequest, reply: FastifyReply) => {
    received.push({ method: req.method, url: req.url, body: req.body })
    return reply.status(answer.status ?? status).send(answer.body ?? body)
  }
  fastify.post("/v1/node-presets", handler(201, { data: row }))
  fastify.patch("/v1/node-presets/:id", handler(200, { data: { ...row, name: "Renamed" } }))
  fastify.delete("/v1/node-presets/:id", handler(200, { data: { success: true } }))
  fastify.post("/v1/node-presets/favorites", handler(200, { data: { success: true } }))
  fastify.delete("/v1/node-presets/favorites", handler(200, { data: { success: true } }))
  return { fastify, received }
}

beforeEach(() => {
  db.rows = {}
  db.queries = []
})

describe("preset write tools — registration", () => {
  const WRITE_TOOLS = ["save_node_preset", "delete_node_preset", "favorite_node_preset"]

  it("register under assets:write, beside the reads under presets:read", async () => {
    expect((await listTools(server(["assets:write"]))).map((t) => t.name).sort()).toEqual([...WRITE_TOOLS].sort())
    const both = (await listTools(server(["presets:read", "assets:write"]))).map((t) => t.name).sort()
    expect(both).toEqual(["get_node_preset", "list_node_presets", ...WRITE_TOOLS].sort())
  })

  it("are absent without assets:write", async () => {
    for (const scopes of [[], ["presets:read"], ["assets:read"]] as Scope[][]) {
      const names = (await listTools(server(scopes))).map((t) => t.name)
      for (const tool of WRITE_TOOLS) expect(names, scopes.join(",")).not.toContain(tool)
    }
  })
})

describe("save_node_preset", () => {
  it("creates a preset through POST /v1/node-presets", async () => {
    const routes = presetRoutes()
    const res = await callTool(server(["assets:write"], { fastify: routes.fastify }), "save_node_preset", {
      nodeType: "generate-image",
      name: "Mine",
      data: { prompt: "{image:1:person} on a beach" },
      previewUrl: PREVIEW,
    })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([
      {
        method: "POST",
        url: "/v1/node-presets",
        body: { nodeType: "generate-image", name: "Mine", data: { prompt: "{image:1:person} on a beach" }, previewUrl: PREVIEW },
      },
    ])
    const body = JSON.parse(textOf(res))
    expect(body).toMatchObject({ saved: "created", id: CUSTOM_ID, name: "Mine", needsImage: true, minReferences: 1, previewUrl: PREVIEW })
  })

  it("refuses to create without nodeType, name and data, before calling the route", async () => {
    const routes = presetRoutes()
    const res = await callTool(server(["assets:write"], { fastify: routes.fastify }), "save_node_preset", { name: "Mine" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toMatch(/nodeType, name and data/)
    expect(routes.received).toEqual([])
  })

  it("updates a preset through PATCH /v1/node-presets/:id (null removes the preview)", async () => {
    const routes = presetRoutes()
    const res = await callTool(server(["assets:write"], { fastify: routes.fastify }), "save_node_preset", {
      presetId: CUSTOM_ID,
      name: "Renamed",
      previewUrl: null,
      expectedUpdatedAt: "2026-10-15T10:00:00Z",
    })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([
      {
        method: "PATCH",
        url: `/v1/node-presets/${CUSTOM_ID}`,
        body: { name: "Renamed", previewUrl: null, expectedUpdatedAt: "2026-10-15T10:00:00Z" },
      },
    ])
    expect(JSON.parse(textOf(res))).toMatchObject({ saved: "updated", name: "Renamed" })
  })

  it("refuses an update that changes nothing, before calling the route", async () => {
    const routes = presetRoutes()
    const res = await callTool(server(["assets:write"], { fastify: routes.fastify }), "save_node_preset", { presetId: CUSTOM_ID })
    expect(res.isError).toBe(true)
    expect(routes.received).toEqual([])
  })

  it("passes the route's refusal on (a name already used)", async () => {
    const routes = presetRoutes({ status: 409, body: { error: { code: "name_taken", message: "A preset with that name already exists for this node type." } } })
    const res = await callTool(server(["assets:write"], { fastify: routes.fastify }), "save_node_preset", {
      nodeType: "generate-image",
      name: "Mine",
      data: { prompt: "x" },
    })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toMatch(/already exists/)
  })
})

describe("delete_node_preset / favorite_node_preset", () => {
  it("deletes through DELETE /v1/node-presets/:id, with the revision when given", async () => {
    const routes = presetRoutes()
    const res = await callTool(server(["assets:write"], { fastify: routes.fastify }), "delete_node_preset", {
      presetId: CUSTOM_ID,
      expectedUpdatedAt: "2026-10-15T10:00:00Z",
    })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([
      { method: "DELETE", url: `/v1/node-presets/${CUSTOM_ID}?expectedUpdatedAt=2026-10-15T10%3A00%3A00Z`, body: undefined },
    ])
  })

  it("adds and removes a favorite through /v1/node-presets/favorites", async () => {
    const routes = presetRoutes()
    const s = server(["assets:write"], { fastify: routes.fastify })
    const add = await callTool(s, "favorite_node_preset", { nodeType: "generate-image", presetId: "generate-image/character-board" })
    const remove = await callTool(s, "favorite_node_preset", { nodeType: "generate-image", presetId: "generate-image/character-board", favorite: false })
    expect(add.isError).toBeFalsy()
    expect(remove.isError).toBeFalsy()
    expect(routes.received).toEqual([
      { method: "POST", url: "/v1/node-presets/favorites", body: { nodeType: "generate-image", presetId: "generate-image/character-board" } },
      { method: "DELETE", url: "/v1/node-presets/favorites?nodeType=generate-image&presetId=generate-image%2Fcharacter-board", body: undefined },
    ])
  })
})

describe("list_node_presets / get_node_preset — what each preset says", () => {
  const seed = () => {
    db.rows.node_presets = [
      { id: CUSTOM_ID, user_id: USER, node_type: "generate-image", name: "Mine", description: null, data: { prompt: "{image:1:person} on a beach" }, preview_url: PREVIEW },
      { id: "22222222-2222-4333-8444-555555555555", user_id: USER, node_type: "generate-image", name: "Plain", description: null, data: { prompt: "a fox" } },
    ]
    db.rows.node_preset_favorites = [
      { user_id: USER, node_type: "generate-image", preset_id: "generate-image/character-board" },
      { user_id: USER, node_type: "generate-image", preset_id: CUSTOM_ID },
    ]
  }

  it("list: photos needed, favorites and previews, on factory and custom presets alike", async () => {
    seed()
    const res = await callTool(server(["presets:read"]), "list_node_presets", { nodeType: "generate-image" })
    const body = JSON.parse(textOf(res))
    const mine = body.custom.find((p: { id: string }) => p.id === CUSTOM_ID)
    expect(mine).toMatchObject({ needsImage: true, minReferences: 1, favorite: true, previewUrl: PREVIEW })
    const plain = body.custom.find((p: { name: string }) => p.name === "Plain")
    expect(plain).not.toHaveProperty("needsImage")
    expect(plain).not.toHaveProperty("favorite")
    expect(plain).not.toHaveProperty("previewUrl")
    const board = body.factory.find((p: { id: string }) => p.id === "generate-image/character-board")
    expect(board).toMatchObject({ needsImage: true, minReferences: 1, favorite: true })
    const portrait = body.factory.find((p: { id: string }) => p.id === "generate-image/cinematic-portrait")
    expect(portrait).not.toHaveProperty("needsImage")
    expect(portrait).not.toHaveProperty("favorite")
    // The favorites read is the caller's own.
    expect(db.queries.filter((q) => q.table === "node_preset_favorites").every((q) => q.filters.user_id === USER)).toBe(true)
  })

  it("get: the same fields, stated in full", async () => {
    seed()
    const custom = JSON.parse(textOf(await callTool(server(["presets:read"]), "get_node_preset", { nodeType: "generate-image", presetId: CUSTOM_ID })))
    expect(custom).toMatchObject({ id: CUSTOM_ID, source: "custom", needsImage: true, minReferences: 1, favorite: true, previewUrl: PREVIEW })
    const factory = JSON.parse(
      textOf(await callTool(server(["presets:read"]), "get_node_preset", { nodeType: "generate-image", presetId: "generate-image/cinematic-portrait" })),
    )
    expect(factory).toMatchObject({ source: "factory", needsImage: false, minReferences: 0, favorite: false, previewUrl: null })
  })

  it("an in-app (first-party) session is never handed a preview address", async () => {
    seed()
    const s = server(["presets:read"], { firstParty: true })
    const list = textOf(await callTool(s, "list_node_presets", { nodeType: "generate-image" }))
    const get = textOf(await callTool(s, "get_node_preset", { nodeType: "generate-image", presetId: CUSTOM_ID }))
    expect(list).not.toContain(PREVIEW)
    expect(list).not.toContain("previewUrl")
    expect(get).not.toContain(PREVIEW)
    expect(JSON.parse(get)).toMatchObject({ needsImage: true, favorite: true })
  })
})
