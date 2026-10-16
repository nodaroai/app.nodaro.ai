// @test-watches backend/src/routes/use-case-run.ts backend/src/routes/use-case-continue.ts
/**
 * The use-case route factories register one route per registered type, their
 * paths read from the type's descriptor. The static route inventory (the
 * frontend path-parity test and check:surfaces) reads them from the same
 * registry, so every type's run, estimate and continue routes are inventoried
 * — on the files that really register them, and only while they loop over the
 * types.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor } from "@nodaro/render-rules"
import { extractRouteRegistrations, usecaseFactoryRegistrations } from "../route-inventory.js"

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8")
const posts = (src: string) =>
  extractRouteRegistrations(src)
    .filter((r) => r.method === "POST")
    .map((r) => r.path)
    .sort()

describe("the use-case route factories are in the route inventory", () => {
  it("the run file registers every type's run and estimate", () => {
    const want = USE_CASE_NODE_TYPES.flatMap((t) => [usecaseDescriptor(t).route, `${usecaseDescriptor(t).route}/estimate`]).sort()
    expect(posts(read("routes/use-case-run.ts"))).toEqual(want)
    expect(want).toContain("/v1/tighten-episode")
    expect(want).toContain("/v1/tighten-episode/estimate")
  })

  it("the continue file registers every type's continue", () => {
    const want = USE_CASE_NODE_TYPES.map((t) => usecaseContinuePath(t)).sort()
    expect(posts(read("routes/use-case-continue.ts"))).toEqual(want)
    expect(want).toContain("/v1/tighten-episode/continue")
  })

  it("each points at the line that registers it", () => {
    const src = read("routes/use-case-run.ts")
    for (const r of usecaseFactoryRegistrations(src)) expect(src.split("\n")[r.line - 1]).toMatch(/\.post\(/)
  })

  it("a file that does not loop over the types reports none of them", () => {
    for (const rel of ["routes/use-case-run.ts", "routes/use-case-continue.ts"]) {
      const unlooped = read(rel).replace(/for \(const type of USE_CASE_NODE_TYPES\)/g, "for (const type of [])")
      expect(usecaseFactoryRegistrations(unlooped), rel).toEqual([])
    }
  })
})
