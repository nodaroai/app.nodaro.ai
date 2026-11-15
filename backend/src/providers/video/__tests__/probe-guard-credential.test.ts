// @test-reads-none sockets only: clients of the proxy on the loopback, no file
/**
 * A guarded run's proxy serves only that run's ffprobe. Its `http_proxy` URL
 * carries a random per-run credential; ffmpeg sends it (Basic) once the proxy
 * asks with a 407 — never unasked (measured on the pinned 8.1.2). A request
 * without it, or with another, is asked again: nothing is looked up,
 * connected or recorded for it, so another process on the host can neither
 * use the proxy nor put a refusal on the run's record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import http from "node:http"
import net from "node:net"
import { openProbeEgress, probeNetwork } from "../probe-guard.js"
import { proxyAuthorization } from "./probe-media-server.js"

let lookups: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  lookups = vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "10.0.0.7", family: 4 }])
})
afterEach(() => vi.restoreAllMocks())

function get(proxy: string, authorization?: string): Promise<{ status?: number; challenge?: string }> {
  const p = new URL(proxy)
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: p.hostname,
      port: Number(p.port),
      path: "http://blocked.test/clip.mp4",
      headers: { host: "blocked.test", ...(authorization ? { "proxy-authorization": authorization } : {}) },
    })
    req.on("response", (res) => res.resume().on("end", () => resolve({ status: res.statusCode, challenge: res.headers["proxy-authenticate"] })))
    req.on("error", reject)
    req.end()
  })
}

function connect(proxy: string, authorization?: string): Promise<string> {
  const p = new URL(proxy)
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(p.port), p.hostname)
    let head = ""
    s.on("error", reject)
    s.on("data", (c: Buffer) => (head += c.toString("latin1")))
    s.on("close", () => resolve(head.split("\r\n")[0] ?? ""))
    s.write(`CONNECT blocked.test:443 HTTP/1.1\r\nHost: blocked.test\r\n${authorization ? `Proxy-Authorization: ${authorization}\r\n` : ""}\r\n`)
  })
}

describe("the guard proxy's per-run credential", () => {
  it("the run's http_proxy carries a random credential of its own", async () => {
    const [a, b] = [await openProbeEgress(), await openProbeEgress()]
    try {
      const [ua, ub] = [new URL(a.env.http_proxy!), new URL(b.env.http_proxy!)]
      expect(ua.username).toBe("probe")
      expect(ua.password.length).toBeGreaterThanOrEqual(32)
      expect(ua.password).not.toBe(ub.password)
    } finally {
      await a.close()
      await b.close()
    }
  })

  it.each([
    ["no credential", () => undefined],
    ["another run's credential", (other: string) => proxyAuthorization(other)],
    ["a wrong one", () => `Basic ${Buffer.from("probe:guess").toString("base64")}`],
  ])("%s: asked again (407), with nothing looked up or recorded — http and CONNECT", async (_label, credential) => {
    const run = await openProbeEgress()
    const other = await openProbeEgress()
    try {
      const auth = credential(other.env.http_proxy!)
      expect(await get(run.env.http_proxy!, auth)).toEqual({ status: 407, challenge: 'Basic realm="probe"' })
      expect(await connect(run.env.http_proxy!, auth)).toMatch(/^HTTP\/1\.1 407/)
      expect(lookups).not.toHaveBeenCalled()
      expect(run.refusal()).toBeUndefined()
    } finally {
      await run.close()
      await other.close()
    }
  })

  it("the run's own credential is served: the hop is checked (here refused) and recorded", async () => {
    const run = await openProbeEgress()
    try {
      expect((await get(run.env.http_proxy!, proxyAuthorization(run.env.http_proxy!))).status).toBe(403)
      expect(lookups).toHaveBeenCalledWith("blocked.test")
      expect(run.refusal()).toMatchObject({ reason: "address" })
    } finally {
      await run.close()
    }
  })
})
