import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ADMIN = "00000000-0000-4000-8000-000000000002"
const NON_ADMIN = "00000000-0000-4000-8000-000000000001"

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (c: number) => { send: (b: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))

import { adminAccessRoutes } from "../admin-access.js"

let app: FastifyInstance
let saved: Record<string, string | undefined> = {}
const ENV_KEYS = ["CLIENT_IP_HEADER", "CLIENT_IP_HEADER_FROM", "NETWORK_HASH_SECRET"] as const

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.CLIENT_IP_HEADER = "x-real-ip"
  process.env.CLIENT_IP_HEADER_FROM = "100.64.0.0/10"
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") (req as { userId?: string }).userId = h
  })
  await app.register(async (i) => {
    await adminAccessRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await app.close()
})

function whoami(headers: Record<string, string>, userId = ADMIN) {
  return app.inject({ method: "GET", url: "/v1/admin/access/whoami", headers: { "x-user-id": userId, ...headers } })
}

describe("GET /v1/admin/access/whoami", () => {
  it("is admin-only", async () => {
    const res = await whoami({ "x-forwarded-for": "100.64.3.4", "x-real-ip": "85.65.91.64" }, NON_ADMIN)
    expect(res.statusCode).toBe(403)
  })

  it("shows how the server sees the caller: the edge's statement, the hop, a network token", async () => {
    const res = await whoami({ "x-forwarded-for": "100.64.3.4", "x-real-ip": "85.65.91.64" })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({
      address: "85.65.91.64",
      source: "edge-header",
      hop: "100.64.3.4",
      header: "x-real-ip",
      network: "85.65.91.64",
      hashScheme: "sha256",
    })
    expect(data.networkToken).toMatch(/^[0-9a-f]{12}$/)
  })

  it("reports unknown — not the proxy — when the edge states nothing", async () => {
    const res = await whoami({ "x-forwarded-for": "100.64.3.4" })
    expect(res.json().data).toMatchObject({ address: null, source: "unknown", hop: "100.64.3.4", network: null, networkToken: null })
  })
})
