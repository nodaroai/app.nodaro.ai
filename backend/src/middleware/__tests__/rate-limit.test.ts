import { describe, it, expect, vi, beforeEach } from "vitest"

const { incrMock, expireMock, ttlMock } = vi.hoisted(() => ({
  incrMock: vi.fn(),
  expireMock: vi.fn(),
  ttlMock: vi.fn(),
}))

vi.mock("../../lib/queue.js", () => ({
  redis: {
    incr: incrMock,
    expire: expireMock,
    ttl: ttlMock,
  },
}))

import { rateLimiter } from "../rate-limit.js"

type FakeReply = {
  header: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}

function makeReply(): FakeReply {
  const reply = {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as FakeReply
  return reply
}

describe("rateLimiter", () => {
  beforeEach(() => {
    incrMock.mockReset()
    expireMock.mockReset()
    ttlMock.mockReset()
  })

  it("is a no-op for unauthenticated requests", async () => {
    const mw = rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: "test" })
    const reply = makeReply()
    await mw({} as never, reply as never)
    expect(incrMock).not.toHaveBeenCalled()
  })

  it("sets TTL on first request in window", async () => {
    incrMock.mockResolvedValue(1)
    const mw = rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: "test" })
    const reply = makeReply()
    await mw({ userId: "u1" } as never, reply as never)
    expect(incrMock).toHaveBeenCalledWith("rl:test:u1")
    expect(expireMock).toHaveBeenCalledWith("rl:test:u1", 60)
    expect(reply.status).not.toHaveBeenCalled()
  })

  it("does not set TTL after the first request", async () => {
    incrMock.mockResolvedValue(2)
    const mw = rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: "test" })
    const reply = makeReply()
    await mw({ userId: "u1" } as never, reply as never)
    expect(expireMock).not.toHaveBeenCalled()
  })

  it("returns 429 when limit exceeded", async () => {
    incrMock.mockResolvedValue(6)
    ttlMock.mockResolvedValue(42)
    const mw = rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: "test" })
    const reply = makeReply()
    await mw({ userId: "u1" } as never, reply as never)
    expect(reply.status).toHaveBeenCalledWith(429)
    expect(reply.header).toHaveBeenCalledWith("Retry-After", "42")
    const payload = reply.send.mock.calls[0][0]
    expect(payload.error.code).toBe("rate_limit_exceeded")
  })

  it("falls back to window when TTL is negative", async () => {
    incrMock.mockResolvedValue(6)
    ttlMock.mockResolvedValue(-1)
    const mw = rateLimiter({ windowMs: 30_000, max: 5, keyPrefix: "test" })
    const reply = makeReply()
    await mw({ userId: "u1" } as never, reply as never)
    expect(reply.header).toHaveBeenCalledWith("Retry-After", "30")
  })

  it("allows the request when Redis throws", async () => {
    incrMock.mockRejectedValue(new Error("redis down"))
    const mw = rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: "test" })
    const reply = makeReply()
    await expect(mw({ userId: "u1" } as never, reply as never)).resolves.toBeUndefined()
    expect(reply.status).not.toHaveBeenCalled()
  })
})
