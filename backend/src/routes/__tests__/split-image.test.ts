import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
}))

vi.mock("@/lib/storage.js", () => ({
  uploadBufferToR2: vi.fn(),
}))

vi.mock("sharp", () => ({
  default: vi.fn(),
}))

import { splitImageRoutes } from "../split-image.js"
import { safeFetch } from "../../lib/safe-fetch.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  await app.register(async (instance) => {
    await splitImageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/split-image", () => {
  it("returns 400 when safeFetch blocks the upstream address", async () => {
    vi.mocked(safeFetch).mockRejectedValue(
      new Error("safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.0.0.7"),
    )

    const res = await app.inject({
      method: "POST",
      url: "/v1/split-image",
      payload: {
        imageUrl: "https://example.com/avatar.jpg",
        gridCols: 1,
        gridRows: 1,
        names: ["avatar"],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: {
        code: "validation_error",
        message: "URL resolves to a blocked address",
      },
    })
  })
})
