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
