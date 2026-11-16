/**
 * GET /health is read every few seconds — by the container's health check
 * through the proxy on the public port (the bundled compose file reads it every
 * 10 s), by the start script while the API boots, and by any uptime monitor.
 * A read that succeeds writes nothing to the log; a read that fails still
 * does, whatever answered it (the route throwing, or a hook answering before
 * the route ran), so an outage shows in the log and the steady polling does not.
 */
import { Writable } from "node:stream"
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

const version = vi.hoisted(() => ({ fail: false }))
vi.mock("../../lib/app-version.js", () => ({
  getAppVersion: () => {
    if (version.fail) throw new Error("version unreadable")
    return "1.2.3"
  },
}))

import { healthRoutes } from "../health.js"

interface LogLine {
  level: number
  msg: string
}

/** The route on a server that logs at info, as the API does, into `lines`. */
async function appWithLog(before?: (app: FastifyInstance) => void) {
  const lines: LogLine[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(line) as LogLine)
      done()
    },
  })
  const app = Fastify({ logger: { level: "info", stream } })
  before?.(app)
  await app.register(healthRoutes)
  await app.ready()
  return { app, lines }
}

const WARN = 40

afterEach(() => {
  version.fail = false
})

describe("GET /health", () => {
  it("answers the API's status and version", async () => {
    const { app } = await appWithLog()
    const res = await app.inject({ method: "GET", url: "/health" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "healthy", version: "1.2.3" })
    await app.close()
  })

  it("a read that succeeds writes nothing to the log, GET or HEAD", async () => {
    const { app, lines } = await appWithLog()
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200)
    expect((await app.inject({ method: "HEAD", url: "/health" })).statusCode).toBe(200)
    expect(lines.map((l) => l.msg)).toEqual([])
    await app.close()
  })

  it("a read that fails because the route threw still writes, at warn or above", async () => {
    const { app, lines } = await appWithLog()
    version.fail = true
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(500)
    expect(lines.some((l) => l.level >= WARN), JSON.stringify(lines)).toBe(true)
    await app.close()
  })

  it("a read that fails because a hook answered before the route ran still writes, at warn or above", async () => {
    const { app, lines } = await appWithLog((app) => {
      app.addHook("onRequest", async (_req, reply) => reply.code(503).send({ error: "unavailable" }))
    })
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(503)
    expect(lines.some((l) => l.level >= WARN && l.msg.includes("503")), JSON.stringify(lines)).toBe(true)
    await app.close()
  })

  it("other spellings of the address are not this route", async () => {
    // The proxy rewrites the address's own spellings (/health/, /health;x, /HEALTH, …)
    // to /health before they reach the API, and hands a path under it (/health/x) on as
    // sent (frontend/Caddyfile). Asked directly, none is this route: here a 404, and in
    // the API the auth hook refuses them first (401), as no public route serves them.
    const { app } = await appWithLog()
    for (const url of ["/health/", "/health/x", "/health%2f", "/health%2fx", "/health;x", "/health%3bx", "/HEALTH"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(404)
    }
    await app.close()
  })
})
