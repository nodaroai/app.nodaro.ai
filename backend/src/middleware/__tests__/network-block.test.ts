import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

/**
 * Network blocks at the door (`middleware/network-block.ts`).
 *
 * Only a BROWSER SESSION is refused for the network it comes from: connector
 * servers, CI runners and webhooks share their egress addresses with thousands
 * of accounts, so a token or an internal call is never refused here (a token
 * that misbehaves is blocked as an account). Admins are never refused, so the
 * page that lifts a block stays reachable from anywhere. An address that
 * cannot be known is never refused.
 *
 * Runs against the REAL snapshot (`lib/access-blocks.ts`) and the REAL address
 * derivation (`lib/client-address.ts`), with only the database underneath
 * stubbed — so "unknown is never refused" is proven against a block on every
 * network, not against a mock that was told to say no.
 */

const USER = "00000000-0000-4000-8000-0000000000a1"
const BLOCKED_RANGE = "203.0.113.0/24"
const IN_BLOCKED = "203.0.113.9"
const ELSEWHERE = "198.51.100.1"

const db = vi.hoisted(() => {
  type NetworkRow = { network_hash: string | null; cidr: string | null; expires_at: string }
  const state = { networks: [] as NetworkRow[] }
  function from(table: string) {
    const chain = {
      select: () => chain,
      gt: () => chain,
      order: () => chain,
      range: (first: number, last: number) =>
        Promise.resolve({
          data: (table === "blocked_networks" ? state.networks : []).slice(first, last + 1),
          error: null,
        }),
    }
    return chain
  }
  return { state, from: vi.fn(from) }
})

const edition = vi.hoisted(() => ({ admin: true }))

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: db.from } }))
vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasAdmin: () => edition.admin,
}))

import { refuseBlockedNetwork, registerNetworkBlockHook } from "../network-block.js"
import { ACCESS_BLOCKED_BODY, __resetAccessBlocksForTests } from "../../lib/access-blocks.js"
import { clientNetworkHash } from "../../lib/client-address.js"

const LIVE = new Date(Date.now() + 7 * 86_400_000).toISOString()

function range(cidr: string) {
  return { network_hash: null, cidr, expires_at: LIVE }
}

interface Caller {
  authKind?: FastifyRequest["authKind"]
  userId?: string
  userRole?: string
  /** The client as the bundled proxy states it; null = nothing to go on. */
  forwardedFor: string | null
}

/** Behind the bundled proxy: the socket is loopback and the client rides X-Forwarded-For. */
function request(c: Caller): FastifyRequest {
  return {
    headers: c.forwardedFor ? { "x-forwarded-for": c.forwardedFor } : {},
    socket: c.forwardedFor === null ? {} : { remoteAddress: "127.0.0.1" },
    authKind: c.authKind,
    userId: c.userId,
    userRole: c.userRole,
  } as unknown as FastifyRequest
}

function reply() {
  const seen: { status?: number; body?: unknown } = {}
  const api = {
    status: vi.fn((code: number) => {
      seen.status = code
      return api
    }),
    send: vi.fn((body: unknown) => {
      seen.body = body
      return api
    }),
  }
  return { reply: api as unknown as FastifyReply, seen, send: api.send }
}

beforeEach(() => {
  __resetAccessBlocksForTests()
  db.state.networks = [range(BLOCKED_RANGE)]
  db.from.mockClear()
  edition.admin = true
})

describe("refuseBlockedNetwork", () => {
  it("refuses a browser session from a blocked range with 403 access_blocked", async () => {
    const r = reply()
    await refuseBlockedNetwork(request({ authKind: "jwt", userId: USER, userRole: "user", forwardedFor: IN_BLOCKED }), r.reply)
    expect(r.seen).toEqual({ status: 403, body: ACCESS_BLOCKED_BODY })
  })

  it("refuses a session from an account's blocked SIGNUP network (a hashed block)", async () => {
    // The hash an admin copies from the account's signup signal — computed by
    // the same derivation the signal writers use.
    const signupRequest = { headers: { "x-forwarded-for": "192.0.2.44" } }
    db.state.networks = [{ network_hash: clientNetworkHash(signupRequest, { unknownScope: "x" }), cidr: null, expires_at: LIVE }]
    const r = reply()
    await refuseBlockedNetwork(request({ authKind: "jwt", userId: USER, forwardedFor: "192.0.2.44" }), r.reply)
    expect(r.seen).toEqual({ status: 403, body: ACCESS_BLOCKED_BODY })
  })

  it("lets a session from any other network through", async () => {
    const r = reply()
    await refuseBlockedNetwork(request({ authKind: "jwt", userId: USER, forwardedFor: ELSEWHERE }), r.reply)
    expect(r.send).not.toHaveBeenCalled()
  })

  it("a forged X-Forwarded-For entry does not walk a blocked network through", async () => {
    // A caller can put anything on the LEFT; the proxy appends the address it saw.
    const r = reply()
    await refuseBlockedNetwork(
      request({ authKind: "jwt", userId: USER, forwardedFor: `${ELSEWHERE}, ${IN_BLOCKED}` }),
      r.reply,
    )
    expect(r.seen).toEqual({ status: 403, body: ACCESS_BLOCKED_BODY })
  })

  it.each(["admin", "super_admin"])("never refuses an %s — the page that lifts a block stays reachable", async (role) => {
    const r = reply()
    await refuseBlockedNetwork(request({ authKind: "jwt", userId: USER, userRole: role, forwardedFor: IN_BLOCKED }), r.reply)
    expect(r.send).not.toHaveBeenCalled()
  })

  it.each(["api_token", "app_token", "internal", "billing_key", undefined] as const)(
    "leaves a %s caller alone even from a blocked network (shared egress)",
    async (authKind) => {
      const r = reply()
      await refuseBlockedNetwork(request({ authKind, userId: USER, forwardedFor: IN_BLOCKED }), r.reply)
      expect(r.send).not.toHaveBeenCalled()
    },
  )

  it("never refuses an address it cannot know — even with every network blocked", async () => {
    db.state.networks = [range("0.0.0.0/0"), range("::/0")]
    const unknown = reply()
    await refuseBlockedNetwork(request({ authKind: "jwt", userId: USER, forwardedFor: null }), unknown.reply)
    expect(unknown.send).not.toHaveBeenCalled()

    // …while that list does refuse every address it CAN see.
    const known = reply()
    await refuseBlockedNetwork(request({ authKind: "jwt", userId: USER, forwardedFor: ELSEWHERE }), known.reply)
    expect(known.seen.status).toBe(403)
  })
})

describe("registerNetworkBlockHook", () => {
  it("is a no-op on an edition without an admin panel", () => {
    edition.admin = false
    const addHook = vi.fn()
    registerNetworkBlockHook({ addHook } as unknown as FastifyInstance)
    expect(addHook).not.toHaveBeenCalled()
  })

  it("registers refuseBlockedNetwork as a preHandler on an edition with one", () => {
    const addHook = vi.fn()
    registerNetworkBlockHook({ addHook } as unknown as FastifyInstance)
    expect(addHook).toHaveBeenCalledTimes(1)
    expect(addHook).toHaveBeenCalledWith("preHandler", refuseBlockedNetwork)
  })

  it("on a real app, a refused request never reaches its handler", async () => {
    const app = Fastify({ logger: false })
    // Stand-in for the auth hook (registered first in app.ts): a resolved browser session.
    app.addHook("preHandler", async (req) => {
      req.authKind = "jwt"
      req.userId = USER
    })
    registerNetworkBlockHook(app)
    const handler = vi.fn(async () => ({ ok: true }))
    app.get("/v1/probe", handler)
    await app.ready()
    try {
      const refused = await app.inject({ method: "GET", url: "/v1/probe", headers: { "x-forwarded-for": IN_BLOCKED } })
      expect(refused.statusCode).toBe(403)
      expect(refused.json()).toEqual(ACCESS_BLOCKED_BODY)
      expect(handler).not.toHaveBeenCalled()

      const passed = await app.inject({ method: "GET", url: "/v1/probe", headers: { "x-forwarded-for": ELSEWHERE } })
      expect(passed.statusCode).toBe(200)
      expect(handler).toHaveBeenCalledTimes(1)
    } finally {
      await app.close()
    }
  })
})
