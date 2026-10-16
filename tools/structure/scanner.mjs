// tools/structure/scanner.mjs
// Static VALUE-import scanner shared by the structure ratchets (see README.md).
// It answers one question — "which of our own source files does this file load
// at run time?" — with the TypeScript parser, not a regex, so aliases,
// multi-line statements, comments and strings can not fool it.
//
// Counted: `import … from`, `import "x"`, `export … from`, `export * from`,
// `import x = require()`, literal `import("x")`, literal `require("x")`,
// `vi.importActual("x")` / `vi.importMock("x")`.
// Not counted: `import type` / `export type`, an import whose every binding is
// `type`-modified, an import in a TypeScript file whose bindings are never used
// as a VALUE (neither tsconfig sets `verbatimModuleSyntax`, so the compiler and
// esbuild both drop those and Vitest's own graph never sees them — a JS file
// keeps every import), `import("x").T` type queries, computed `import(expr)`,
// `vi.mock()`.
// Resolved: relative paths with `.js`→`.ts`/`.tsx` mapping, directory `index`
// files, and the tsconfig `paths` aliases (`@/`). node_modules and workspace
// packages (`@nodaro/*`) are outside the scanned tree and ignored by design.
//
// Pure: no file system. project-scan.mjs walks the tree and feeds it the
// sources, so the unit tests run on in-memory fixtures.
import { posix } from "node:path"
import { TEST_FILE, isTestSideHelper } from "../test-select/test-node.mjs"

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/
const DECLARATION = /\.d\.[cm]?ts$/

export const isSourceFile = (path) => SOURCE_EXT.test(path) && !DECLARATION.test(path)
export const isTestFile = (path) => TEST_FILE.test(path)
// A product file is one that ships: not a test and not a test-side helper.
export const isProductFile = (path) => !isTestFile(path) && !isTestSideHelper(path)

const scriptKindFor = (ts, path) => {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

const stringArg = (ts, call) => {
  const a = call.arguments[0]
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null
}

/**
 * The module specifiers a file loads at run time, in source order, de-duplicated.
 * @param {typeof import("typescript")} ts
 */
export function valueSpecifiers(ts, path, text) {
  const kind = scriptKindFor(ts, path)
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  // Only TypeScript elides an import nothing uses as a value.
  const elides = kind === ts.ScriptKind.TS || kind === ts.ScriptKind.TSX
  const direct = new Set()
  // `import a, { b } from "x"` — loaded only if a binding is used as a value.
  const conditional = []
  const used = new Set()

  const visit = (node, inType) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (!ts.isStringLiteral(node.moduleSpecifier)) return
      const spec = node.moduleSpecifier.text
      if (!clause) { direct.add(spec); return }
      if (clause.isTypeOnly) return
      const names = []
      if (clause.name) names.push(clause.name.text)
      const nb = clause.namedBindings
      if (nb && ts.isNamespaceImport(nb)) names.push(nb.name.text)
      else if (nb) for (const el of nb.elements) if (!el.isTypeOnly) names.push(el.name.text)
      if (names.length > 0) conditional.push({ spec, names })
      return
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)
        && ts.isStringLiteral(node.moduleReference.expression)) {
        conditional.push({ spec: node.moduleReference.expression.text, names: [node.name.text] })
      }
      return
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        const ne = node.exportClause
        const allType = ne && ts.isNamedExports(ne) && ne.elements.length > 0 && ne.elements.every((e) => e.isTypeOnly)
        if (!allType) direct.add(node.moduleSpecifier.text)
      }
      // `export { a }` (no module) reads a local binding: a use.
      if (!node.moduleSpecifier) ts.forEachChild(node, (c) => visit(c, false))
      return
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const spec = stringArg(ts, node)
      if (spec !== null) {
        if (callee.kind === ts.SyntaxKind.ImportKeyword) direct.add(spec)
        else if (ts.isIdentifier(callee) && callee.text === "require") direct.add(spec)
        else if (ts.isPropertyAccessExpression(callee) && (callee.name.text === "importActual" || callee.name.text === "importMock")) direct.add(spec)
      }
    }
    if (ts.isIdentifier(node)) {
      if (!inType) used.add(node.text)
      return
    }
    // A type position loads nothing — except `class A extends B`, which is a value.
    let childInType = inType
    if (ts.isTypeNode(node)) {
      const isClassExtends = ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent)
        && node.parent.token === ts.SyntaxKind.ExtendsKeyword && !ts.isInterfaceDeclaration(node.parent.parent)
      if (!isClassExtends) childInType = true
    }
    ts.forEachChild(node, (c) => visit(c, childInType))
  }
  visit(sf, false)

  for (const { spec, names } of conditional) if (!elides || names.some((n) => used.has(n))) direct.add(spec)
  return [...direct]
}

const JS_TO_TS = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] }
const TRY_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]
const INDEX = ["index.ts", "index.tsx", "index.js", "index.jsx"]

/**
 * `aliases`: [{ pattern: "@/*", target: "frontend/src/*" }] — repo-relative, one `*`.
 * @param {Set<string>} files repo-relative POSIX paths of every scanned file
 */
export function createResolver(files, aliases = []) {
  const tryPath = (p) => {
    if (files.has(p)) return p
    const m = /\.[cm]?jsx?$/.exec(p)
    if (m && JS_TO_TS[m[0]]) {
      for (const e of JS_TO_TS[m[0]]) { const c = p.slice(0, -m[0].length) + e; if (files.has(c)) return c }
    }
    for (const e of TRY_EXT) if (files.has(p + e)) return p + e
    for (const i of INDEX) if (files.has(posix.join(p, i))) return posix.join(p, i)
    return null
  }
  return (from, rawSpec) => {
    const spec = rawSpec.replace(/[?#].*$/, "")
    if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
      return tryPath(posix.normalize(posix.join(posix.dirname(from), spec)).replace(/\/$/, ""))
    }
    for (const { pattern, target } of aliases) {
      const star = pattern.indexOf("*")
      if (star < 0) { if (spec === pattern) { const r = tryPath(target); if (r) return r } continue }
      const pre = pattern.slice(0, star)
      const suf = pattern.slice(star + 1)
      if (spec.length >= pre.length + suf.length && spec.startsWith(pre) && spec.endsWith(suf)) {
        const hit = tryPath(posix.normalize(target.replace("*", spec.slice(pre.length, spec.length - suf.length))))
        if (hit) return hit
      }
    }
    return null
  }
}

/**
 * The value-import graph of one set of files.
 * @param {Map<string,string>} sources path → text
 * @returns {{ files: string[], edges: Map<string,string[]> }}
 */
export function buildGraph(ts, sources, aliases = []) {
  const files = [...sources.keys()].sort()
  const resolve = createResolver(new Set(files), aliases)
  const edges = new Map()
  for (const f of files) {
    const out = new Set()
    for (const spec of valueSpecifiers(ts, f, sources.get(f))) {
      const to = resolve(f, spec)
      if (to && to !== f) out.add(to)
    }
    edges.set(f, [...out].sort())
  }
  return { files, edges }
}
