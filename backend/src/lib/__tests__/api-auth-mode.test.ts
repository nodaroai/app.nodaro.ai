import { describe, it, expect, vi } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"
import { rejectProgrammaticAuth } from "../api-auth-mode.js"

function makeReply() {
  const captured = { statusCode: 0, body: undefined as unknown }
  const r: Record<string, unknown> = {}
  r.status = vi.fn((c: number) => { captured.statusCode = c; return r })
  r.send = vi.fn((b: unknown) => { captured.body = b; return r })
  return { reply: r as unknown as FastifyReply, captured }
}

const OAUTH = { appAuthorization: { appId: "a", authorizationId: "z", scopes: [] } } as unknown as FastifyRequest
const PERSONAL = { apiToken: { userId: "u" } } as unknown as FastifyRequest
const BILLING = { billingKey: { id: "k", name: "back office" } } as unknown as FastifyRequest
const JWT = {} as FastifyRequest

describe("rejectProgrammaticAuth", () => {
  it("passes a first-party JWT request (neither appAuthorization nor apiToken)", () => {
    const { reply } = makeReply()
    expect(rejectProgrammaticAuth(JWT, reply, "nope")).toBe(false)
  })

  it("blocks an OAuth app token (403)", () => {
    const { reply, captured } = makeReply()
    expect(rejectProgrammaticAuth(OAUTH, reply, "nope")).toBe(true)
    expect(captured.statusCode).toBe(403)
  })

  it("blocks an OAuth app token even when allowPersonalToken is set", () => {
    const { reply } = makeReply()
    expect(rejectProgrammaticAuth(OAUTH, reply, "nope", { allowPersonalToken: true })).toBe(true)
  })

  it("blocks a personal API token by default (JWT-only routes like /v1/api-tokens)", () => {
    const { reply, captured } = makeReply()
    expect(rejectProgrammaticAuth(PERSONAL, reply, "nope")).toBe(true)
    expect(captured.statusCode).toBe(403)
  })

  it("allows a personal API token when allowPersonalToken is set (SDK surfaces like developer-apps)", () => {
    const { reply } = makeReply()
    expect(rejectProgrammaticAuth(PERSONAL, reply, "nope", { allowPersonalToken: true })).toBe(false)
  })
})

/**
 * The billing integration key is the third programmatic kind, and this guard is
 * the SECOND defence behind the auth hook's path allow-list. Every one of these
 * cases fails if the `req.billingKey` clause is deleted or if either option is
 * allowed to stand in for the other — which is the whole point of testing an
 * opt-in: a clause nothing executes is a clause that can be removed by accident
 * and never missed.
 */
describe("rejectProgrammaticAuth — the billing integration key", () => {
  it("refuses a billing key by DEFAULT, like every other programmatic caller (403)", () => {
    const { reply, captured } = makeReply()
    expect(rejectProgrammaticAuth(BILLING, reply, "nope")).toBe(true)
    expect(captured.statusCode).toBe(403)
  })

  it("passes a billing key only where the route opted in with allowBillingKey", () => {
    const { reply } = makeReply()
    expect(rejectProgrammaticAuth(BILLING, reply, "nope", { allowBillingKey: true })).toBe(false)
  })

  it("still refuses an OAuth app token on a route that opted the key in", () => {
    // The two are independent: opting the billing key into a money verb must
    // never widen the surface to every OAuth app that holds any scope.
    const { reply, captured } = makeReply()
    expect(rejectProgrammaticAuth(OAUTH, reply, "nope", { allowBillingKey: true })).toBe(true)
    expect(captured.statusCode).toBe(403)
  })

  it("still refuses a personal API token on a route that opted the key in", () => {
    const { reply } = makeReply()
    expect(rejectProgrammaticAuth(PERSONAL, reply, "nope", { allowBillingKey: true })).toBe(true)
    // ...and the personal token's own option does not open the key's door.
    const second = makeReply()
    expect(rejectProgrammaticAuth(BILLING, second.reply, "nope", { allowPersonalToken: true })).toBe(true)
  })

  it("a request carrying BOTH a key and a personal token is refused unless both are allowed", () => {
    const both = { apiToken: { userId: "u" }, billingKey: { id: "k" } } as unknown as FastifyRequest
    const a = makeReply()
    expect(rejectProgrammaticAuth(both, a.reply, "nope", { allowPersonalToken: true })).toBe(true)
    const b = makeReply()
    expect(rejectProgrammaticAuth(both, b.reply, "nope", { allowBillingKey: true })).toBe(true)
    const c = makeReply()
    expect(
      rejectProgrammaticAuth(both, c.reply, "nope", { allowPersonalToken: true, allowBillingKey: true }),
    ).toBe(false)
  })
})
