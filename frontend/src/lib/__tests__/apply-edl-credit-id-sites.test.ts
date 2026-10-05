/**
 * The editor quotes an Apply EDL render on the id `applyEdlCreditId(quality)`
 * (@nodaro/shared) names — `apply-edl` for a final, `apply-edl:proxy` for a
 * preview — and on nothing it spells itself. This guard reads the CALL SHAPES
 * of the editor's price lookups (the live model-cost hooks and cache, and the
 * cold-cache `NODE_CREDIT_COSTS` table), so a new pill, badge or estimate
 * cannot quote a preview at the final's price, or a final at the preview's.
 *
 * Why not a text search: `apply-edl` is also the node TYPE, which legitimately
 * appears all over the editor (the node map, handles, resolvers, executors).
 * Only a credit id handed to a price lookup is wrong as a bare literal.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const SRC = path.resolve(__dirname, "../..")
/** The first test reads every source file under frontend/src: about a second
 *  here, many times that on a shared CI runner, past vitest's 5 s default. */
const SCAN_TIMEOUT_MS = 60_000

/** Price lookups → the index of the argument that names the credit id. */
const CREDIT_ID_ARG: Readonly<Record<string, number>> = {
  useModelCredits: 0,
  useModelCreditCost: 0,
  getCachedCredits: 0,
  getCachedModelCredits: 0,
  fetchModelCredits: 0,
  getModelCreditCost: 0,
  // estimateRunCredits' injected live-cost reader.
  cachedCost: 0,
}
/** Tables indexed by a credit id. */
const CREDIT_TABLES: ReadonlySet<string> = new Set(["NODE_CREDIT_COSTS"])

const HELPER = "applyEdlCreditId"

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      sourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      acc.push(full)
    }
  }
  return acc
}

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind)
}

function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/")
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)) {
    cur = cur.expression
  }
  return cur
}

/** True when an expression spells an Apply EDL credit id itself — a literal, a
 *  template, or a hand-rolled choice — instead of asking `applyEdlCreditId`. */
function spellsApplyEdlId(expr: ts.Expression): boolean {
  const e = unwrap(expr)
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text === "apply-edl" || e.text.startsWith("apply-edl:")
  if (ts.isTemplateExpression(e)) return e.head.text.startsWith("apply-edl")
  if (ts.isConditionalExpression(e)) return spellsApplyEdlId(e.whenTrue) || spellsApplyEdlId(e.whenFalse)
  if (ts.isBinaryExpression(e)) return spellsApplyEdlId(e.left) || spellsApplyEdlId(e.right)
  return false
}

function callsHelper(expr: ts.Expression | undefined): boolean {
  if (!expr) return false
  const e = unwrap(expr)
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === HELPER
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return undefined
}

/** The credit-id expression a price lookup names, when `n` is one. */
function lookupId(n: ts.Node): { what: string; id: ts.Expression | undefined } | undefined {
  if (ts.isCallExpression(n)) {
    const name = calleeName(n)
    if (name === undefined || !Object.hasOwn(CREDIT_ID_ARG, name)) return undefined
    return { what: `${name}(…)`, id: n.arguments[CREDIT_ID_ARG[name]!] }
  }
  if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && CREDIT_TABLES.has(n.expression.text)) {
    return { what: `${n.expression.text}[…]`, id: n.argumentExpression }
  }
  return undefined
}

/** The body of the function (declaration or `const x = (…) =>`) named `name`. */
function functionBody(sf: ts.SourceFile, name: string): ts.Node | undefined {
  let body: ts.Node | undefined
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) body = n.body
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      const init = unwrap(n.initializer)
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) body = init.body
    }
  })
  return body
}

describe("the editor prices Apply EDL on applyEdlCreditId's id", () => {
  it("no price lookup anywhere in frontend/src is handed a bare apply-edl id", { timeout: SCAN_TIMEOUT_MS }, () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      if (!fs.readFileSync(file, "utf8").includes("apply-edl")) continue
      const sf = parse(file)
      walk(sf, (n) => {
        const found = lookupId(n)
        if (found?.id && spellsApplyEdlId(found.id)) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
          offenders.push(`${rel(file)}:${line} ${found.what} names ${found.id.getText(sf)} — take it from ${HELPER}(quality)`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it("the run estimate's id, the cold-cache fallback and the node pill each ask applyEdlCreditId", () => {
    const helpers = parse(path.join(SRC, "components/editor/config-panels/helpers.ts"))
    const types = parse(path.join(SRC, "components/editor/workflow-editor/types.ts"))
    const node = parse(path.join(SRC, "components/nodes/apply-edl-node.tsx"))

    // getModelIdentifier → the id every run-level estimate reads the live row of.
    const returnsHelper: string[] = []
    walk(functionBody(helpers, "getModelIdentifier")!, (n) => {
      if (ts.isReturnStatement(n) && callsHelper(n.expression)) returnsHelper.push(n.expression!.getText(helpers))
    })
    expect(returnsHelper).toHaveLength(1)

    // estimateNodeCredits → the cold-cache row, read through the same id.
    const tableReads: boolean[] = []
    walk(functionBody(types, "estimateNodeCredits")!, (n) => {
      const found = lookupId(n)
      if (found?.what === "NODE_CREDIT_COSTS[…]" && callsHelper(found.id)) tableReads.push(true)
    })
    expect(tableReads).toHaveLength(1)

    // The node pill (and its Run button, which takes the pill's number).
    const pillReads: boolean[] = []
    walk(node, (n) => {
      const found = lookupId(n)
      if (found?.what === "useModelCredits(…)") pillReads.push(callsHelper(found.id))
    })
    expect(pillReads).toEqual([true])
  })
})
