/**
 * Fix round 1, item 6. `loadOverlay()` has five real (non-test) callers —
 * every process entry point that boots a queue/route that can reach the
 * payload-builder / prompt assembly. Each one MUST also call
 * `registerMainlinePromptPolicies()` right after, or that process runs with
 * the minor-age floor permanently unregistered (silent identity, not a
 * startup failure) even though every other process has it. This guard walks
 * every non-test source file under `backend/src` that calls `loadOverlay()`
 * and asserts it also calls `registerMainlinePromptPolicies()` — so a SIXTH
 * caller added later (a new worker entry point) fails this test instead of
 * silently shipping without the floor.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
/** backend/src */
const SRC_DIR = join(HERE, "..", "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

/** Strip block and line comments before matching — this file's own doc
 *  comments mention `loadOverlay()` in prose, which would otherwise register
 *  as a false "caller". */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

describe("registerMainlinePromptPolicies registration totality", () => {
  it("every non-test file that calls loadOverlay() also calls registerMainlinePromptPolicies()", () => {
    const files = walk(SRC_DIR)
    const contents = new Map(files.map((f) => [f, stripComments(readFileSync(f, "utf-8"))]))

    const callers = files.filter((f) => /\bloadOverlay\s*\(\s*\)/.test(contents.get(f)!))

    // Sanity: this guard is only meaningful if it actually found the known
    // callers — an empty/near-empty result means the walk is broken, not that
    // there's nothing to check. (app.ts, worker.ts, orchestrator.ts,
    // pipeline-worker.ts, render-worker.ts as of this writing.)
    expect(callers.length).toBeGreaterThanOrEqual(5)

    const missing = callers.filter((f) => !/\bregisterMainlinePromptPolicies\s*\(\s*\)/.test(contents.get(f)!))

    expect(missing.map((f) => relative(SRC_DIR, f))).toEqual([])
  })

  it("the dedicated orchestrator entrypoint registers the mainline policies", () => {
    // M-9a: PR 7 rewrites orchestrator.ts's shutdown. This process runs the
    // workflow DAG, so losing the minor-age floor here loses it for every
    // orchestrated generation — with no startup error and no other test.
    const src = stripComments(readFileSync(join(SRC_DIR, "orchestrator.ts"), "utf-8"))
    expect(src).toMatch(/\bloadOverlay\s*\(\s*\)/)
    expect(src).toMatch(/\bregisterMainlinePromptPolicies\s*\(\s*\)/)
  })
})
