/**
 * A job's `display_cost` comes from its own `provider_cost`, and from nothing
 * else (lib/job-cost-columns.ts).
 *
 * The bug this holds closed: the router marked up the cost a provider adapter
 * reported, and handed it back as a second figure beside the cost. A handler
 * that then replaced the cost with a measured one (a per-second model measured
 * from the video it returned) carried the router's figure into `display_cost`,
 * so every run of that model showed the same display figure whatever its
 * length, while `provider_cost` was right.
 *
 * Two rules, over every shipped .ts file in backend/src:
 *  1. `display_cost` is written by lib/job-cost-columns.ts alone. No other file
 *     builds an object with that key.
 *  2. An object with a `provider_cost` key is the argument of a funnel that
 *     pairs it (`markJobCompleted`, `markJobCompletedDetailed`,
 *     `markJobFailed`, `markJobFailedDetailed` — each derives `display_cost`
 *     from it), or is listed below with where it goes. A raw `.update()` or
 *     `.insert()` with the key fails: it writes `provider_cost` with no display
 *     figure beside it, or beside a stale one. Spread `await jobCostColumns(cost)`
 *     instead.
 *
 * A key is matched by name, as a string-literal key, or as a computed key that
 * is a string literal or a const initialised with one. Out of scope: SQL. A
 * database function that writes `provider_cost` (migration 392's
 * `settle_job_reservation`) is paired by its backend wrapper, which writes
 * `jobCostColumns` after the call (ee/billing/job-reservation-settlement.ts).
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { eachSourceFile, lineOf, SCAN_TIMEOUT_MS } from "./source-scan.js"

const PAIRING_FUNNELS = new Set(["markJobCompleted", "markJobCompletedDetailed", "markJobFailed", "markJobFailedDetailed"])

/** The module that is the one writer of `display_cost`. */
const DISPLAY_COST_WRITER = "lib/job-cost-columns.ts"

/**
 * `provider_cost` objects that are built before the call they reach, each with
 * where it goes. A listed site that no longer exists fails, so the list only
 * ever names real sites.
 */
const BUILT_BEFORE_THE_FUNNEL: Readonly<Record<string, string>> = {
  "lib/job-cost-columns.ts": "the pairing module itself",
}

interface Site { file: string; line: number; key: string; reachedBy: string | null }

function callName(call: ts.CallExpression): string | null {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return null
}

const TRACKED_CALLS = new Set([...PAIRING_FUNNELS, "update", "insert", "upsert"])

/**
 * Every `provider_cost` / `display_cost` key in a file, with the nearest call
 * (a funnel, or a raw update/insert/upsert) whose arguments hold it inside the
 * same function. The parse keeps no parent pointers (source-ast.ts), so the
 * walk carries the enclosing call down instead.
 */
const COST_KEYS = new Set(["provider_cost", "display_cost"])

/** The file's consts initialised with a string literal, by name. */
function stringConsts(sf: ts.SourceFile): Map<string, string> {
  const consts = new Map<string, string>()
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.Const) !== 0) {
      for (const d of n.declarations) {
        let init = d.initializer
        while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression
        if (ts.isIdentifier(d.name) && init && ts.isStringLiteralLike(init)) consts.set(d.name.text, init.text)
      }
    }
    n.forEachChild(visit)
  }
  visit(sf)
  return consts
}

/** The key a property names: plain, string-literal, or computed from a literal or a string const. */
function keyOf(name: ts.PropertyName, consts: Map<string, string>): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) {
    let e = name.expression
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression
    if (ts.isStringLiteralLike(e)) return e.text
    if (ts.isIdentifier(e)) return consts.get(e.text) ?? null
  }
  return null
}

function sitesIn(sf: ts.SourceFile, rel: string, out: Site[]): void {
  const consts = stringConsts(sf)
  const visit = (n: ts.Node, enclosing: string | null): void => {
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      const key = keyOf(n.name, consts)
      if (key !== null && COST_KEYS.has(key)) out.push({ file: rel, line: lineOf(sf, n), key, reachedBy: enclosing })
    }
    if (ts.isCallExpression(n)) {
      const name = callName(n)
      visit(n.expression, enclosing)
      const inner = name && TRACKED_CALLS.has(name) ? name : enclosing
      for (const a of n.arguments) visit(a, inner)
      return
    }
    const next = ts.isFunctionLike(n) ? null : enclosing
    n.forEachChild((c) => visit(c, next))
  }
  visit(sf, null)
}

function costKeySites(): Site[] {
  const sites: Site[] = []
  eachSourceFile(["provider_cost", "display_cost"], (sf, rel) => sitesIn(sf, rel, sites))
  return sites
}

describe("the guard's matcher", () => {
  it("sees a computed key built from a literal or a string const", () => {
    const text = 'const COL = "provider_cost"\nsupabase.from("jobs").update({ [COL]: 1, ["display_cost"]: 2 })\n'
    const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    const sites: Site[] = []
    sitesIn(sf, "x.ts", sites)
    expect(sites.map((s) => `${s.key}->${s.reachedBy}`)).toEqual(["provider_cost->update", "display_cost->update"])
  })
})

describe("display_cost has one source: the row's own provider_cost", () => {
  const sites = costKeySites()

  it("finds the cost writes (the scan still matches)", () => {
    expect(sites.filter((s) => s.key === "provider_cost").length).toBeGreaterThan(20)
  }, SCAN_TIMEOUT_MS)

  it("writes display_cost only in lib/job-cost-columns.ts", () => {
    const offenders = sites.filter((s) => s.key === "display_cost" && s.file !== DISPLAY_COST_WRITER).map((s) => `${s.file}:${s.line}`)
    expect(offenders).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("writes provider_cost only through a funnel that pairs it", () => {
    const offenders = sites
      .filter((s) => s.key === "provider_cost" && !(s.reachedBy && PAIRING_FUNNELS.has(s.reachedBy)) && !(s.file in BUILT_BEFORE_THE_FUNNEL))
      .map((s) => `${s.file}:${s.line} (reaches ${s.reachedBy ?? "no call"})`)
    expect(offenders).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("lists only sites that exist", () => {
    const files = new Set(sites.filter((s) => s.key === "provider_cost").map((s) => s.file))
    expect(Object.keys(BUILT_BEFORE_THE_FUNNEL).filter((f) => !files.has(f))).toEqual([])
  }, SCAN_TIMEOUT_MS)
})
