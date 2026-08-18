/**
 * Boot-safety pins for the 4b relay registration (source-level, like
 * route-path-parity): on cloud @nodaroai/cloud-plugins registers the SAME
 * wire paths and worker job types — a second registration is a Fastify boot
 * crash (routes) or a silent handler shadow (worker). These pins fail the
 * build if either registration loses its `!hasCredits()` gate, which no
 * runtime test exercises (public CI can't boot the real plugin lane).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8")

describe("nodaro-exclusive registration stays edition-gated", () => {
  it("app.ts registers nodaroExclusiveRoutes ONLY behind !hasCredits() — double registration on cloud is a boot crash", () => {
    const src = read("src/app.ts")
    expect(src).toMatch(/if \(!hasCredits\(\)\) await app\.register\(nodaroExclusiveRoutes\)/)
    // Exactly one registration site, and no unguarded one.
    const sites = src.match(/register\(nodaroExclusiveRoutes\)/g) ?? []
    expect(sites).toHaveLength(1)
  })

  it("video-worker merges the relay handlers ONLY behind !hasCredits(), BEFORE the plugin merge (plugin wins on cloud)", () => {
    const src = read("src/workers/video-worker.ts")
    const gate = src.indexOf("if (!hasCredits()) {")
    const relayImport = src.indexOf("nodaro-exclusive-relay.js")
    const relayMerge = src.indexOf("Object.assign(allHandlers, nodaroExclusiveRelayHandlers)")
    const pluginMerge = src.indexOf("Object.assign(allHandlers, privatePluginHandlers)")
    expect(relayImport).toBeGreaterThan(-1)
    expect(relayMerge).toBeGreaterThan(-1)
    expect(pluginMerge).toBeGreaterThan(-1)
    // The gate opens before the import/merge, and both precede the plugin merge.
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(relayImport)
    expect(relayMerge).toBeLessThan(pluginMerge)
  })
})
