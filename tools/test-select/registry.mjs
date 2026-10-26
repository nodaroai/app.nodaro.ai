// tools/test-select/registry.mjs
// The registry rule (§5.8 B, decided 2026-10-16). Node units
// (frontend/src/nodes/<type>/, backend/src/nodes/<type>/) are collected into
// generated aggregates (`_generated/`), and central composers spread those
// aggregates into the collections the product reads (NODE_DEFINITIONS,
// NODE_OPTIONS, …). Every test that imports a composer therefore reaches
// every unit — so without this rule a one-line edit inside one unit selects
// every test that imports any registry.
//
// The rule: an aggregate's import of a member file (`@registry <glob>`) is a
// MEMBER edge. A file INSIDE a unit folder that a test reaches ONLY through
// member edges (its `viaRegistry`) does not select the test by "imports".
// Instead the test is selected, for the registry R it reaches the file
// through and the unit U the file belongs to, when
//   (a) it reaches an ENUMERATOR of R — a product module that names one of
//       R's exports, is not a declared pass-through composer and does not
//       declare `@registry-lookup` (the safety argument: any test reaching
//       code that iterates the collection still runs). A composer that reads
//       every unit of R WHILE IT LOADS (registry-composers.json `foldsAtLoad`:
//       it validates or folds the collection at module evaluation, so one
//       broken unit fails every test that imports it) is an enumerator of R,
//       never a pass-through — decided 2026-10-18;
//   (b) it names U's type id as a string literal (a payload test feeding that node);
//   (c) it names one of R's exports itself and declares neither
//       `@test-units-by-name` nor `@test-always`, nor a `@test-watches` that
//       covers the changed file — the G4 burn-down, counted as needing every unit;
//   (d) the changed module did not pass G7's AST check (cli.mjs, with the
//       same predicate as frontend/src/__tests__/node-units-structure.test.ts),
//       or could not be checked — then every test that reaches R.
// A file outside the unit folders is never narrowed, even when only units
// reach it: nothing holds it to declarations only.
// A diff to an aggregate made only of `// unit:<type>` lines (a member added
// or removed) is narrowed the same way, with U = those types.
//
// Its own shadow period: until the repository variable
// TEST_SELECT_REGISTRY_RULE is exactly `enforce`, the rule only computes a
// second list (recorded, and checked against failures as "Registry-rule
// miss"); the selection itself stays today's. Pure: graph.mjs feeds it.
import { matchesAny } from "./glob.mjs"
import { parseRegistryAnnotations } from "./annotations.mjs"
import { memoBySource } from "./source-memo.mjs"
import { sideEffectProblems } from "../units/structure.mjs"

/** The aggregates' directories (tools/units/seams.mjs GENERATED_DIRS). */
export const AGGREGATE_FILE = /^(?:frontend|backend)\/src\/(?:ee\/)?nodes\/_generated\/[^/]+\.[cm]?[jt]sx?$/
const UNIT_FILE = /^(?:frontend|backend)\/src\/nodes\/([a-z][a-z0-9-]*)\//

/** The unit a repo path belongs to (its folder name), or null. */
export function unitOf(path) {
  const m = path.match(UNIT_FILE)
  return m && m[1] !== "_generated" ? m[1] : null
}

/**
 * Rule (d)'s input for one changed file: false only for a module INSIDE a unit
 * folder that passes G7's own AST check (sideEffectProblems — the predicate
 * frontend/src/__tests__/node-units-structure.test.ts enforces). undefined —
 * unknown, which never narrows — without TypeScript, for unreadable text, and
 * for every file outside a unit (the engine never narrows those).
 */
export function sideEffectsOf(ts, path, text) {
  if (!ts || text == null || !unitOf(path)) return undefined
  return sideEffectProblems(ts, path, text).length > 0
}

export const registryRuleMode = (value) => (value === "enforce" ? "enforce" : "shadow")

/**
 * The registries of a tree, from its aggregates and composers.
 * `files`: [{ path, source }] — every aggregate (each declares its own
 * `@registry` / `@registry-exports` header: it is generated). `composers`:
 * the `composers` map of tools/units/registry-composers.json — path →
 * { exports: { <aggregate id>: [names] } } — the names each reviewed composer
 * re-exports a composed collection through (an array of paths is accepted
 * too). A composer's own `@registry-exports` comment, if it carries one, is
 * read as well. A registry the entry lists in `foldsAtLoad` (the composer
 * reads every unit of it while it loads) is NOT a pass-through: its names
 * still join `exportsById`, and the composer is that registry's enumerator.
 * Returns
 *   aggregates:  Map<path, { id, members: glob[], names: string[] }>
 *   composers:   Map<path, Set<id>> — a pass-through for the registries it exports and does not fold at load (only those)
 *   folds:       Map<path, Set<id>> — the registries it folds at load (an enumerator of each)
 *   exportsById: Map<id, Set<name>>
 */
export function collectRegistries(files, composers = {}) {
  const aggregates = new Map()
  const passThrough = new Map()
  const folds = new Map()
  const exportsById = new Map()
  const add = (id, names) => {
    if (!exportsById.has(id)) exportsById.set(id, new Set())
    for (const n of names) exportsById.get(id).add(n)
  }
  const listed = Array.isArray(composers) ? Object.fromEntries(composers.map((c) => [c, {}])) : composers
  const folded = (path, id) => (listed[path]?.foldsAtLoad ?? []).includes(id)
  const classify = (path, id) => {
    const into = folded(path, id) ? folds : passThrough
    if (!into.has(path)) into.set(path, new Set())
    into.get(path).add(id)
  }
  for (const [path, entry] of Object.entries(listed)) {
    for (const [id, names] of Object.entries(entry?.exports ?? {})) {
      add(id, names)
      classify(path, id)
    }
    for (const id of entry?.foldsAtLoad ?? []) classify(path, id)
  }
  for (const { path, source } of files) {
    if (source == null) continue
    const a = parseRegistryAnnotations(source)
    for (const e of a.exports) add(e.aggregate, e.names)
    if (AGGREGATE_FILE.test(path) && a.members.length) {
      const own = a.exports[0]
      aggregates.set(path, { id: own?.aggregate ?? path, members: a.members, names: own?.names ?? [] })
    } else if (Object.hasOwn(listed, path) && a.exports.length) {
      for (const e of a.exports) classify(path, e.aggregate)
    }
  }
  return { aggregates, composers: passThrough, folds, exportsById }
}

const escape = (s) => s.replace(/[$]/g, "\\$")
const UPPER = /^[A-Z][A-Z0-9_]*$/

const OPEN = { "{": "}", "[": "]", "(": ")" }
const CLOSE = { "}": "{", "]": "[", ")": "(" }
/** How far a bracket walk goes before it gives up (the legacy capture then stands). */
const MAX_WALK = 20000

/**
 * `source` with every comment blanked and, with `strings`, the inside of every
 * string and template literal too (quotes kept) — the same length, so offsets
 * hold; line breaks are kept. A '…' or "…" literal ends at its line's end.
 * Regex literals are not recognised: a misread only blanks text, so a reader
 * of the result finds less there, never more — and the legacy captures in
 * bindingsOf are its floor.
 */
function blanked(source, strings) {
  const out = source.split("")
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
      const line = source[i + 1] === "/"
      let e = line ? source.indexOf("\n", i) : source.indexOf("*/", i + 2)
      e = e < 0 ? source.length : line ? e : e + 2
      blank(i, e)
      i = e - 1
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      for (; j < source.length && source[j] !== c; j++) {
        if (source[j] === "\\") j++
        else if (c !== "`" && source[j] === "\n") break
      }
      if (strings) blank(i + 1, Math.min(j, source.length))
      i = j
    }
  }
  return out.join("")
}

/** In blanked `code`: the index of the `}` closing the `{` at `open`, or -1. */
function matchingBrace(code, open) {
  const stack = []
  for (let i = open; i < code.length && i - open < MAX_WALK; i++) {
    const c = code[i]
    if (OPEN[c]) stack.push(OPEN[c])
    else if (CLOSE[c]) {
      if (stack.pop() !== c) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

/**
 * In blanked `code`: the [start, end) of the inside of the object pattern that
 * ends right before the `=` at `eq` (`{ a, b: { c } } = …` → ` a, b: { c } `),
 * or null when what precedes the `=` is not a closing `}` or the walk back to
 * its `{` fails.
 */
function patternBefore(code, eq) {
  let i = eq - 1
  while (i >= 0 && /\s/.test(code[i])) i--
  if (code[i] !== "}") return null
  const stack = []
  for (let j = i; j >= 0 && i - j < MAX_WALK; j--) {
    const c = code[j]
    if (CLOSE[c]) stack.push(CLOSE[c])
    else if (OPEN[c]) {
      if (stack.pop() !== c) return null
      if (stack.length === 0) return [j + 1, i]
    }
  }
  return null
}

/**
 * The module's export names an object pattern reads: the key of each
 * top-level property (`a`, `a: b`, `a: { b }`, `a = 1`, `"a": b`), never a
 * nested pattern's keys (those are properties of the export, not exports). A
 * `...rest` element is the module object minus the named keys — a namespace.
 * A computed key (`[k]: v`) names nothing. `code` is the pattern with comments
 * and string contents blanked (it decides the top-level commas), `text` the
 * same span with only comments blanked (it holds a quoted key).
 */
function takePattern(code, text, bound, namespaces) {
  let depth = 0
  let from = 0
  const take = (to) => {
    const p = text.slice(from, to).trim()
    const rest = p.match(/^\.\.\.\s*([\w$]+)$/)
    if (rest) namespaces.add(rest[1])
    const key = !rest && p.match(/^(?:([\w$]+)|"([^"]*)"|'([^']*)')\s*(?:[:=]|$)/)
    if (key) bound.add(key[1] ?? key[2] ?? key[3])
  }
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (OPEN[c]) depth++
    else if (CLOSE[c]) depth--
    else if (c === "," && depth === 0) {
      take(i)
      from = i + 1
    }
  }
  take(code.length)
}

/**
 * The bindings a module makes of other modules' exports: `bound` (names
 * imported or destructured by name) and `namespaces` (module objects). Memoised
 * per distinct source (source-memo.mjs): enumeratorsIn asks once per registry
 * for every module of every test that reaches an aggregate, and the tests share
 * their modules. The Sets are this module's own: namesUsed only reads them.
 */
const bindingsOf = memoBySource("bindingsOf", (source) => {
  const bound = new Set()
  // Namespace bindings: `import * as m from …`, the module object of a
  // dynamic import / vi.importActual, and the `...rest` of a destructured one —
  // `m.nodeTypes` counts for any name.
  const namespaces = new Set()
  const take = (list) => {
    for (const part of list.split(",")) {
      const p = part.trim().replace(/^type\s+/, "\0")
      if (!p || p.startsWith("\0")) continue
      const original = p.split(/\s+as\s+/)[0].split(":")[0].trim()
      bound.add(original)
    }
  }
  for (const m of source.matchAll(/\bimport\s+(?!type\b)(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\b/g)) take(m[1])
  for (const m of source.matchAll(/\bexport\s+(?!type\b)\{([^}]*)\}\s*from\b/g)) take(m[1])
  // A destructured dynamic import is read as a balanced pattern, with comments
  // and string contents blanked so a bracket inside them does not count:
  //   `const { X, Y: y, Z = 1, ...rest } = await import(…)` (or vi.importActual,
  //   vi.importMock, importOriginal) — anchored on the import, the pattern is
  //   the `{…}` that ends just before its `=`, read back from there;
  //   `import(…).then(({ X }) => …)` (also `async`, or a typed parameter).
  const text = blanked(source, false)
  const code = blanked(source, true)
  for (const m of code.matchAll(/=\s*(?:await\s+)?(?:import|vi\.importActual|vi\.importMock|importOriginal)\b/g)) {
    const span = patternBefore(code, m.index)
    if (span) takePattern(code.slice(...span), text.slice(...span), bound, namespaces)
  }
  for (const m of code.matchAll(/\bimport\s*\([^)]*\)\s*\.then\(\s*(?:async\s*)?\(\s*(?=\{)/g)) {
    const open = m.index + m[0].length
    const close = matchingBrace(code, open)
    if (close >= 0 && /^\s*(?::[^)]*)?\)\s*=>/.test(code.slice(close + 1, close + 200))) takePattern(code.slice(open + 1, close), text.slice(open + 1, close), bound, namespaces)
  }
  // The legacy captures are the floor: whatever the reader above makes of a
  // site, a name these took still counts. (A brace-free class starts at any
  // earlier open brace — a function body — and swallows the first name, which
  // is why it is not the reader.)
  for (const m of source.matchAll(/\{([^}]*)\}\s*=\s*(?:await\s+)?(?:import|vi\.importActual)\b/g)) take(m[1])
  for (const m of source.matchAll(/\bimport\s*\([^)]*\)\s*\.then\(\s*\(\s*\{([^}]*)\}\s*\)\s*=>/g)) take(m[1])
  for (const m of source.matchAll(/\bimport\s+\*\s+as\s+([\w$]+)\s+from\b/g)) namespaces.add(m[1])
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:import\s*\(|vi\.importActual\b|vi\.importMock\b|importOriginal\b)/g)) namespaces.add(m[1])
  // `import(…).then((m) => m.x)`
  for (const m of source.matchAll(/\bimport\s*\([^)]*\)\s*\.then\(\s*(?:\(\s*)?([\w$]+)\s*\)?\s*=>/g)) namespaces.add(m[1])
  // `(await import(…)).x`, `(await importOriginal()).x`, `(await vi.importActual(…)).x` —
  // also with a type argument, which may itself hold parentheses:
  // `(await vi.importActual<typeof import("x")>("x")).x`.
  for (const m of source.matchAll(/\(\s*await\s+(?:import|importOriginal|vi\.importActual|vi\.importMock)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*\)\s*\.\s*([\w$]+)/g)) bound.add(m[1])
  return { bound, namespaces }
}, { freeze: false })

// Whether a module uses one name: a pure function of (source, name), so each
// source keeps the verdicts it was asked for — the member-read RegExps scan
// the whole text, once per registry export, for every test that loads it.
const nameVerdictsOf = memoBySource("nameVerdicts", () => new Map(), { freeze: false })
function usesName(source, n) {
  const { bound, namespaces } = bindingsOf(source)
  if (bound.has(n)) return true
  if (UPPER.test(n) && new RegExp(`\\.${escape(n)}\\b`).test(source)) return true
  return [...namespaces].some((ns) => new RegExp(`\\b${escape(ns)}\\??\\.${escape(n)}\\b`).test(source))
}

/**
 * Which of `names` a module uses. A name counts when the module imports it by
 * name (`import { X }`, `import { X as Y }`, `export { X } from`, a destructured
 * dynamic import) — so a local variable that happens to share a generic name
 * (`nodeTypes`) never counts — or, for an UPPER_SNAKE name, reads it as a
 * member (`ns.X`, `actual.X` after `vi.importActual`). Type-only imports do
 * not count: a type cannot enumerate anything at run time.
 */
export function namesUsed(source, names) {
  const used = new Set()
  if (!source || names.size === 0) return used
  const verdicts = nameVerdictsOf(source)
  for (const n of names) {
    if (!verdicts.has(n)) verdicts.set(n, usesName(source, n))
    if (verdicts.get(n)) used.add(n)
  }
  return used
}

/**
 * The cut of one test's closure. `adjacency`: Map<file, file[]> of the test's
 * imports (the same walk as its deps); `aggregates` as from collectRegistries;
 * `excluded`: factory-mocked files the walk never enters. Returns
 *   cutDeps: Set — what the test reaches without crossing a member edge
 *   via: Map<file, { registries: Set<id>, units: Set<type> }> — reached ONLY through member edges
 */
export function registryClosure(adjacency, root, aggregates, excluded = new Set()) {
  const isMember = (from, to) => {
    const agg = aggregates.get(from)
    return Boolean(agg) && matchesAny(to, agg.members)
  }
  const cutDeps = new Set()
  const stack = [root]
  while (stack.length) {
    const f = stack.pop()
    if (cutDeps.has(f) || excluded.has(f)) continue
    cutDeps.add(f)
    for (const t of adjacency.get(f) ?? []) if (!isMember(f, t)) stack.push(t)
  }
  const via = new Map()
  for (const [agg, info] of aggregates) {
    if (!cutDeps.has(agg)) continue
    for (const member of (adjacency.get(agg) ?? []).filter((t) => isMember(agg, t))) {
      const unit = unitOf(member)
      const seen = new Set()
      const todo = [member]
      while (todo.length) {
        const f = todo.pop()
        if (seen.has(f) || excluded.has(f) || cutDeps.has(f)) continue
        seen.add(f)
        if (!via.has(f)) via.set(f, { registries: new Set(), units: new Set() })
        via.get(f).registries.add(info.id)
        if (unit) via.get(f).units.add(unit)
        for (const t of adjacency.get(f) ?? []) todo.push(t)
      }
    }
  }
  cutDeps.delete(root)
  return { cutDeps, via }
}

/**
 * The enumerators among a test's product modules: per registry id, the first
 * module (sorted) that names one of its exports, is not a pass-through
 * composer OF THAT REGISTRY (a composer of another one is classified like any
 * module), is not an aggregate or a unit file, and does not declare
 * `@registry-lookup` — or a composer that folds that registry at load
 * (`folds`), whatever it names or declares: loading it reads every unit.
 * `files`: [{ path, source }] of the test's cutDeps.
 */
export function enumeratorsIn(files, registries) {
  const out = {}
  for (const { path, source } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (AGGREGATE_FILE.test(path) || unitOf(path)) continue
    for (const id of registries.folds?.get(path) ?? []) out[id] ??= path
    if (source == null) continue
    if (parseRegistryAnnotations(source).lookup) continue
    const passesThrough = registries.composers.get(path) ?? new Set()
    for (const [id, names] of registries.exportsById) {
      if (out[id] || passesThrough.has(id)) continue
      if (namesUsed(source, names).size) out[id] = path
    }
  }
  return out
}

/** Registry id → the exports of it a source names. */
export function registryNamesIn(sources, exportsById) {
  const out = {}
  for (const [id, names] of exportsById) {
    const used = new Set()
    for (const s of sources) for (const n of namesUsed(s, names)) used.add(n)
    if (used.size) out[id] = [...used].sort()
  }
  return out
}

/** The unit types named as string literals ("x", 'x' or `x`) in any of the sources. */
export function typeLiteralsIn(sources, unitTypes) {
  const out = new Set()
  if (!unitTypes.length) return out
  for (const s of sources) {
    if (!s) continue
    for (const t of unitTypes) if (s.includes(`"${t}"`) || s.includes(`'${t}'`) || s.includes(`\`${t}\``)) out.add(t)
  }
  return out
}

// G4's bookkeeping only: a test's `@test-watches` declares how it uses a
// registry when it watches some unit files ({frontend,backend}/src/nodes/**);
// a watch of unrelated files (migrations, docs) says nothing. The engine is
// stricter: rule (c) is waived only when a watch covers the changed file itself.
const UNIT_PROBES = ["frontend/src/nodes/probe-unit/exec.ts", "frontend/src/nodes/probe-unit/unit.json", "backend/src/nodes/probe-unit/route.ts", "backend/src/nodes/probe-unit/price.ee.ts"]
export const watchesUnits = (watches) => (watches ?? []).length > 0 && UNIT_PROBES.some((p) => matchesAny(p, watches))

const MEMBER_LINE = /\/\/ unit:([a-z][a-z0-9-]*)[ \t]*$/
/**
 * An aggregate diff made only of member lines (each ending `// unit:<type>`):
 * the types it adds or removes. null when any other line changed (the
 * generator's template) — then the plain dependency rule applies.
 */
export function memberLineTypes(before, after) {
  if (before == null || after == null) return null
  const count = (text) => {
    const m = new Map()
    for (const l of text.replace(/\r/g, "").split("\n")) m.set(l, (m.get(l) ?? 0) + 1)
    return m
  }
  const a = count(before)
  const b = count(after)
  const changed = []
  for (const [l, n] of a) if ((b.get(l) ?? 0) !== n) changed.push(l)
  for (const l of b.keys()) if (!a.has(l)) changed.push(l)
  if (changed.length === 0) return null
  const types = new Set()
  for (const l of changed) {
    const m = l.match(MEMBER_LINE)
    if (!m) return null
    types.add(m[1])
  }
  return [...types].sort()
}

/** The unit folder names under frontend/src/nodes/ (the unit ids), from a file list. */
export function unitTypesFrom(paths) {
  const out = new Set()
  for (const p of paths) {
    const m = p.match(/^frontend\/src\/nodes\/([a-z][a-z0-9-]*)\/unit\.json$/)
    if (m) out.add(m[1])
  }
  return [...out].sort()
}
