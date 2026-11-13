// @test-watches backend/src/**/*.ts
/**
 * Every route queues its work through the shared queue-failure helpers, never
 * with a bare `<queue>.add(…)`.
 *
 * The helpers (lib/enqueue-route-job.ts, lib/enqueue-execution.ts) are what
 * fail a job or a run the queue refused — from `pending` only, its
 * Idempotency-Key released, a job's credits refunded confirmed — and answer
 * the request with the error. A route that calls `videoQueue.add` itself
 * leaves such a row `pending`, holding its credits and its key, until a
 * never-started sweep, and a client retrying with the same key is answered
 * with that dead job all along. So the rule is mechanical:
 *
 *   - in a route file (`routes/**`, `ee/routes/**`, a node unit's route), a
 *     queue is added to only inside the closure handed to a helper: an
 *     argument of `enqueueRouteJob` / `enqueueExecution` /
 *     `tryEnqueueExecution`, or the `enqueue` of a job written inside the
 *     arguments of `enqueueRouteJobs` / `runJobBatch`;
 *   - each helper call is awaited and the route stops when the helper
 *     answered: `if (reply.sent) return` is the next statement (after a
 *     captured outcome, after the `if`s that read it). `runJobBatch` resolves
 *     null once it answered, so its stop is `if (!<result>) return`;
 *     `tryEnqueueExecution` never answers, so it is only held to being awaited;
 *   - a node unit's route imports no queue module at all and queues with
 *     `enqueueUnitJob`, the helper that names the queue from its descriptor.
 *
 * "A queue" is found, not guessed from a name: every module under
 * backend/src that constructs a BullMQ queue is scanned for the queues and
 * the queue getters it exports (lib/queue.ts's `videoQueue`,
 * concurrency-lanes/park.ts's `queueOf`, …, a default export included), and a
 * route's imports of them — renamed, default, through a namespace, or from a
 * dynamic `import()` — and its own aliases of those (of a getter too) are
 * followed. An `add` or `addBulk` reached on one outside a helper's closure
 * counts: `.add(`, `.addBulk(`, `["add"]`, `.add.call(`, a destructured
 * `add`, a computed key; `addListener` and the other `add…` methods queue
 * nothing and do not. The older rule stays beside it as a fallback: `.add` /
 * `.addBulk` on anything whose name ends in "queue".
 *
 * Read with the TypeScript parser, so comments and strings are never code and
 * "the next statement" is a statement, not the next matching line.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { unitRouteFiles } from "../unit-source-files.js"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const SRC = join(REPO_ROOT, "backend", "src")

/** The helpers a route queues through that answer the request themselves on a refusal: `if (reply.sent) return` follows. */
const HELPERS = new Set(["enqueueRouteJob", "enqueueRouteJobs", "enqueueExecution", "enqueueUnitJob"])
/** Runs a whole batch (lib/job-batch.ts) and resolves null once it answered the failure: `if (!<result>) return` follows. */
const BATCH_RUNNER = "runJobBatch"
/**
 * Settles a refused run WITHOUT answering (a chat platform's webhook must not
 * see a server error): awaited as its own statement, never held to the stop.
 */
const AWAIT_ONLY_HELPERS = new Set(["tryEnqueueExecution"])
/** The helpers whose closure argument may add to a queue. */
const CLOSURE_HELPERS = new Set(["enqueueRouteJob", "enqueueExecution", "tryEnqueueExecution"])
/** The helpers whose jobs' `enqueue` may add to a queue, when the job is written inside their arguments. */
const BATCH_HELPERS = new Set(["enqueueRouteJobs", BATCH_RUNNER])

/**
 * A queue's methods that hand it work: exactly `add` and `addBulk`. Not any
 * `add…` — `addListener` (an event emitter's) and the like queue nothing.
 */
const ADD_METHODS: ReadonlySet<string> = new Set(["add", "addBulk"])
/** The fallback by name: a receiver called `<something>Queue` / `queue`. */
const QUEUE_NAME = /queue$/i

/**
 * A queue module by its path alone — bullmq itself, or a module under lib/
 * whose name is or starts a word with "queue" (queue, render-queue,
 * video-director-queue, queue-connection, …), never enqueue-route-job, the
 * helper itself. Beside the scanned modules, for the node-unit import rule.
 */
const QUEUE_MODULE = /(?:^bullmq$|\/lib\/(?:[^/]*[-_.])?queue[^/]*$)/

function tsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") tsFiles(p, out)
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node)
  ts.forEachChild(node, (child) => visit(child, fn))
}

const lineOf = (sf: ts.SourceFile, n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
const repoPath = (file: string): string => relative(REPO_ROOT, file).split("\\").join("/")

/** Strip what never changes the value: parentheses, `!`, `as`, `<T>x`, `satisfies`. */
function unwrap(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) {
      e = e.expression
    } else return e
  }
}

/** The literal module of an `import("…")` call (awaited or not), or undefined. */
function dynamicImportSpec(e: ts.Expression): string | undefined {
  let inner = unwrap(e)
  if (ts.isAwaitExpression(inner)) inner = unwrap(inner.expression)
  if (!ts.isCallExpression(inner) || inner.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined
  const arg = inner.arguments[0]
  return arg && ts.isStringLiteralLike(arg) ? arg.text : undefined
}

/** Every module the file imports: static imports, re-exports and `import("…")` calls (a computed one as `<computed import()>`). */
function importedModules(sf: ts.SourceFile): string[] {
  const out: string[] = []
  visit(sf, (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) {
      out.push(n.moduleSpecifier.text)
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0]
      out.push(arg && ts.isStringLiteralLike(arg) ? arg.text : "<computed import()>")
    }
  })
  return out
}

const isQueueModule = (m: string): boolean => m === "<computed import()>" || QUEUE_MODULE.test(m.replace(/\.js$/, ""))

// ───────────────────────────────────────────────────────── the queue modules

/** What a queue module exports: queues, and functions that hand one back. */
interface QueueExports {
  readonly queues: ReadonlySet<string>
  readonly getters: ReadonlySet<string>
}

/** What a file imported, from where it imported it: a queue module's exports, or null. */
type ModuleExportsOf = (spec: string) => QueueExports | null

/** The names bullmq's `Queue` class goes by in a file: imported as a name, or reached through a namespace. */
interface BullmqNames {
  readonly classes: Set<string>
  readonly namespaces: Set<string>
}

function bullmqNames(sf: ts.SourceFile): BullmqNames {
  const names: BullmqNames = { classes: new Set(), namespaces: new Set() }
  visit(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier) && n.moduleSpecifier.text === "bullmq") {
      const bindings = n.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) names.namespaces.add(bindings.name.text)
      else if (bindings) for (const el of bindings.elements) if ((el.propertyName ?? el.name).text === "Queue") names.classes.add(el.name.text)
    } else if (ts.isVariableDeclaration(n) && n.initializer && dynamicImportSpec(n.initializer) === "bullmq") {
      if (ts.isIdentifier(n.name)) names.namespaces.add(n.name.text)
      else if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) if (ts.isIdentifier(el.name) && (bindingKey(el) ?? "") === "Queue") names.classes.add(el.name.text)
      }
    }
  })
  return names
}

/** The property a destructured element reads: `add` in `{ add }` and in `{ add: a }`; undefined when computed. */
function bindingKey(el: ts.BindingElement): string | undefined {
  const key = el.propertyName ?? el.name
  if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) return key.text
  return undefined
}

/** `new Queue(…)` (type arguments or not, the class renamed or reached through a namespace). */
function constructsQueue(e: ts.Expression, bull: BullmqNames): boolean {
  const n = unwrap(e)
  if (!ts.isNewExpression(n)) return false
  const callee = unwrap(n.expression)
  if (ts.isIdentifier(callee)) return bull.classes.has(callee.text)
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "Queue" && ts.isIdentifier(callee.expression) && bull.namespaces.has(callee.expression.text)
}

/** Whether a type is a queue: `Queue`, `Queue<T>`, `Queue | null`, `Promise<Queue>` — never `Map<…, Queue>` or `QueueInfo`. */
function isQueueType(type: ts.TypeNode | undefined, sf: ts.SourceFile, bull: BullmqNames): boolean {
  if (!type) return false
  let text = type.getText(sf).replace(/\s+/g, "")
  const promised = /^Promise<(.*)>$/.exec(text)
  if (promised) text = promised[1]!
  const parts = text.split("|").filter((p) => p !== "null" && p !== "undefined")
  const names = [...bull.classes, ...[...bull.namespaces].map((ns) => `${ns}.Queue`)]
  return parts.length > 0 && parts.every((p) => names.some((name) => p === name || p.startsWith(`${name}<`)))
}

/** A function's own `return`s (not those of a function nested in it). */
function ownReturns(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  const out: ts.Expression[] = []
  if (fn.body && !ts.isBlock(fn.body)) return [fn.body]
  const walk = (n: ts.Node): void => {
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression)
    if (!ts.isFunctionLike(n)) ts.forEachChild(n, walk)
  }
  if (fn.body) ts.forEachChild(fn.body, walk)
  return out
}

const hasExportModifier = (st: ts.Statement): boolean =>
  (ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
const hasDefaultModifier = (st: ts.Statement): boolean =>
  (ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
/** The local name of an export default that has none (`export default new Queue(…)`): never an identifier. */
const UNNAMED_DEFAULT = "<default>"

/**
 * What one module exports that is a queue, and whether it constructs one at
 * all: module-level constants built with `new Queue(…)` (or typed as a Queue),
 * and functions whose declared return is a Queue or that return one they
 * built or hold.
 */
function moduleQueueExports(sf: ts.SourceFile): QueueExports & { readonly constructs: boolean } {
  const bull = bullmqNames(sf)
  let constructs = false
  visit(sf, (n) => {
    if (ts.isNewExpression(n) && constructsQueue(n, bull)) constructs = true
  })
  const localQueues = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && ((d.initializer && constructsQueue(d.initializer, bull)) || isQueueType(d.type, sf, bull))) localQueues.add(d.name.text)
    }
  }
  const returnsQueue = (fn: ts.FunctionLikeDeclaration): boolean =>
    isQueueType(fn.type, sf, bull) ||
    ownReturns(fn).some((r) => constructsQueue(r, bull) || (ts.isIdentifier(unwrap(r)) && localQueues.has((unwrap(r) as ts.Identifier).text)))
  const localGetters = new Set<string>()
  const exported: Array<[local: string, exported: string]> = []
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue
        const init = d.initializer && unwrap(d.initializer)
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && returnsQueue(init)) localGetters.add(d.name.text)
        if (hasExportModifier(st)) exported.push([d.name.text, d.name.text])
      }
    } else if (ts.isFunctionDeclaration(st)) {
      // `export default function [name]()` is exported as "default", not by its name.
      const local = st.name?.text ?? UNNAMED_DEFAULT
      if (returnsQueue(st)) localGetters.add(local)
      if (hasExportModifier(st)) exported.push([local, hasDefaultModifier(st) ? "default" : local])
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) exported.push([(el.propertyName ?? el.name).text, el.name.text])
    } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
      // `export default <a queue, a getter, or a name holding one>`.
      const value = unwrap(st.expression)
      if (ts.isIdentifier(value)) exported.push([value.text, "default"])
      else if (constructsQueue(value, bull)) {
        localQueues.add(UNNAMED_DEFAULT)
        exported.push([UNNAMED_DEFAULT, "default"])
      } else if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && returnsQueue(value)) {
        localGetters.add(UNNAMED_DEFAULT)
        exported.push([UNNAMED_DEFAULT, "default"])
      }
    }
  }
  const queues = new Set(exported.filter(([local]) => localQueues.has(local)).map(([, name]) => name))
  const getters = new Set(exported.filter(([local]) => localGetters.has(local)).map(([, name]) => name))
  return { queues, getters, constructs }
}

/** The file a module specifier names, from `fromFile`: a relative path or `@/…` (backend/src); null for a package. */
function resolveModule(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith(".")) base = join(dirname(fromFile), spec)
  else if (spec.startsWith("@/")) base = join(SRC, spec.slice(2))
  else return null
  const stem = base.replace(/\.(?:js|ts)$/, "")
  for (const candidate of [`${stem}.ts`, join(stem, "index.ts")]) if (existsSync(candidate)) return candidate
  return null
}

const CONSTRUCTS_A_QUEUE = /\bnew\s+(?:[\w$]+\.)?Queue\b|["']bullmq["']/
const RE_EXPORTS = /\bexport\s*(?:\*|\{[^}]*\})\s*from\s*["'][^"']+["']/

/**
 * Every module under backend/src that constructs a BullMQ queue or exports
 * one (a re-export of another's included), by its absolute path: what it
 * exports, and whether it constructs one itself.
 */
function scanQueueModules(): Map<string, QueueExports & { readonly constructs: boolean }> {
  const found = new Map<string, QueueExports & { readonly constructs: boolean }>()
  const reExporters: Array<{ file: string; sf: ts.SourceFile }> = []
  for (const file of tsFiles(SRC)) {
    const text = readFileSync(file, "utf8")
    const constructs = CONSTRUCTS_A_QUEUE.test(text)
    const reExports = RE_EXPORTS.test(text)
    if (!constructs && !reExports) continue
    const sf = parseSource(file, text)
    if (constructs) {
      const exp = moduleQueueExports(sf)
      if (exp.constructs || exp.queues.size > 0 || exp.getters.size > 0) found.set(file, exp)
    }
    if (reExports) reExporters.push({ file, sf })
  }
  // A module that re-exports a queue module's queue is one too, to a fixpoint.
  for (let grew = true; grew; ) {
    grew = false
    for (const { file, sf } of reExporters) {
      const queues = new Set(found.get(file)?.queues ?? [])
      const getters = new Set(found.get(file)?.getters ?? [])
      const before = queues.size + getters.size
      for (const st of sf.statements) {
        if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteralLike(st.moduleSpecifier)) continue
        const target = resolveModule(file, st.moduleSpecifier.text)
        const exp = target ? found.get(target) : undefined
        if (!exp) continue
        if (!st.exportClause) {
          for (const q of exp.queues) queues.add(q)
          for (const g of exp.getters) getters.add(g)
        } else if (ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            const source = (el.propertyName ?? el.name).text
            if (exp.queues.has(source)) queues.add(el.name.text)
            if (exp.getters.has(source)) getters.add(el.name.text)
          }
        }
      }
      if (queues.size + getters.size > before) {
        found.set(file, { queues, getters, constructs: found.get(file)?.constructs ?? false })
        grew = true
      }
    }
  }
  return found
}

/**
 * The queue modules as of this guard's last edit: a FALLBACK the scan is
 * unioned with, so a queue the scan stops recognising (one built by a
 * factory, say) is still known. The scan is the source of truth — "the
 * fallback list covers every module the scan finds" fails when a new queue
 * module appears, so this list cannot go stale.
 */
const KNOWN_QUEUE_MODULES: Readonly<Record<string, { readonly queues: readonly string[]; readonly getters: readonly string[] }>> = {
  "backend/src/lib/queue.ts": { queues: ["videoQueue"], getters: [] },
  "backend/src/lib/render-queue.ts": { queues: ["renderQueue"], getters: [] },
  "backend/src/lib/orchestration-queue.ts": { queues: ["orchestrationQueue"], getters: [] },
  "backend/src/lib/video-director-queue.ts": { queues: ["videoDirectorQueue"], getters: [] },
  "backend/src/lib/social-queue.ts": { queues: ["socialPublishQueue"], getters: [] },
  "backend/src/lib/concurrency-lanes/park.ts": { queues: [], getters: ["queueOf"] },
  "backend/src/ee/pipelines/queue.ts": { queues: ["pipelineOrchestrationQueue"], getters: [] },
  // A maintenance script: it builds its queues inside its own function and exports none.
  "backend/src/scripts/flush-queue.ts": { queues: [], getters: [] },
}

const scanned = scanQueueModules()
const queueModules = new Map<string, QueueExports>([...scanned].map(([file, exp]) => [file, exp]))
for (const [path, known] of Object.entries(KNOWN_QUEUE_MODULES)) {
  const file = join(REPO_ROOT, path)
  const exp = queueModules.get(file)
  queueModules.set(file, {
    queues: new Set([...(exp?.queues ?? []), ...known.queues]),
    getters: new Set([...(exp?.getters ?? []), ...known.getters]),
  })
}
const exportsFrom = (fromFile: string): ModuleExportsOf => (spec) => {
  const target = resolveModule(fromFile, spec)
  return target === null ? null : (queueModules.get(target) ?? null)
}

// ─────────────────────────────────────────────────── a route's queue names

/** The names that hold a queue in one file, and the names that reach one. */
interface QueueBindings {
  /** Identifiers that hold a queue: imported, destructured from an import, or an alias of one. */
  readonly queues: Set<string>
  /** Identifiers whose call returns a queue (a queue module's getter). */
  readonly getters: Set<string>
  /** Namespace imports of a queue module (`ns.videoQueue`). */
  readonly namespaces: Map<string, QueueExports>
  readonly bull: BullmqNames
  readonly exportsOf: ModuleExportsOf
}

/** Whether `e` evaluates to a queue this file can name (not by name alone: see QUEUE_NAME). */
function isQueue(e: ts.Expression, b: QueueBindings): boolean {
  const n = unwrap(e)
  if (ts.isIdentifier(n)) return b.queues.has(n.text)
  if (ts.isAwaitExpression(n)) return isQueue(n.expression, b)
  if (ts.isConditionalExpression(n)) return isQueue(n.whenTrue, b) || isQueue(n.whenFalse, b)
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) {
    return isQueue(n.left, b) || isQueue(n.right, b)
  }
  if (constructsQueue(n, b.bull)) return true
  if (ts.isPropertyAccessExpression(n)) {
    const exp = moduleOf(n.expression, b)
    if (exp?.queues.has(n.name.text)) return true
    // `Queue.prototype.add.call(q, …)`: the class's own add.
    const target = unwrap(n.expression)
    return n.name.text === "prototype" && ts.isIdentifier(target) && b.bull.classes.has(target.text)
  }
  if (ts.isCallExpression(n)) return isGetter(n.expression, b)
  return false
}

/** Whether `e` evaluates to a queue getter this file can name: imported (by any name), a namespace's, or an alias of one. */
function isGetter(e: ts.Expression, b: QueueBindings): boolean {
  const n = unwrap(e)
  if (ts.isIdentifier(n)) return b.getters.has(n.text)
  if (ts.isPropertyAccessExpression(n)) return moduleOf(n.expression, b)?.getters.has(n.name.text) ?? false
  if (ts.isConditionalExpression(n)) return isGetter(n.whenTrue, b) || isGetter(n.whenFalse, b)
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) {
    return isGetter(n.left, b) || isGetter(n.right, b)
  }
  return false
}

/** The queue module `e` stands for: a namespace import of one, or `await import("…")` of one. */
function moduleOf(e: ts.Expression, b: QueueBindings): QueueExports | null {
  const n = unwrap(e)
  if (ts.isIdentifier(n)) return b.namespaces.get(n.text) ?? null
  const spec = dynamicImportSpec(n)
  return spec === undefined ? null : b.exportsOf(spec)
}

/** Bind each name a queue module's import or destructure introduces. */
function bindImported(b: QueueBindings, exp: QueueExports, imported: string, local: string): boolean {
  const before = b.queues.size + b.getters.size
  if (exp.queues.has(imported)) b.queues.add(local)
  if (exp.getters.has(imported)) b.getters.add(local)
  return b.queues.size + b.getters.size > before
}

/** The queue names of one file: its imports of queue modules (static, default, namespace, dynamic) and its aliases of queues and getters, to a fixpoint. */
function queueBindings(sf: ts.SourceFile, exportsOf: ModuleExportsOf): QueueBindings {
  const b: QueueBindings = { queues: new Set(), getters: new Set(), namespaces: new Map(), bull: bullmqNames(sf), exportsOf }
  visit(sf, (n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteralLike(n.moduleSpecifier)) return
    const exp = exportsOf(n.moduleSpecifier.text)
    if (!exp) return
    // `import vq from "…"`: the module's default export.
    if (n.importClause?.name) bindImported(b, exp, "default", n.importClause.name.text)
    const bindings = n.importClause?.namedBindings
    if (!bindings) return
    if (ts.isNamespaceImport(bindings)) b.namespaces.set(bindings.name.text, exp)
    else for (const el of bindings.elements) bindImported(b, exp, (el.propertyName ?? el.name).text, el.name.text)
  })
  for (let grew = true; grew; ) {
    grew = false
    visit(sf, (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const exp = moduleOf(n.initializer, b)
        if (exp && ts.isIdentifier(n.name)) {
          if (!b.namespaces.has(n.name.text)) grew = true
          b.namespaces.set(n.name.text, exp)
        } else if (exp && ts.isObjectBindingPattern(n.name)) {
          for (const el of n.name.elements) {
            const key = bindingKey(el)
            if (key && ts.isIdentifier(el.name) && bindImported(b, exp, key, el.name.text)) grew = true
          }
        } else if (ts.isIdentifier(n.name) && !b.queues.has(n.name.text) && isQueue(n.initializer, b)) {
          b.queues.add(n.name.text)
          grew = true
        } else if (ts.isIdentifier(n.name) && !b.getters.has(n.name.text) && isGetter(n.initializer, b)) {
          // `const lane = queueOf`: an alias of a getter is one too.
          b.getters.add(n.name.text)
          grew = true
        }
      } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
        if (!b.queues.has(n.left.text) && isQueue(n.right, b)) {
          b.queues.add(n.left.text)
          grew = true
        } else if (!b.getters.has(n.left.text) && isGetter(n.right, b)) {
          b.getters.add(n.left.text)
          grew = true
        }
      }
    })
  }
  return b
}

/** The name a receiver goes by: `videoQueue` in `videoQueue.add(…)`, `queue` in `queues.queue.add(…)`. */
function receiverName(expr: ts.Expression): string | undefined {
  const e = unwrap(expr)
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return undefined
}

function calleeName(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined
}

/** Whether `fn` is the `enqueue` of a job object: `enqueue: () => …`, `enqueue: function …`, or `enqueue() { … }`. */
function enqueueMember(fn: ts.Node): ts.Node | undefined {
  const holder = fn.parent
  if (holder && ts.isPropertyAssignment(holder) && holder.initializer === fn && ts.isIdentifier(holder.name) && holder.name.text === "enqueue") return holder
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name) && fn.name.text === "enqueue" && ts.isObjectLiteralExpression(fn.parent)) return fn
  return undefined
}

/** Whether `member` is written inside the arguments of an `enqueueRouteJobs` / `runJobBatch` call (through any `.map` or callback). */
function insideBatchCall(member: ts.Node): boolean {
  for (let child: ts.Node = member, p = member.parent; p; child = p, p = p.parent) {
    if (ts.isCallExpression(p) && BATCH_HELPERS.has(calleeName(p) ?? "") && p.arguments.includes(child as ts.Expression)) return true
  }
  return false
}

/**
 * Whether the queue access sits in a closure a helper owns: the nearest
 * enclosing function is a closure helper's argument, or the `enqueue` of a
 * job written inside a batch helper's arguments.
 */
function inHelperClosure(access: ts.Node): boolean {
  for (let p: ts.Node | undefined = access.parent; p; p = p.parent) {
    if (!ts.isArrowFunction(p) && !ts.isFunctionExpression(p) && !ts.isMethodDeclaration(p)) continue
    const holder = p.parent
    if (holder && ts.isCallExpression(holder) && holder.arguments.includes(p as ts.Expression) && CLOSURE_HELPERS.has(calleeName(holder) ?? "")) return true
    const member = enqueueMember(p)
    return member !== undefined && insideBatchCall(member)
  }
  return false
}

/**
 * Each place a queue is added to outside a helper's closure (its line): an
 * `add…` property (called, `.call`ed, or handed on), an element read by an
 * `add…` or a computed key, an `add…` (or a rest) destructured from a queue;
 * and, by name, `.add` / `.addBulk` on a `<x>Queue`.
 */
function bareQueueAdds(sf: ts.SourceFile, exportsOf: ModuleExportsOf): number[] {
  const b = queueBindings(sf, exportsOf)
  const byName = (receiver: ts.Expression, method: string): boolean => ADD_METHODS.has(method) && QUEUE_NAME.test(receiverName(receiver) ?? "")
  const lines = new Set<number>()
  const flag = (n: ts.Node): void => {
    if (!inHelperClosure(n)) lines.add(lineOf(sf, n))
  }
  visit(sf, (n) => {
    if (ts.isPropertyAccessExpression(n)) {
      const method = n.name.text
      if ((ADD_METHODS.has(method) && isQueue(n.expression, b)) || byName(n.expression, method)) flag(n)
    } else if (ts.isElementAccessExpression(n)) {
      const key = unwrap(n.argumentExpression)
      const literal = ts.isStringLiteralLike(key) ? key.text : undefined
      if ((isQueue(n.expression, b) && (literal === undefined || ADD_METHODS.has(literal))) || (literal !== undefined && byName(n.expression, literal))) flag(n)
    } else if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && isQueue(n.initializer, b)) {
      if (n.name.elements.some((el) => el.dotDotDotToken !== undefined || ADD_METHODS.has(bindingKey(el) ?? "add"))) flag(n)
    }
  })
  return [...lines].sort((x, y) => x - y)
}

// ───────────────────────────────────────────────────── the helper stop rule

/** `if (<reply>.sent) return …`, as a statement (its return bare or in a one-statement block). */
function isStopWhenAnswered(st: ts.Statement | undefined, replyName: string): boolean {
  if (!st || !ts.isIfStatement(st) || st.elseStatement) return false
  const cond = st.expression
  if (!ts.isPropertyAccessExpression(cond) || cond.name.text !== "sent" || !ts.isIdentifier(cond.expression) || cond.expression.text !== replyName) return false
  return returnsOnly(st.thenStatement)
}

/** `if (!<name>) return …` (or `<name> === null` / `== null`): a batch run that already answered. */
function isStopWhenNull(st: ts.Statement | undefined, name: string): boolean {
  if (!st || !ts.isIfStatement(st) || st.elseStatement) return false
  const cond = unwrap(st.expression)
  const negated = ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(unwrap(cond.operand)) && (unwrap(cond.operand) as ts.Identifier).text === name
  const isNull = ts.isBinaryExpression(cond) &&
    [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(cond.operatorToken.kind) &&
    ts.isIdentifier(cond.left) && cond.left.text === name && cond.right.kind === ts.SyntaxKind.NullKeyword
  return (negated || isNull) && returnsOnly(st.thenStatement)
}

function returnsOnly(then: ts.Statement): boolean {
  return ts.isReturnStatement(then) || (ts.isBlock(then) && then.statements.length === 1 && ts.isReturnStatement(then.statements[0]!))
}

/** Whether `st` is an `if` reading `name` (what a route does with a captured outcome before it stops). */
function readsOutcome(st: ts.Statement, name: string): boolean {
  if (!ts.isIfStatement(st)) return false
  let found = false
  visit(st.expression, (n) => {
    if (ts.isIdentifier(n) && n.text === name) found = true
  })
  return found
}

/** The statement a call is awaited as — `await f(…)` or `const x = await f(…)` — and the name it is captured in. */
function awaitedStatement(call: ts.CallExpression): { statement?: ts.Statement; captured?: string } {
  const awaited = ts.isAwaitExpression(call.parent) ? call.parent : undefined
  if (awaited && ts.isExpressionStatement(awaited.parent)) return { statement: awaited.parent }
  if (awaited && ts.isVariableDeclaration(awaited.parent) && ts.isIdentifier(awaited.parent.name)) {
    const list = awaited.parent.parent
    if (ts.isVariableDeclarationList(list) && ts.isVariableStatement(list.parent)) return { statement: list.parent, captured: awaited.parent.name.text }
  }
  return {}
}

/**
 * Each helper call, and whether it keeps its rule:
 *   - a helper that answers: `await helper(…)` then `if (reply.sent) return`,
 *     or `const outcome = await helper(…)`, the `if`s that read `outcome`,
 *     then the stop;
 *   - `runJobBatch`: `const jobs = await runJobBatch(…)` then `if (!jobs) return`
 *     (or the reply stop);
 *   - `tryEnqueueExecution`: awaited as its own statement.
 */
function helperCalls(sf: ts.SourceFile): Array<{ helper: string; line: number; stops: boolean }> {
  const out: Array<{ helper: string; line: number; stops: boolean }> = []
  visit(sf, (n) => {
    if (!ts.isCallExpression(n)) return
    const helper = calleeName(n)
    if (!helper || !(HELPERS.has(helper) || helper === BATCH_RUNNER || AWAIT_ONLY_HELPERS.has(helper))) return
    const line = lineOf(sf, n)
    const { statement, captured } = awaitedStatement(n)
    if (AWAIT_ONLY_HELPERS.has(helper)) {
      out.push({ helper, line, stops: statement !== undefined })
      return
    }
    const replyArg = n.arguments[1]
    const replyName = replyArg && ts.isIdentifier(replyArg) ? replyArg.text : undefined
    const block = statement?.parent
    if (!replyName || !statement || !block || !(ts.isBlock(block) || ts.isSourceFile(block))) {
      out.push({ helper, line, stops: false })
      return
    }
    const siblings = block.statements
    let next = siblings.indexOf(statement) + 1
    if (helper === BATCH_RUNNER) {
      out.push({ helper, line, stops: captured !== undefined && (isStopWhenNull(siblings[next], captured) || isStopWhenAnswered(siblings[next], replyName)) })
      return
    }
    if (captured) while (next < siblings.length && readsOutcome(siblings[next]!, captured)) next++
    out.push({ helper, line, stops: isStopWhenAnswered(siblings[next], replyName) })
  })
  return out
}

// ─────────────────────────────────────────────────────────────── the routes

const unitRoutes = new Set(unitRouteFiles(REPO_ROOT))
const routeFiles = [...tsFiles(join(SRC, "routes")), ...tsFiles(join(SRC, "ee", "routes")), ...unitRoutes]
const routes = routeFiles.map((file) => {
  const sf = parseSource(file, readFileSync(file, "utf8"))
  const imports = importedModules(sf)
  return {
    rel: repoPath(file),
    unit: unitRoutes.has(file),
    worker: unitRoutes.has(file) && existsSync(join(dirname(file), "worker.ts")),
    queueImports: unitRoutes.has(file)
      ? imports.filter((m) => {
        const target = resolveModule(file, m)
        return isQueueModule(m) || (target !== null && queueModules.has(target))
      })
      : [],
    bareAdds: bareQueueAdds(sf, exportsFrom(file)),
    calls: helperCalls(sf),
  }
})

describe("routes queue through the shared queue-failure helpers", () => {
  it("finds the routes, node units and helper users among them (the guard is wired to something)", () => {
    expect(routes.length).toBeGreaterThan(200)
    expect(routes.filter((r) => r.worker).length).toBeGreaterThanOrEqual(5)
    expect(routes.filter((r) => r.calls.length > 0).length).toBeGreaterThan(80)
  })

  it("finds the queue modules by scanning: each queue and getter, wherever it is built", () => {
    const at = (path: string) => scanned.get(join(REPO_ROOT, path))
    expect([...(at("backend/src/lib/queue.ts")?.queues ?? [])]).toEqual(["videoQueue"])
    expect([...(at("backend/src/ee/pipelines/queue.ts")?.queues ?? [])]).toEqual(["pipelineOrchestrationQueue"])
    expect([...(at("backend/src/lib/concurrency-lanes/park.ts")?.getters ?? [])]).toEqual(["queueOf"])
    expect(at("backend/src/lib/enqueue-route-job.ts")).toBeUndefined()
  })

  it("the fallback list covers every module the scan finds, with each queue and getter it exports; every listed module exists", () => {
    const uncovered = [...scanned].flatMap(([file, exp]) => {
      const known = KNOWN_QUEUE_MODULES[repoPath(file)]
      if (!known) return [`${repoPath(file)}: not listed`]
      return [
        ...[...exp.queues].filter((q) => !known.queues.includes(q)).map((q) => `${repoPath(file)}: queue ${q}`),
        ...[...exp.getters].filter((g) => !known.getters.includes(g)).map((g) => `${repoPath(file)}: getter ${g}`),
      ]
    })
    expect(uncovered, `Add these to KNOWN_QUEUE_MODULES (the scan found them):\n${uncovered.join("\n")}`).toEqual([])
    const gone = Object.keys(KNOWN_QUEUE_MODULES).filter((path) => !existsSync(join(REPO_ROOT, path)))
    expect(gone, `These listed queue modules no longer exist — remove them:\n${gone.join("\n")}`).toEqual([])
  })

  it("no route adds to a queue outside a helper's closure", () => {
    const offenders = routes.flatMap((r) => r.bareAdds.map((line) => `${r.rel}:${line}`))
    expect(
      offenders,
      `These routes add to a queue directly:\n${offenders.map((o) => `  - ${o}`).join("\n")}\n\n` +
        "Queue a job with `await enqueueRouteJob(req, reply, job.id, () => queue.add(…))` (a batch: " +
        "`enqueueRouteJobs`, or `runJobBatch`'s `enqueue`; a node unit: `enqueueUnitJob`; a workflow run: `enqueueExecution`) " +
        "followed by `if (reply.sent) return`: a row the queue refuses is then failed, refunded and its key freed at once, " +
        "instead of being left pending for a never-started sweep.",
    ).toEqual([])
  })

  it("every helper call is awaited and keeps its stop", () => {
    const unchecked = routes.flatMap((r) => r.calls.filter((c) => !c.stops).map((c) => `${r.rel}:${c.line} ${c.helper}`))
    expect(
      unchecked,
      "Each helper call must be its own awaited statement, followed at once by `if (reply.sent) return` " +
        "(after a captured outcome, after the `if`s reading it; `runJobBatch`: its result captured, then `if (!result) return`; " +
        `\`tryEnqueueExecution\`: awaited) — otherwise a refused job is answered twice:\n${unchecked.join("\n")}`,
    ).toEqual([])
  })

  it("a node unit's route imports no queue module and queues with enqueueUnitJob", () => {
    const imports = routes.filter((r) => r.unit).flatMap((r) => r.queueImports.map((m) => `${r.rel}: ${m}`))
    expect(imports, `These unit routes import a queue module:\n${imports.join("\n")}`).toEqual([])
    const missing = routes.filter((r) => r.worker && !r.calls.some((c) => c.helper === "enqueueUnitJob")).map((r) => r.rel)
    expect(missing, `These worker units' routes never call enqueueUnitJob:\n${missing.join("\n")}`).toEqual([])
  })
})

describe("the guard's readers", () => {
  const sfOf = (src: string) => ts.createSourceFile("r.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const handler = (body: string) => `app.post("/x", async (req, reply) => {\n${body}\n})`
  /**
   * A world with four queue modules: lib/queue.js (a queue), concurrency-lanes/park.js
   * (a getter), and two whose DEFAULT export is one — lib/default-queue.js (a
   * queue) and lib/default-lanes.js (a getter).
   */
  const WORLD: ModuleExportsOf = (spec) =>
    spec.endsWith("/lib/queue.js") ? { queues: new Set(["videoQueue"]), getters: new Set() }
    : spec.endsWith("/concurrency-lanes/park.js") ? { queues: new Set(), getters: new Set(["queueOf"]) }
    : spec.endsWith("/lib/default-queue.js") ? { queues: new Set(["default"]), getters: new Set() }
    : spec.endsWith("/lib/default-lanes.js") ? { queues: new Set(), getters: new Set(["default"]) }
    : null
  const NO_MODULES: ModuleExportsOf = () => null
  /** A route that imports the queue under a name the name rule never sees, then runs `body`. */
  const withVq = (body: string) => `import { videoQueue as vq } from "../lib/queue.js"\n${body}`
  const adds = (src: string) => bareQueueAdds(sfOf(src), WORLD)

  it("a statement between the call and the stop fails, though a later handler has the stop", () => {
    const src = handler(`await enqueueRouteJob(req, reply, "j", () => q.add())\nlog()\nif (reply.sent) return\nreturn 1`) +
      "\n" + handler(`if (reply.sent) return`)
    expect(helperCalls(sfOf(src))).toEqual([{ helper: "enqueueRouteJob", line: 2, stops: false }])
  })

  it("the stop right after the call passes, bare or in a block, across a multi-line call; a captured outcome may be read first", () => {
    expect(helperCalls(sfOf(handler(`await enqueueUnitJob(req, reply, d, {\n  jobId: "j",\n})\nif (reply.sent) return\nreturn 1`)))[0]!.stops).toBe(true)
    expect(helperCalls(sfOf(handler(`await enqueueRouteJobs(req, reply, jobs);\nif (reply.sent) { return }`)))[0]!.stops).toBe(true)
    expect(helperCalls(sfOf(handler(`const outcome = await enqueueExecution(req, reply, "e", () => q.add())\nif (outcome === "failed") await releaseFee()\nif (reply.sent) return`)))[0]!.stops).toBe(true)
    expect(helperCalls(sfOf(handler(`const outcome = await enqueueExecution(req, reply, "e", () => q.add())\nlog()\nif (reply.sent) return`)))[0]!.stops).toBe(false)
  })

  it("a call that is not awaited as its own statement fails", () => {
    expect(helperCalls(sfOf(handler(`const p = enqueueRouteJob(req, reply, "j", () => q.add())\nif (reply.sent) return`)))[0]!.stops).toBe(false)
    expect(helperCalls(sfOf(handler(`enqueueUnitJob(req, reply, d, { jobId: "j" })\nif (reply.sent) return`)))[0]!.stops).toBe(false)
  })

  it("runJobBatch stops on its own null; tryEnqueueExecution is held to being awaited, and to nothing more", () => {
    const batch = (rest: string) => helperCalls(sfOf(handler(`const created = await runJobBatch(req, reply, jobs, opts)\n${rest}`)))[0]!.stops
    expect(batch(`if (!created) return\nreturn created`)).toBe(true)
    expect(batch(`if (created === null) { return }`)).toBe(true)
    expect(batch(`log()\nif (!created) return`)).toBe(false)
    expect(batch(`if (!other) return`)).toBe(false)
    expect(helperCalls(sfOf(handler(`await runJobBatch(req, reply, jobs, opts)\nif (reply.sent) return`)))[0]!.stops).toBe(false)

    const tryRun = (body: string) => helperCalls(sfOf(handler(body)))[0]!
    expect(tryRun(`const refused = await tryEnqueueExecution(req, "e", () => q.add())\nlog(refused)`)).toEqual({ helper: "tryEnqueueExecution", line: 2, stops: true })
    expect(tryRun(`await tryEnqueueExecution(req, "e", () => q.add())`).stops).toBe(true)
    expect(tryRun(`const refused = tryEnqueueExecution(req, "e", () => q.add())`).stops).toBe(false)
    expect(tryRun(`void tryEnqueueExecution(req, "e", () => q.add())`).stops).toBe(false)
    expect(tryRun(`tryEnqueueExecution(req, "e", () => q.add()).catch(log)`).stops).toBe(false)
  })

  it("by name: a queue's add counts as bare unless a helper's closure holds it", () => {
    const src = `await videoQueue.add("a", {})\nawait enqueueRouteJob(req, reply, "j", () => videoQueue.add("b", {}))\n` +
      `await enqueueRouteJobs(req, reply, ids.map((id) => ({ jobId: id, enqueue: () => videoQueue.add("c", { id }) })))\n` +
      `await enqueueExecution(req, reply, "e", async () => { await orchestrationQueue.add("d", {}) })\n` +
      `await other(() => renderQueue.add("e", {}))\n// await videoQueue.add("f", {})\nawait q.pipelineQueue.add("g", {})\nlist.add(1)`
    expect(bareQueueAdds(sfOf(src), NO_MODULES)).toEqual([1, 5, 7])
  })

  it("an imported queue is found under any name: renamed, through a namespace, from a dynamic import", () => {
    expect(adds(withVq(`await vq.add("x", {})`))).toEqual([2])
    expect(adds(`import * as queues from "../lib/queue.js"\nawait queues.videoQueue.add("x", {})`)).toEqual([2])
    expect(adds(`const { videoQueue: v } = await import("../lib/queue.js")\nawait v.add("x", {})`)).toEqual([2])
    expect(adds(`const m = await import("../lib/queue.js")\nawait m.videoQueue.add("x", {})`)).toEqual([2])
    expect(adds(`await (await import("../lib/queue.js")).videoQueue.add("x", {})`)).toEqual([1])
    // What an import of the same module that is not a queue does is never a queue add.
    expect(adds(`import { tryRemoveFromQueue, redis } from "../lib/queue.js"\nawait tryRemoveFromQueue("j")\nawait redis.get("k")\nconst s = new Set<string>()\ns.add("x")`)).toEqual([])
  })

  it("every way to add is caught: addBulk, a bracket, .call, a destructure, an alias, a getter", () => {
    expect(adds(withVq(`await vq.addBulk([{ name: "x", data: {} }])`))).toEqual([2])
    expect(adds(withVq(`await vq["add"]("x", {})`))).toEqual([2])
    expect(adds(withVq(`await vq["addBulk"]([])`))).toEqual([2])
    expect(adds(withVq(`const method = "add"\nawait vq[method]("x", {})`))).toEqual([3])
    expect(adds(withVq(`await vq.add.call(vq, "x", {})`))).toEqual([2])
    expect(adds(withVq(`const send = vq.add.bind(vq)\nawait send("x", {})`))).toEqual([2])
    expect(adds(withVq(`const { add } = vq\nawait add("x", {})`))).toEqual([2])
    expect(adds(withVq(`const { addBulk: many } = vq`))).toEqual([2])
    expect(adds(withVq(`const { ...all } = vq`))).toEqual([2])
    expect(adds(withVq(`const q2 = vq\nconst q3 = q2 as typeof vq\nawait q3.add("x", {})`))).toEqual([4])
    expect(adds(withVq(`let q: unknown\nq = vq\nawait (q as typeof vq).add("x", {})`))).toEqual([4])
    expect(adds(withVq(`const q = ready ? vq : null\nawait q?.add("x", {})`))).toEqual([3])
    expect(adds(`import { videoQueue as vq } from "bullmq-lookalike"\nimport { Queue } from "bullmq"\nawait Queue.prototype.add.call(vq, "x", {})`)).toEqual([3])

    const park = `import { queueOf } from "../lib/concurrency-lanes/park.js"\n`
    expect(adds(`${park}await queueOf("video-generation")!.add("x", {})`)).toEqual([2])
    expect(adds(`${park}await queueOf("video-generation")?.add("x", {})`)).toEqual([2])
    expect(adds(`${park}const lane = queueOf("video-generation")\nawait lane!.add("x", {})`)).toEqual([3])
    expect(adds(`import * as park from "../lib/concurrency-lanes/park.js"\nawait park.queueOf("video-render")!.addBulk([])`)).toEqual([2])
    expect(adds(`import { Queue } from "bullmq"\nconst local = new Queue("x")\nawait local.add("y", {})`)).toEqual([3])
  })

  it("a default import of a queue module is followed: static, mixed with named ones, destructured from a dynamic import", () => {
    expect(adds(`import vq from "../lib/default-queue.js"\nawait vq.add("x", {})`)).toEqual([2])
    expect(adds(`import vq, { other } from "../lib/default-queue.js"\nawait vq.addBulk([])`)).toEqual([2])
    expect(adds(`import lane from "../lib/default-lanes.js"\nawait lane("video-generation")!.add("x", {})`)).toEqual([2])
    expect(adds(`const { default: dq } = await import("../lib/default-queue.js")\nawait dq.add("x", {})`)).toEqual([2])
    expect(adds(`const m = await import("../lib/default-queue.js")\nawait m.default.add("x", {})`)).toEqual([2])
    // A default import of a module whose default is no queue is no queue.
    expect(adds(`import notQ from "../lib/queue.js"\nawait notQ.add("x", {})`)).toEqual([])
    expect(adds(`import vq from "../lib/default-queue.js"\nawait enqueueRouteJob(req, reply, "j", () => vq.add("x", {}))`)).toEqual([])
  })

  it("an alias of a getter is a getter: direct, a namespace's, a chain, an assignment", () => {
    const park = `import { queueOf } from "../lib/concurrency-lanes/park.js"\n`
    expect(adds(`${park}const f = queueOf\nawait f("video-generation")!.add("x", {})`)).toEqual([3])
    expect(adds(`import * as lanes from "../lib/concurrency-lanes/park.js"\nconst f = lanes.queueOf\nawait f("v")!.add("x", {})`)).toEqual([3])
    expect(adds(`${park}const f = queueOf\nconst g = f\nawait g("v")?.add("x", {})`)).toEqual([4])
    expect(adds(`${park}let f: typeof queueOf | undefined\nf = queueOf\nawait f("v")!.addBulk([])`)).toEqual([4])
    expect(adds(`${park}const f = ready ? queueOf : null\nawait f!("v")!.add("x", {})`)).toEqual([3])
    // The alias's queue held by a name, then added to, is caught too; inside a helper it passes.
    expect(adds(`${park}const f = queueOf\nconst lane = f("v")\nawait lane!.add("x", {})`)).toEqual([4])
    expect(adds(`${park}const f = queueOf\nawait enqueueRouteJob(req, reply, "j", () => f("v")!.add("x", {}))`)).toEqual([])
  })

  it("only add and addBulk are adds: addListener and the other add… methods are not, by name or by binding", () => {
    expect(adds(withVq(`vq.addListener("error", log)`))).toEqual([])
    expect(adds(withVq(`vq["addListener"]("error", log)`))).toEqual([])
    expect(adds(withVq(`const { addListener, addAll } = vq`))).toEqual([])
    expect(adds(withVq(`const listen = vq.addListener.bind(vq)`))).toEqual([])
    expect(bareQueueAdds(sfOf(`videoQueue.addListener("error", log)\nrenderQueue.addHook(1)`), NO_MODULES)).toEqual([])
    // A key the reader cannot see stays an add.
    expect(adds(withVq(`await vq[method]("x", {})`))).toEqual([2])
    expect(adds(withVq(`const { [method]: fn } = vq`))).toEqual([2])
  })

  it("an `enqueue:` counts only inside an enqueueRouteJobs / runJobBatch call's arguments", () => {
    expect(adds(withVq(`const jobs = ids.map((id) => ({ jobId: id, enqueue: () => vq.add("c", { id }) }))\nawait enqueueRouteJobs(req, reply, jobs)`))).toEqual([2])
    expect(adds(withVq(`await other({ jobId: "j", enqueue: () => vq.add("c", {}) })`))).toEqual([2])
    expect(adds(withVq(`await enqueueRouteJobs(req, reply, [{ jobId: "j", enqueue: () => helper(() => vq.add("c", {})) }])`))).toEqual([2])
    // The legitimate forms: a job written in the call (through a .map / .flatMap), a method, runJobBatch's option.
    expect(adds(withVq(
      `await enqueueRouteJobs(req, reply, ids.map((id) => ({ jobId: id, enqueue: () => vq.add("c", { id }) })))\n` +
        `await enqueueRouteJobs(req, reply, rs.flatMap((r) => { const e = r; return [{ jobId: e.id, enqueue: async () => { await vq.add("d", {}) } }] }))\n` +
        `await enqueueRouteJobs(req, reply, [{ jobId: "j", enqueue() { return vq.add("e", {}) } }])\n` +
        `const created = await runJobBatch(req, reply, jobs, { failureMessage: "m", enqueue: async (toQueue) => { await vq.addBulk(toQueue.map(() => ({ name: "n", data: {} }))) } })`,
    ))).toEqual([])
  })

  it("a queue's add inside each closure helper passes; reading a queue for anything else is not an add", () => {
    expect(adds(withVq(
      `await enqueueRouteJob(req, reply, "j", () => vq.add("a", {}))\n` +
        `await enqueueExecution(req, reply, "e", async () => { await vq.add("b", {}) })\n` +
        `const refused = await tryEnqueueExecution(req, "e", () => vq.add("c", {}))\n` +
        `await vq.getJobs(["waiting"])\nconst { getJobs, name } = vq\nawait vq.remove("j")\nconst n = vq["name"]`,
    ))).toEqual([])
    // A closure nested in the helper's closure is not the helper's.
    expect(adds(withVq(`await enqueueRouteJob(req, reply, "j", () => { const go = () => vq.add("a", {}); return go() })`))).toEqual([2])
  })

  it("dynamic imports and every lib queue module are seen; comments, strings and the helper are not", () => {
    const mods = importedModules(sfOf(
      `import { videoQueue } from "../../lib/queue.js"\n// import { x } from "../../lib/render-queue.js"\nconst s = "../../lib/queue.js"\n` +
        `async function f(n: string) { await import("../../lib/video-director-queue.js"); await import(n) }`,
    ))
    expect(mods).toEqual(["../../lib/queue.js", "../../lib/video-director-queue.js", "<computed import()>"])
    expect(mods.every(isQueueModule)).toBe(true)
    for (const m of ["../../lib/render-queue.js", "../../lib/orchestration-queue.js", "../../lib/queue-connection.js", "bullmq"]) {
      expect(isQueueModule(m), m).toBe(true)
    }
    expect(isQueueModule("../../lib/enqueue-route-job.js")).toBe(false)
  })

  it("the module scan reads a module's exported queues and getters, never another export or a queue it keeps", () => {
    const exp = moduleQueueExports(sfOf(
      `import { Queue, type ConnectionOptions } from "bullmq"\n` +
        `export const aQueue = new Queue<{ id: string }>("a", {})\nconst hidden = new Queue("h")\nexport const typed: Queue | null = null\n` +
        `const queues = new Map<string, Queue>()\nexport function laneOf(name: string): Queue | null { return queues.get(name) ?? null }\n` +
        `export async function laterOf(): Promise<Queue> { return hidden }\nexport const built = () => new Queue("b")\n` +
        `export function infoOf(): QueueInfo { return {} as QueueInfo }\nexport function nameOf(q: Queue): string { return q.name }\n` +
        `export async function enqueueThing(): Promise<void> { await hidden.add("x", {}) }\nexport { hidden as renamed }`,
    ))
    expect(exp.constructs).toBe(true)
    expect([...exp.queues].sort()).toEqual(["aQueue", "renamed", "typed"])
    expect([...exp.getters].sort()).toEqual(["built", "laneOf", "laterOf"])
  })

  it("the module scan reads a default export that is a queue or a getter, however it is written", () => {
    const scan = (body: string) => moduleQueueExports(sfOf(`import { Queue } from "bullmq"\n${body}`))
    expect([...scan(`const q = new Queue("a")\nexport default q`).queues]).toEqual(["default"])
    expect([...scan(`export default new Queue("a")`).queues]).toEqual(["default"])
    expect([...scan(`const q = new Queue("a")\nexport { q as default }`).queues]).toEqual(["default"])
    expect([...scan(`export default function (): Queue { return new Queue("a") }`).getters]).toEqual(["default"])
    expect([...scan(`const q = new Queue("a")\nexport default function laneOf() { return q }`).getters]).toEqual(["default"])
    expect([...scan(`export default () => new Queue("a")`).getters]).toEqual(["default"])
    const notAQueue = scan(`const q = new Queue("a")\nexport default function nameOf(x: Queue): string { return x.name }`)
    expect([...notAQueue.queues, ...notAQueue.getters]).toEqual([])
  })
})
