/**
 * The MCP face of /v1/palettes and /v1/moodboards: list_palettes, save_palette,
 * list_moodboards, save_moodboard. Reads under assets:read, writes under
 * assets:write (the scopes the REST routes ask an OAuth app for); every call
 * goes through the route as the session's user. No delete here — a person
 * deletes in the app, the CLI or the API.
 */
import { describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const assets = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock("../../asset-resolver.js", () => ({ resolveAssetId: assets.resolve }))

import { registerPaletteMoodboardTools } from "../palettes-moodboards.js"

const PALETTE = {
  id: "00000000-0000-4000-8000-000000000031",
  name: "Harbour",
  colors: ["#0F4C5C", "#E3B23C"],
  description: null,
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T10:00:00Z",
}
const BOARD = {
  id: "00000000-0000-4000-8000-000000000041",
  name: "Nordic calm",
  description: "Moody Nordic interiors",
  images: [{ url: "https://cdn.test/a.png", caption: "linen" }, { url: "https://cdn.test/b.png" }],
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T10:00:00Z",
}

function session(scopes: Scope[]) {
  return newSession({ userId: "u1", scopes, clientName: "Claude" })
}

interface Seen { method: string; url: string; user: unknown; body?: Record<string, unknown> }

function stubApp(opts: { status?: number; nextCursor?: string | null } = {}) {
  const fastify = Fastify()
  const seen: Seen[] = []
  const note = (req: { method: string; url: string; headers: Record<string, unknown>; body?: unknown }) =>
    seen.push({ method: req.method, url: req.url, user: req.headers["x-internal-user-id"], body: req.body as Record<string, unknown> | undefined })
  const fail = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.status(opts.status!).send({ error: { code: "direction_not_found", message: "no palette here" } })
  fastify.get("/v1/palettes", async (req, reply) => { note(req); return opts.status ? fail(reply) : { data: [PALETTE], nextCursor: opts.nextCursor ?? null } })
  fastify.post("/v1/palettes", async (req, reply) => { note(req); return opts.status ? fail(reply) : reply.status(201).send(PALETTE) })
  fastify.patch("/v1/palettes/:id", async (req, reply) => { note(req); return opts.status ? fail(reply) : PALETTE })
  fastify.get("/v1/moodboards", async (req) => { note(req); return { data: [BOARD], nextCursor: opts.nextCursor ?? null } })
  fastify.get("/v1/moodboards/:id", async (req) => { note(req); return BOARD })
  fastify.post("/v1/moodboards", async (req, reply) => { note(req); return reply.status(201).send(BOARD) })
  fastify.patch("/v1/moodboards/:id", async (req) => { note(req); return BOARD })
  return { fastify, seen }
}

const text = (res: { content: unknown }) => JSON.stringify(res.content)

describe("palette & moodboard MCP tools", () => {
  it("each tool needs its own assets scope, and there is no delete", async () => {
    const read = buildServer()
    registerPaletteMoodboardTools({ server: read, session: session(["assets:read"]), fastify: stubApp().fastify })
    expect((await listTools(read)).map((t) => t.name).sort()).toEqual(["list_moodboards", "list_palettes"])

    const write = buildServer()
    registerPaletteMoodboardTools({ server: write, session: session(["assets:write"]), fastify: stubApp().fastify })
    expect((await listTools(write)).map((t) => t.name).sort()).toEqual(["save_moodboard", "save_palette"])

    const none = buildServer()
    registerPaletteMoodboardTools({ server: none, session: session(["workflows:execute"]), fastify: stubApp().fastify })
    expect(await listTools(none)).toEqual([])
  })

  it("list_palettes lists as the session's user, colours named with their hex, and the next cursor", async () => {
    const server = buildServer()
    const stub = stubApp({ nextCursor: "abc" })
    registerPaletteMoodboardTools({ server, session: session(["assets:read"]), fastify: stub.fastify })
    const res = await callTool(server, "list_palettes", {})
    expect(res.isError).toBeFalsy()
    expect(stub.seen[0]).toMatchObject({ method: "GET", url: "/v1/palettes", user: "u1" })
    expect(text(res)).toContain("Harbour")
    expect(text(res)).toContain("#0F4C5C")
    expect(text(res)).toContain(PALETTE.id)
    expect(text(res)).toContain('cursor \\"abc\\"')
  })

  it("save_palette creates without an id and needs a name and colours to", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerPaletteMoodboardTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const res = await callTool(server, "save_palette", { name: "Harbour", colors: ["#0F4C5C", "#E3B23C"] })
    expect(res.isError).toBeFalsy()
    expect(stub.seen[0]).toMatchObject({ method: "POST", url: "/v1/palettes", body: { name: "Harbour", colors: ["#0F4C5C", "#E3B23C"] } })
    expect(text(res)).toContain(PALETTE.id)

    const missing = await callTool(server, "save_palette", { name: "Harbour" })
    expect(missing.isError).toBe(true)
    expect(stub.seen).toHaveLength(1)
  })

  it("save_palette with an id changes only what it was given", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerPaletteMoodboardTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    await callTool(server, "save_palette", { id: PALETTE.id, description: "Summer" })
    expect(stub.seen[0]).toMatchObject({ method: "PATCH", url: `/v1/palettes/${PALETTE.id}`, body: { description: "Summer" } })
    expect(stub.seen[0].body).not.toHaveProperty("name")
  })

  it("surfaces the route's refusal as an error the model can read", async () => {
    const server = buildServer()
    registerPaletteMoodboardTools({ server, session: session(["assets:read"]), fastify: stubApp({ status: 404 }).fastify })
    const res = await callTool(server, "list_palettes", {})
    expect(res.isError).toBe(true)
    expect(text(res)).toContain("404")
  })

  it("list_moodboards lists, and reads one in full by id", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerPaletteMoodboardTools({ server, session: session(["assets:read"]), fastify: stub.fastify })
    const list = await callTool(server, "list_moodboards", {})
    expect(text(list)).toContain("Nordic calm")
    expect(text(list)).toContain("2 images")

    const one = await callTool(server, "list_moodboards", { id: BOARD.id })
    expect(stub.seen[1]).toMatchObject({ method: "GET", url: `/v1/moodboards/${BOARD.id}`, user: "u1" })
    expect(text(one)).toContain("https://cdn.test/a.png")
    expect(text(one)).toContain("linen")
  })

  it("save_moodboard turns a Nodaro asset id into its link and keeps the captions", async () => {
    assets.resolve.mockReset().mockResolvedValue("https://cdn.test/from-asset.png")
    const server = buildServer()
    const stub = stubApp()
    registerPaletteMoodboardTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const res = await callTool(server, "save_moodboard", {
      name: "Nordic calm",
      description: "Moody Nordic interiors",
      images: [{ url: "https://cdn.test/a.png", caption: "linen" }, { url: "00000000-0000-4000-8000-0000000000aa" }],
    })
    expect(res.isError).toBeFalsy()
    expect(assets.resolve).toHaveBeenCalledWith({ assetId: "00000000-0000-4000-8000-0000000000aa", userId: "u1", expectedKind: "image" })
    expect(stub.seen[0]).toMatchObject({
      method: "POST",
      url: "/v1/moodboards",
      body: {
        name: "Nordic calm",
        description: "Moody Nordic interiors",
        images: [{ url: "https://cdn.test/a.png", caption: "linen" }, { url: "https://cdn.test/from-asset.png" }],
      },
    })
  })

  it("save_moodboard says which image could not be resolved, and saves nothing", async () => {
    assets.resolve.mockReset().mockRejectedValue(new Error("forbidden: asset belongs to a different user"))
    const server = buildServer()
    const stub = stubApp()
    registerPaletteMoodboardTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const res = await callTool(server, "save_moodboard", { name: "x", images: [{ url: "not-mine" }] })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain("not-mine")
    expect(stub.seen).toHaveLength(0)
  })

  it("save_moodboard with an id replaces the images it is given", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerPaletteMoodboardTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    await callTool(server, "save_moodboard", { id: BOARD.id, images: [{ url: "https://cdn.test/c.png" }] })
    expect(stub.seen[0]).toMatchObject({ method: "PATCH", url: `/v1/moodboards/${BOARD.id}`, body: { images: [{ url: "https://cdn.test/c.png" }] } })
  })
  // The tools paste an id into a route path; the injected request carries the
  // internal secret (no app scope check), so an id must never reach another route.
  it.each([
    ["list_moodboards", "assets:read", { id: "../api-tokens" }],
    ["list_moodboards", "assets:read", { id: "%2e%2e/api-tokens" }],
    ["save_palette", "assets:write", { id: "../user/settings", name: "x" }],
    ["save_moodboard", "assets:write", { id: "../api-tokens", name: "x" }],
    ["save_palette", "assets:write", { id: "not-a-uuid", name: "x" }],
  ] as const)("%s refuses a non-uuid id (%s) and calls no route", async (tool, scope, args) => {
    const server = buildServer()
    const stub = stubApp()
    const decoy = vi.fn(async () => ({ hit: true }))
    stub.fastify.get("/v1/api-tokens", decoy)
    stub.fastify.patch("/v1/api-tokens", decoy)
    stub.fastify.patch("/v1/user/settings", decoy)
    registerPaletteMoodboardTools({ server, session: session([scope]), fastify: stub.fastify })
    const res = await callTool(server, tool, args)
    expect(res.isError).toBe(true)
    expect(text(res)).toContain("id")
    expect(decoy).not.toHaveBeenCalled()
    expect(stub.seen).toHaveLength(0)
  })
})
