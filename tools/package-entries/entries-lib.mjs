// Shared helpers for the subpath-entry guards of the published packages
// (@nodaro/shared, @nodaro/prompts). Used by each package's
// src/__tests__/package-entries*.test.ts and by root-exports-snapshot.mjs.
//
// Everything here reads either the package SOURCE (the static import graph of
// an entry) or the BUILT dist (what a consumer actually resolves) — never a
// hand-kept list.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/**
 * Every name (values AND types) each declaration file exports, resolved through
 * re-exports and shared declaration chunks. One TS program for all the files.
 * Returns { [file]: sortedNames }.
 */
export function declaredExportNamesOf(dtsFiles) {
  const program = ts.createProgram(dtsFiles, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  })
  const checker = program.getTypeChecker()
  const out = {}
  for (const file of dtsFiles) {
    const sf = program.getSourceFile(file)
    if (!sf) throw new Error(`declaration file not found: ${file}`)
    const sym = checker.getSymbolAtLocation(sf)
    out[file] = sym ? checker.getExportsOfModule(sym).map((s) => s.name).sort() : []
  }
  return out
}

/** Every name (values AND types) one declaration file exports. */
export function declaredExportNames(dtsFile) {
  return declaredExportNamesOf([dtsFile])[dtsFile]
}

/** The package's src/entries/*.ts names (without extension), sorted. */
export function entryNames(pkgDir) {
  const dir = path.join(pkgDir, 'src', 'entries')
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)).sort()
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''))
  const hit = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((c) => fs.existsSync(c))
  if (!hit) throw new Error(`unresolved import "${spec}" from ${fromFile}`)
  return hit
}

function isErasedAtRuntime(st) {
  if (ts.isImportDeclaration(st)) {
    const c = st.importClause
    if (!c) return false // bare side-effect import — always kept
    if (c.isTypeOnly) return true
    const nb = c.namedBindings
    return !c.name && !!nb && ts.isNamedImports(nb) && nb.elements.length > 0 && nb.elements.every((e) => e.isTypeOnly)
  }
  if (ts.isExportDeclaration(st)) {
    if (st.isTypeOnly) return true
    const ec = st.exportClause
    return !!ec && ts.isNamedExports(ec) && ec.elements.length > 0 && ec.elements.every((e) => e.isTypeOnly)
  }
  return false
}

const depCache = new Map()

/** Relative modules a source file loads AT RUNTIME (type-only imports/exports are erased). */
export function runtimeDeps(file) {
  const hit = depCache.get(file)
  if (hit) return hit
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
  const out = []
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text
      if (spec.startsWith('.') && !isErasedAtRuntime(node)) out.push(resolveRelative(file, spec))
    }
  }
  sf.statements.forEach(visit)
  depCache.set(file, out)
  return out
}

/** Transitive runtime closure of a source file inside its package (absolute paths). */
export function runtimeClosure(file) {
  const seen = new Set()
  const stack = [path.resolve(file)]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    stack.push(...runtimeDeps(f))
  }
  return seen
}
