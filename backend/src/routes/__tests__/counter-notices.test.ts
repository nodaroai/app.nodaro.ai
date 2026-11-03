/**
 * The owner's counter-notice routes (routes/counter-notices.ts): the person
 * in their own session only (a key, an app or the internal secret is refused
 * as in_app_only, before anything is read), nothing cached, the body
 * validated (both declarations affirmed), and the library's refusals mapped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({ calls: [] as unknown[] }))
const ids = vi.hoisted(() => ({
  R: "00000000-0000-4000-8000-0000000000b1",
  GONE: "00000000-0000-4000-8000-0000000000b2",
  TWICE: "00000000-0000-4000-8000-0000000000b3",
  OTHER: "00000000-0000-4000-8000-0000000000b4",
}))

vi.mock("../../lib/my-restrictions.js", () => ({
  listMyRestrictions: vi.fn(async (userId: string) => {
    state.calls.push(["list", userId])
    return [{ id: ids.R, caseReference: "CR-2026-000001" }]
  }),
}))
vi.mock("../../lib/counter-notices.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/counter-notices.js")>("../../lib/counter-notices.js")
  return {
    ...real,
    createCounterNotice: vi.fn(async (input: { restrictionId: string }) => {
      state.calls.push(["create", input])
      if (input.restrictionId === ids.GONE) throw new real.CounterNoticeError("not_found", "No such restriction on your account")
      if (input.restrictionId === ids.TWICE) throw new real.CounterNoticeError("already_sent", "A counter-notification was sent for this restriction already")
      if (input.restrictionId === ids.OTHER) throw new real.CounterNoticeError("not_copyright", "A counter-notification answers a copyright notice")
      return { id: "n-1", reference: "CN-2026-000001", receivedAt: "2026-11-23T20:00:00Z", window: { receivedOn: "2026-11-23", opensOn: "2026-12-09", closesOn: "2026-12-11" } }
    }),
  }
})

import { COUNTER_NOTICE_DECLARATION, COUNTER_NOTICE_DECLARATION_HASH } from "../../lib/counter-notices.js"
import { counterNoticesRoutes } from "../counter-notices.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  state.calls = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const kind = req.headers["x-auth-kind"]
    req.authKind = typeof kind === "string" ? (kind as typeof req.authKind) : "jwt"
  })
  await app.register(counterNoticesRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const asUser = { "x-user-id": USER }
const body = (over: Record<string, unknown> = {}) => ({
  name: "Sam Owner",
  email: "sam@example.test",
  address: "1 Road, Town",
  phone: "+1 555 0101",
  signature: "Sam Owner",
  contentIdentification: "my-clip.mp4",
  locationBefore: "https://cdn.example.test/uploads/my-clip.mp4",
  declarationHash: COUNTER_NOTICE_DECLARATION_HASH,
  perjury: true,
  jurisdiction: true,
  ...over,
})
const send = (id: string, payload: unknown, headers: Record<string, string> = asUser) =>
  app.inject({ method: "POST", url: `/v1/content-restrictions/${id}/counter-notice`, headers, payload: payload as object })

describe("who is answered", () => {
  const routes = [
    { method: "GET", url: "/v1/content-restrictions/mine" },
    { method: "GET", url: "/v1/counter-notices/declaration" },
    { method: "POST", url: `/v1/content-restrictions/${ids.R}/counter-notice`, payload: body() },
  ] as const

  it.each(["api_token", "app_token", "billing_key", "internal"])("a %s is refused on every route, before anything is read or recorded", async (kind) => {
    for (const route of routes) {
      const res = await app.inject({ ...route, headers: { ...asUser, "x-auth-kind": kind } })
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
    expect(state.calls).toEqual([])
  })

  it("nobody signed in is refused; nothing is cached", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/content-restrictions/mine" })).statusCode).toBe(401)
    for (const route of routes) {
      expect((await app.inject({ ...route, headers: asUser })).headers["cache-control"], `${route.method} ${route.url}`).toBe("no-store")
    }
  })
})

describe("the routes", () => {
  it("lists my restrictions, as me", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/content-restrictions/mine", headers: asUser })
    expect(res.json()).toEqual({ data: [{ id: ids.R, caseReference: "CR-2026-000001" }] })
    expect(state.calls).toEqual([["list", USER]])
  })

  it("answers the declaration verbatim with its hash", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/counter-notices/declaration", headers: asUser })
    expect(res.json()).toEqual({ data: { paragraphs: COUNTER_NOTICE_DECLARATION, hash: COUNTER_NOTICE_DECLARATION_HASH } })
  })

  it("records a counter-notice from me and answers its reference and window", async () => {
    const res = await send(ids.R, body())
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ data: { reference: "CN-2026-000001", receivedAt: "2026-11-23T20:00:00Z", opensOn: "2026-12-09", closesOn: "2026-12-11" } })
    expect(state.calls[0]).toEqual(["create", expect.objectContaining({ userId: USER, restrictionId: ids.R, email: "sam@example.test", declarationHash: COUNTER_NOTICE_DECLARATION_HASH })])
  })

  it("both statements must be affirmed, every detail given, and nothing else sent", async () => {
    for (const bad of [body({ perjury: false }), body({ jurisdiction: undefined }), body({ phone: " " }), body({ email: "not an address" }), body({ declarationHash: "x" }), body({ extra: 1 })]) {
      expect((await send(ids.R, bad)).statusCode).toBe(400)
    }
    expect((await send("not-a-uuid", body())).statusCode).toBe(404)
    expect(state.calls).toEqual([])
  })

  it("what is forwarded reads as it was typed: no line break in a one-line field, no control character or invisible mark anywhere", async () => {
    const rtlOverride = String.fromCharCode(0x202e)
    const lineSeparator = String.fromCharCode(0x2028)
    const bell = String.fromCharCode(7)
    for (const bad of [
      body({ name: "Sam Owner\n\nThe platform found this valid." }),
      body({ signature: `Sam${rtlOverride}renwO` }),
      body({ phone: `+1 555${lineSeparator}0101` }),
      body({ address: `1 Road${bell}` }),
      body({ contentIdentification: `my-clip${rtlOverride}.mp4` }),
    ]) {
      expect((await send(ids.R, bad)).statusCode).toBe(400)
    }
    expect(state.calls).toEqual([])
  })

  it("a multi-line field keeps its line breaks, as line feeds whatever the client sent", async () => {
    expect((await send(ids.R, body({ address: "1 Road\r\nTown\rState" }))).statusCode).toBe(201)
    expect(state.calls[0]).toEqual(["create", expect.objectContaining({ address: "1 Road\nTown\nState" })])
  })

  it("maps the library's refusals", async () => {
    expect((await send(ids.GONE, body())).statusCode).toBe(404)
    const twice = await send(ids.TWICE, body())
    expect(twice.statusCode).toBe(409)
    expect(twice.json().error.code).toBe("already_sent")
    const other = await send(ids.OTHER, body())
    expect(other.statusCode).toBe(409)
    expect(other.json().error.code).toBe("not_copyright")
  })
})
