import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyReply } from "fastify"

const m = vi.hoisted(() => ({ connected: false as boolean | "throw" }))
vi.mock("../nodaro-connect.js", () => ({
  isNodaroConnected: async () => {
    if (m.connected === "throw") throw new Error("credential read failed")
    return m.connected
  },
}))
import { nodaroConnectionRefusal, requireNodaroConnection } from "../nodaro-connection-gate.js"
import { NODARO_CONNECTION_REQUIRED_CODE, NODARO_CONNECTION_REQUIRED_MESSAGE } from "../nodaro-connection-messages.js"

function fakeReply() {
  const sent: { status?: number; body?: unknown } = {}
  const reply = {
    status(code: number) { sent.status = code; return reply },
    send(body: unknown) { sent.body = body; return reply },
  }
  return { reply: reply as unknown as FastifyReply, sent }
}

beforeEach(() => { m.connected = false })

describe("nodaroConnectionRefusal — the one connection gate", () => {
  it("connected: no refusal", async () => {
    m.connected = true
    expect(await nodaroConnectionRefusal()).toBeNull()
  })
  it("not connected: 503 with the shared code and words", async () => {
    expect(await nodaroConnectionRefusal()).toEqual({
      status: 503,
      code: NODARO_CONNECTION_REQUIRED_CODE,
      message: NODARO_CONNECTION_REQUIRED_MESSAGE,
    })
  })
  it("a failed connection read counts as not connected", async () => {
    m.connected = "throw"
    expect(await nodaroConnectionRefusal()).toMatchObject({ status: 503, code: NODARO_CONNECTION_REQUIRED_CODE })
  })
})

describe("requireNodaroConnection — the route form of the same gate", () => {
  it("connected: passes and sends nothing", async () => {
    m.connected = true
    const { reply, sent } = fakeReply()
    expect(await requireNodaroConnection(reply)).toBe(true)
    expect(sent).toEqual({})
  })
  it("not connected: sends the refusal as the route's error body", async () => {
    const { reply, sent } = fakeReply()
    expect(await requireNodaroConnection(reply)).toBe(false)
    expect(sent).toEqual({
      status: 503,
      body: { error: { code: NODARO_CONNECTION_REQUIRED_CODE, message: NODARO_CONNECTION_REQUIRED_MESSAGE } },
    })
  })
})
