// tools/test-select/package-symbols.mjs
// Symbol-level selection for @nodaro/shared (§5.8 A2a, decided 2026-10-15:
// an engine-only index, no public API change). Every app module imports a few
// names from the package, yet any source change in it selected every test that
// loads its build (73 % of frontend, 62 % of backend). Here a change to a
// module of packages/shared/src affects only the names exported by the modules
// that (transitively) import it — and a test is selected through the package
// only if it, or an app module it loads, imports one of those names.
// Pure; built-ins only. Every doubt returns null: the package rule stands.
import { memoBySource } from "./source-memo.mjs"

const PACKAGE = "@nodaro/shared"
const SRC = "packages/shared/src/"

// Relative specifiers inside the package: static, re-export, literal dynamic.
const RELATIVE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g
// A dynamic import whose specifier is a template with a substitution.
const TEMPLATE_IMPORT = /\bimport\s*\(\s*`(\.{1,2}\/[^`]*\$\{[^`]*)`/g

function resolve(importer, spec) {
  const stack = importer.split("/").slice(0, -1)
  for (const part of spec.split("/")) {
    if (part === "..") stack.pop()
    else if (part !== ".") stack.push(part)
  }
  return stack.join("/").replace(/\.(?:js|mjs|ts)$/, "")
}
const stem = (p) => p.replace(/\.(?:ts|tsx|mts)$/, "").replace(/\/index$/, "")

// Names a module exports by declaration or `export { … }` (re-exports
// included); `export *` is followed through the importer graph instead.
export function exportedNames(source) {
  const names = new Set()
  for (const m of source.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|abstract\s+class|enum|const\s+enum|type|interface|namespace)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim()
      if (name && name !== "default") names.add(name)
    }
  }
  return names
}

// A top-level call (`registerX(…)`) can change what OTHER names do: no narrowing.
const TOP_LEVEL_EFFECT = /^(?!export\b|import\b|const\b|let\b|var\b|function\b|async\b|class\b|abstract\b|type\b|interface\b|enum\b|declare\b|namespace\b)[A-Za-z_$][\w$.]*\s*\(/m

// files: [{ path, source }] — every non-test source of packages/shared/src.
// changed: repo paths under it. Returns the Set of exported names a change can
// reach, or null when it cannot tell.
export function affectedNames(files, changed) {
  const byStem = new Map(files.map((f) => [stem(f.path), f]))
  const importers = new Map() // stem → Set of importer paths
  const templates = []
  for (const f of files) {
    for (const m of f.source.matchAll(RELATIVE)) {
      const target = stem(resolve(f.path, m[1]))
      if (!importers.has(target)) importers.set(target, new Set())
      importers.get(target).add(f.path)
    }
    for (const m of f.source.matchAll(TEMPLATE_IMPORT)) {
      const parts = resolve(f.path, m[1].replace(/\$\{[^}]*\}/g, "\u0000")).split("\u0000")
      templates.push({ importer: f.path, pattern: new RegExp(`^${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}(?:\\.(?:js|ts))?$`) })
    }
  }
  const reached = new Set()
  const queue = []
  for (const path of changed) {
    if (!path.startsWith(SRC)) return null
    const f = files.find((x) => x.path === path)
    if (!f) return null // added, removed or unreadable
    if (TOP_LEVEL_EFFECT.test(f.source)) return null
    queue.push(path)
  }
  while (queue.length) {
    const path = queue.shift()
    if (reached.has(path)) continue
    reached.add(path)
    const s = stem(path)
    for (const importer of importers.get(s) ?? []) queue.push(importer)
    for (const t of templates) if (t.pattern.test(s) || t.pattern.test(path)) queue.push(t.importer)
  }
  const names = new Set()
  for (const path of reached) for (const n of exportedNames(byStem.get(stem(path))?.source ?? "")) names.add(n)
  return names
}

// The names a module imports from the package (any subpath), or "*" when it
// takes the whole namespace or imports it in a way we cannot read. Memoised
// per source (source-memo.mjs; every test asks about every module it loads);
// each caller gets its own copy of the Set.
const importedNamesOf = memoBySource("importedNames", importedNamesUncached, { freeze: false })
export function importedNames(source) {
  const names = importedNamesOf(source)
  return names instanceof Set ? new Set(names) : names
}
function importedNamesUncached(source) {
  if (!source.includes(PACKAGE)) return null
  const names = new Set()
  const spec = `["']${PACKAGE}(?:/[^"']*)?["']`
  for (const m of source.matchAll(new RegExp(`\\b(?:import|export)\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*${spec}`, "g"))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim()
      if (name) names.add(name)
    }
  }
  const any = new RegExp(spec, "g")
  const named = [...source.matchAll(new RegExp(`\\b(?:import|export)\\s+(?:type\\s+)?\\{[^}]*\\}\\s*from\\s*${spec}`, "g"))].length
  const mentions = [...source.matchAll(any)].length
  // a namespace/default import, `export *`, import(), require(), vi.mock(…) of
  // the package: everything it exports may be used
  if (mentions !== named) return "*"
  return names
}
