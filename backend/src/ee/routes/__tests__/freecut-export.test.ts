import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
vi.mock("../../pipelines/_freecut-timeline.js", async (orig) => ({
  ...(await orig<typeof import("../../pipelines/_freecut-timeline.js")>()),
  persistExportAsset: vi.fn(async () => ({ assetId: "a1", assetUrl: "https://cdn.nodaro.ai/exports/u1/freecut-x.json" })),
}))
import { freecutExportRoutes } from "../freecut-export.js"

function build() {
  const app = Fastify()
  app.addHook("preHandler", async (req) => { (req as { userId?: string }).userId = "u1" })
  app.register(freecutExportRoutes)
  return app
}
const timeline = { scenes: [{ sceneEntityId: "s1", compositeUrl: "https://cdn/c1.mp4", shots: [{ shot_id: "s1", duration_seconds: 5 }] }, { sceneEntityId: "s2", compositeUrl: "https://cdn/c2.mp4", shots: [{ shot_id: "s2", duration_seconds: 4 }] }], musicAssetUrl: "" }

describe("POST /v1/freecut-export", () => {
  it("returns { url, format, assetId } for a valid json request", async () => {
    const app = build()
    const res = await app.inject({ method: "POST", url: "/v1/freecut-export", payload: { format: "json", timeline } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ url: expect.stringContaining("exports/"), format: "json", assetId: "a1" })
    await app.close()
  })
  it("400s on an invalid body", async () => {
    const app = build()
    const res = await app.inject({ method: "POST", url: "/v1/freecut-export", payload: { format: "png", timeline } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
