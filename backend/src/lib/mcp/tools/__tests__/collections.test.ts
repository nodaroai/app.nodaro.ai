import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import type { Collection, CollectionRecord } from "@nodaro/shared"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { collectionLine, registerCollectionTools, sinceFor } from "../collections.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const NEWS: Collection = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "News",
  description: "Articles the pipeline wrote",
  recordCount: 12,
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
}

const RECORD: CollectionRecord = {
  id: "00000000-0000-4000-8000-0000000000e1",
  collectionId: NEWS.id,
  title: "Telegram turns ten",
  text: "The messenger marks a decade.",
  url: "https://t.me/telegram/441",
  media: [],
  fields: { channel: "telegram" },
  dedupeKey: "https://t.me/telegram/441",
  source: { via: "node" },
  createdAt: "2026-10-06T09:00:00Z",
}

function session(scopes: Scope[]) {
  return newSession({ userId: "u1", scopes, clientName: "Claude" })
}

type Received = { listHeader?: unknown; listCalls: number; getUrl?: string; recordsUrl?: string; recordsHeader?: unknown; recordBody?: Record<string, unknown>; createBody?: Record<string, unknown> }

const LEADS: Collection = { ...NEWS, id: "00000000-0000-4000-8000-0000000000c9", name: "Leads", recordCount: 0 }

function stubApp(
  opts: {
    collections?: Collection[]
    available?: boolean
    status?: number
    outcome?: "inserted" | "duplicate" | "replayed"
    evicted?: number
    nextCursor?: string | null
    records?: CollectionRecord[]
    /** POST /v1/collections answers 409 and the NEXT list shows the collection another call created. */
    createConflict?: boolean
  } = {},
) {
  const fastify = Fastify()
  const received: Received = { listCalls: 0 }
  const status = opts.status ?? 200
  fastify.get("/v1/collections", async (req, reply) => {
    received.listHeader = req.headers["x-internal-user-id"]
    received.listCalls += 1
    if (status >= 400) return reply.status(status).send({ error: { code: "x", message: "x" } })
    const data = opts.createConflict && received.listCalls > 1 ? [...(opts.collections ?? [NEWS]), LEADS] : (opts.collections ?? [NEWS])
    return { data, available: opts.available ?? true, caps: { collections: 3, records: 500 } }
  })
  fastify.get("/v1/collections/:id", async (req, reply) => {
    received.getUrl = req.url
    const found = (opts.collections ?? [NEWS]).find((c) => c.id === (req.params as { id: string }).id)
    return found ? reply.send(found) : reply.status(404).send({ error: { code: "not_found", message: "Collection not found" } })
  })
  fastify.get("/v1/collections/:id/records", async (req, reply) => {
    received.recordsUrl = req.url
    received.recordsHeader = req.headers["x-internal-user-id"]
    return reply.send({ data: opts.records ?? [RECORD], nextCursor: opts.nextCursor ?? null })
  })
  fastify.post("/v1/collections/:id/records", async (req, reply) => {
    received.recordBody = req.body as Record<string, unknown>
    if (status >= 400) return reply.status(status).send({ error: { code: "not_available", message: "x" } })
    const outcome = opts.outcome ?? "inserted"
    return reply.status(outcome === "inserted" ? 201 : 200).send({ record: RECORD, outcome, evicted: opts.evicted ?? 0 })
  })
  fastify.post("/v1/collections", async (req, reply) => {
    received.createBody = req.body as Record<string, unknown>
    if (opts.createConflict) return reply.status(409).send({ error: { code: "name_taken", message: "You already have a collection with that name." } })
    return reply.status(201).send({ ...LEADS, name: (req.body as { name: string }).name })
  })
  return { fastify, received }
}

describe("collection MCP tools", () => {
  it("each tool needs its own assets scope", async () => {
    const readOnly = buildServer()
    registerCollectionTools({ server: readOnly, session: session(["assets:read"]), fastify: stubApp().fastify })
    expect((await listTools(readOnly)).map((t) => t.name).sort()).toEqual(["list_collections", "read_collection"])

    const writeOnly = buildServer()
    registerCollectionTools({ server: writeOnly, session: session(["assets:write"]), fastify: stubApp().fastify })
    expect((await listTools(writeOnly)).map((t) => t.name)).toEqual(["add_collection_record"])

    const none = buildServer()
    registerCollectionTools({ server: none, session: session(["workflows:execute"]), fastify: stubApp().fastify })
    expect(await listTools(none)).toEqual([])
  })

  it("list_collections names each collection with its size and the caps, as the session's user", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerCollectionTools({ server, session: session(["assets:read"]), fastify: stub.fastify })
    const res = await callTool(server, "list_collections", {})
    expect(res.isError).toBeFalsy()
    expect(stub.received.listHeader).toBe("u1")
    const text = JSON.stringify(res.content)
    expect(text).toContain("News — 12 records · Articles the pipeline wrote (id 00000000-0000-4000-8000-0000000000c1)")
    expect(text).toContain("Caps: 3 collections, 500 records each.")
  })

  it("list_collections says plainly when the server has no collections yet", async () => {
    const server = buildServer()
    registerCollectionTools({ server, session: session(["assets:read"]), fastify: stubApp({ available: false, collections: [] }).fastify })
    expect(JSON.stringify((await callTool(server, "list_collections", {})).content)).toContain("not available on this server yet")
  })

  it("read_collection resolves a name, passes the window, words and limit, and prints the digest with the next cursor", async () => {
    const server = buildServer()
    const stub = stubApp({ nextCursor: "abc" })
    registerCollectionTools({ server, session: session(["assets:read"]), fastify: stub.fastify })
    const before = Date.now()
    const res = await callTool(server, "read_collection", { collection: "news", hours: 48, q: "telegram", limit: 10 })
    expect(res.isError).toBeFalsy()
    expect(stub.received.recordsHeader).toBe("u1")
    const url = new URL(`http://x${stub.received.recordsUrl}`)
    expect(url.pathname).toBe(`/v1/collections/${NEWS.id}/records`)
    expect(url.searchParams.get("limit")).toBe("10")
    expect(url.searchParams.get("q")).toBe("telegram")
    const since = Date.parse(url.searchParams.get("since")!)
    expect(before - since).toBeGreaterThanOrEqual(48 * 3_600_000 - 1_000)
    expect(before - since).toBeLessThan(48 * 3_600_000 + 60_000)
    const text = JSON.stringify(res.content)
    // The page's own count, never the collection's total (which counts the Trash too).
    expect(text).toContain('\\"News\\" — 1 record since')
    expect(text).toContain("- Telegram turns ten · 2026-10-06 · https://t.me/telegram/441")
    expect(text).toContain('cursor \\"abc\\"')
  })

  it("read_collection passes `usage` through — never the default — so a queue reads only what is not used yet", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerCollectionTools({ server, session: session(["assets:read"]), fastify: stub.fastify })
    expect((await callTool(server, "read_collection", { collection: "news", usage: "unused" })).isError).toBeFalsy()
    expect(new URL(`http://x${stub.received.recordsUrl}`).searchParams.get("usage")).toBe("unused")
    expect((await callTool(server, "read_collection", { collection: "news", usage: "all" })).isError).toBeFalsy()
    expect(new URL(`http://x${stub.received.recordsUrl}`).searchParams.get("usage")).toBeNull()
  })

  it("read_collection by id reads that one collection (never the whole list), in full, and an empty window says so", async () => {
    const server = buildServer()
    const stub = stubApp({ records: [] })
    registerCollectionTools({ server, session: session(["assets:read"]), fastify: stub.fastify })
    const res = await callTool(server, "read_collection", { collection: NEWS.id, days: 2, format: "full" })
    expect(res.isError).toBeFalsy()
    expect(JSON.stringify(res.content)).toContain("has no records since")
    expect(stub.received.getUrl).toBe(`/v1/collections/${NEWS.id}`)
    expect(stub.received.listCalls).toBe(0)
    expect(stub.received.recordsUrl).toContain(`/v1/collections/${NEWS.id}/records`)
  })

  it("read_collection names the collections that exist when the one asked for does not, by name or by id", async () => {
    const server = buildServer()
    registerCollectionTools({ server, session: session(["assets:read"]), fastify: stubApp().fastify })
    const byName = await callTool(server, "read_collection", { collection: "Leads" })
    expect(byName.isError).toBe(true)
    expect(JSON.stringify(byName.content)).toContain('No collection \\"Leads\\". You have: \\"News\\".')
    const byId = await callTool(server, "read_collection", { collection: LEADS.id })
    expect(byId.isError).toBe(true)
    expect(JSON.stringify(byId.content)).toContain(`No collection \\"${LEADS.id}\\". You have: \\"News\\".`)
  })

  it("add_collection_record maps the item through the route as the session's user, from mcp", async () => {
    const server = buildServer()
    const stub = stubApp({ evicted: 2 })
    registerCollectionTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const item = { postUrl: "https://t.me/telegram/441", text: "Telegram turns ten." }
    const res = await callTool(server, "add_collection_record", { collection: "News", item, fields: { topic: "tech" } })
    expect(res.isError).toBeFalsy()
    expect(stub.received.recordBody).toMatchObject({ item, fields: { topic: "tech" }, source: { via: "mcp" }, userId: "u1" })
    const text = JSON.stringify(res.content)
    expect(text).toContain(`Saved to \\"News\\" (record id ${RECORD.id}). 2 oldest records evicted past the cap.`)
  })

  it("add_collection_record reports a duplicate and a replay as what they are", async () => {
    const dup = buildServer()
    registerCollectionTools({ server: dup, session: session(["assets:write"]), fastify: stubApp({ outcome: "duplicate" }).fastify })
    expect(JSON.stringify((await callTool(dup, "add_collection_record", { collection: "News", url: "https://t.me/telegram/441" })).content)).toContain(
      "Already in \\\"News\\\": the same link or key was saved 2026-10-06",
    )
    const replay = buildServer()
    registerCollectionTools({ server: replay, session: session(["assets:write"]), fastify: stubApp({ outcome: "replayed" }).fastify })
    expect(JSON.stringify((await callTool(replay, "add_collection_record", { collection: "News", text: "x" })).content)).toContain("Already saved by this same write")
  })

  it("add_collection_record creates the collection on request, and refuses an unknown one otherwise", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerCollectionTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const refused = await callTool(server, "add_collection_record", { collection: "Leads", text: "x" })
    expect(refused.isError).toBe(true)
    expect(stub.received.createBody).toBeUndefined()

    const created = await callTool(server, "add_collection_record", { collection: "Leads", text: "x", create_if_missing: true })
    expect(created.isError).toBeFalsy()
    expect(stub.received.createBody).toMatchObject({ name: "Leads", userId: "u1" })
    expect(JSON.stringify(created.content)).toContain('Saved to \\"Leads\\"')
  })

  it("add_collection_record that loses the race to create the collection reads it back and saves", async () => {
    const server = buildServer()
    const stub = stubApp({ createConflict: true })
    registerCollectionTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const res = await callTool(server, "add_collection_record", { collection: "Leads", text: "x", create_if_missing: true })
    expect(res.isError).toBeFalsy()
    expect(stub.received.listCalls).toBe(2)
    expect(JSON.stringify(res.content)).toContain('Saved to \\"Leads\\"')
  })

  it("add_collection_record says plainly when the server has no collections yet", async () => {
    const server = buildServer()
    registerCollectionTools({ server, session: session(["assets:write"]), fastify: stubApp({ available: false, collections: [] }).fastify })
    const res = await callTool(server, "add_collection_record", { collection: "News", text: "x" })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res.content)).toContain("not available on this server yet")
  })

  it("collectionLine and sinceFor read as documented", () => {
    expect(collectionLine({ ...NEWS, recordCount: 1, description: "" })).toBe(`- News — 1 record (id ${NEWS.id})`)
    const now = Date.parse("2026-10-06T12:00:00Z")
    expect(sinceFor({ hours: 2 }, now)).toBe("2026-10-06T10:00:00.000Z")
    expect(sinceFor({ days: 1, hours: 12 }, now)).toBe("2026-10-05T00:00:00.000Z")
    expect(sinceFor({}, now)).toBeUndefined()
  })
})
