import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import type { SavedPost } from "@nodaro/shared"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { registerSavedPostTools, savedPostText } from "../saved-posts.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const SAVE: SavedPost = {
  id: "00000000-0000-4000-8000-0000000000aa",
  postId: "reddit:abc",
  platform: "reddit",
  url: "https://www.reddit.com/r/running/comments/abc/",
  post: {
    id: "reddit:abc",
    platform: "reddit",
    url: "https://www.reddit.com/r/running/comments/abc/",
    title: "What finally fixed my shin splints",
    text: "Long story",
    author: { handle: "runner", name: "runner" },
    publishedAt: "2026-09-30T08:00:00Z",
    metrics: { score: 812, comments: 140 },
    media: { kind: "text" },
    hashtags: [],
    extra: {},
  },
  thumbnailUrl: null,
  note: "great pain-point\nopener",
  tags: ["hooks", "running"],
  source: "picker",
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-10-01T12:00:00Z",
}

function session(scopes: Scope[]) {
  return newSession({ userId: "u1", scopes, clientName: "Claude" })
}

function stubApp(status = 200) {
  const fastify = Fastify()
  const received: { method?: string; url?: string; body?: Record<string, unknown>; userHeader?: unknown } = {}
  fastify.post("/v1/saved-posts", async (req, reply) => {
    received.method = "POST"
    received.body = req.body as Record<string, unknown>
    return reply.status(status === 200 ? 201 : status).send(status === 200 ? SAVE : { error: { code: "not_available", message: "x" } })
  })
  fastify.get("/v1/saved-posts", async (req, reply) => {
    received.method = "GET"
    received.url = req.url
    received.userHeader = req.headers["x-internal-user-id"]
    return reply.status(status).send(status === 200 ? { data: [SAVE], nextCursor: "2026-10-01T12:00:00Z|x" } : { error: { code: "x" } })
  })
  return { fastify, received }
}

describe("saved-post MCP tools", () => {
  it("each tool needs its own assets scope", async () => {
    const readOnly = buildServer()
    registerSavedPostTools({ server: readOnly, session: session(["assets:read"]), fastify: stubApp().fastify })
    expect((await listTools(readOnly)).map((t) => t.name)).toEqual(["list_saved_posts"])

    const none = buildServer()
    registerSavedPostTools({ server: none, session: session(["workflows:execute"]), fastify: stubApp().fastify })
    expect(await listTools(none)).toEqual([])
  })

  it("save_post sends the post unchanged, as the session's user", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerSavedPostTools({ server, session: session(["assets:write"]), fastify: stub.fastify })
    const res = await callTool(server, "save_post", { post: SAVE.post, note: "opener", tags: ["hooks"] })

    expect(res.isError).toBeFalsy()
    expect(stub.received.body).toMatchObject({ post: SAVE.post, note: "opener", tags: ["hooks"], source: "api", userId: "u1" })
    expect(JSON.stringify(res.content)).toContain(SAVE.id)
  })

  it("save_post says plainly when the server has no saved posts yet", async () => {
    const server = buildServer()
    registerSavedPostTools({ server, session: session(["assets:write"]), fastify: stubApp(503).fastify })
    const res = await callTool(server, "save_post", { post: SAVE.post })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res.content)).toContain("not available on this server yet")
  })

  it("list_saved_posts passes the filters and the user, and offers the next page", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerSavedPostTools({ server, session: session(["assets:read"]), fastify: stub.fastify })
    const res = await callTool(server, "list_saved_posts", { platform: "reddit", tag: "hooks", q: "shin" })

    expect(res.isError).toBeFalsy()
    expect(stub.received.userHeader).toBe("u1")
    expect(stub.received.url).toContain("platform=reddit")
    expect(stub.received.url).toContain("tag=hooks")
    expect(stub.received.url).toContain("limit=20")
    const text = JSON.stringify(res.content)
    expect(text).toContain("What finally fixed my shin splints")
    expect(text).toContain("2026-10-01T12:00:00Z|x")
  })

  it("savedPostText reads as the digest line plus the person's note and tags", () => {
    expect(savedPostText(SAVE, 0)).toBe(
      [
        "1. @runner · 2026-09-30 · 812 points",
        "   What finally fixed my shin splints",
        "   https://www.reddit.com/r/running/comments/abc/",
        "   note: great pain-point opener",
        "   tags: hooks, running",
        "   save id: 00000000-0000-4000-8000-0000000000aa · saved 2026-10-01",
      ].join("\n"),
    )
  })
})
