// @test-watches backend/src/routes/**/*.ts backend/src/ee/routes/**/*.ts backend/src/nodes/**/*.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { extendSocketTimeout } from "../llm-route-timeout.js"

describe("extendSocketTimeout", () => {
  it("sets the idle timeout on a request and reply that have a socket", () => {
    const req = { raw: { setTimeout: vi.fn() } }
    const reply = { raw: { setTimeout: vi.fn() } }
    extendSocketTimeout(req, reply, 600_000)
    expect(req.raw.setTimeout).toHaveBeenCalledWith(600_000)
    expect(reply.raw.setTimeout).toHaveBeenCalledWith(600_000)
  })

  it("leaves an in-process request alone (app.inject has no setTimeout)", () => {
    // A plugin worker's request reaches the route through app.inject: its raw
    // objects carry no setTimeout, and calling it was a 500 (2026-10-27).
    expect(() => extendSocketTimeout({ raw: {} }, { raw: {} }, 600_000)).not.toThrow()
    expect(() => extendSocketTimeout({ raw: null }, { raw: undefined }, 1)).not.toThrow()
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
