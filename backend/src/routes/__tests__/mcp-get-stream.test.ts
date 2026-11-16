import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import http from "node:http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js"

/**
 * `GET /mcp`, the stream a client opens for messages the server starts, as a
 * client sees it on the wire: the status line, every header line in the order
 * and case it is sent, and the bytes that follow. Read over a raw socket
 * against the whole app (`buildApp`, every hook), because only that shows the
 * exact form (`inject` cannot hold a stream open, and a bare Fastify would
 * leave out the hooks' headers).
 *
 * Two holds on it:
 *  - the answers as they were, written out, for each kind of caller: signed
 *    in with and without an event-stream `Accept`, a protocol version the SDK
 *    does not know, no token, a token that does not resolve, and a caller the
 *    client list refuses;
 *  - every answer past those refusals equal to what the SDK's own stateless
 *    transport answers for the same request, served beside the app on a plain
 *    Node server. An SDK upgrade that changes how a GET is answered fails here
 *    instead of drifting from a copy.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "open"
  process.env.PUBLIC_URL = "https://app.example.com"
  process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
  delete process.env.MCP_ALLOWED_CLIENT_IDS
  delete process.env.NODARO_SURFACE_PROFILE
})

const fake = vi.hoisted(() => ({ db: null as unknown }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb, oauthMemorySupabase } = await import("./helpers/oauth-memory-db.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: oauthMemorySupabase(db) }
})

import { buildApp } from "../../app.js"
import { config } from "../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { OWN_CLIENT_ID, seedLane, type Seeded } from "./helpers/mcp-lane-transcript.js"
import type { OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { rawExchange, type RawAnswer, type RawRequest } from "./helpers/raw-http.js"

const STREAM_HEAD = [
  "cache-control: no-cache, no-transform",
  "connection: keep-alive",
  "content-type: text/event-stream",
  "Date: <masked>",
  "Transfer-Encoding: chunked",
]

function jsonRpcError(status: string, message: string) {
  const body = JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null })
  return {
    statusLine: `HTTP/1.1 ${status}`,
    headerLines: ["content-type: application/json", `content-length: ${Buffer.byteLength(body)}`, "Date: <masked>", "Connection: keep-alive", "Keep-Alive: timeout=72"],
    body,
    ended: false,
  }
}

/** A refusal the route itself sends (through Fastify, so its hooks' headers come with it). */
function routeRefusal(status: string, extra: string[], body: unknown) {
  const text = JSON.stringify(body)
  return {
    statusLine: `HTTP/1.1 ${status}`,
    headerLines: [
      "vary: Origin",
      "access-control-allow-credentials: true",
      "x-ratelimit-limit: 600",
      "x-ratelimit-remaining: <n>",
      "x-ratelimit-reset: <n>",
      ...extra,
      "content-type: application/json; charset=utf-8",
      `content-length: ${Buffer.byteLength(text)}`,
      "Date: <masked>",
      "Connection: keep-alive",
      "Keep-Alive: timeout=72",
    ],
    body: text,
    ended: false,
  }
}

const UNAUTHORIZED = routeRefusal(
  "401 Unauthorized",
  ['www-authenticate: Bearer realm="mcp.example.com", resource="https://mcp.example.com/mcp"'],
  { error: { code: "unauthorized", message: "MCP requires a Bearer token. See /.well-known/oauth-protected-resource." } },
)

/** The parts of a raw answer a client can tell apart, the rate-limit counters masked (they move with every call). */
function seen(a: RawAnswer) {
  return {
    statusLine: a.statusLine,
    headerLines: a.headerLines.map((l) => l.replace(/^(x-ratelimit-(remaining|reset)): \d+$/, "$1: <n>")),
    body: a.body,
    ended: a.ended,
  }
}

describe("GET /mcp on the wire", () => {
  let app: FastifyInstance
  let port: number
  let seeded: Seeded
  let db: OAuthMemoryDb
  /** The SDK's own stateless transport, one per request, no MCP server behind it. */
  let reference: http.Server
  let referencePort: number

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    db = fake.db as OAuthMemoryDb
    seeded = seedLane(db)
    app = await buildApp()
    await app.listen({ port: 0, host: "127.0.0.1" })
    port = (app.server.address() as { port: number }).port
    reference = http.createServer((req, res) => {
      void new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }).handleRequest(req, res)
    })
    reference.keepAliveTimeout = app.server.keepAliveTimeout
    await new Promise<void>((r) => reference.listen(0, "127.0.0.1", () => r()))
    referencePort = (reference.address() as { port: number }).port
  }, 120_000)

  afterAll(async () => {
    reference.closeAllConnections()
    await new Promise<void>((r) => reference.close(() => r()))
    app.server.closeAllConnections()
    await app.close()
  })

  const listedAtBoot = config.MCP_ALLOWED_CLIENT_IDS
  afterEach(() => {
    config.MCP_ALLOWED_CLIENT_IDS = listedAtBoot
    db.failReads.clear()
  })

  const signedIn = () => `Authorization: Bearer ${seeded.ownToken}`
  const get = (headers: string[], more: Partial<RawRequest> = {}) => rawExchange(port, { path: "/mcp", headers, ...more })

  describe("answers as it always did", () => {
    it("signed in, accepting an event stream: 200 and an open stream, not a byte in it", async () => {
      for (const token of [seeded.ownToken, seeded.apiToken]) {
        const a = await get([`Authorization: Bearer ${token}`, "Accept: text/event-stream"])
        expect(seen(a)).toEqual({ statusLine: "HTTP/1.1 200 OK", headerLines: STREAM_HEAD, body: "", ended: false })
      }
    })

    it("signed in, not accepting an event stream: 406", async () => {
      for (const accept of [[], ["Accept: application/json"], ["Accept: */*"]]) {
        expect(seen(await get([signedIn(), ...accept]))).toEqual(jsonRpcError("406 Not Acceptable", "Not Acceptable: Client must accept text/event-stream"))
      }
    })

    it("signed in, naming a protocol version the SDK does not know: 400", async () => {
      const supported = SUPPORTED_PROTOCOL_VERSIONS.join(", ")
      expect(seen(await get([signedIn(), "Accept: text/event-stream", "mcp-protocol-version: 1999-01-01"]))).toEqual(
        jsonRpcError("400 Bad Request", `Bad Request: Unsupported protocol version: 1999-01-01 (supported versions: ${supported})`),
      )
    })

    it("no token, or one that does not resolve: the 401 challenge", async () => {
      for (const auth of [[], ["Authorization: Bearer nonsense"], [`Authorization: Bearer ndr_${"f".repeat(64)}`]]) {
        for (const accept of [[], ["Accept: text/event-stream"]]) {
          expect(seen(await get([...auth, ...accept]))).toEqual(UNAUTHORIZED)
        }
      }
    })

    it("a caller the client list refuses: 403; a list that cannot be read: 503", async () => {
      config.MCP_ALLOWED_CLIENT_IDS = OWN_CLIENT_ID
      expect(seen(await get([`Authorization: Bearer ${seeded.apiToken}`, "Accept: text/event-stream"]))).toEqual(
        routeRefusal("403 Forbidden", [], {
          error: {
            code: "mcp_client_not_allowed",
            message: "This deployment accepts MCP connections only from the clients it has set up. Connect through the deployment's own app.",
          },
        }),
      )
      db.failReads.add("developer_apps")
      expect(seen(await get([signedIn(), "Accept: text/event-stream"]))).toEqual(
        routeRefusal("503 Service Unavailable", [], {
          error: { code: "mcp_client_check_failed", message: "Could not check this client right now. Try again in a moment." },
        }),
      )
    })
  })

  describe("answers every admitted GET exactly as the SDK's own transport does", () => {
    const cases: Array<[string, string[], Partial<RawRequest>?]> = [
      ["no Accept", []],
      ["Accept: application/json", ["Accept: application/json"]],
      ["Accept: */*", ["Accept: */*"]],
      ["the event-stream type in capitals (the check is case-sensitive)", ["Accept: TEXT/EVENT-STREAM"]],
      ["Accept: text/event-stream", ["Accept: text/event-stream"]],
      ["both types, as a POST sends them", ["Accept: application/json, text/event-stream"]],
      ["two Accept headers, joined", ["Accept: application/json", "Accept: text/event-stream"]],
      ...SUPPORTED_PROTOCOL_VERSIONS.map((v): [string, string[]] => [`protocol version ${v}`, ["Accept: text/event-stream", `mcp-protocol-version: ${v}`]]),
      ["an unknown protocol version", ["Accept: text/event-stream", "mcp-protocol-version: 1999-01-01"]],
      ["an empty protocol version", ["Accept: text/event-stream", "mcp-protocol-version: "]],
      ["two protocol versions", ["Accept: text/event-stream", "mcp-protocol-version: 2025-06-18", "mcp-protocol-version: 2025-06-18"]],
      ["an unknown version and no event-stream Accept (Accept is checked first)", ["mcp-protocol-version: x"]],
      ["a session id (stateless: not checked)", ["Accept: text/event-stream", "mcp-session-id: 0b0e7a9e-0000-4000-8000-000000000000"]],
      ["a Last-Event-ID (no event store: ignored)", ["Accept: text/event-stream", "last-event-id: 7"]],
      ["an Origin (no DNS-rebinding check)", ["Accept: text/event-stream", "Origin: https://elsewhere.example"]],
      ["HTTP/1.0", ["Accept: text/event-stream"], { httpVersion: "1.0" }],
      ["HTTP/1.0 without a Host", ["Accept: text/event-stream"], { httpVersion: "1.0", noHost: true }],
      ["a Host with a user part", ["Accept: text/event-stream", "Host: a@b"], { noHost: true }],
    ]

    it.each(cases)("%s", async (_label, headers, more) => {
      const ours = await get([signedIn(), ...headers], more)
      const sdk = await rawExchange(referencePort, { path: "/mcp", headers, ...more })
      expect(seen(ours)).toEqual(seen(sdk))
    })
  })
})
