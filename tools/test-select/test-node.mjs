// tools/test-select/test-node.mjs
// One test's view of the graph: what it imports, what it (or a test-side
// helper it imports) reads at run time, and which product modules on its
// path read repo files — declared (`@reads`) or not. Pure, so it is tested
// without Vitest; graph.mjs feeds it the sources.
import { posix } from "node:path"
import { isScanner, parseAnnotations, parseReads, parseRegistryAnnotations } from "./annotations.mjs"
import { importedNames } from "./package-symbols.mjs"
import { AGGREGATE_FILE, enumeratorsIn, registryNamesIn, typeLiteralsIn } from "./registry.mjs"

// A non-test file that only tests import: its file reads belong to the test.
// The `test/` segment is frontend/src/test/… and backend/src/test/… (the
// shared setup and helpers, e.g. migration-columns.ts reading migrations).
export const TEST_SIDE_HELPER = /(?:^|\/)(?:__tests__|test|test-utils|fixtures)\//
// Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)` — one
// spelling for the engine and both guards.
export const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

export const isTestSideHelper = (path) => TEST_SIDE_HELPER.test(path) && !TEST_FILE.test(path)

// Reads files at run time and declares nothing that tells the engine what.
// `@test-reads-for-caller` counts only on a test-side helper: a test file is
// the caller, so it has to say what it reads. Shared with the guard
// (tools/__tests__/test-watches-guard.test.mjs) so the two never disagree.
export function undeclaredTestReader(path, source, a = parseAnnotations(source)) {
  if (!isScanner(source) || a.always || a.readsNone || a.watches.length > 0) return false
  return !(a.forCaller && isTestSideHelper(path))
}

// A helper that hands paths to a `@test-reads-for-caller` module is itself a
// caller: what it asks for is invisible to the test that imports it, so it
// must carry the marker too, or declare `@test-watches` / `@test-always`.
// `@test-reads-none` does NOT excuse it: the module reads whatever the helper
// hands it, and "reads no repo file" is a claim no check can verify — a helper
// that handed it repo paths under that marker would leave those reads declared
// by nobody (the test truthfully declares only its own), so a change to them
// would select no test. Only the three declarations that either name the reads
// or move them to the caller pass.
// Static and conservative (over-flagging is safe): an import specifier names
// a module by its last segment, extension dropped — or, for `…/index`,
// `…/index.js` and a directory import `…/dir/`, by the directory — whether it
// is relative, `@/`-aliased or spelled `.js`; a marked `dir/index.ts` is named
// `dir`. A relative specifier is also resolved against the importing file's
// directory, so `.`, `./` and `..` reach a marked `index` too. `from`,
// `import`, `import(…)`, `require(…)`, `vi.importActual(…)` /
// `vi.importMock(…)` (generic or not, a Prettier-wrapped generic across lines
// included — the generic is matched as balanced `<…>` up to three levels deep,
// so a stray `<` in a comment or a generic call with no string argument never
// swallows the specifiers after it) and a template literal without
// substitutions all count.
const SPECIFIER = /(?:\bfrom|\bimport|\brequire|\bimportActual|\bimportMock)\s*(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?\s*\(?\s*(["'`])([^"'`$]+)\1/g
const EXT = /\.[cm]?[jt]sx?$/
const nameOf = (p) => {
  const parts = p.replace(/\/+$/, "").split("/")
  const last = parts.pop().replace(EXT, "")
  return last === "index" && parts.length > 0 ? parts.pop() : last
}
// The module path a relative specifier points at, extension and a trailing
// `/index` dropped (so a file and a directory import resolve alike).
const resolvedFrom = (importer, spec) => {
  const resolved = posix.normalize(posix.join(posix.dirname(importer), spec)).replace(/\/+$/, "").replace(EXT, "")
  return resolved.replace(/\/index$/, "")
}
const moduleOf = (path) => path.replace(EXT, "").replace(/\/index$/, "")

export function helpersImportingPassThrough(files) {
  const markedFiles = files.filter((f) => isTestSideHelper(f.path) && parseAnnotations(f.source).forCaller)
  if (markedFiles.length === 0) return []
  const names = new Set(markedFiles.map((f) => nameOf(f.path)))
  const modules = new Set(markedFiles.map((f) => moduleOf(f.path)))
  const reaches = (importer, spec) => names.has(nameOf(spec))
    || (spec.startsWith(".") && modules.has(resolvedFrom(importer, spec)))
  return files.filter((f) => {
    if (!isTestSideHelper(f.path)) return false
    const a = parseAnnotations(f.source)
    if (a.forCaller || a.always || a.watches.length > 0) return false
    return [...f.source.matchAll(SPECIFIER)].some((m) => reaches(f.path, m[2]))
  }).map((f) => f.path)
}

// What a test imports from @nodaro/shared, through its own file and every app
// module it loads (package-symbols.mjs): a sorted name list, "*" when some
// module takes the whole namespace, or null when nothing imports it by name.
function sharedImports(source, deps) {
  const names = new Set()
  let any = false
  for (const s of [source, ...deps.filter((d) => !d.path.startsWith("packages/")).map((d) => d.source)]) {
    if (s === null) return "*" // unreadable: cannot show it imports only some names
    const n = importedNames(s)
    if (n === null) continue
    if (n === "*") return "*"
    any = true
    for (const x of n) names.add(x)
  }
  return any ? [...names].sort() : null
}

// The registry view of one test (registry.mjs). `registry`, from graph.mjs:
//   info:      collectRegistries(...) of the tree
//   via:       Map<dep, { registries, units }> — deps reached ONLY through member edges
//   unitTypes: the unit ids (frontend/src/nodes/<type>/)
// Without it (no units, or the walker unavailable) every field is empty and
// selection is exactly today's.
function registryView(source, deps, registry) {
  const empty = { viaRegistry: {}, registryNames: {}, unitsByName: null, typeLiterals: [], enumerates: {} }
  if (!registry?.info) return empty
  const { info, via = new Map(), unitTypes = [] } = registry
  const helpers = deps.filter((d) => isTestSideHelper(d.path) && d.source !== null)
  const own = [source, ...helpers.map((d) => d.source)]
  const unitsByName = [source, ...helpers.map((d) => d.source)].map((s) => parseRegistryAnnotations(s).unitsByName).find(Boolean) ?? null
  // Test data in its closure (JSON fixtures) can name a unit too.
  const data = deps.filter((d) => /\.json$/.test(d.path) && d.source !== null).map((d) => d.source)
  const viaRegistry = Object.fromEntries([...via].map(([f, v]) => [f, { registries: [...v.registries].sort(), units: [...v.units].sort() }]))
  // Enumerators matter only to a test that reaches an aggregate.
  const reachesAggregate = deps.some((d) => AGGREGATE_FILE.test(d.path))
  const product = deps.filter((d) => !isTestSideHelper(d.path) && !via.has(d.path) && !d.path.startsWith("packages/"))
  return {
    viaRegistry,
    registryNames: registryNamesIn(own, info.exportsById),
    unitsByName,
    typeLiterals: [...typeLiteralsIn([...own, ...data], unitTypes)].sort(),
    enumerates: reachesAggregate ? enumeratorsIn(product, info) : {},
  }
}

export function summarizeTest({ file, source, deps, registry = null }) {
  const own = parseAnnotations(source)
  // Only the test's OWN declaration covers what it asks a
  // `@test-reads-for-caller` helper to read — watches inherited from another
  // helper describe that helper's reads, not these.
  const declaresOwnReads = own.watches.length > 0 || own.always !== null || own.readsNone !== null
  const watches = [...own.watches]
  let always = own.always
  // The test file is the caller by construction: its own `@test-reads-for-caller`
  // never excuses it (it would excuse a helper).
  let scanner = isScanner(source) && !own.always && !own.readsNone && own.watches.length === 0
  let passThrough = false
  const reads = []
  let undeclaredReader = null
  for (const dep of deps) {
    const helper = isTestSideHelper(dep.path)
    // A dependency whose source could not be read (`null`) cannot be shown
    // NOT to read files — count it as the reader that is never skipped.
    if (dep.source === null) {
      if (helper) scanner = true
      else undeclaredReader ??= dep.path
      continue
    }
    if (helper) {
      const a = parseAnnotations(dep.source)
      watches.push(...a.watches)
      always ??= a.always
      if (undeclaredTestReader(dep.path, dep.source, a)) scanner = true
      // It reads what the test passes it: that is the TEST's to declare. The
      // marker only ADDS this requirement — the helper's own watches/always
      // above still flow in. A test that declares nothing runs on every change
      // (the safe default). The deps are transitive, so a test reaching it
      // through another helper is caught here too.
      if (a.forCaller && !declaresOwnReads) passThrough = true
    } else {
      const r = parseReads(dep.source)
      reads.push(...r.reads)
      if (!undeclaredReader && isScanner(dep.source) && r.reads.length === 0 && !r.readsNone) undeclaredReader = dep.path
    }
  }
  // `passThroughOnly`: the pass-through rule is the only reason it runs on
  // every change (select.mjs words the reason after it).
  return {
    file, deps: deps.map((d) => d.path), watches, always, sharedImports: sharedImports(source, deps),
    scanner: scanner || passThrough, passThroughOnly: passThrough && !scanner,
    reads, undeclaredReader,
    ...registryView(source, deps, registry),
  }
}
