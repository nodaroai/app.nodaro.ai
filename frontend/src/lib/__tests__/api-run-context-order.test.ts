// @vitest-environment node
// @test-watches frontend/src/lib/api.ts frontend/src/nodes/*/api.ts
/**
 * `withWorkflowId` hands a request the run settings the node that is starting
 * put on module state (its node id, forcePrivate, its prompt template) and
 * clears them. They are that node's only until another node's run puts its
 * own, which can happen during any `await` (two nodes start together in a
 * sub-workflow level or a fan-out). So every request takes them before it
 * waits for anything. This guard reads the request layer (lib/api.ts and every
 * node unit's api.ts) and fails a use of the settings that comes after an
 * await: `withWorkflowId` itself, `apiJson` / `ugcApi` asked for them
 * (`workflowId`), and any function that uses them, followed to its callers.
 * A use in a callback, in a closure made after an await, or in a loop that
 * awaits fails too, and the helper stays private to api.ts, where every use
 * can be seen. It reads source order, not control flow, so an await in a
 * branch above a use fails it as well: take the settings first. The behavior
 * itself is pinned in api-run-context-race.test.ts; the executor's side (set
 * the settings right before the request) is not judged here.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const SRC = path.resolve(__dirname, "../..")
const HELPER = "withWorkflowId"
/** Request helpers that take the run settings only when asked (`workflowId`). */
const ON_REQUEST: ReadonlySet<string> = new Set(["apiJson", "ugcApi"])

interface Source {
  readonly name: string
  readonly text: string
}

function requestFiles(): Source[] {
  const files = [path.join(SRC, "lib/api.ts")]
  const units = path.join(SRC, "nodes")
  for (const entry of fs.readdirSync(units, { withFileTypes: true })) {
    const file = path.join(units, entry.name, "api.ts")
    if (entry.isDirectory() && fs.existsSync(file)) files.push(file)
  }
  return files.map((file) => ({ name: path.relative(SRC, file).split(path.sep).join("/"), text: fs.readFileSync(file, "utf8") }))
}

type FunctionWithBody =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration

function isFunctionWithBody(n: ts.Node): n is FunctionWithBody {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  )
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function enclosingFunction(n: ts.Node): FunctionWithBody | undefined {
  for (let cur = n.parent; cur; cur = cur.parent) if (isFunctionWithBody(cur)) return cur
  return undefined
}

function outermostFunction(n: ts.Node): FunctionWithBody | undefined {
  let found: FunctionWithBody | undefined
  for (let fn = enclosingFunction(n); fn; fn = enclosingFunction(fn)) found = fn
  return found
}

function functionName(fn: FunctionWithBody): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name && ts.isIdentifier(fn.name)) return fn.name.text
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text
  return undefined
}

/** Where `scope` waits itself (an await, a `for await`, a yield); a nested function's waits are its own. */
function ownWaits(scope: ts.Node): ts.Node[] {
  const out: ts.Node[] = []
  const visit = (n: ts.Node): void => {
    if (isFunctionWithBody(n)) return
    if (ts.isAwaitExpression(n) || ts.isYieldExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier)) out.push(n)
    n.forEachChild(visit)
  }
  scope.forEachChild(visit)
  return out
}

function isLoop(n: ts.Node): boolean {
  return ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)
}

function loopWaits(loop: ts.Node): boolean {
  return (ts.isForOfStatement(loop) && loop.awaitModifier !== undefined) || ownWaits(loop).length > 0
}

/** A function value that runs later: handed to a call, or set on an object. */
function isHandedOn(fn: ts.Node): boolean {
  let cur: ts.Node = fn
  while (ts.isParenthesizedExpression(cur.parent)) cur = cur.parent
  const holder = cur.parent
  if ((ts.isCallExpression(holder) || ts.isNewExpression(holder)) && holder.arguments?.some((a) => a === cur)) return true
  return ts.isPropertyAssignment(holder) && holder.initializer === cur
}

/** Whether request options ask for the run settings (`workflowId`); options it cannot read count as asking. */
function optionsAsk(expr: ts.Expression): boolean {
  let e = expr
  while (ts.isParenthesizedExpression(e)) e = e.expression
  if (ts.isConditionalExpression(e)) return optionsAsk(e.whenTrue) || optionsAsk(e.whenFalse)
  if (!ts.isObjectLiteralExpression(e)) return true
  return e.properties.some((prop) => {
    if (ts.isSpreadAssignment(prop)) return optionsAsk(prop.expression)
    if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text === "workflowId"
    return ts.isPropertyAssignment(prop) && prop.name.getText() === "workflowId" && prop.initializer.kind !== ts.SyntaxKind.FalseKeyword
  })
}

function asksForSettings(call: ts.CallExpression): boolean {
  const options = call.arguments[1]
  return options !== undefined && optionsAsk(options)
}

/** A use of the run settings: the helper called or handed on, a request helper asked for them, or a function that uses them. */
function usesSettings(n: ts.Node, users: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(n) && n.text === HELPER) {
    const parent = n.parent
    return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && (parent.arguments ?? []).some((a) => a === n)
  }
  if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return false
  const name = n.expression.text
  if (name === HELPER) return true
  if (ON_REQUEST.has(name)) return asksForSettings(n)
  return users.has(name)
}

/** Every function that uses the run settings, followed through its callers to a fixed point. */
function settingsUsers(files: readonly ts.SourceFile[]): Set<string> {
  const users = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const sf of files) {
      walk(sf, (n) => {
        if (!usesSettings(n, users)) return
        const fn = outermostFunction(n)
        const name = fn && functionName(fn)
        if (!name || name === HELPER || ON_REQUEST.has(name) || users.has(name)) return
        users.add(name)
        grew = true
      })
    }
  }
  return users
}

interface SettingsUse {
  readonly at: string
  readonly fn: string
  readonly problem?: string
}

/** Why a use of the settings may run after another node's run put its own, or undefined. */
function lateness(use: ts.Node, sf: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(use)) return "hands the helper on as a callback, which runs after the request has started"
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  let inner: ts.Node = use
  for (let fn = enclosingFunction(use); fn; inner = fn, fn = enclosingFunction(fn)) {
    for (let cur = inner.parent; cur && cur !== fn; cur = cur.parent) {
      if (isLoop(cur) && loopWaits(cur)) return "runs in a loop that waits, so every round after the first follows a wait"
    }
    const before = ownWaits(fn).find((w) => w.getEnd() <= inner.getStart(sf))
    if (before) return `runs after the wait on line ${line(before)}`
    if (fn !== outermostFunction(use) && isHandedOn(fn)) return "runs in a callback, after the request has started"
  }
  return undefined
}

function settingsUses(sources: readonly Source[]): { readonly uses: SettingsUse[]; readonly users: ReadonlySet<string> } {
  const files = sources.map((s) => ts.createSourceFile(s.name, s.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS))
  const users = settingsUsers(files)
  const uses: SettingsUse[] = []
  for (const sf of files) {
    walk(sf, (n) => {
      if (!usesSettings(n, users)) return
      const fn = outermostFunction(n)
      if (!fn) return
      const at = `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
      uses.push({ at, fn: functionName(fn) ?? "(anonymous)", problem: lateness(n, sf) })
    })
  }
  return { uses, users }
}

const late = (sources: readonly Source[]) =>
  settingsUses(sources).uses.filter((u) => u.problem).map((u) => `${u.at} ${u.fn}: ${u.problem}`)

const snippet = (text: string): Source[] => [{ name: "snippet.ts", text }]

describe("every request takes its run settings before it waits", () => {
  it("no use of the run settings in the request layer follows a wait of its own", () => {
    expect(late(requestFiles())).toEqual([])
  })

  it("follows the settings through the request helpers to their callers (guard against a vacuous pass)", () => {
    const { uses, users } = settingsUses(requestFiles())
    const fns = new Set(uses.map((u) => u.fn))
    for (const fn of ["apiJson", "ugcApi", "continueUseCase", "llmStreamGeneric"]) expect(fns).toContain(fn)
    for (const fn of ["textToVideo", "ugcScriptApi", "generateAIWriterStream", "qaCheckApi"]) expect(users).toContain(fn)
  })

  it.each([
    ["the helper after the auth lookup", "async function apiJson(body) { const h = await getAuthHeaders(); return fetch(u, { headers: h, body: JSON.stringify(withWorkflowId(body)) }) }"],
    ["a caller that waits, then asks apiJson for the settings", 'export async function fooApi(p) { const userId = await getCurrentUserId(); return apiJson("/v1/foo", { body: { ...p, userId }, workflowId: true, label: "x" }) }'],
    ["a request helper asked for them through spread options, in a callback", 'export function fooApi(p) { return poll({ ask: () => apiJson("/v1/foo", { body: p, label: "x", ...(p.track ? { workflowId: true } : {}) }) }) }'],
    ["a caller that waits, then calls a function that takes them", "function payloadOf(p) { return withWorkflowId(p) }\nexport async function fooApi(p) { await ready(); return post(payloadOf(p)) }"],
    ["a closure made after a wait", "async function f(body) { const headers = await getAuthHeaders(); const send = (b) => fetch(u, { headers, body: JSON.stringify(withWorkflowId(b)) }); return send(body) }"],
    ["a for await body", 'async function f(body) { for await (const ev of stream()) { if (ev.type === "retry") post(withWorkflowId(body)) } }'],
    ["a loop that waits after", "async function f(items) { for (const it of items) { post(withWorkflowId(it)); await sleep() } }"],
    ["the helper handed on", "async function f(bodies) { return bodies.map(withWorkflowId) }"],
    ["a callback set on an object", "function f(body) { return streamRequest(u, { buildBody: () => withWorkflowId(body) }) }"],
    ["a then callback", "function f(body) { return getAuthHeaders().then((h) => fetch(u, { headers: h, body: JSON.stringify(withWorkflowId(body)) })) }"],
    ["a wrapped then callback", "function f(body) { return getAuthHeaders().then(((h) => fetch(u, { headers: h, body: JSON.stringify(withWorkflowId(body)) }))) }"],
    ["a generator that yields first", "async function* f(body) { yield 1; post(withWorkflowId(body)) }"],
    ["a retry that runs again after a wait", "async function f(body, n = 0) { const p = withWorkflowId(body); try { return await post(p) } catch { await sleep(); return f(body, n + 1) } }"],
  ])("fails %s", (_label, text) => {
    expect(late(snippet(text))).not.toEqual([])
  })

  it.each([
    ["the settings taken before the auth lookup", "async function apiJson(body) { const payload = JSON.stringify(withWorkflowId(body)); const h = await getAuthHeaders(); return fetch(u, { headers: h, body: payload }) }"],
    ["a request helper asked for them before any wait", 'export function fooApi(p) { return apiJson("/v1/foo", { body: p, workflowId: true, label: "x" }) }'],
    ["a request helper not asked for them, after a wait", 'export async function fooApi(p) { await ready(); return apiJson("/v1/foo", { body: p, label: "x" }) }'],
    ["a request helper not asked for them, in a callback with spread options", 'export function fooApi(p) { return poll({ ask: () => apiJson("/v1/foo", { body: p, label: "x", ...(p.signal ? { signal: p.signal } : {}) }) }) }'],
    ["the settings taken into an argument of the request", "function f(p) { return apiRequest(u, l, { body: withWorkflowId(p) }) }"],
  ])("passes %s", (_label, text) => {
    expect(late(snippet(text))).toEqual([])
  })

  it("withWorkflowId stays private to api.ts", () => {
    const sf = ts.createSourceFile("api.ts", fs.readFileSync(path.join(SRC, "lib/api.ts"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const exported: string[] = []
    walk(sf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === HELPER && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exported.push("declaration")
      if (ts.isExportSpecifier(n) && (n.propertyName ?? n.name).text === HELPER) exported.push("export list")
    })
    expect(exported).toEqual([])
  })
})
