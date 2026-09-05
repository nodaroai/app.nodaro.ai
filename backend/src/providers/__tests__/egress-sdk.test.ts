import { describe, it, expect, afterEach } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { egressSdkFetch, setEgressDecorator, clearEgressDecorator, type EgressCall } from "../egress.js"

async function loopback(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }
}
afterEach(() => clearEgressDecorator())

describe("egressSdkFetch — a fetch-shaped adapter that flows through the seam", () => {
  it("decorates the SDK's request and reports the provider + a path-derived operation", async () => {
    let received: http.IncomingHttpHeaders = {}
    const srv = await loopback((req, res) => {
      received = req.headers
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return { headers: { "X-Acme-User": "sdk-user" } } } })
    try {
      const f = egressSdkFetch("replicate")
      const res = await f(`${srv.base}/v1/predictions`, { method: "POST", body: "{}" })
      expect(res.status).toBe(200)
      expect(received["x-acme-user"]).toBe("sdk-user")
      expect(seen).toHaveLength(1)
      expect(seen[0].provider).toBe("replicate")
      expect(seen[0].operation).toContain("/v1/predictions")
      expect(seen[0].modelKey).toBeNull()
    } finally {
      await srv.close()
    }
  })

  it("accepts a URL or Request input and never throws on a non-URL path", async () => {
    const srv = await loopback((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      const f = egressSdkFetch("fal")
      await f(new URL(`${srv.base}/queue/submit`))
      expect(seen.some((c) => c.provider === "fal" && c.operation === "fal/queue/submit")).toBe(true)
    } finally {
      await srv.close()
    }
  })
})
