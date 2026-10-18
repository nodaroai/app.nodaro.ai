// @test-watches backend/src/routes/** backend/src/ee/routes/** backend/src/nodes/*/route*.ts
/**
 * The boot smoke (`backend-boot-smoke` in .github/workflows/ci.yml) probes
 * every use-case node's run and continue on both editions. Its list is not kept
 * by hand: backend/scripts/use-case-probe-paths.mjs derives it from the
 * use-case registry. This guard holds that derivation to the routes the code
 * really registers:
 *  - every registered use-case type contributes its run and its continue;
 *  - each probed path is a POST some route file registers;
 *  - every POST registered at or under a use-case type's route is probed, or
 *    is a suffix the probe deliberately skips (listed below, with the reason).
 * A use-case route registered any other way — a hand-written path in a node
 * unit, a new suffix in a factory — fails here instead of going unprobed.
 */
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor } from "@nodaro/render-rules"
import { allRouteFiles, extractRouteRegistrations } from "../lib/route-inventory.js"
// Plain .mjs by design (the CI step runs it with zero build); typed by the sibling .d.mts.
import { usecaseProbePaths } from "../../scripts/use-case-probe-paths.mjs"

const REPO_ROOT = join(__dirname, "..", "..", "..")

/**
 * Suffixes under a use-case route that the boot probe does not ask, and why.
 * The probe proves a type's routes are registered on every edition by asking
 * its run and its continue; anything else the type registers must be named here.
 */
const UNPROBED_SUFFIXES: Readonly<Record<string, string>> = {
  "/estimate":
    "a price quote registered by the same factory call as the run (routes/use-case-run.ts); route-inventory-use-case.test.ts holds that it is registered for every type",
}

/** Every POST registered by any route file: `path -> "file:line"` of its registrations. */
function registeredPosts(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const file of allRouteFiles(REPO_ROOT)) {
    for (const r of extractRouteRegistrations(readFileSync(file, "utf8"))) {
      if (r.method !== "POST") continue
      const at = `${relative(REPO_ROOT, file)}:${r.line}`
      out.set(r.path, [...(out.get(r.path) ?? []), at])
    }
  }
  return out
}

describe("the boot probe's use-case routes are derived from the registry", () => {
  const probed = usecaseProbePaths()

  it("asks every registered use-case type's run and continue, once each", () => {
    expect(probed.length).toBeGreaterThan(0)
    expect(new Set(probed).size).toBe(probed.length)
    for (const type of USE_CASE_NODE_TYPES) {
      expect(probed, type).toContain(usecaseDescriptor(type).route)
      expect(probed, type).toContain(usecaseContinuePath(type))
    }
    expect(probed).toHaveLength(USE_CASE_NODE_TYPES.length * 2)
    expect(probed).toContain("/v1/tighten-episode")
    expect(probed).toContain("/v1/tighten-episode/continue")
  })

  it("asks only routes some route file registers", () => {
    const posts = registeredPosts()
    const unregistered = probed.filter((p) => !posts.has(p))
    expect(unregistered, "probed paths no route file registers").toEqual([])
  })

  it("leaves no registered use-case route unprobed", () => {
    const probedSet = new Set(probed)
    const prefixes = USE_CASE_NODE_TYPES.map((type) => usecaseDescriptor(type).route)
    const missed: string[] = []
    for (const [path, at] of registeredPosts()) {
      const prefix = prefixes.find((p) => path === p || path.startsWith(`${p}/`))
      if (!prefix || probedSet.has(path)) continue
      if (Object.hasOwn(UNPROBED_SUFFIXES, path.slice(prefix.length))) continue
      missed.push(`${path} (${at.join(", ")})`)
    }
    expect(
      missed,
      "a use-case route the boot probe does not ask: register it through the use-case registry, or name its suffix in UNPROBED_SUFFIXES with the reason",
    ).toEqual([])
  })
})
