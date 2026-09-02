/**
 * THE WALL IS ATTACHED WHERE EVERY RUN PASSES — a placement pin.
 *
 * `findForeignCatalogIds` refuses picker ids a curated deployment does not
 * offer. It only protects the lanes it is called on, and the run graph has
 * exactly three places a graph is in hand and about to become prompt text:
 *   1. the orchestrator worker, AFTER `applyInputOverridesToNodes` (any lane's
 *      overrides can write an id onto a parameter node past every route
 *      check) and BEFORE parameter nodes are pre-completed via
 *      `getParameterPromptHint`;
 *   2. the sub-workflow handler, which loads and executes a nested graph
 *      in-process without ever re-entering the orchestrator;
 *   3. the credit guard, for the single-node routes that carry `direction`
 *      / `subject` ids on the wire.
 * Eight producers enqueue into (1) and three of them never load nodes, so
 * the worker is the only place that is guaranteed to see every run. These
 * pins read the source, because the worker's entry is not unit-drivable
 * without standing up BullMQ + Supabase, and an ORDERING regression (guard
 * moved above the override merge, or below the pre-complete) would pass any
 * mock-level test that only checks "was it called".
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

describe("catalog guard placement", () => {
  it("orchestrator: after the override merge, before parameter pre-completion", () => {
    const src = read("workers/orchestrator-worker.ts")
    const merge = src.indexOf("applyInputOverridesToNodes(nodes, inputOverrides)")
    const guard = src.indexOf("findForeignCatalogIds(nodes)")
    const preComplete = src.indexOf("getParameterPromptHint(node)")
    expect(merge, "override merge present").toBeGreaterThan(-1)
    expect(guard, "guard present").toBeGreaterThan(-1)
    expect(preComplete, "pre-completion present").toBeGreaterThan(-1)
    expect(guard, "guard must run AFTER the override merge").toBeGreaterThan(merge)
    expect(guard, "guard must run BEFORE parameter nodes become prompt text").toBeLessThan(preComplete)
    // And it fails the execution, not just logs.
    const slice = src.slice(guard, guard + 800)
    expect(slice).toMatch(/failExecution\(executionId, foreignCatalogIdMessage\(foreign\)\)/)
  })

  it("sub-workflow handler: after the route filter, before parameter pre-completion", () => {
    const src = read("services/workflow-engine/sub-workflow-handler.ts")
    const filter = src.indexOf("subNodes = subNodes.filter((n) => reachable.has(n.id))")
    const guard = src.indexOf("findForeignCatalogIds(subNodes)")
    const preComplete = src.indexOf("getParameterPromptHint(")
    expect(filter).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(filter)
    expect(guard).toBeLessThan(preComplete)
    expect(src.slice(guard, guard + 400)).toContain('err.code = "catalog_value_not_available"')
  })

  it("credit guard: the wire lane is checked inside the surface-deny block, before any reservation", () => {
    const src = read("middleware/credit-guard.ts")
    const guard = src.indexOf("findForeignCatalogIdsInBody(nodeType")
    const deny = src.indexOf("isNodeDenied(nodeType)")
    // The shim hands off to the edition impl (storage + credit check +
    // reservation) at this call; the wall must precede it.
    const handoff = src.indexOf("impl.creditGuardImpl(modelResolver, opts)(req, reply)")
    expect(guard).toBeGreaterThan(deny)
    expect(handoff).toBeGreaterThan(-1)
    expect(guard, "guard before the reservation hand-off").toBeLessThan(handoff)
    expect(src.slice(guard, guard + 600)).toContain('code: "catalog_value_not_available"')
  })

  it("every orchestration enqueue producer feeds the guarded worker (no second consumer)", () => {
    // The wall holds because there is ONE consumer of the orchestration
    // queue. A second Worker on it would be a second run path with no guard.
    const worker = read("workers/orchestrator-worker.ts")
    expect(worker).toMatch(/new Worker(<[^>]*>)?\(\s*["']workflow-orchestration["']/)
    // Sweep for any other Worker bound to the same queue name.
    const queueName = "workflow-orchestration"
    const glob = ["workers", "lib", "services", "routes", "ee"].flatMap((d) => walk(join(SRC, d)))
    const others = glob.filter((f) => {
      if (f.endsWith("orchestrator-worker.ts") || f.includes("__tests__")) return false
      const s = readFileSync(f, "utf8")
      return /new Worker(<[^>]*>)?\(/.test(s) && s.includes(`"${queueName}"`)
    })
    expect(others, "a second worker on the orchestration queue would bypass the wall").toEqual([])
  })
})

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (e.endsWith(".ts")) out.push(full)
  }
  return out
}
