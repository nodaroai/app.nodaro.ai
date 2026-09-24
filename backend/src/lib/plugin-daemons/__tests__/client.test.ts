/**
 * The API side of the internal hop (`tk.daemons.request`): the host supplies
 * the address and the secret, an unreachable daemon is an answer rather than
 * a throw, and a caller cannot aim the request anywhere but a daemon's own
 * routes on the configured listener.
 */
import { describe, it, expect, afterEach } from "vitest"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { requestPluginDaemon } from "../client.js"

const SECRET = "s".repeat(40)
const servers: Server[] = []

interface Seen {
  method?: string
  url?: string
  headers?: IncomingHttpHeaders
  body?: string
}

async function listen(handler: (seen: Seen, res: import("node:http").ServerResponse) => void): Promise<{ baseUrl: string; seen: Seen }> {
  const seen: Seen = {}
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      Object.assign(seen, { method: req.method, url: req.url, headers: req.headers, body })
      handler(seen, res)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections()
          s.close(() => resolve())
        }),
    ),
  )
})

describe("requestPluginDaemon", () => {
  it("calls the daemon's route on the configured listener with the internal secret and a JSON body", async () => {
    const { baseUrl, seen } = await listen((_seen, res) => {
      res.writeHead(201, { "content-type": "application/json" })
      res.end(JSON.stringify({ attemptId: "a1" }))
    })

    const out = await requestPluginDaemon(
      { daemon: "alpha", path: "/login/start", method: "POST", body: { x: 1 } },
      { baseUrl: `${baseUrl}/`, secret: SECRET },
    )

    expect(out).toEqual({ reachable: true, status: 201, body: { attemptId: "a1" } })
    expect(seen.method).toBe("POST")
    expect(seen.url).toBe("/alpha/login/start")
    expect(seen.headers?.["x-internal-orchestrator-secret"]).toBe(SECRET)
    expect(seen.headers?.["content-type"]).toContain("application/json")
    expect(JSON.parse(seen.body!)).toEqual({ x: 1 })
  })

  it("passes a non-2xx status and a non-JSON body through as an answer", async () => {
    const { baseUrl } = await listen((_seen, res) => {
      res.writeHead(409, { "content-type": "text/plain" })
      res.end("busy")
    })
    const out = await requestPluginDaemon({ daemon: "alpha", path: "/x" }, { baseUrl, secret: SECRET })
    expect(out).toEqual({ reachable: true, status: 409, body: "busy" })
  })

  it("a body that claims JSON but is not comes back as text rather than throwing", async () => {
    const { baseUrl } = await listen((_seen, res) => {
      res.writeHead(502, { "content-type": "application/json" })
      res.end("<html>bad gateway</html>")
    })
    const out = await requestPluginDaemon({ daemon: "alpha", path: "/x" }, { baseUrl, secret: SECRET })
    expect(out).toEqual({ reachable: true, status: 502, body: "<html>bad gateway</html>" })
  })

  it("a malformed percent-escape is not mistaken for a climb, and is sent as written", async () => {
    const { baseUrl, seen } = await listen((_seen, res) => {
      res.writeHead(204)
      res.end()
    })
    const out = await requestPluginDaemon({ daemon: "alpha", path: "/items/%E0%A4%A" }, { baseUrl, secret: SECRET })
    expect(out).toMatchObject({ reachable: true, status: 204 })
    expect(seen.url).toBe("/alpha/items/%E0%A4%A")
  })

  it("defaults to GET with no body", async () => {
    const { baseUrl, seen } = await listen((_seen, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end("{}")
    })
    await requestPluginDaemon({ daemon: "alpha", path: "/list?owner=1" }, { baseUrl, secret: SECRET })
    expect(seen.method).toBe("GET")
    expect(seen.url).toBe("/alpha/list?owner=1")
    expect(seen.body).toBe("")
  })

  it("an unreachable daemon is an answer, not a throw", async () => {
    const { baseUrl } = await listen(() => undefined)
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()))
    const out = await requestPluginDaemon({ daemon: "alpha", path: "/x" }, { baseUrl, secret: SECRET })
    expect(out).toEqual({ reachable: false, error: "unreachable" })
  })

  it("a daemon that does not answer in time is a timeout", async () => {
    const { baseUrl } = await listen(() => undefined) // never responds
    const out = await requestPluginDaemon({ daemon: "alpha", path: "/slow", timeoutMs: 150 }, { baseUrl, secret: SECRET })
    expect(out).toEqual({ reachable: false, error: "timeout" })
  })

  it("refuses a request aimed anywhere but a daemon's own routes", async () => {
    const deps = { baseUrl: "http://127.0.0.1:1", secret: SECRET }
    await expect(requestPluginDaemon({ daemon: "Alpha", path: "/x" }, deps)).rejects.toThrow(/daemon/)
    await expect(requestPluginDaemon({ daemon: "alpha", path: "x" }, deps)).rejects.toThrow(/path/)
    await expect(requestPluginDaemon({ daemon: "alpha", path: "//evil.example/x" }, deps)).rejects.toThrow(/path/)
    await expect(requestPluginDaemon({ daemon: "alpha", path: "/../beta/x" }, deps)).rejects.toThrow(/path/)
    await expect(requestPluginDaemon({ daemon: "alpha", path: "/%2e%2e/beta/x" }, deps)).rejects.toThrow(/path/)
    await expect(requestPluginDaemon({ daemon: "alpha", path: "/%2E./beta/x" }, deps)).rejects.toThrow(/path/)
    await expect(requestPluginDaemon({ daemon: "alpha", path: "/a\\b" }, deps)).rejects.toThrow(/path/)
  })

  it("refuses control characters and whitespace — fetch strips tab/CR/LF BEFORE resolving `..`", async () => {
    const deps = { baseUrl: "http://127.0.0.1:1", secret: SECRET }
    // Each of these reached GET /beta/admin with the secret attached before the fix.
    for (const path of ["/.\t./beta/admin", "/%2\te%2\te/beta/admin", "/x/.\n./.\r./beta/admin", "/ x", "/x\u0000", "/x\u007f"]) {
      await expect(requestPluginDaemon({ daemon: "alpha", path }, deps), JSON.stringify(path)).rejects.toThrow(/path/)
    }
  })

  it("refuses a method outside GET/POST/DELETE at runtime, not only in the type", async () => {
    const deps = { baseUrl: "http://127.0.0.1:1", secret: SECRET }
    const input = { daemon: "alpha", path: "/x", method: "PUT" } as unknown as Parameters<typeof requestPluginDaemon>[0]
    await expect(requestPluginDaemon(input, deps)).rejects.toThrow(/method/)
  })

  it("`..` inside the query string is data, not a climb — the path stays under /<daemon>/", async () => {
    const { baseUrl, seen } = await listen((_seen, res) => {
      res.writeHead(200)
      res.end()
    })
    const out = await requestPluginDaemon({ daemon: "alpha", path: "/items/1?next=a/../b" }, { baseUrl, secret: SECRET })
    expect(out).toMatchObject({ reachable: true, status: 200 })
    expect(seen.url).toBe("/alpha/items/1?next=a/../b")
  })
})
