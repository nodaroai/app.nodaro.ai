/**
 * Site totality for the stored listing price (decided 2026-10-05).
 *
 * The preview stop rule shapes RUN estimates only. A price stored at publish —
 * `estimated_credits` / `base_estimated_credits` on an app, a component or a
 * template, written on publish and republish and read back by the monetization
 * recalculation — counts the whole graph. So every file that writes one of
 * those columns prices it with `estimateWorkflowListingCredits`, never with the
 * run estimate, and the listing estimator is used for nothing else.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(path)
    }
  }
  return out
}
const FILES = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))

/** Writes a stored estimate column: an insert/update key, or an assignment
 *  (a row type's `estimated_credits: number` declares, it does not write). */
const WRITES_STORED_ESTIMATE = /\b(base_)?estimated_credits\s*(:(?!\s*number\b)|=(?!=))/
/** Any workflow estimator but the listing one — run, base, or one added later —
 *  defaults to the run scope, so a writer may call none of them. */
const RUN_ESTIMATE_CALL = /\bestimateWorkflow(?!ListingCredits\b)[A-Za-z]*Credits\s*\(/
const LISTING_ESTIMATE_CALL = /\bestimateWorkflowListingCredits\s*\(/
const ESTIMATOR_FILE = "ee/billing/credits.ts"

const writers = FILES.filter((f) => WRITES_STORED_ESTIMATE.test(f.text))

/** Every workflow estimator the billing module defines — a static method on
 *  `CreditsService` or an exported function — named `estimateWorkflow…Credits`. */
const ESTIMATOR_NAMES = [
  ...new Set(
    [...FILES.find((f) => f.rel === ESTIMATOR_FILE)!.text.matchAll(/\b(?:static\s+(?:async\s+)?|function\s+)(estimateWorkflow[A-Za-z]*Credits)\s*\(/g)].map(
      (m) => m[1],
    ),
  ),
]

describe("the forbidden call covers every run-scope estimator", () => {
  it("finds the estimators in the billing module", () => {
    expect(ESTIMATOR_NAMES).toEqual(expect.arrayContaining(["estimateWorkflowCredits", "estimateWorkflowBaseCredits", "estimateWorkflowListingCredits"]))
  })

  it.each(ESTIMATOR_NAMES.filter((name) => name !== "estimateWorkflowListingCredits"))("%s is forbidden in a writer", (name) => {
    expect(`${name}(nodes, edges)`).toMatch(RUN_ESTIMATE_CALL)
  })

  it("the listing estimate is not forbidden", () => {
    expect("estimateWorkflowListingCredits(nodes, edges)").not.toMatch(RUN_ESTIMATE_CALL)
  })
})

describe("every file that stores an estimate prices it over the whole graph", () => {
  it("the census finds the publish paths (and the seeded tutorials)", () => {
    expect(writers.map((f) => f.rel).sort()).toEqual([
      // Seeds a template's estimate from its JSON file; it estimates nothing.
      "lib/tutorial-seed/index.ts",
      // App + component publish and republish, and the monetization recalculation.
      "routes/published-apps.ts",
      // Template publish (new and existing template).
      "routes/workflow-templates.ts",
    ])
  })

  it.each(writers.map((f) => f.rel))("%s never calls the run estimate", (rel) => {
    expect(FILES.find((f) => f.rel === rel)!.text).not.toMatch(RUN_ESTIMATE_CALL)
  })

  it.each(["routes/published-apps.ts", "routes/workflow-templates.ts"])("%s calls the listing estimate", (rel) => {
    expect(FILES.find((f) => f.rel === rel)!.text).toMatch(LISTING_ESTIMATE_CALL)
  })

  it("the listing estimate is called only where an estimate is stored", () => {
    const callers = FILES.filter((f) => f.rel !== ESTIMATOR_FILE && LISTING_ESTIMATE_CALL.test(f.text)).map((f) => f.rel)
    for (const rel of callers) expect(writers.map((f) => f.rel), rel).toContain(rel)
  })
})
