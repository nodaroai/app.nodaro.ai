/**
 * Every paid run whose result lands on a canvas node shows a run in flight on
 * that node, from before its first paid request until the result is written
 * (T100). A `view` or `none` answer for an open canvas turns it read-only only
 * once no node does (`showsARunInFlight`), and `updateNodeData` does nothing on
 * a read-only canvas: a run the freeze cannot see is paid for, and its result
 * dropped.
 *
 * The executors mark their nodes as part of the run (a job's id, a status that
 * reads `running`, …: `workflow-viewer-mode-runs.test.ts` holds them to it).
 * Anything else marks through ONE wrapper, `withRunInFlight`
 * (`hooks/run-in-flight.ts`). So this guard reads every source file under
 * `frontend/src` and fails on a paid client call that is neither:
 *
 *   - lexically inside the callback handed to `withRunInFlight`, imported from
 *     its module (a function of the same name declared anywhere else does not
 *     count), nor
 *   - in an executor file (`EXECUTOR_FILES`), nor
 *   - in a file of `ALLOWED`, which says why that call needs no mark (its result
 *     lands on a row server-side, it stays in a dialog, …) and pins how many
 *     such calls the file holds, so a new one fails here until somebody decides
 *     it.
 *
 * "A paid client call" is any reference to a function of the client module
 * (`lib/api.ts`) in the PAID set: the per-variant asset calls
 * (`generate*Asset`), `generateImage`, the Suno persona (`sunoVoiceGenerateApi`),
 * every client function a file in the executors' folders imports, and every
 * client function whose declared return type carries a `jobId` (it starts a
 * job, which is what the server reserves credits against), minus `FREE`. A
 * function in `FREE` must say why it is not paid, so the set fails closed: a
 * new import there, or a new job, is paid until somebody says otherwise.
 *
 * The scan is a TypeScript parse, not a text search: aliased imports, a
 * destructured dynamic import and imports by relative path are followed, the
 * client taken whole (`import * as m`, `const m = await import(…)`,
 * `.then((m) => …)`) is followed through each `m.name`, and type positions
 * (`typeof generateImage`) are not calls. Any other use of the client it
 * cannot follow (a default import, a `require`, a re-export, the whole client
 * handed on) fails it.
 *
 * Limits, stated: an executor file is allowed whole, so a new call added to
 * one is held only by the executors' own convention, as before. And a paid
 * request made around the client module (a raw `fetch` to a route that
 * charges) is not seen.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const SRC = path.resolve(__dirname, "../..")
/** The scan reads every source file under frontend/src: allow for a slow runner. */
const SCAN_TIMEOUT_MS = 60_000

/** The client module and the wrapper's module, as source paths without extensions. */
const API_MODULE = "lib/api"
const WRAPPER_MODULE = "hooks/run-in-flight"
const WRAPPER = "withRunInFlight"

/** Where the executors live. What they import from the client is paid. */
const EXECUTOR_DIRS = ["components/editor/workflow-editor", "components/editor/reference-sheet"]

/**
 * Client functions an executor imports, or whose return type carries a
 * `jobId`, that pay for nothing, each with the reason. An entry must name a
 * function of the client that one of those two rules brings in (a stale entry
 * fails).
 */
const FREE: ReadonlyMap<string, string> = new Map([
  ["getAuthHeaders", "reads the session's headers"],
  ["getJobStatusLean", "reads a job"],
  ["getExecutionEstimate", "reads an estimate"],
  ["getUserCredits", "reads the balance"],
  ["getWorkflowExecution", "reads a run"],
  ["getComponentWaitLimit", "reads a limit"],
  ["getCharacter", "reads an entity row"],
  ["getObjectById", "reads an entity row"],
  ["getLocationById", "reads an entity row"],
  ["streamWorkflowExecution", "follows a run already started"],
  ["cancelJob", "stops a job"],
  ["discardWorkflowExecution", "stops a run"],
  ["uploadFile", "uploads the person's own file"],
  ["saveCharacter", "saves an entity row"],
  ["saveCreature", "saves an entity row"],
  ["saveFace", "saves an entity row"],
  ["saveLocation", "saves an entity row"],
  ["saveObject", "saves an entity row"],
  ["setCurrentWorkflowId", "sets a header for later requests; sends nothing"],
  ["setCurrentNodeId", "sets a header for later requests; sends nothing"],
  ["setForcePrivate", "sets a header for later requests; sends nothing"],
  ["setUserPromptTemplate", "sets a header for later requests; sends nothing"],
  ["withDedupRaceRetry", "retries the request it is handed; sends nothing of its own"],
  ["quotePro3DRender", "a price quote (`/v1/pro-3d-render/quote` reserves nothing)"],
  ["downloadYouTubeAudio", "`/v1/youtube-audio` charges no credits"],
  ["extractYouTubeAudioApi", "`/v1/extract-youtube-audio` charges no credits"],
  ["grokSegmentMap", "Grok region detection is priced at 0 credits (`grok-2-segment`)"],
])

/**
 * Files whose paid calls run inside an executor's own marks: a node's Run flips
 * it to `pending`, the run-start reset marks it `running` before the create
 * request and its job's id follows, and a loop that owns no job marks its own
 * status key (`showsARunInFlight`; `workflow-viewer-mode-runs` holds the
 * executors to the convention). Allowed whole.
 */
const EXECUTOR_FILES: ReadonlyMap<string, string> = new Map([
  ["components/editor/workflow-editor/execute-node.ts", "the per-type executors, run by a node's Run"],
  ["components/editor/workflow-editor/node-executors.ts", "executors through `pollJobWithNodeUpdate`, which writes the run-start reset first"],
  ["components/editor/workflow-editor/asset-executors.ts", "entity generation (the run-start reset) and the variant loops (their own `*Status` key)"],
  ["components/editor/workflow-editor/scene-story-handlers.ts", "a script scene's image, marked by its own `imageStatus`"],
  ["components/editor/workflow-editor/run-handlers.ts", "a whole-workflow run, its nodes flipped to `pending` first"],
  ["components/editor/workflow-editor/component-executor.ts", "a component node, run by a node's Run"],
])

interface Allowed {
  /** How many paid references outside the wrapper the file holds. */
  readonly refs: number
  readonly why: string
  /** A reason the guard can check, handed those references: what is no longer true, or null. */
  readonly check?: (outside: readonly Reference[]) => string | null
}

/** The request names the entity row the worker attaches its result to. */
const ROW_KEY = /^attachTo[A-Z]\w*Id$|^entityDbId$/

/** Checks: every paid call in the file names the entity row its result goes to. */
function attachesToARow(outside: readonly Reference[]): string | null {
  const bare = outside.filter((ref) => !ref.argKeys.some((key) => ROW_KEY.test(key)))
  return bare.length > 0 ? `a call that names no entity row (\`attachTo…Id\` / \`entityDbId\`): ${describeRefs(bare)}` : null
}

/** Checks: every paid call in the file is made inside a callback handed to `wrapper`. */
function insideOf(wrapper: string): (outside: readonly Reference[]) => string | null {
  return (outside) => {
    const elsewhere = outside.filter((ref) => ref.via !== wrapper)
    return elsewhere.length > 0 ? `a call outside \`${wrapper}\`: ${describeRefs(elsewhere)}` : null
  }
}

/** Checks: nothing but `allowedImporters` imports `module` (a component nothing renders). */
function importedOnlyBy(module: string, allowedImporters: readonly string[]): () => string | null {
  return () => {
    const importers = FILES.filter((file) => {
      const name = rel(file)
      if (allowedImporters.includes(name)) return false
      const text = fs.readFileSync(file, "utf8")
      if (!text.includes(path.posix.basename(module))) return false
      let found = false
      walk(parse(file, text), (node) => {
        const spec = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
        if (spec && ts.isStringLiteralLike(spec) && moduleOf(name, spec.text) === module) found = true
      })
      return found
    }).map(rel)
    return importers.length > 0 ? `${module} is imported by ${importers.join(", ")}` : null
  }
}

const STUDIO_ROW =
  "a Studio run: the job attaches its result to the entity's row server-side, where it stays whatever the canvas does"
const STUDIO_CANDIDATES =
  "a Studio's candidates: one attaches to the entity's row server-side; several wait in the Studio until one is approved, which the server writes to the row"
const LORA = "LoRA training: the trained model lands on the character's row server-side; the node only mirrors it"
const REFINE_POLL =
  "inside `pollImageRefineToNode`, which marks the node `running` (the run-start reset) before its create request"
const UNMOUNTED = "the legacy scene editor: nothing renders `SceneEditorModal`"
const SCENE_EDITOR = "components/editor/scene-editor-modal"

/** Every other file with a paid call outside the wrapper, why it needs no mark, and how many it holds. */
const ALLOWED: ReadonlyMap<string, Allowed> = new Map<string, Allowed>([
  ["components/editor/character-studio/ensure-body-angle.ts", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/character-studio/expressions-tab.tsx", { refs: 4, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/character-studio/motions-tab.tsx", { refs: 3, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/character-studio/pages/board-page.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/character-studio/use-portrait-candidates.ts", { refs: 1, why: STUDIO_CANDIDATES, check: attachesToARow }],
  ["components/editor/creature-studio/creature-asset-tab.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/creature-studio/motion-tab.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/creature-studio/use-creature-candidates.ts", { refs: 1, why: STUDIO_CANDIDATES, check: attachesToARow }],
  ["components/editor/location-studio/environmental-asset-tab.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/location-studio/motion-tab.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/location-studio/pages/appearance-page.tsx", { refs: 1, why: STUDIO_CANDIDATES, check: attachesToARow }],
  ["components/editor/object-studio/motion-tab.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/object-studio/object-asset-tab.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/object-studio/use-object-candidates.ts", { refs: 1, why: STUDIO_CANDIDATES, check: attachesToARow }],
  ["components/editor/reference-sheet/character-sheet-panel.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/reference-sheet/reference-sheet-tab.tsx", { refs: 1, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/reference-sheet/sheet-tab-adapter.ts", { refs: 3, why: STUDIO_ROW, check: attachesToARow }],
  ["components/editor/character-studio/pages/lora-page.tsx", { refs: 1, why: LORA }],
  ["components/editor/training-section.tsx", { refs: 1, why: LORA }],
  ["components/editor/studio-shell/voice-resource.tsx", { refs: 4, why: "a Studio's voice previews: what they play stays in the panel's own state, and nothing is written to a node" }],
  ["components/editor/config-panels/prompt-helper-dialog.tsx", { refs: 2, why: "the prompt helper: its answer stays in the dialog until the person accepts it, which is their own edit" }],
  ["components/editor/config-panels/refine-regions-section.tsx", { refs: 1, why: REFINE_POLL, check: insideOf("pollImageRefineToNode") }],
  ["components/nodes/reference-board-node.tsx", { refs: 3, why: REFINE_POLL, check: insideOf("pollImageRefineToNode") }],
  ["components/nodes/run-node-button.tsx", { refs: 1, why: "Stop on a Video Pro run: it acts on the run the node already shows, whose job's id holds the freeze back, and starts nothing" }],
  ["hooks/queries/use-competitors-queries.ts", { refs: 1, why: "Competitors: a page of its own, with no canvas" }],
  ["routes/video-director-page.tsx", { refs: 1, why: "the Video Director: a page of its own, with no canvas" }],
  ["components/editor/scene-editor-modal.tsx", { refs: 2, why: UNMOUNTED, check: importedOnlyBy(SCENE_EDITOR, []) }],
  ["components/editor/scene-config.tsx", { refs: 1, why: UNMOUNTED, check: importedOnlyBy("components/editor/scene-config", [`${SCENE_EDITOR}.tsx`]) }],
])

// ── the scan ────────────────────────────────────────────────────────────────

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "test") continue
      sourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      acc.push(full)
    }
  }
  return acc
}

function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/")
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

/** The module a specifier names, as a source path without its extension, or null for a package. */
function moduleOf(fromFile: string, spec: string): string | null {
  let target: string
  if (spec.startsWith("@/")) target = spec.slice(2)
  else if (spec.startsWith("./") || spec.startsWith("../")) target = path.posix.join(path.posix.dirname(fromFile), spec)
  else return null
  return path.posix.normalize(target).replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "")
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function skipParens(node: ts.Node): ts.Node {
  let cur = node
  while (cur.parent && ts.isParenthesizedExpression(cur.parent)) cur = cur.parent
  return cur
}

interface Reference {
  readonly name: string
  readonly line: number
  /** Inside the callback of `withRunInFlight`. */
  readonly wrapped: boolean
  /** The call whose callback holds this one, by its callee's name (`pollJobWithNodeUpdate`), if any. */
  readonly via: string | null
  /** When called, the keys of the object literals it is handed (its request body among them). */
  readonly argKeys: readonly string[]
}

interface Scan {
  readonly references: readonly Reference[]
  /** Imports of the client this scan cannot follow. */
  readonly unresolved: readonly string[]
  /** Every client function the file imports by name, paid or not. */
  readonly imported: readonly string[]
}

/** True when the identifier names a declaration or a property, not the binding. */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isBindingElement(p)) return true
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true
  if (ts.isQualifiedName(p)) return true
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === id) return true
  if (ts.isJsxAttribute(p) && p.name === id) return true
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && p.name === id) return true
  return false
}

/** The callee of the nearest call that is handed a function holding `node`. */
function viaOf(node: ts.Node): string | null {
  for (let cur: ts.Node = node; cur.parent; cur = cur.parent) {
    const call = cur.parent
    if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && ts.isCallExpression(call) && call.arguments.some((arg) => arg === cur)) {
      const callee = call.expression
      if (ts.isIdentifier(callee)) return callee.text
      if (ts.isPropertyAccessExpression(callee)) return callee.name.text
      return null
    }
  }
  return null
}

/** When `callee` is called, the keys of the object literals handed to the call. */
function argKeysOf(callee: ts.Node): string[] {
  const call = callee.parent
  if (!call || !ts.isCallExpression(call) || call.expression !== callee) return []
  return call.arguments.flatMap((arg) =>
    ts.isObjectLiteralExpression(arg)
      ? arg.properties.flatMap((prop) => (prop.name && ts.isIdentifier(prop.name) ? [prop.name.text] : []))
      : [],
  )
}

function inTypePosition(node: ts.Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isTypeNode(cur) && !ts.isExpressionWithTypeArguments(cur)) return true
    if (ts.isStatement(cur)) return false
  }
  return false
}

/**
 * Every reference to a paid client function in one file, and whether each is
 * inside the callback of `withRunInFlight`. Pure, so the guard can test it on
 * sources of its own.
 *
 * The client reaches a file by name (`import { a, b as c }`, a destructured
 * `await import(…)` or `.then(({ a }) => …)`) or as a whole (`import * as m`,
 * `const m = await import(…)`, `.then((m) => …)`), and then every use of `m`
 * must be `m.name`. Any other shape is reported, not guessed at.
 */
function scanSource(file: string, text: string, paid: ReadonlySet<string>): Scan {
  const sf = parse(file, text)
  const paidLocals = new Map<string, string>()
  /** A name bound to the whole client, and where that binding is visible. */
  const wholes: Array<{ readonly name: string; readonly scope: ts.Node }> = []
  const wrapperLocals = new Set<string>()
  const unresolved: string[] = []
  const imported: string[] = []
  const isApi = (spec: ts.Expression | undefined) =>
    !!spec && ts.isStringLiteralLike(spec) && moduleOf(file, spec.text) === API_MODULE
  const cannotFollow = (node: ts.Node) =>
    unresolved.push(`an import of the client the scan cannot follow at line ${lineOf(sf, node)}`)
  const bindNames = (pattern: ts.ObjectBindingPattern, at: ts.Node) => {
    for (const el of pattern.elements) {
      const key = el.propertyName ?? el.name
      if (el.dotDotDotToken || !ts.isIdentifier(key) || !ts.isIdentifier(el.name)) {
        cannotFollow(at)
        continue
      }
      imported.push(key.text)
      if (paid.has(key.text)) paidLocals.set(el.name.text, key.text)
    }
  }
  const bind = (name: ts.BindingName | undefined, scope: ts.Node, at: ts.Node) => {
    if (name && ts.isObjectBindingPattern(name)) bindNames(name, at)
    else if (name && ts.isIdentifier(name)) wholes.push({ name: name.text, scope })
    else cannotFollow(at)
  }

  walk(sf, (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (!clause || clause.isTypeOnly || !ts.isStringLiteralLike(node.moduleSpecifier)) return
      const target = moduleOf(file, node.moduleSpecifier.text)
      if (target === WRAPPER_MODULE && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if ((el.propertyName ?? el.name).text === WRAPPER) wrapperLocals.add(el.name.text)
        }
      }
      if (target !== API_MODULE) return
      if (clause.name) cannotFollow(node)
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        wholes.push({ name: bindings.name.text, scope: sf })
      } else if (bindings) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue
          const name = (el.propertyName ?? el.name).text
          imported.push(name)
          if (paid.has(name)) paidLocals.set(el.name.text, name)
        }
      }
      return
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && isApi(node.moduleSpecifier)) {
      const clause = node.exportClause
      if (!clause || !ts.isNamedExports(clause)) {
        unresolved.push(`a re-export of the whole client at line ${lineOf(sf, node)}`)
        return
      }
      for (const el of clause.elements) {
        const name = (el.propertyName ?? el.name).text
        if (!el.isTypeOnly && paid.has(name)) unresolved.push(`a re-export of ${name} at line ${lineOf(sf, node)}`)
      }
      return
    }
    if (!ts.isCallExpression(node) || node.arguments.length === 0 || !isApi(node.arguments[0])) return
    if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
      // `require("@/lib/api")`, or the module path handed to anything else.
      cannotFollow(node)
      return
    }
    const outer = skipParens(node)
    const parent = outer.parent
    // `const … = await import("@/lib/api")`
    if (parent && ts.isAwaitExpression(parent)) {
      const declared = skipParens(parent).parent
      if (declared && ts.isVariableDeclaration(declared)) {
        let scope: ts.Node = declared
        while (scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent
        bind(declared.name, scope, node)
      } else {
        cannotFollow(node)
      }
      return
    }
    // `import("@/lib/api").then((m) => …)` or `.then(({ a }) => …)`
    const then = parent && ts.isPropertyAccessExpression(parent) && parent.name.text === "then" ? parent.parent : undefined
    const callback = then && ts.isCallExpression(then) ? then.arguments[0] : undefined
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      bind(callback.parameters[0]?.name, callback.body, node)
      return
    }
    cannotFollow(node)
  })

  const isWrapperCallback = (fn: ts.Node): boolean => {
    const call = fn.parent
    return (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
      && !!call && ts.isCallExpression(call)
      && call.arguments.some((arg) => arg === fn)
      && ts.isIdentifier(call.expression)
      && wrapperLocals.has(call.expression.text)
    )
  }
  const inWrapper = (node: ts.Node): boolean => {
    for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) if (isWrapperCallback(cur)) return true
    return false
  }

  const references: Reference[] = []
  const refer = (name: string, at: ts.Node) =>
    references.push({ name, line: lineOf(sf, at), wrapped: inWrapper(at), via: viaOf(at), argKeys: argKeysOf(at) })
  if (paidLocals.size > 0) {
    walk(sf, (node) => {
      if (!ts.isIdentifier(node) || !paidLocals.has(node.text)) return
      if (isNamePosition(node) || inTypePosition(node)) return
      refer(paidLocals.get(node.text)!, node)
    })
  }
  // The client as a whole: each use must name its function.
  for (const whole of wholes) {
    walk(whole.scope, (node) => {
      if (!ts.isIdentifier(node) || node.text !== whole.name) return
      if (isNamePosition(node) || inTypePosition(node)) return
      const access = node.parent
      if (ts.isPropertyAccessExpression(access) && access.expression === node) {
        imported.push(access.name.text)
        if (paid.has(access.name.text)) refer(access.name.text, access)
      } else {
        cannotFollow(node)
      }
    })
  }
  return { references, unresolved, imported }
}

// ── the paid set ────────────────────────────────────────────────────────────

interface ClientFunction {
  /** Its declared return type carries a `jobId`. */
  readonly startsAJob: boolean
}

function clientFunctions(): Map<string, ClientFunction> {
  const file = path.join(SRC, `${API_MODULE}.ts`)
  const sf = parse(file, fs.readFileSync(file, "utf8"))
  const out = new Map<string, ClientFunction>()
  const add = (name: string, returnType: ts.TypeNode | undefined) => {
    const startsAJob = !!returnType && /\bjobId\b/.test(returnType.getText(sf))
    out.set(name, { startsAJob: startsAJob || (out.get(name)?.startsAJob ?? false) })
  }
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if (ts.isFunctionDeclaration(st) && st.name) add(st.name.text, st.type)
    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        const init = decl.initializer
        if (ts.isIdentifier(decl.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) add(decl.name.text, init.type)
      }
    }
  }
  return out
}

const FILES = sourceFiles(SRC).filter((file) => rel(file) !== `${API_MODULE}.ts`)
const CLIENT = clientFunctions()
const NAMED = [...[...CLIENT.keys()].filter((name) => /^generate\w*Asset$/.test(name)), "generateImage", "sunoVoiceGenerateApi"]
const EXECUTOR_IMPORTS = new Set(
  FILES.filter((file) => EXECUTOR_DIRS.some((dir) => rel(file).startsWith(`${dir}/`)))
    .flatMap((file) => scanSource(rel(file), fs.readFileSync(file, "utf8"), new Set()).imported)
    .filter((name) => CLIENT.has(name)),
)
const JOB_STARTERS = new Set([...CLIENT].filter(([, fn]) => fn.startsAJob).map(([name]) => name))
const PAID: ReadonlySet<string> = new Set(
  [...NAMED, ...EXECUTOR_IMPORTS, ...JOB_STARTERS].filter((name) => !FREE.has(name)),
)

function scanAll(): Map<string, Scan> {
  return new Map(FILES.map((file) => [rel(file), scanSource(rel(file), fs.readFileSync(file, "utf8"), PAID)]))
}

const describeRefs = (refs: readonly Reference[]) => refs.map((r) => `${r.name} (line ${r.line})`).join(", ")

describe("the paid set", () => {
  it("holds the calls T100 names and every job the client starts, and nothing listed as free", () => {
    for (const name of ["generateCharacterAsset", "generateObjectAsset", "generateLocationAsset", "generateCreatureAsset", "generateImage", "sunoVoiceGenerateApi"]) {
      expect(CLIENT.has(name), `${name} is no longer a client function: update the guard`).toBe(true)
      expect(PAID.has(name), name).toBe(true)
    }
    // An executor's paid call that starts no job of its own (a whole run),
    // an executor's job, and a job only a dialog starts.
    expect(PAID.has("runWorkflow")).toBe(true)
    expect(PAID.has("generateVideo")).toBe(true)
    expect(PAID.has("suggestOverlayPlacement")).toBe(true)
    expect(PAID.has("getJobStatusLean")).toBe(false)
    // The rules still find what they are for: a parse that matched nothing
    // would make every call free.
    expect(EXECUTOR_IMPORTS.size).toBeGreaterThan(80)
    expect(JOB_STARTERS.size).toBeGreaterThan(100)
  })

  it("lists as free only client functions a rule brings in, never one T100 names", () => {
    const candidates = new Set([...EXECUTOR_IMPORTS, ...JOB_STARTERS])
    const stale = [...FREE.keys()].filter((name) => !candidates.has(name))
    expect(stale, "FREE entries no rule brings in").toEqual([])
    expect(NAMED.filter((name) => FREE.has(name))).toEqual([])
  })
})

/**
 * What is wrong with these scans: a paid call outside the wrapper in a file
 * neither an executor's nor allowed, an allowed count that no longer matches,
 * an entry with nothing left to allow, and any use of the client the scan
 * could not follow. Pure, so the guard tests its own verdict.
 */
function verdict(
  scans: ReadonlyMap<string, Scan>,
  executorFiles: ReadonlyMap<string, string>,
  allowed: ReadonlyMap<string, Allowed>,
): string[] {
  const problems: string[] = []
  const outsideOf = (file: string) => scans.get(file)?.references.filter((r) => !r.wrapped) ?? []
  for (const [file, scan] of scans) {
    for (const what of scan.unresolved) problems.push(`${file}: ${what}`)
    const outside = outsideOf(file)
    if (outside.length === 0 || executorFiles.has(file)) continue
    const entry = allowed.get(file)
    if (!entry) {
      problems.push(`${file}: a paid call outside ${WRAPPER}: ${describeRefs(outside)}. Run it inside ${WRAPPER}(nodeId, …) when its result lands on a canvas node; otherwise allow the file, with why`)
    } else if (outside.length !== entry.refs) {
      problems.push(`${file}: ${outside.length} paid calls outside ${WRAPPER}, ${entry.refs} allowed (${describeRefs(outside)}). Decide the new one, then update the count`)
    }
  }
  for (const file of [...executorFiles.keys(), ...allowed.keys()]) {
    if (outsideOf(file).length === 0) problems.push(`${file}: allowed, but holds no paid call outside ${WRAPPER} any more: remove the entry`)
  }
  return problems
}

/** The reasons an entry can check, checked against these scans. */
function brokenReasons(scans: ReadonlyMap<string, Scan>, allowed: ReadonlyMap<string, Allowed>): string[] {
  return [...allowed].flatMap(([file, entry]) => {
    const what = entry.check?.(scans.get(file)?.references.filter((r) => !r.wrapped) ?? [])
    return what ? [`${file}: ${what}`] : []
  })
}

describe("every paid client call outside the executors is inside withRunInFlight", () => {
  it("or is allowed, with its reason and its count", { timeout: SCAN_TIMEOUT_MS }, () => {
    expect(verdict(scanAll(), EXECUTOR_FILES, ALLOWED)).toEqual([])
  })

  it("the reasons it can check still hold", { timeout: SCAN_TIMEOUT_MS }, () => {
    expect(brokenReasons(scanAll(), ALLOWED)).toEqual([])
  })

  it("finds the calls it is meant to police", { timeout: SCAN_TIMEOUT_MS }, () => {
    // A scan that silently stopped matching would pass everything.
    const scans = scanAll()
    const wrapped = (file: string) => scans.get(file)?.references.filter((r) => r.wrapped).map((r) => r.name) ?? []
    expect(wrapped("components/editor/character-page-modal.tsx").sort()).toEqual(["generateCharacterAsset", "generateCharacterAsset", "generateImage"])
    expect(wrapped("components/editor/object-page-modal.tsx").sort()).toEqual(["generateImage", "generateObjectAsset", "generateObjectAsset"])
    expect(wrapped("components/nodes/suno-voice-setup-modal.tsx")).toEqual(["sunoVoiceGenerateApi"])
    expect(wrapped("components/editor/config-panels/image-overlay-layer-editor.tsx")).toEqual(["suggestOverlayPlacement"])
    expect(scans.get("components/editor/workflow-editor/execute-node.ts")!.references.length).toBeGreaterThan(50)
  })
})

describe("the scanner", () => {
  const paid = new Set(["generateImage", "generateCharacterAsset"])
  const scan = (text: string, file = "components/editor/thing.tsx") => scanSource(file, text, paid)
  const outside = (text: string, file?: string) => scan(text, file).references.filter((r) => !r.wrapped).map((r) => r.name)
  const inside = (text: string, file?: string) => scan(text, file).references.filter((r) => r.wrapped).map((r) => r.name)
  const IMPORTS = `import { generateImage, getJobStatusLean } from "@/lib/api"\nimport { withRunInFlight } from "@/hooks/run-in-flight"\n`

  it("sees a paid call with no wrapper", () => {
    expect(outside(`${IMPORTS}async function go() { await generateImage("p") }`)).toEqual(["generateImage"])
  })

  it("accepts one inside the wrapper's callback, nested functions included", () => {
    const text = `${IMPORTS}withRunInFlight("n1", async () => {
      const again = () => generateImage("p")
      await generateImage("p"); await again()
    })`
    expect(inside(text)).toEqual(["generateImage", "generateImage"])
    expect(outside(text)).toEqual([])
  })

  it("accepts the wrapper under another name, and only the one imported from its module", () => {
    expect(inside(`import { generateImage } from "@/lib/api"\nimport { withRunInFlight as hold } from "../../hooks/run-in-flight"\nhold("n1", async () => generateImage("p"))`)).toEqual(["generateImage"])
    expect(outside(`import { generateImage } from "@/lib/api"\nconst withRunInFlight = (_: string, run: () => unknown) => run()\nwithRunInFlight("n1", async () => generateImage("p"))`)).toEqual(["generateImage"])
  })

  it("does not accept a call handed to the wrapper from elsewhere", () => {
    expect(outside(`${IMPORTS}const run = async () => generateImage("p")\nwithRunInFlight("n1", run)`)).toEqual(["generateImage"])
  })

  it("follows an alias, a destructured dynamic import and a relative import", () => {
    expect(outside(`import { generateImage as make } from "@/lib/api"\nmake("p")`)).toEqual(["generateImage"])
    expect(outside(`async function go() { const { generateImage: make, getJobStatusLean } = await import("@/lib/api"); await make("p") }`)).toEqual(["generateImage"])
    expect(outside(`import("@/lib/api").then(({ generateImage }) => generateImage("p"))`)).toEqual(["generateImage"])
    expect(outside(`import { generateCharacterAsset } from "./api"\ngenerateCharacterAsset({})`, "lib/thing.ts")).toEqual(["generateCharacterAsset"])
    expect(outside(`import { generateCharacterAsset } from "./api"\ngenerateCharacterAsset({})`, "components/thing.ts")).toEqual([])
  })

  it("follows the client taken whole, through each name it is asked for", () => {
    expect(outside(`import * as api from "@/lib/api"\napi.generateImage("p"); api.getJobStatusLean("j")`)).toEqual(["generateImage"])
    expect(outside(`async function go() { const api = await import("@/lib/api"); await api.generateImage("p") }`)).toEqual(["generateImage"])
    expect(outside(`import("@/lib/api").then((m) => m.generateImage("p"))`)).toEqual(["generateImage"])
    expect(inside(`${IMPORTS}withRunInFlight("n1", () => import("@/lib/api").then((m) => m.generateImage("p")))`)).toEqual(["generateImage"])
    expect(scan(`import("@/lib/api").then((m) => m.getAuthHeaders())`).imported).toEqual(["getAuthHeaders"])
  })

  it("records the call a paid call is handed to, and the keys of its request", () => {
    const [ref] = scan(`${IMPORTS}pollImageRefineToNode("n1", () => generateImage({ attachToCharacterId: "c1", variant }), "label")`).references
    expect(ref).toMatchObject({ name: "generateImage", wrapped: false, via: "pollImageRefineToNode", argKeys: ["attachToCharacterId", "variant"] })
  })

  it("counts the function handed on as a value", () => {
    expect(outside(`${IMPORTS}poll("n1", generateImage)`)).toEqual(["generateImage"])
  })

  it("ignores types, properties, other modules and free functions", () => {
    expect(outside(`${IMPORTS}type T = Parameters<typeof generateImage>
      type U = Parameters<typeof import("@/lib/api").generateImage>
      const o = { generateImage: 1 }; other.generateImage(); getJobStatusLean("j")`)).toEqual([])
    expect(outside(`import { generateImage } from "@/lib/other"\ngenerateImage("p")`)).toEqual([])
    expect(outside(`import type { generateImage } from "@/lib/api"\nlet x: typeof generateImage`)).toEqual([])
  })

  it("fails closed on an import of the client it cannot follow", () => {
    expect(scan(`import * as api from "@/lib/api"\nconst handOn = api`).unresolved).toHaveLength(1)
    expect(scan(`import("@/lib/api").then((m) => use(m))`).unresolved).toHaveLength(1)
    expect(scan(`async function go() { const { ...api } = await import("@/lib/api") }`).unresolved).toHaveLength(1)
    expect(scan(`void import("@/lib/api")`).unresolved).toHaveLength(1)
    expect(scan(`const api = require("@/lib/api")`).unresolved).toHaveLength(1)
    expect(scan(`import api from "@/lib/api"`).unresolved).toHaveLength(1)
    expect(scan(`export { generateImage } from "@/lib/api"`).unresolved).toHaveLength(1)
    expect(scan(`export * from "@/lib/api"`).unresolved).toHaveLength(1)
    expect(scan(`export { getJobStatusLean } from "@/lib/api"`).unresolved).toEqual([])
  })
})

describe("the checks an allowed reason can carry", () => {
  const ref = (over: Partial<Reference>): Reference => ({ name: "generateImage", line: 1, wrapped: false, via: null, argKeys: [], ...over })

  it("attachesToARow: every call names the entity row its result goes to", () => {
    expect(attachesToARow([ref({ argKeys: ["attachToCharacterId"] }), ref({ argKeys: ["entityDbId", "type"] })])).toBeNull()
    expect(attachesToARow([ref({ argKeys: ["attachToObjectId"] }), ref({ line: 9, argKeys: ["variant"] })])).toMatch(/names no entity row.*line 9/)
  })

  it("insideOf: every call is handed to the function named", () => {
    expect(insideOf("pollImageRefineToNode")([ref({ via: "pollImageRefineToNode" })])).toBeNull()
    expect(insideOf("pollImageRefineToNode")([ref({ via: "then" })])).toMatch(/outside `pollImageRefineToNode`/)
  })
})

describe("the verdict", () => {
  const call = (over: Partial<Reference> = {}): Reference => ({ name: "generateImage", line: 3, wrapped: false, via: null, argKeys: [], ...over })
  const scanOf = (references: Reference[], unresolved: string[] = []): Scan => ({ references, unresolved, imported: [] })
  const executors = new Map([["exec.ts", "an executor"]])
  const allowed = new Map<string, Allowed>([["dialog.tsx", { refs: 1, why: "stays in the dialog" }]])
  const judge = (scans: Record<string, Scan>) =>
    verdict(new Map(Object.entries({ "exec.ts": scanOf([call()]), "dialog.tsx": scanOf([call()]), ...scans })), executors, allowed)

  it("passes wrapped calls, executor files and allowed files at their count", () => {
    expect(judge({ "page.tsx": scanOf([call({ wrapped: true })]) })).toEqual([])
  })

  it("fails a paid call outside the wrapper in a file nobody allowed", () => {
    expect(judge({ "page.tsx": scanOf([call({ line: 7 })]) })).toEqual([expect.stringMatching(/^page\.tsx: a paid call outside withRunInFlight: generateImage \(line 7\)/)])
  })

  it("fails an allowed file whose count moved, either way", () => {
    expect(judge({ "dialog.tsx": scanOf([call(), call()]) })).toEqual([expect.stringMatching(/^dialog\.tsx: 2 paid calls outside withRunInFlight, 1 allowed/)])
    expect(judge({ "dialog.tsx": scanOf([call({ wrapped: true })]) })).toEqual([expect.stringMatching(/^dialog\.tsx: allowed, but holds no paid call/)])
  })

  it("fails an entry with nothing left to allow, executor files included", () => {
    expect(judge({ "exec.ts": scanOf([]) })).toEqual([expect.stringMatching(/^exec\.ts: allowed, but holds no paid call/)])
  })

  it("fails a use of the client it could not follow, wherever it is", () => {
    expect(judge({ "exec.ts": scanOf([call()], ["a re-export of the whole client at line 1"]) })).toEqual(["exec.ts: a re-export of the whole client at line 1"])
  })

  it("reports a reason that no longer holds", () => {
    const checked = new Map<string, Allowed>([["studio.tsx", { refs: 1, why: "attaches to a row", check: attachesToARow }]])
    expect(brokenReasons(new Map([["studio.tsx", scanOf([call({ argKeys: ["attachToCharacterId"] })])]]), checked)).toEqual([])
    expect(brokenReasons(new Map([["studio.tsx", scanOf([call({ argKeys: ["variant"] })])]]), checked)).toEqual([expect.stringMatching(/^studio\.tsx: a call that names no entity row/)])
  })
})
