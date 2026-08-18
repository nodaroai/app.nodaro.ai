/**
 * GET /v1/version — public like /health (presence data only); the payload the
 * sidebar red dot consumes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  getUpdateStatus: vi.fn(),
}))
vi.mock("@/lib/update-check.js", () => ({ getUpdateStatus: mocks.getUpdateStatus }))

import { versionRoutes } from "../version.js"

let app: FastifyInstance

beforeEach(async () => {
  mocks.getUpdateStatus.mockResolvedValue({
    current: "1.23.0",
    latest: { version: "v2.0.0", url: "https://x", publishedAt: "2026-08-19T00:00:00Z", highlights: "h" },
    updateAvailable: true,
  })
  app = Fastify({ logger: false })
  await app.register(async (i) => versionRoutes(i))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/version", () => {
  it("answers without any auth and carries the update payload", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/version" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      current: "1.23.0",
      latest: expect.objectContaining({ version: "v2.0.0" }),
      updateAvailable: true,
    })
    expect(res.headers["cache-control"]).toContain("max-age=3600")
  })
})
