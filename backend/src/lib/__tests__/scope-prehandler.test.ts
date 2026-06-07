import { describe, it, expect, vi } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"
import { requireAppScope } from "../scope-prehandler.js"

function makeReply() {
  const captured = { statusCode: 0, body: undefined as unknown }
  const r: Record<string, unknown> = {}
  r.status = vi.fn((c: number) => { captured.statusCode = c; return r })
  r.send = vi.fn((b: unknown) => { captured.body = b; return r })
  return { reply: r as unknown as FastifyReply, captured }
}

describe("requireAppScope preHandler", () => {
  it("no-op (returns undefined) for first-party JWT / personal-token callers (no appAuthorization)", async () => {
    const { reply, captured } = makeReply()
    const result = await requireAppScope("assets:write")({} as FastifyRequest, reply)
    expect(result).toBeUndefined()
    expect(captured.statusCode).toBe(0) // nothing sent → handler runs (owner's own request)
  })

  it("passes (returns undefined) when the OAuth app HAS the scope", async () => {
    const { reply, captured } = makeReply()
    const req = { appAuthorization: { appId: "a", authorizationId: "z", scopes: ["assets:write"] } } as unknown as FastifyRequest
    const result = await requireAppScope("assets:write")(req, reply)
    expect(result).toBeUndefined()
    expect(captured.statusCode).toBe(0)
  })

  it("HALTS by RETURNING the reply (not just await send) + 403 when the app LACKS the scope — guards the auth fail-open", async () => {
    const { reply, captured } = makeReply()
    const req = { appAuthorization: { appId: "a", authorizationId: "z", scopes: ["assets:read"] } } as unknown as FastifyRequest
    const result = await requireAppScope("assets:write")(req, reply)
    // Returning the reply object is the Fastify async-hook halt signal — proves
    // the route handler will NOT execute (the unauthorized write is actually
    // blocked, not merely 403'd after the side effect already ran).
    expect(result).toBe(reply)
    expect(captured.statusCode).toBe(403)
    expect((captured.body as { error?: { code?: string } })?.error?.code).toBe("insufficient_scope")
  })
})
