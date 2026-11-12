// @test-watches backend/src/**/*.ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, it, expect } from "vitest"

/**
 * Where a node unit's app fields (unit.json `appFields`) are held — the lanes, read from source with the
 * TypeScript parser, so a new one cannot skip the check (lib/exposed-unit-field-check.ts):
 *  - the ONE merge of a run's overrides into node data, `applyInputOverridesToNodes`, is called from exactly
 *    one product file (the orchestrator: every lane's job and every continuation is processed there), and
 *    holds the declaration right after the outbound-node lock, before it touches a node;
 *  - every route that takes or applies a run's overrides — it names `inputOverrides`, or re-applies a stored
 *    run's through `continuationInputOverrides` — refuses an app-field value outside the declaration up
 *    front, so the caller gets a 400 before any row exists;
 *  - a route that re-applies a stored run's overrides checks the overrides the run APPLIES (the stored pin
 *    with the request's over it, `continuationInputOverrides`), never only what the request sent.
 */
const SRC = path.resolve(__dirname, "../..")
const files: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(abs)
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(abs)
  }
}
walk(SRC)
const rel = (abs: string) => path.relative(SRC, abs).split(path.sep).join("/")
const source = new Map(files.map((f) => [rel(f), readFileSync(f, "utf8")]))
const parsed = new Map<string, ts.SourceFile>()
const parse = (f: string) => {
  let sf = parsed.get(f)
  if (!sf) parsed.set(f, (sf = ts.createSourceFile(f, source.get(f)!, ts.ScriptTarget.Latest, true)))
  return sf
}
const visit = (node: ts.Node, fn: (n: ts.Node) => void) => {
  fn(node)
  node.forEachChild((c) => visit(c, fn))
}
const calleeName = (call: ts.CallExpression) => (ts.isIdentifier(call.expression) ? call.expression.text : undefined)
const callsTo = (f: string, name: string) => {
  const out: ts.CallExpression[] = []
  visit(parse(f), (n) => {
    if (ts.isCallExpression(n) && calleeName(n) === name) out.push(n)
  })
  return out
}
/** A route that takes or applies a run's overrides: it names `inputOverrides` in code (not a comment), or re-applies a stored run's. */
const takesOverrides = (f: string) => {
  let found = false
  visit(parse(f), (n) => {
    if (ts.isIdentifier(n) && n.text === "inputOverrides") found = true
  })
  return found || callsTo(f, "continuationInputOverrides").length > 0
}
/** Identifiers assigned from `continuationInputOverrides(…)` in the file (a declaration or an assignment). */
const continuationValues = (f: string) => {
  const out = new Set<string>()
  const isContinuation = (e: ts.Expression | undefined) => !!e && ts.isCallExpression(e) && calleeName(e) === "continuationInputOverrides"
  visit(parse(f), (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isContinuation(n.initializer)) out.add(n.name.text)
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && isContinuation(n.right)) out.add(n.left.text)
  })
  return out
}

// The text narrows which files are parsed (a file that never spells the name cannot call it); the parser decides.
const calling = (fn: string) => [...source].filter(([f, s]) => s.includes(fn) && callsTo(f, fn).length > 0).map(([f]) => f).sort()
const routes = [...source]
  .filter(([f, s]) => f.startsWith("routes/") && /inputOverrides|continuationInputOverrides/.test(s) && takesOverrides(f))
  .map(([f]) => f)
  .sort()

describe("every lane that can set a unit's app field holds its declaration", () => {
  it("the override merge has one product caller, the orchestrator", () => {
    expect(calling("applyInputOverridesToNodes").filter((f) => !/apply-input-overrides\.ts$/.test(f))).toEqual(["workers/orchestrator-worker.ts"])
  })

  it("the merge holds the declaration before it touches a node, right after the outbound-node lock", () => {
    const merge = source.get("workers/apply-input-overrides.ts")!
    const body = merge.slice(merge.indexOf("export function applyInputOverridesToNodes("))
    const lock = body.indexOf("assertNoLockedOverrides(")
    const unit = body.indexOf("assertUnitFieldOverrides(")
    const firstWrite = body.indexOf("node.data = ")
    expect(lock).toBeGreaterThan(-1)
    expect(unit).toBeGreaterThan(lock)
    expect(unit).toBeLessThan(firstWrite)
  })

  it("the routes that take or apply a run's overrides are the ones known (a floor, so the census cannot go empty)", () => {
    for (const r of [
      "routes/app-runner.ts", "routes/app-run-resume.ts", "routes/app-render-final.ts", "routes/presentation.ts", "routes/component-execute.ts",
      "routes/workflow-execution.ts", "routes/workflow-render-final.ts", "routes/api-tokens.ts", "routes/use-case-continue.ts",
    ]) expect(routes, r).toContain(r)
  })

  it("every one of them refuses an app-field value outside its declaration up front", () => {
    expect(routes.filter((f) => callsTo(f, "findUnitFieldOverrideRefusals").length === 0)).toEqual([])
  })

  it("a route that re-applies a stored run's overrides checks the overrides the run applies, not the request's alone", () => {
    const offenders: string[] = []
    for (const f of routes.filter((r) => callsTo(r, "continuationInputOverrides").length > 0)) {
      const merged = continuationValues(f)
      for (const call of callsTo(f, "findUnitFieldOverrideRefusals")) {
        const arg = call.arguments[1]
        const ok = !!arg && ((ts.isCallExpression(arg) && calleeName(arg) === "continuationInputOverrides") || (ts.isIdentifier(arg) && merged.has(arg.text)))
        if (!ok) offenders.push(`${f}: findUnitFieldOverrideRefusals(…, ${arg?.getText() ?? "?"})`)
      }
    }
    expect(offenders).toEqual([])
  })
})
