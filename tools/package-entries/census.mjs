#!/usr/bin/env node
// Import-site census of the @nodaro/shared and @nodaro/prompts ROOTS: for every
// tracked frontend/backend/packages/tools file, the root symbols it imports and
// the index.ts-level module each comes from (today: the subpath entry that owns
// it, `./entries/<entry>.js` — i.e. the symbol → subpath map a codemod needs).
// Also: per-module importer counts by area, top co-imported module pairs,
// namespace imports and dynamic import()/vi.mock()/require() sites.
//
//   node tools/package-entries/census.mjs [outJson]   (default: census.json in cwd)
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const ts = createRequire(import.meta.url)("typescript")
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const out = path.resolve(process.argv[2] ?? "census.json")
const PKGS = Object.assign(Object.create(null), { "@nodaro/shared": "packages/shared", "@nodaro/prompts": "packages/prompts" })

function indexMap(pkgDir) {
  const indexFile = path.join(repo, pkgDir, "src/index.ts")
  const program = ts.createProgram([indexFile], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true,
  })
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(indexFile)
  const nameToMod = new Map()
  const modOrder = []
  const dupes = []
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st)) continue
    const spec = st.moduleSpecifier.text
    if (!modOrder.includes(spec)) modOrder.push(spec)
    let names
    if (st.exportClause && ts.isNamedExports(st.exportClause)) names = st.exportClause.elements.map((e) => e.name.text)
    else {
      const sym = checker.getSymbolAtLocation(st.moduleSpecifier)
      names = checker.getExportsOfModule(sym).map((s) => s.name)
    }
    for (const n of names) {
      if (nameToMod.has(n) && nameToMod.get(n) !== spec) dupes.push([n, nameToMod.get(n), spec])
      if (!nameToMod.has(n)) nameToMod.set(n, spec)
    }
  }
  return { nameToMod, modOrder, dupes }
}

const maps = Object.fromEntries(Object.entries(PKGS).map(([p, d]) => [p, indexMap(d)]))

const files = execSync("git ls-files frontend backend packages tools", { cwd: repo, encoding: "utf8" })
  .split("\n").filter((f) => /\.(m?[jt]sx?|cts|cjs)$/.test(f) && !f.includes("/dist/"))

const result = {}
for (const p of Object.keys(PKGS)) result[p] = { perFile: {}, unknown: new Set(), namespace: [], dynamic: [] }

for (const f of files) {
  const text = fs.readFileSync(path.join(repo, f), "utf8")
  if (!text.includes("@nodaro/shared") && !text.includes("@nodaro/prompts")) continue
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : undefined)
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text
      if (PKGS[spec]) {
        const r = result[spec]
        const names = []
        if (ts.isImportDeclaration(node)) {
          const c = node.importClause
          if (!c) names.push("<side-effect>")
          else {
            if (c.name) names.push("<default>")
            if (c.namedBindings) {
              if (ts.isNamespaceImport(c.namedBindings)) { names.push("*"); r.namespace.push(f) }
              else for (const e of c.namedBindings.elements) names.push((e.propertyName ?? e.name).text)
            }
          }
        } else {
          if (!node.exportClause) { names.push("*"); r.namespace.push(f) }
          else if (ts.isNamedExports(node.exportClause)) for (const e of node.exportClause.elements) names.push((e.propertyName ?? e.name).text)
          else { names.push("*"); r.namespace.push(f) }
        }
        ;(r.perFile[f] ??= new Set()); for (const n of names) r.perFile[f].add(n)
      }
    }
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0]) && PKGS[node.arguments[0].text]) {
      const spec = node.arguments[0].text
      result[spec].dynamic.push(`${f}:${node.expression.getText(sf)}`)
    }
    if (ts.isImportTypeNode?.(node) && ts.isLiteralTypeNode(node.argument) && PKGS[node.argument.literal.text]) {
      const spec = node.argument.literal.text
      const q = node.qualifier ? node.qualifier.getText(sf).split(".")[0] : "*"
      ;(result[spec].perFile[f] ??= new Set()).add(q)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

const summary = {}
for (const [p, r] of Object.entries(result)) {
  const { nameToMod, modOrder, dupes } = maps[p]
  const modFiles = Object.fromEntries(modOrder.map((m) => [m, { total: 0, frontend: 0, backend: 0, packages: 0, tools: 0 }]))
  const co = {}
  const fileMods = {}
  for (const [f, names] of Object.entries(r.perFile)) {
    const mods = new Set()
    for (const n of names) {
      if (n === "*" || n.startsWith("<")) continue
      const m = nameToMod.get(n)
      if (!m) { r.unknown.add(`${n} (${f})`); continue }
      mods.add(m)
    }
    fileMods[f] = [...mods]
    const area = f.split("/")[0]
    for (const m of mods) { modFiles[m].total++; modFiles[m][area]++ }
    const arr = [...mods]
    for (const a of arr) for (const b of arr) if (a < b) { const k = `${a}|${b}`; co[k] = (co[k] ?? 0) + 1 }
  }
  summary[p] = {
    importingFiles: Object.keys(r.perFile).length,
    namespaceImports: r.namespace, dynamic: r.dynamic, unknownNames: [...r.unknown],
    indexDupes: dupes, modOrder,
    modFiles, topCo: Object.entries(co).sort((a, b) => b[1] - a[1]).slice(0, 150), fileMods,
    nameToMod: Object.fromEntries(nameToMod),
  }
}
fs.writeFileSync(out, JSON.stringify(summary, null, 1))
for (const [p, s] of Object.entries(summary)) {
  console.log(`== ${p}: ${s.importingFiles} importing files, ${s.modOrder.length} index modules, ${Object.keys(s.nameToMod).length} names`)
  console.log(`  namespace/star: ${s.namespaceImports.length}, dynamic/mock: ${s.dynamic.length}, unknown names: ${s.unknownNames.length}, index dupes: ${s.indexDupes.length}`)
}
