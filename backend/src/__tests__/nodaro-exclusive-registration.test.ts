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
    // The relay map is merged through the edit-plan mode gate (decided
    // 2026-10-06), so this matches the merge with or without a wrapper, as below.
    const relayMerge = src.search(/Object\.assign\(allHandlers, (?:[A-Za-z0-9_]+\()*nodaroExclusiveRelayHandlers/)
    // The plugin map is merged bare today (liveness is applied at the dispatch
    // site, not to the map), but a wrapper around it would be legitimate —
    // what this pin owns is the ORDER of the two merges, not the shape of the
    // value, so it matches the merge itself and lets a wrapper vary.
    const pluginMerge = src.search(/Object\.assign\(allHandlers, (?:[A-Za-z0-9_]+\()*privatePluginHandlers/)
    expect(relayImport).toBeGreaterThan(-1)
    expect(relayMerge).toBeGreaterThan(-1)
    expect(pluginMerge).toBeGreaterThan(-1)
    // The gate opens before the import/merge, and both precede the plugin merge.
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(relayImport)
    expect(relayMerge).toBeLessThan(pluginMerge)
  })
})
