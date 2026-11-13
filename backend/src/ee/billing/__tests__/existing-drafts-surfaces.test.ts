// @test-watches backend/src/**/*.ts
/**
 * Every estimate of a run made for the user who would run it is told that
 * user's Seedance drafts (`existingDrafts`, decided 2026-11-12/13), so a
 * Seedance 2.5 HD finalize of a draft that already exists is priced exactly —
 * as its gate prices that draft for that user — on every surface, never at the
 * provider's 8 s row on some and exactly on others:
 *
 *   - the whole-workflow estimates (`estimateWorkflowCredits[Detailed]`): the
 *     API and MCP estimate route, an API token's schema, a shared workflow's
 *     page and a Component's price, through `existingDraftsFor(userId)`;
 *   - the run-set estimates (`estimateRunSet*`): a Render final, a continued
 *     step, an app's Retry, through `existingDraftFinalizePricer(userId)`.
 *
 * Each call site outside the billing module passes the option in its own
 * arguments, or is named here with the reason it prices no such finalize.
 * A listing (an app's, a component's or a template's stored price) is a
 * general user's figure, shown to everyone: it never carries one user's drafts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"

const SRC = join(__dirname, "..", "..", "..")
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

/** A call of a run estimator (the billing module's own definitions excluded). */
const ESTIMATE_CALL = /\b(?:estimateWorkflowCredits(?:Detailed)?|estimateRunSetCredits|estimateRunSetFigures|estimateRunSetCreditsWithoutUgc)\s*\(/
/** A listing estimate: a general user's figure. */
const LISTING_CALL = /\bestimateWorkflowListingCredits\s*\(/
/** Arguments that carry the runner's drafts. */
const CARRIES_DRAFTS = /\bexistingDrafts(?:For)?\b|\bexistingDraftFinalizePricer\(/
/** Files that price a graph holding no Seedance draft node (or define the estimators). */
const NO_DRAFTS: Readonly<Record<string, string>> = {
  "ee/billing/credits.ts": "the estimators themselves",
  "ee/billing/use-case-estimate.ts": "prices a use-case run's built chain: its builders place no Seedance draft node",
  "lib/use-case/continue-credits.ts": "prices a use-case continuation's stored chain: its builders place no Seedance draft node",
}

/** The source with its comments blanked (a word in a comment is never a call site's argument). */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length))
}

/** Each call of `call` in `code`: its line and the text of its arguments (to the matching paren). */
function callSites(code: string, call: RegExp): Array<{ line: number; args: string }> {
  const out: Array<{ line: number; args: string }> = []
  const re = new RegExp(call.source, "g")
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let end = open
    for (let i = open; i < code.length; i++) {
      if (code[i] === "(") depth++
      else if (code[i] === ")" && --depth === 0) { end = i; break }
    }
    out.push({ line: code.slice(0, m.index).split("\n").length, args: code.slice(open + 1, end) })
  }
  return out
}

describe("every run estimate is told its runner's Seedance drafts (site totality)", () => {
  const files = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path).split("\\").join("/"), code: codeOf(readFileSync(path, "utf8")) }))
  const callers = files.filter((f) => ESTIMATE_CALL.test(f.code))

  it("the census finds the estimate surfaces", () => {
    expect(callers.map((f) => f.rel)).toEqual(
      expect.arrayContaining([
        "ee/routes/credits.ts",
        "routes/api-tokens.ts",
        "routes/presentation.ts",
        "routes/component-execute.ts",
        "lib/render-final-run.ts",
        "routes/app-run-resume.ts",
        "ee/lib/app-run-resume-price.ts",
      ]),
    )
  })

  it.each(Object.keys(NO_DRAFTS))("%s is still an estimate caller (or leave the list)", (rel) => {
    expect(callers.map((f) => f.rel)).toContain(rel)
  })

  it("each other call site passes the drafts in its own arguments", () => {
    const missing = callers
      .filter((f) => !(f.rel in NO_DRAFTS))
      .flatMap((f) => callSites(f.code, ESTIMATE_CALL).filter((c) => !CARRIES_DRAFTS.test(c.args)).map((c) => `${f.rel}:${c.line}`))
    expect(missing).toEqual([])
  })

  it("the call-site check sees what a file-level word would miss", () => {
    const code = codeOf(
      "// existingDraftsFor(userId)\nestimateWorkflowCreditsDetailed(nodes, edges)\n" +
        "estimateWorkflowCreditsDetailed(nodes, edges, { ...viewer, ...existingDraftsFor(req.userId) })\n" +
        "estimateRunSetFigures(n, e, ids, undefined, viewer, undefined, { priceOf: existingDraftFinalizePricer(userId) })",
    )
    expect(callSites(code, ESTIMATE_CALL).map((c) => CARRIES_DRAFTS.test(c.args))).toEqual([false, true, true])
  })

  it("no listing site carries a user's drafts: a listing is shown to everyone", () => {
    const listingSites = files.filter((f) => f.rel !== "ee/billing/credits.ts" && LISTING_CALL.test(f.code))
    expect(listingSites.length).toBeGreaterThan(0)
    const carrying = listingSites.flatMap((f) => callSites(f.code, LISTING_CALL).filter((c) => CARRIES_DRAFTS.test(c.args)).map((c) => `${f.rel}:${c.line}`))
    expect(carrying).toEqual([])
  })
})
