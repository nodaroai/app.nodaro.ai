// @test-watches backend/src/**/*.ts
/**
 * Every reader of the platform's `trigger_data` stamps goes through the trust
 * decision in lib/server-started-runs.ts.
 *
 * A stamp — a continue-from-failed's lineage, an app run's, a Render final's,
 * a continuation chain's root — is read back as fact: which run a
 * continuation goes to, which version a run executed, which executions an app
 * run owns. It is the platform's only on a run a stamp-writing lane started
 * (`manual`, `mcp`, `app_run`); a webhook's row stores the body its caller
 * posted. A reader that parsed `trigger_data` itself would take a stamp posted
 * to a webhook as fact. So:
 *
 * 1. a stamp parser (`continueFromFailedStampOf`, `appRunStampOf`,
 *    `appRenderFinalStampOf`, `runRootOf`, `appRunResumedFromOf`) is only ever called on
 *    `serverTriggerData(row)` — `serverStamps(row)` (lib/trigger-data-stamps.ts)
 *    does exactly that;
 * 2. a query that FINDS rows by a stamp (a `trigger_data->…` path) is narrowed
 *    by `onlyServerStampedRows` in the same statement;
 * 3. no code reads a stamp key off a `trigger_data` / `triggerData` value by
 *    hand (the parsers' own modules aside).
 *
 * Parsed with the TypeScript compiler (`source-scan.ts`): comments are not AST
 * nodes, so prose naming a stamp is never a finding.
 */
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, lineOf, parseText, walk } from "./source-scan.js"

// A run's node selection (`nodeSelection`, the scope a continue-from-failed of it considers) is
// read as fact the same way: only off a run a stamp-writing lane started.
const PARSERS = new Set(["continueFromFailedStampOf", "appRunStampOf", "appRenderFinalStampOf", "runRootOf", "appRunResumedFromOf", "nodeSelectionOf"])
const STAMP_KEYS = new Set(["continueFromFailed", "appRun", "appRenderFinal", "runRoot", "nodeSelection"])
/** The modules that define a stamp: their parser reads the key off the value it is handed. */
const STAMP_MODULES = new Set([
  "lib/continue-from-failed-lineage.ts",
  "lib/app-run-stamp.ts",
  "lib/app-run-final-column.ts",
  "lib/continuation-run-root.ts",
])

const isCallTo = (node: ts.Node, name: string): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  (ts.isIdentifier(node.expression) ? node.expression.text === name : ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name)

/** A stamp path: a `trigger_data->…` literal, or a `*_STAMP_PATH` constant (not its declaration). */
function isStampPath(node: ts.Node, parent: ts.Node | undefined): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.startsWith("trigger_data->")
  if (ts.isTemplateExpression(node)) return node.head.text.startsWith("trigger_data->")
  if (ts.isIdentifier(node)) {
    if (!/_STAMP_PATH$/.test(node.text) || !parent) return false
    // Its declaration, an import or an export names the constant; it is no read.
    return !(ts.isVariableDeclaration(parent) && parent.name === node) && !ts.isImportSpecifier(parent) && !ts.isExportSpecifier(parent)
  }
  return false
}

/** The statement a node sits in: the ancestor just below the nearest block or the file. */
function statementOf(node: ts.Node, ancestors: readonly ts.Node[]): ts.Node {
  let at = node
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const up = ancestors[i]!
    if (ts.isSourceFile(up) || ts.isBlock(up) || ts.isModuleBlock(up)) break
    at = up
  }
  return at
}

/** Walk with each node's ancestors (the shared parser keeps no parent pointers). */
function walkWithAncestors(node: ts.Node, visit: (n: ts.Node, ancestors: readonly ts.Node[]) => void, ancestors: ts.Node[] = []): void {
  visit(node, ancestors)
  ancestors.push(node)
  node.forEachChild((child) => walkWithAncestors(child, visit, ancestors))
  ancestors.pop()
}

function findings(sf: ts.SourceFile, rel: string): string[] {
  const out: string[] = []
  walkWithAncestors(sf, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1]
    // 1. A parser called on anything but `serverTriggerData(...)`.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && PARSERS.has(node.expression.text)) {
      const arg = node.arguments[0]
      if (!arg || !isCallTo(arg, "serverTriggerData")) out.push(`${rel}:${lineOf(sf, node)} ${node.expression.text}(…) not on serverTriggerData(row)`)
    }
    // 2. A query by a stamp path not narrowed to the stamp-writing lanes.
    if (isStampPath(node, parent)) {
      const inFilter = !!parent && ts.isCallExpression(parent) && parent.arguments[0] === node
      if (inFilter || ts.isIdentifier(node)) {
        let narrowed = false
        walk(statementOf(node, ancestors), (n) => {
          if (isCallTo(n, "onlyServerStampedRows")) narrowed = true
        })
        if (!narrowed) out.push(`${rel}:${lineOf(sf, node)} a query by a stamp path not narrowed by onlyServerStampedRows`)
      }
    }
    // 3. A stamp key read off trigger data by hand.
    if (!STAMP_MODULES.has(rel)) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : null
      if (key && STAMP_KEYS.has(key) && /trigger_?data/i.test((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression.getText(sf))) {
        out.push(`${rel}:${lineOf(sf, node)} reads trigger data's ${key} by hand`)
      }
    }
  })
  return out
}

const NEEDLES = [...PARSERS, "trigger_data->", "_STAMP_PATH", ...STAMP_KEYS]

describe("every stamp reader goes through lib/server-started-runs.ts", { timeout: SCAN_TIMEOUT_MS }, () => {
  it("no reader trusts a stamp on a row a caller could have written", () => {
    const all: string[] = []
    let scanned = 0
    eachSourceFile(NEEDLES, (sf, rel) => {
      scanned++
      all.push(...findings(sf, rel))
    })
    expect(scanned).toBeGreaterThan(5)
    expect(all, "read stamps with serverStamps(row) / serverTriggerData(row), and narrow a query by a stamp with onlyServerStampedRows").toEqual([])
  })

  it("matches every shape it exists for (self-test)", () => {
    const bad = parseText(
      "x.ts",
      `
      const a = continueFromFailedStampOf(row.trigger_data)
      const b = appRunStampOf(execution.trigger_data)
      const c = supabase.from("workflow_executions").select("id").eq("trigger_data->continueFromFailed->>root", r)
      const d = supabase.from("workflow_executions").select("id").in(APP_RUN_STAMP_PATH, ids)
      const e = (row.trigger_data as any).continueFromFailed
      const f = job.data.triggerData?.appRun
      const g = triggerData["runRoot"]
      const h = runRootOf(current)
      const i = appRunResumedFromOf(execution.trigger_data)
    `,
    )
    expect(findings(bad, "x.ts")).toHaveLength(9)
    const good = parseText(
      "y.ts",
      `
      // continueFromFailedStampOf(row.trigger_data) in prose is not a call
      const a = continueFromFailedStampOf(serverTriggerData(row))
      const s = serverStamps(row).continueFromFailed
      const c = onlyServerStampedRows(supabase.from("workflow_executions").select("id").eq(\`trigger_data->\${KEY}->>root\`, r))
      let q = onlyServerStampedRows(supabase.from("workflow_executions").select("id").in(APP_RUN_STAMP_PATH, ids))
      const t = source.continueFromFailed
    `,
    )
    expect(findings(good, "y.ts")).toEqual([])
  })
})
