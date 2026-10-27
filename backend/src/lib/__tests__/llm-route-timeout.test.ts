// @test-watches backend/src/routes/**/*.ts backend/src/ee/routes/**/*.ts backend/src/nodes/**/*.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { extendSocketTimeout } from "../llm-route-timeout.js"

describe("extendSocketTimeout", () => {
  it("sets the idle timeout on the connection's socket", () => {
    const socket = { setTimeout: vi.fn() }
    extendSocketTimeout({ raw: { socket } }, { raw: { socket } }, 600_000)
    expect(socket.setTimeout).toHaveBeenCalledOnce()
    expect(socket.setTimeout).toHaveBeenCalledWith(600_000)
  })

  it("leaves a request with no real socket alone", () => {
    expect(() => extendSocketTimeout({ raw: {} }, { raw: {} }, 600_000)).not.toThrow()
    expect(() => extendSocketTimeout({ raw: { socket: {} } }, { raw: null }, 1)).not.toThrow()
  })

  it("a route using it answers an in-process app.inject request (a plugin worker's call)", async () => {
    // The path that failed: light-my-request's reply has a setTimeout that
    // throws without a callback, and its request has none at all.
    const app = Fastify({ logger: false })
    app.post("/t", async (req, reply) => {
      extendSocketTimeout(req, reply, 600_000)
      return { ok: true }
    })
    const res = await app.inject({ method: "POST", url: "/t", payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })

  it("a route using it sets the timeout on a real HTTP request's socket", async () => {
    const app = Fastify({ logger: false })
    let timeout: number | undefined
    app.get("/t", async (req, reply) => {
      extendSocketTimeout(req, reply, 600_000)
      timeout = req.raw.socket.timeout
      return { ok: true }
    })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const res = await fetch(`${address}/t`)
    expect(res.status).toBe(200)
    expect(timeout).toBe(600_000)
    await app.close()
  })
})

/** Every .ts file under `dir`, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path)
    return path.endsWith(".ts") ? [path] : []
  })
}

describe("routes set socket timeouts only through extendSocketTimeout", () => {
  it("no route (node units included) calls req.raw.setTimeout / reply.raw.setTimeout directly", () => {
    const root = join(import.meta.dirname, "..", "..")
    const offenders = [join(root, "routes"), join(root, "ee", "routes"), join(root, "nodes")]
      .flatMap(sources)
      .filter((file) => /\b(req|reply)\.raw\.setTimeout\(/.test(readFileSync(file, "utf8")))
    expect(offenders).toEqual([])
  })
})
