import { describe, it, expect, afterEach, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import {
  providerFetch,
  setEgressDecorator,
  clearEgressDecorator,
  readUserSafeMessage,
  type EgressCall,
  type EgressDecorator,
  type EgressObservation,
} from "../egress.js"

/** Start a one-shot loopback server; returns its base URL + last received request. */
async function startServer(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => handler(req, body, res))
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

const call = (over: Partial<EgressCall> = {}): EgressCall => ({
  provider: "kie",
  operation: "jobs.createTask",
  modelKey: "nano-banana",
  body: { hello: "world" },
  dimensions: {},
  ...over,
})

afterEach(() => clearEgressDecorator())

describe("providerFetch — inert default (no decorator)", () => {
  it("does not add headers and leaves the response body consumable by the caller", async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {}
    const srv = await startServer((req, _b, res) => {
      receivedHeaders = req.headers
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const res = await providerFetch(call(), srv.base, { method: "POST" })
      expect(res.status).toBe(200)
      // No decorator ⇒ no injected identity/enrichment headers.
      expect(receivedHeaders["x-sai-user"]).toBeUndefined()
      // Body must still be readable exactly once (proves no clone consumed it).
      await expect(res.json()).resolves.toEqual({ ok: true })
      // No observe ran ⇒ no user-safe mark recorded.
      expect(readUserSafeMessage(res)).toBeNull()
    } finally {
      await srv.close()
    }
  })
})

describe("providerFetch — with a decorator", () => {
  it("merges decorate() headers onto the outgoing request and passes the EgressCall through", async () => {
    let received: http.IncomingHttpHeaders = {}
    const srv = await startServer((req, _b, res) => {
      received = req.headers
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    const seen: EgressCall[] = []
    const dec: EgressDecorator = {
      decorate(c: EgressCall) {
        seen.push(c)
        return { headers: { "X-SAI-User": "u-123", "X-Studio-Model": c.modelKey ?? "" } }
      },
    }
    setEgressDecorator(dec)
    try {
      await providerFetch(call({ modelKey: "nano-banana" }), srv.base, {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
      expect(received["x-sai-user"]).toBe("u-123")
      expect(received["x-studio-model"]).toBe("nano-banana")
      // Pre-existing headers survive the merge.
      expect(received["content-type"]).toBe("application/json")
      expect(seen).toHaveLength(1)
      expect(seen[0].operation).toBe("jobs.createTask")
    } finally {
      await srv.close()
    }
  })

  it("records a user-safe message from observe() and returns it via readUserSafeMessage", async () => {
    const srv = await startServer((_req, _b, res) => {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "friendly reason" }))
    })
    const dec: EgressDecorator = {
      decorate: () => null,
      observe(_c: EgressCall, r: EgressObservation) {
        const body = r.body as { error?: string } | undefined
        return r.status === 400 && body?.error ? { userSafeMessage: body.error } : undefined
      },
    }
    setEgressDecorator(dec)
    try {
      const res = await providerFetch(call(), srv.base, { method: "POST" })
      expect(readUserSafeMessage(res)).toBe("friendly reason")
    } finally {
      await srv.close()
    }
  })

  it("a blank user-safe message is NOT honored (falsy guard)", async () => {
    const srv = await startServer((_req, _b, res) => {
      res.writeHead(400, { "content-type": "application/json" })
      res.end("{}")
    })
    setEgressDecorator({ decorate: () => null, observe: () => ({ userSafeMessage: "   " }) })
    try {
      const res = await providerFetch(call(), srv.base, { method: "POST" })
      expect(readUserSafeMessage(res)).toBeNull()
    } finally {
      await srv.close()
    }
  })

  it("an observe() that throws never breaks the call and never mutates the response", async () => {
    const srv = await startServer((_req, _b, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    setEgressDecorator({
      decorate: () => null,
      observe: () => {
        throw new Error("observer boom")
      },
    })
    try {
      const res = await providerFetch(call(), srv.base, { method: "POST" })
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ ok: true })
      expect(errSpy).toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      await srv.close()
    }
  })
})
