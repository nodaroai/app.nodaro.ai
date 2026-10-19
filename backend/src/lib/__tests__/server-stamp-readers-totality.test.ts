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
 *    does exactly that. It is called by its own name or through a namespace, and
 *    never handed around (`rows.map(appRunStampOf)`) or imported under another name;
 * 2. a query that FINDS rows by a stamp is built inside `onlyServerStampedRows(…)`.
 *    A stamp path is a `trigger_data->…` string, a PostgREST filter string on
 *    `trigger_data` (`trigger_data.cs.{…}`, inside an `.or(…)` too), the bare
 *    column handed to a filter (`.contains("trigger_data", …)`), a `*_STAMP_PATH`
 *    constant, or a name bound to any of those (a `const`, a `for … of` over them);
 * 3. no code reads a stamp key off a `trigger_data` / `triggerData` value by
 *    hand — by property, by element, or by destructuring (the parsers' own
 *    modules aside);
 * 4. the trust decision is handed a row as read back, never an object literal
 *    (a literal names its own lane; the insert and writer guards fail one too).
 *
 * Names are followed within a file: a `const` bound to `trigger_data`
 * (`const td = row.trigger_data`), a column or key held in a `const`, and a
 * parser called through a namespace (`ns.appRunStampOf`, `ns["appRunStampOf"]`).
 * Known limits: a value that reaches a reader through a call's return, a
 * parameter or another module, and a key or column built at run time.
 *
 * Parsed with the TypeScript compiler (`source-scan.ts`): comments are not AST
 * nodes, so prose naming a stamp is never a finding.
 */
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, lineOf, parseText } from "./source-scan.js"
import { stringValue, unwrap } from "./execution-row-ast.js"

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

/** The trust decision's entry points (rule 4). */
const TRUST_CALLS = new Set(["serverTriggerData", "serverStamps", "isServerStartedRun"])
/** A PostgREST filter string on the column: `trigger_data->…`, `trigger_data.cs.{…}`. */
const STAMP_FILTER = /trigger_data(?:->|\.[a-z]+\.)/
/** The query methods that select or order rather than filter: the bare column there is no find. */
const NOT_A_FILTER = new Set(["select", "order"])

const STAMP_SOURCE = /trigger_?data/i

/** Whether a string-like node's text, in any of its parts, is a stamp filter. */
function isStampString(node: ts.Node, sf: ts.SourceFile): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return STAMP_FILTER.test(node.text)
  if (ts.isTemplateExpression(node)) return STAMP_FILTER.test(node.getText(sf)) || [node.head, ...node.templateSpans.map((t) => t.literal)].some((p) => STAMP_FILTER.test(p.text))
  return false
}

/** The bare column handed to a filter method: `.contains("trigger_data", …)`, `.filter("trigger_data", "cs", …)`. */
function isBareColumnFilter(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
  const parent = ancestors[ancestors.length - 1]
  const column = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : ts.isIdentifier(node) ? stringValue(node, ancestors) : null
  if (column !== "trigger_data") return false
  if (!parent || !ts.isCallExpression(parent) || !parent.arguments.includes(node as ts.Expression)) return false
  const callee = parent.expression
  return ts.isPropertyAccessExpression(callee) && !NOT_A_FILTER.has(callee.name.text)
}

/** Is this identifier a name being declared, imported or exported (no read of it)? */
function isDeclarationName(node: ts.Identifier, parent: ts.Node | undefined): boolean {
  if (!parent) return false
  if ((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent)) && parent.name === node) return true
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true
  return ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
}

/** Inside an argument of `onlyServerStampedRows(…)`. */
function narrowed(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const up = ancestors[i]!
    const child = ancestors[i + 1] ?? node
    if (isCallTo(up, "onlyServerStampedRows") && up.arguments.includes(child as ts.Expression)) return true
  }
  return false
}

/** Walk with each node's ancestors (the shared parser keeps no parent pointers). */
function walkWithAncestors(node: ts.Node, visit: (n: ts.Node, ancestors: readonly ts.Node[]) => void, ancestors: ts.Node[] = []): void {
  visit(node, ancestors)
  ancestors.push(node)
  node.forEachChild((child) => walkWithAncestors(child, visit, ancestors))
  ancestors.pop()
}

/** A name bound to a stamp path, and the node its uses sit in (its block, or its loop). */
interface Alias {
  readonly name: string
  readonly scope: ts.Node
  /** The expression it is bound from: the stamp paths in it are read through the name. */
  readonly source: ts.Node
}

const nearestScope = (ancestors: readonly ts.Node[]): ts.Node =>
  [...ancestors].reverse().find((a) => ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a)) ?? ancestors[0]!

function findings(sf: ts.SourceFile, rel: string): string[] {
  const out: string[] = []
  const aliases: Alias[] = []
  const aliasAt = (id: ts.Identifier, ancestors: readonly ts.Node[]) => aliases.find((a) => a.name === id.text && ancestors.includes(a.scope))
  /** A stamp path occurrence: a string, a bare column handed to a filter, a `*_STAMP_PATH` constant or an alias read. */
  const isStampPath = (node: ts.Node, ancestors: readonly ts.Node[]): boolean => {
    const parent = ancestors[ancestors.length - 1]
    if (isStampString(node, sf) || isBareColumnFilter(node, ancestors)) return true
    if (!ts.isIdentifier(node) || isDeclarationName(node, parent)) return false
    return /_STAMP_PATH$/.test(node.text) || !!aliasAt(node, ancestors)
  }
  /** Is `e` itself a stamp path, or a choice or a list of them (not a query that uses one)? */
  const isPathValue = (e: ts.Node, ancestors: readonly ts.Node[]): boolean => {
    let at = e
    while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isNonNullExpression(at)) at = at.expression
    if (isStampPath(at, ancestors)) return true
    if (ts.isArrayLiteralExpression(at)) return at.elements.some((el) => isPathValue(ts.isSpreadElement(el) ? el.expression : el, ancestors))
    if (ts.isConditionalExpression(at)) return isPathValue(at.whenTrue, ancestors) || isPathValue(at.whenFalse, ancestors)
    if (ts.isBinaryExpression(at) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(at.operatorToken.kind)) return isPathValue(at.left, ancestors) || isPathValue(at.right, ancestors)
    return false
  }

  /** Names bound to a trigger data value (`const td = row.trigger_data as any`): a stamp key read off one is a hand read. */
  const dataAliases: Alias[] = []
  const isTriggerData = (e: ts.Expression, ancestors: readonly ts.Node[]): boolean => {
    const at = unwrap(e)
    if (ts.isIdentifier(at) && dataAliases.some((a) => a.name === at.text && ancestors.includes(a.scope))) return true
    return STAMP_SOURCE.test(e.getText(sf))
  }
  const isTriggerDataValue = (e: ts.Expression, ancestors: readonly ts.Node[]): boolean => {
    const at = unwrap(e)
    if (ts.isPropertyAccessExpression(at)) return STAMP_SOURCE.test(at.name.text)
    if (ts.isElementAccessExpression(at)) return STAMP_SOURCE.test(stringValue(at.argumentExpression, ancestors) ?? "")
    return ts.isIdentifier(at) && dataAliases.some((a) => a.name === at.text && ancestors.includes(a.scope))
  }

  // Pass 1: the names bound to a stamp path (in source order, so an alias of an alias is one too).
  walkWithAncestors(sf, (node, ancestors) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !/_STAMP_PATH$/.test(node.name.text)) {
      if (isPathValue(node.initializer, [...ancestors, node])) aliases.push({ name: node.name.text, scope: nearestScope(ancestors), source: node.initializer })
      if (isTriggerDataValue(node.initializer, [...ancestors, node])) dataAliases.push({ name: node.name.text, scope: nearestScope(ancestors), source: node.initializer })
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer) && isPathValue(node.expression, [...ancestors, node])) {
      for (const d of node.initializer.declarations) if (ts.isIdentifier(d.name)) aliases.push({ name: d.name.text, scope: node, source: node.expression })
    }
  })

  walkWithAncestors(sf, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1]
    // 1. A parser called on anything but `serverTriggerData(...)`, handed around, or renamed.
    const callee = ts.isCallExpression(node) ? node.expression : null
    const parserCalled =
      callee &&
      (ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isElementAccessExpression(callee)
            ? stringValue(callee.argumentExpression, ancestors)
            : null)
    if (callee && parserCalled && PARSERS.has(parserCalled)) {
      const arg = (node as ts.CallExpression).arguments[0]
      if (!arg || !isCallTo(arg, "serverTriggerData")) out.push(`${rel}:${lineOf(sf, node)} ${parserCalled}(…) not on serverTriggerData(row) — call it as ${parserCalled}(serverTriggerData(row)), or read serverStamps(row)`)
    }
    if (ts.isIdentifier(node) && PARSERS.has(node.text) && parent) {
      const isCallee = (ts.isCallExpression(parent) && parent.expression === node) || (ts.isPropertyAccessExpression(parent) && parent.name === node && ancestors.length > 1 && ts.isCallExpression(ancestors[ancestors.length - 2]!) && (ancestors[ancestors.length - 2] as ts.CallExpression).expression === parent)
      const declared = (ts.isFunctionDeclaration(parent) && parent.name === node) || (ts.isVariableDeclaration(parent) && parent.name === node)
      // An import or export under its own name, or a destructured dynamic import (`const { appRunStampOf } = await import(…)`).
      const named =
        ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && !parent.propertyName) ||
        (ts.isBindingElement(parent) && parent.name === node)
      const renamed =
        (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isBindingElement(parent)) &&
        !!parent.propertyName &&
        parent.propertyName === node &&
        (parent.name as ts.Node).getText(sf) !== node.text
      const inType = ancestors.some((a) => ts.isTypeQueryNode(a))
      if (renamed) out.push(`${rel}:${lineOf(sf, node)} ${node.text} imported or exported under another name — use it under its own name, so this guard can see each call`)
      else if (!isCallee && !declared && !named && !inType && !(ts.isBindingElement(parent) && parent.propertyName === node)) {
        out.push(`${rel}:${lineOf(sf, node)} ${node.text} handed around rather than called on serverTriggerData(row) — call it directly, as ${node.text}(serverTriggerData(row))`)
      }
    }
    // 2. A query by a stamp path built outside onlyServerStampedRows.
    if (isStampPath(node, ancestors) && !narrowed(node, ancestors)) {
      const declaresPath = parent && ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name) && /_STAMP_PATH$/.test(parent.name.text)
      const bindsAlias = aliases.some((a) => a.source === node || ancestors.includes(a.source))
      if (!declaresPath && !bindsAlias) out.push(`${rel}:${lineOf(sf, node)} a query by a stamp path not built inside onlyServerStampedRows — build the whole query inside onlyServerStampedRows(…), filters included`)
    }
    // 3. A stamp key read off trigger data by hand.
    if (!STAMP_MODULES.has(rel)) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isElementAccessExpression(node)
          ? stringValue(node.argumentExpression, ancestors)
          : null
      if (key && STAMP_KEYS.has(key) && isTriggerData((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression, ancestors)) {
        out.push(`${rel}:${lineOf(sf, node)} reads trigger data's ${key} by hand — read it from serverStamps(row)`)
      }
      // …or destructured: `const { appRun } = row.trigger_data`, `{ trigger_data: { appRun } }`.
      if (ts.isObjectBindingPattern(node) && parent) {
        const fromStamps =
          (ts.isBindingElement(parent) && parent.name === node && STAMP_SOURCE.test((parent.propertyName ?? parent.name).getText(sf))) ||
          (ts.isVariableDeclaration(parent) && parent.name === node && !!parent.initializer && isTriggerData(parent.initializer, ancestors))
        if (fromStamps) {
          for (const el of node.elements) {
            const k = el.propertyName ? el.propertyName.getText(sf) : ts.isIdentifier(el.name) ? el.name.text : null
            if (k && STAMP_KEYS.has(k.replace(/^["']|["']$/g, ""))) out.push(`${rel}:${lineOf(sf, el)} destructures trigger data's ${k} by hand — destructure serverStamps(row) instead`)
          }
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(ts.isParenthesizedExpression(node.left) ? node.left.expression : node.left) && isTriggerData(node.right, ancestors)) {
        const left = (ts.isParenthesizedExpression(node.left) ? node.left.expression : node.left) as ts.ObjectLiteralExpression
        for (const p of left.properties) {
          const k = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null
          if (k && STAMP_KEYS.has(k)) out.push(`${rel}:${lineOf(sf, p)} destructures trigger data's ${k} by hand — destructure serverStamps(row) instead`)
        }
      }
    }
    // 4. The trust decision handed a literal row rather than a row read back.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TRUST_CALLS.has(node.expression.text)) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(unwrap(arg))) {
        out.push(`${rel}:${lineOf(sf, node)} ${node.expression.text}({ … }) on a literal row rather than a row read back — pass the row as selected (with its trigger_type); a literal names its own lane`)
      }
    }
  })
  return out
}

const NEEDLES = [...PARSERS, ...TRUST_CALLS, "trigger_data", "triggerData", "_STAMP_PATH", ...STAMP_KEYS]

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

  it.each([
    ["a parser on a row's own trigger_data", `const a = continueFromFailedStampOf(row.trigger_data)`, "not on serverTriggerData"],
    ["another parser on it", `const b = appRunStampOf(execution.trigger_data)`, "not on serverTriggerData"],
    ["a parser on a value of unknown origin", `const h = runRootOf(current)`, "not on serverTriggerData"],
    ["the resume parser", `const i = appRunResumedFromOf(execution.trigger_data)`, "not on serverTriggerData"],
    ["a parser through a namespace", `const n = stamps.appRunStampOf(row.trigger_data)`, "not on serverTriggerData"],
    ["a parser handed around", `const ids = rows.map(appRunStampOf)`, "handed around"],
    ["a parser held in a name", `const parse = appRunStampOf`, "handed around"],
    ["a parser imported under another name", `import { appRunStampOf as parse } from "./app-run-stamp.js"`, "under another name"],
    ["a stamp path literal", `const c = supabase.from("workflow_executions").select("id").eq("trigger_data->continueFromFailed->>root", r)`, "not built inside onlyServerStampedRows"],
    ["a stamp path constant", `const d = supabase.from("workflow_executions").select("id").in(APP_RUN_STAMP_PATH, ids)`, "not built inside onlyServerStampedRows"],
    ["a JSON containment on the column", `const e = supabase.from("workflow_executions").select("id").contains("trigger_data", { appRun: { appRunId: id } })`, "not built inside onlyServerStampedRows"],
    ["a raw filter on the column", `const f = supabase.from("workflow_executions").select("id").filter("trigger_data", "cs", json)`, "not built inside onlyServerStampedRows"],
    ["a path inside an or-filter", `const g = supabase.from("workflow_executions").select("id").or("status.eq.failed,trigger_data->appRun->>appRunId.eq." + id)`, "not built inside onlyServerStampedRows"],
    ["a containment inside an or-filter template", "const g = supabase.from(\"workflow_executions\").select(\"id\").or(`status.eq.x,trigger_data.cs.${json}`)", "not built inside onlyServerStampedRows"],
    ["a path bound to a name", `const path = "trigger_data->appRun->>appRunId"\nconst q = supabase.from("workflow_executions").select("id").eq(path, id)`, "not built inside onlyServerStampedRows"],
    [
      "an un-narrowed query beside a narrowed one in a loop",
      `for (const path of [APP_RUN_STAMP_PATH, APP_RENDER_FINAL_STAMP_PATH]) {
        const a = onlyServerStampedRows(supabase.from("workflow_executions").select("id").in(path, ids))
        const b = supabase.from("workflow_executions").select("id").in(path, ids)
      }`,
      "not built inside onlyServerStampedRows",
    ],
    ["a key read by property", `const e = (row.trigger_data as any).continueFromFailed`, "by hand"],
    ["a key read off a job's trigger data", `const f = job.data.triggerData?.appRun`, "by hand"],
    ["a key read by element", `const g = triggerData["runRoot"]`, "by hand"],
    ["a key destructured", `const { continueFromFailed } = row.trigger_data`, "destructures"],
    ["a key destructured from a nested pattern", `const { trigger_data: { appRun } } = row`, "destructures"],
    ["a key destructured in an assignment", `;({ appRun } = row.trigger_data)`, "destructures"],
    ["the trust decision handed a literal lane", `const t = serverTriggerData({ trigger_type: "manual", trigger_data: x })`, "on a literal row"],
    ["the stamps read off a literal row copying its lane", `const t = serverStamps({ trigger_type: row.trigger_type, trigger_data: row.trigger_data })`, "on a literal row"],
    ["a parser destructured under another name", `const { appRunStampOf: parse } = await import("./app-run-stamp.js")`, "under another name"],
    ["a parser through a namespace by element", `const n = stamps["appRunStampOf"](row.trigger_data)`, "not on serverTriggerData"],
    ["the bare column held in a const", `const COL = "trigger_data"\nconst q = supabase.from("workflow_executions").select("id").contains(COL, { appRun: {} })`, "not built inside onlyServerStampedRows"],
    ["a key held in a const", `const KEY = "appRun"\nconst v = row.trigger_data[KEY]`, "by hand"],
    ["a key read off a name bound to trigger data", `const td = row.trigger_data as any\nconst v = td.continueFromFailed?.root`, "by hand"],
    ["a key destructured off a name bound to trigger data", `const td = row.trigger_data\nconst { appRun } = td`, "destructures"],
    ["the stamps read off a literal lane", `const t = serverStamps({ trigger_type: lane, trigger_data: x })`, "on a literal row"],
  ])("%s", (_name, source, fragment) => {
    const found = findings(parseText("x.ts", source), "x.ts")
    expect(found).toHaveLength(1)
    expect(found[0]).toContain(fragment)
  })

  it("passes the shapes the platform reads with", () => {
    const good = parseText(
      "y.ts",
      `
      // continueFromFailedStampOf(row.trigger_data) in prose is not a call
      import { appRunStampOf } from "./elsewhere.js"
      export { appRunStampOf }
      export const APP_RUN_STAMP_PATH = \`trigger_data->\${KEY}->>appRunId\`
      export function continueFromFailedStampOf(triggerData: unknown) { return triggerData }
      type Parse = typeof appRunStampOf
      const a = continueFromFailedStampOf(serverTriggerData(row))
      const n = stamps.appRunStampOf(serverTriggerData(row))
      const s = serverStamps(row).continueFromFailed
      const { appRun } = serverStamps(row)
      const c = onlyServerStampedRows(supabase.from("workflow_executions").select("id").eq(\`trigger_data->\${KEY}->>root\`, r))
      let q = onlyServerStampedRows(supabase.from("workflow_executions").select("id").in(APP_RUN_STAMP_PATH, ids))
      for (const path of [APP_RUN_STAMP_PATH, APP_RENDER_FINAL_STAMP_PATH]) {
        const rows = onlyServerStampedRows(supabase.from("workflow_executions").select("id, trigger_type, trigger_data").in(path, ids))
        for (const row of rows) take(serverStamps(row).appRun)
      }
      const sel = supabase.from("workflow_executions").select("id, trigger_type, trigger_data").order("created_at")
      const { appRunResumedFromOf } = await import("./app-run-stamp.js")
      const resumed = appRunResumedFromOf(serverTriggerData(row))
      const td = serverStamps(row)
      const fine = td.appRun
      const t = source.continueFromFailed
    `,
    )
    expect(findings(good, "y.ts")).toEqual([])
  })
})
