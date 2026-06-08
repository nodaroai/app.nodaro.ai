import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

import { installEmptyJsonBodyFix } from "../empty-json-body-fix.js"

let app: FastifyInstance
beforeEach(async () => {
  app = Fastify({ logger: false })
  installEmptyJsonBodyFix(app)
  app.delete("/del", async () => ({ ok: true }))
  app.post("/echo", async (req) => ({ body: req.body ?? null }))
  await app.ready()
})
afterEach(async () => app.close())

describe("installEmptyJsonBodyFix", () => {
  it("accepts a bodyless request that declares application/json (no 400)", async () => {
    const r = await app.inject({
      method: "DELETE",
      url: "/del",
      headers: { "content-type": "application/json" },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true })
  })

  it("treats an empty json body as no body", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "",
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ body: null })
  })

  it("still parses a non-empty json body", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ a: 1 }),
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ body: { a: 1 } })
  })
})
