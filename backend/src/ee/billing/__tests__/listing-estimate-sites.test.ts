/**
 * Site totality for the stored listing price (decided 2026-10-05).
 *
 * The preview stop rule shapes RUN estimates only. A price stored at publish —
 * `estimated_credits` / `base_estimated_credits` on an app, a component or a
 * template, written on publish and republish and read back by the monetization
 * recalculation — counts the whole graph. So every file that writes one of
 * those columns prices it with `estimateWorkflowListingCredits`, never with the
 * run estimate, and the listing estimator is used for nothing else. Every
 * listing — app, component and template — asks it for two parts (decided
 * 2026-10-06): the whole graph at Preview (the creator's fee applies to it),
 * plus each Render final without the fee. The per-minute columns (decided
 * 2026-10-07: `base_per_minute_credits`, `per_minute_credits`,
 * `estimated_per_minute_credits`) are stored listing columns too.
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
const WRITES_STORED_ESTIMATE = /\b(?:(?:base_)?estimated_credits|(?:base_|estimated_)?per_minute_credits)\s*(:(?!\s*number\b)|=(?!=))/
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
      // The published-app price backfill for length-based speech pricing: it
      // rewrites the stored columns and MUST price them as a republish does.
      "ee/scripts/backfill-speech-app-prices.ts",
      // Re-prices a stored listing under new monetization from its stored
      // parts (the monetization PATCH); it estimates nothing.
      "lib/app-listing-price.ts",
      // Writes the per-minute columns, folding them into the fixed price
      // while they are missing from the database; it estimates nothing.
      "lib/listing-per-minute-columns.ts",
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

  it.each(["routes/published-apps.ts", "routes/workflow-templates.ts", "ee/scripts/backfill-speech-app-prices.ts"])("%s calls the listing estimate", (rel) => {
    expect(FILES.find((f) => f.rel === rel)!.text).toMatch(LISTING_ESTIMATE_CALL)
  })

  it("the listing estimate is called only where an estimate is stored", () => {
    const callers = FILES.filter((f) => f.rel !== ESTIMATOR_FILE && LISTING_ESTIMATE_CALL.test(f.text)).map((f) => f.rel)
    for (const rel of callers) expect(writers.map((f) => f.rel), rel).toContain(rel)
  })
})

// Review F2 (decided 2026-10-07): a listing prices a recording the app user
// replaces with no length. A call that does not name the exposed media inputs
// would fall back to treating every upload as replaced (never an under-quote,
// but an over-quote of a creator's own fixed asset), so every caller says.
describe("every listing estimate names the media inputs the user replaces", () => {
  const callers = FILES.filter((f) => f.rel !== ESTIMATOR_FILE && LISTING_ESTIMATE_CALL.test(f.text))

  it("finds the callers", () => {
    expect(callers.map((f) => f.rel).sort()).toEqual([
      "ee/scripts/backfill-speech-app-prices.ts",
      "routes/published-apps.ts",
      "routes/workflow-templates.ts",
    ])
  })

  it.each(callers.map((f) => f.rel))("%s passes replaceableMediaNodeIds on every call", (rel) => {
    const text = FILES.find((f) => f.rel === rel)!.text
    const calls = [...text.matchAll(/\bestimateWorkflowListingCredits\s*\(/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      // The call's arguments: up to its closing parenthesis.
      let depth = 0
      let end = call.index! + call[0].length - 1
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++
        else if (text[end] === ")" && --depth === 0) break
      }
      expect(text.slice(call.index!, end), `${rel} @${call.index}`).toMatch(/\breplaceableMediaNodeIds\b/)
    }
  })

  // A List the app user fills is listed per further item (decided 2026-10-07):
  // every caller that lists an app or a component passes its List inputs. A
  // template has none (its cloner edits the workflow), so its route is exempt.
  it.each(callers.map((f) => f.rel).filter((rel) => !rel.endsWith("workflow-templates.ts")))("%s passes exposedListNodeIds on every call", (rel) => {
    const text = FILES.find((f) => f.rel === rel)!.text
    for (const call of text.matchAll(/\bestimateWorkflowListingCredits\s*\(/g)) {
      let depth = 0
      let end = call.index! + call[0].length - 1
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++
        else if (text[end] === ")" && --depth === 0) break
      }
      expect(text.slice(call.index!, end), `${rel} @${call.index}`).toMatch(/\bexposedListNodeIds\b/)
    }
  })
})
