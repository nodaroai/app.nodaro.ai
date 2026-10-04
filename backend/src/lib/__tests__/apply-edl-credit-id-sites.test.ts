/**
 * Apply EDL's credit id is chosen in ONE place: `applyEdlCreditId(quality)`
 * (@nodaro/shared) — `apply-edl` for a final render, `apply-edl:proxy` for a
 * preview. This guard reads the CALL SHAPES of the backend's credit consumers
 * (the guard's resolver, the rate lookup, the reservation, the markup, the
 * workflow run's reserve id), so neither a new site nor an edited one can price
 * an Apply EDL render on the wrong row: a preview reserved at the final's rate,
 * or a final checked against the preview's.
 *
 * Why not a text search: the JOB is named `apply-edl` as well, and that name
 * stays, legitimately, at many sites (the queue add, the job-budget registry,
 * the finalize allowlist, the worker's handler map, `jobName !== "apply-edl"`).
 * Only a credit id handed to a consumer is wrong as a bare literal.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { SRC, SCAN_TIMEOUT_MS, eachSourceFile, lineOf, parseText, walk } from "./source-scan.js"

/** Credit consumers → the index of the argument that names the credit id. */
const CREDIT_ID_ARG: Readonly<Record<string, number>> = {
  creditGuard: 0, // a resolver: (req) => id
  reserveCreditsForJob: 3,
  getModelCreditBaseCost: 0,
  getModelCreditCostFromDB: 0,
  getModelCreditCost: 0,
  applyServiceMarkup: 2,
  checkCredits: 1,
  reserveCredits: 2,
  chargedCredits: 1,
  // A workflow run's reserve id: (jobName, payload, modelIdentifier = jobName).
  ffmpegResult: 2,
  // (jobName, modelIdentifier, payload).
  simpleResult: 1,
}
/** Where the id comes from when its own argument is left out: `ffmpegResult`
 *  defaults its model identifier to the job name. */
const DEFAULTED_ID_ARG: Readonly<Record<string, number>> = { ffmpegResult: 0 }

/** The files that price Apply EDL renders and nothing else. */
const PRICING_MODULES = ["routes/apply-edl.ts", "lib/apply-edl-plan.ts"] as const

const CREDIT_ID_HELPER = "applyEdlCreditId"

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return undefined
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isAwaitExpression(cur)
  ) {
    cur = cur.expression
  }
  return cur
}

/** The expressions a function argument returns (its expression body, or every
 *  `return` of its block body, not descending into nested functions). */
function returnedExpressions(fn: ts.ArrowFunction | ts.FunctionExpression): ts.Expression[] {
  if (!ts.isBlock(fn.body)) return [fn.body]
  const out: ts.Expression[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression)
    n.forEachChild(visit)
  }
  fn.body.forEachChild(visit)
  return out
}

/** The id expressions a consumer call names, or [] when it is not a consumer
 *  call (or names no id at all). */
function idExpressions(call: ts.CallExpression): { consumer: string; ids: ts.Expression[] } | undefined {
  const consumer = calleeName(call)
  if (consumer === undefined || !Object.hasOwn(CREDIT_ID_ARG, consumer)) return undefined
  const arg = call.arguments[CREDIT_ID_ARG[consumer]!] ??
    (Object.hasOwn(DEFAULTED_ID_ARG, consumer) ? call.arguments[DEFAULTED_ID_ARG[consumer]!] : undefined)
  if (!arg) return { consumer, ids: [] }
  const a = unwrap(arg)
  return { consumer, ids: ts.isArrowFunction(a) || ts.isFunctionExpression(a) ? returnedExpressions(a) : [a] }
}

/** True when an expression spells an Apply EDL credit id itself — a literal, a
 *  template, or a hand-rolled choice between the two — instead of asking
 *  `applyEdlCreditId`. */
function spellsApplyEdlId(expr: ts.Expression): boolean {
  const e = unwrap(expr)
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return e.text === "apply-edl" || e.text.startsWith("apply-edl:")
  }
  if (ts.isTemplateExpression(e)) return e.head.text.startsWith("apply-edl")
  if (ts.isConditionalExpression(e)) return spellsApplyEdlId(e.whenTrue) || spellsApplyEdlId(e.whenFalse)
  if (ts.isBinaryExpression(e)) return spellsApplyEdlId(e.left) || spellsApplyEdlId(e.right)
  return false
}

/** Names declared in this file as `const x = applyEdlCreditId(…)`. */
function helperBoundNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && callsHelper(n.initializer)) {
      names.add(n.name.text)
    }
  })
  return names
}

function callsHelper(expr: ts.Expression): boolean {
  const e = unwrap(expr)
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === CREDIT_ID_HELPER
}

function fromHelper(expr: ts.Expression, bound: ReadonlySet<string>): boolean {
  const e = unwrap(expr)
  return callsHelper(e) || (ts.isIdentifier(e) && bound.has(e.text))
}

function parseFile(rel: string): ts.SourceFile {
  const file = join(SRC, rel)
  return parseText(file, readFileSync(file, "utf8"))
}

describe("Apply EDL credit ids come from applyEdlCreditId", () => {
  it("no credit consumer anywhere in backend/src is handed a bare apply-edl id", { timeout: SCAN_TIMEOUT_MS }, () => {
    const offenders: string[] = []
    eachSourceFile(["apply-edl"], (sf, rel) => {
      walk(sf, (n) => {
        if (!ts.isCallExpression(n)) return
        const found = idExpressions(n)
        if (!found) return
        for (const id of found.ids) {
          if (spellsApplyEdlId(id)) {
            offenders.push(`${rel}:${lineOf(sf, n)} ${found.consumer}(… ${id.getText(sf)} …) — take the id from ${CREDIT_ID_HELPER}(quality)`)
          }
        }
      })
    })
    expect(offenders).toEqual([])
  })

  it("the Apply EDL pricing modules take EVERY credit id from applyEdlCreditId", () => {
    const census: Record<string, Record<string, number>> = {}
    const offenders: string[] = []
    for (const rel of PRICING_MODULES) {
      const sf = parseFile(rel)
      const bound = helperBoundNames(sf)
      walk(sf, (n) => {
        if (!ts.isCallExpression(n)) return
        const found = idExpressions(n)
        if (!found) return
        const perFile = (census[rel] ??= {})
        perFile[found.consumer] = (perFile[found.consumer] ?? 0) + 1
        if (found.ids.length === 0 || !found.ids.every((id) => fromHelper(id, bound))) {
          offenders.push(`${rel}:${lineOf(sf, n)} ${found.consumer}(…) does not take its id from ${CREDIT_ID_HELPER}(quality)`)
        }
      })
    }
    expect(offenders).toEqual([])
    // The census pins every site this guard checks, so a refactor that moves a
    // site out of reach fails here instead of passing with nothing checked. A
    // new consumer call in these files is added here on purpose.
    expect(census).toEqual({
      "routes/apply-edl.ts": { creditGuard: 1, getModelCreditBaseCost: 1, reserveCreditsForJob: 1 },
      "lib/apply-edl-plan.ts": { getModelCreditBaseCost: 1, applyServiceMarkup: 1 },
    })
  })

  it("a workflow run reserves an Apply EDL node on applyEdlCreditId's id (the job keeps its name)", () => {
    const sf = parseFile("services/workflow-engine/payload-builder.ts")
    const sites: string[] = []
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return
      const name = calleeName(n)
      if (name !== "ffmpegResult" && name !== "simpleResult") return
      const jobName = n.arguments[0]
      if (!jobName || !ts.isStringLiteral(jobName) || jobName.text !== "apply-edl") return
      const id = n.arguments[CREDIT_ID_ARG[name]!]
      sites.push(id && callsHelper(id) ? "applyEdlCreditId" : `${name}:${lineOf(sf, n)} names ${id ? id.getText(sf) : "no id (defaults to the job name)"}`)
    })
    expect(sites).toEqual(["applyEdlCreditId"])
  })

  it("the workflow estimate prices an Apply EDL node through applyEdlCreditId", () => {
    const sf = parseFile("ee/billing/credits.ts")
    let helperCalls = 0
    walk(sf, (n) => {
      if (!ts.isFunctionDeclaration(n) || n.name?.text !== "getNodeModelIdentifier" || !n.body) return
      walk(n.body, (inner) => {
        if (ts.isReturnStatement(inner) && inner.expression && callsHelper(inner.expression)) helperCalls++
      })
    })
    expect(helperCalls).toBe(1)
  })
})
