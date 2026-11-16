import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import type { IncomingMessage, ServerResponse } from "node:http"
import net from "node:net"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Agent, fetch as undiciFetch } from "undici"

/**
 * What a `GET /mcp` stream costs and how it ends, with the whole app booted
 * (`buildApp`) and real sockets:
 *  - no MCP server is built for a GET, whatever it is answered; a POST still
 *    builds its own;
 *  - an open stream is never written to after its head, however long it
 *    stays open, and no timer exists for it;
 *  - the official SDK client connects, lists the tools and calls one with its
 *    GET stream open across minutes of idle time, and hears nothing on that
 *    stream;
 *  - closing the app cuts every open stream instead of waiting on it.
 * `GET /mcp` on the wire (mcp-get-stream.test.ts) holds the answers
 * themselves to what they were.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "open"
  process.env.PUBLIC_URL = "https://app.example.com"
  process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
  delete process.env.MCP_ALLOWED_CLIENT_IDS
  delete process.env.NODARO_SURFACE_PROFILE
})

const fake = vi.hoisted(() => ({ db: null as unknown, builds: 0 }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb, oauthMemorySupabase } = await import("./helpers/oauth-memory-db.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: oauthMemorySupabase(db) }
})

vi.mock("../../lib/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mcp/server.js")>()
  return {
    ...actual,
    buildMcpServer: async (...args: Parameters<typeof actual.buildMcpServer>) => {
      fake.builds++
      return actual.buildMcpServer(...args)
    },
  }
})

import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { seedLane, type Seeded } from "./helpers/mcp-lane-transcript.js"
import type { OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { openRaw, rawExchange } from "./helpers/raw-http.js"

/** Idle time stepped through: well past any keep-alive interval, and past the two minutes after which an edge closes an idle stream. */
const IDLE_STEPS_MS = [15_000, 60_000, 60_000, 60_000]

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** `until`, turning the event loop with `setImmediate`: for a test that fakes `setTimeout`. */
async function untilImmediate(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setImmediate(r))
  }
}

/** Let what a step of fake time started (a write, a socket event) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}

describe("GET /mcp streams", () => {
  let app: FastifyInstance
  let port: number
  let seeded: Seeded
  /** Every GET /mcp response the server has open (seen from the Node server, beside Fastify). */
  const openGets = new Set<ServerResponse>()
  let posts = 0

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    seeded = seedLane(fake.db as OAuthMemoryDb)
    app = await buildApp()
    await app.listen({ port: 0, host: "127.0.0.1" })
    port = (app.server.address() as { port: number }).port
    app.server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== "/mcp") return
      if (req.method === "POST") posts++
      if (req.method !== "GET") return
      openGets.add(res)
      res.once("close", () => openGets.delete(res))
    })
  }, 120_000)

  afterAll(async () => {
    vi.useRealTimers()
    app.server.closeAllConnections()
    await app.close()
  })

  afterEach(async () => {
    vi.useRealTimers()
    // A test that failed half way leaves its stream open: the next starts from none.
    for (const res of openGets) res.destroy()
    await until(() => openGets.size === 0, "leftover streams to close")
  })

  const auth = () => `Authorization: Bearer ${seeded.ownToken}`

  it("builds no MCP server for a GET, whatever it is answered; a POST still builds one", async () => {
    const before = fake.builds
    const answers = [
      await rawExchange(port, { path: "/mcp", headers: [auth(), "Accept: text/event-stream"] }),
      await rawExchange(port, { path: "/mcp", headers: [auth()] }),
      await rawExchange(port, { path: "/mcp", headers: [auth(), "Accept: text/event-stream", "mcp-protocol-version: 1999-01-01"] }),
    ]
    expect(answers.map((a) => a.status)).toEqual([200, 406, 400])
    expect(fake.builds - before).toBe(0)

    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    const post = await rawExchange(port, {
      method: "POST",
      path: "/mcp",
      headers: [auth(), "Accept: application/json, text/event-stream", "Content-Type: application/json", `Content-Length: ${Buffer.byteLength(body)}`],
      body,
      windowMs: 2_000,
    })
    expect(post.status).toBe(200)
    expect(fake.builds - before).toBe(1)
  })

  it("an open stream is never written to after its head, however long it stays open, and no timer exists for it", async () => {
    // Every timer the GET creates from here on is a fake one, so the count below
    // sees it. A bare socket: the raw-http helper waits with timers of its own.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] })
    const socket = net.connect(port, "127.0.0.1")
    let received = ""
    socket.setEncoding("latin1")
    socket.on("data", (chunk: string) => (received += chunk))
    socket.on("error", () => {})
    socket.write(`GET /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${auth()}\r\nAccept: text/event-stream\r\n\r\n`)
    const stream = { received: () => received, close: () => socket.destroy() }
    await untilImmediate(() => stream.received().includes("\r\n\r\n") && openGets.size === 1, "the stream to open")
    const head = stream.received()
    expect(head.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true)
    expect(head.endsWith("\r\n\r\n")).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    for (const step of IDLE_STEPS_MS) {
      vi.advanceTimersByTime(step)
      await settle()
    }
    expect(stream.received()).toBe(head)
    expect(vi.getTimerCount()).toBe(0)
    expect(openGets.size).toBe(1)

    stream.close()
    await untilImmediate(() => openGets.size === 0, "the server to see the client leave")
  })

  it("the official SDK client connects, lists the tools and calls one, its GET stream open across minutes of idle time and silent", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const errors: unknown[] = []
    const client = new Client({ name: "get-stream-e2e", version: "1.0.0" })
    client.onerror = (e) => errors.push(e)
    // The client's own connection pool, closed with it (as a client that exits
    // closes its connections), so none of its idle sockets outlives the test.
    const pool = new Agent()
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${seeded.ownToken}` } },
      fetch: ((url: string | URL, init?: RequestInit) =>
        undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: pool })) as unknown as typeof fetch,
    })
    const buildsBefore = fake.builds
    const postsBefore = posts
    await client.connect(transport)
    await until(() => openGets.size === 1, "the client's GET stream")

    // Everything the client hears from here on, whichever stream it came on.
    let heard = 0
    const onmessage = transport.onmessage
    transport.onmessage = (...args: Parameters<NonNullable<typeof onmessage>>) => {
      heard++
      onmessage?.(...args)
    }
    const idle = async () => {
      vi.advanceTimersByTime(60_000)
      await new Promise((r) => setTimeout(r, 50))
    }

    // No timer is kept for the open stream.
    expect(vi.getTimerCount()).toBe(0)
    await idle()
    await idle()
    expect(heard).toBe(0)
    const tools = await client.listTools()
    expect(tools.tools.some((t) => t.name === "ping")).toBe(true)
    expect(heard).toBe(1)
    await idle()
    const pong = await client.callTool({ name: "ping", arguments: {} })
    expect(JSON.stringify(pong.content)).toContain("pong")
    expect(heard).toBe(2)
    await idle()
    expect(heard).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
    expect(openGets.size).toBe(1)
    expect(errors).toEqual([])
    // A server for each POST (initialize, initialized, tools/list, tools/call), none for the GET.
    expect(posts - postsBefore).toBe(4)
    expect(fake.builds - buildsBefore).toBe(4)

    await client.close()
    await until(() => openGets.size === 0, "the GET stream to close")
    expect(vi.getTimerCount()).toBe(0)
    await pool.destroy()
  })

  // Last: it closes the app.
  it("closing the app cuts every open stream instead of waiting on it", async () => {
    const streams = Array.from({ length: 3 }, () => openRaw(port, { path: "/mcp", headers: [auth(), "Accept: text/event-stream"] }))
    for (const s of streams) expect((await s.answer).status).toBe(200)
    await until(() => openGets.size === 3, "three open streams")
    const started = Date.now()
    const outcome = await Promise.race([
      app.close().then(() => "closed"),
      new Promise((r) => setTimeout(() => r("still waiting after 5 s"), 5_000)),
    ])
    expect(outcome).toBe("closed")
    expect(Date.now() - started).toBeLessThan(2_000)
    await until(() => streams.every((s) => s.socket.destroyed), "the client sockets to close")
    expect(openGets.size).toBe(0)
  }, 15_000)
})
