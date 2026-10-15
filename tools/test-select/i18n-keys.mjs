// tools/test-select/i18n-keys.mjs
// Key-level selection for the UI-string dictionaries (§5.8 A1, decided
// 2026-10-15). Every component that calls t() reaches every locale dict, so a
// one-string change used to select ~1,000 frontend tests. Here a dict change
// selects the tests that can see one of its changed KEYS: a test whose own
// file or any module it loads names the key as a string literal, plus every
// test that reaches a module reading the dicts as data. Pure; built-ins only.
//
// Fail-safe: any doubt returns null and the caller keeps today's rule (every
// test that reaches the dict) — a change outside the flat `"key": "value",`
// lines, a key no source names literally (it may be built at run time), a
// template literal or a dotted prefix literal that could build it.

export const LOCALE_DICT = /^frontend\/src\/lib\/i18n\/(?:en|he|ar|de|es|fr|hi|ja|ko|pt-br|ru|zh-cn)\.ts$/
// The resolver and the registry read every dict for every component: the
// whole point is to look past them.
const INFRASTRUCTURE = new Set(["frontend/src/lib/i18n/index.ts", "frontend/src/lib/i18n/dicts.ts"])

const ENTRY = /^\s*"((?:[^"\\]|\\.)+)":\s*\S/
const IGNORABLE = /^\s*(?:\/\/.*)?$/

function parse(source) {
  const entries = new Map()
  const rest = []
  for (const line of source.split("\n")) {
    const m = line.match(ENTRY)
    if (m) {
      if (entries.has(m[1])) return null // a duplicate key: not the shape we read
      entries.set(m[1], line.trim())
    } else if (!IGNORABLE.test(line)) rest.push(line.trim())
  }
  return { entries, rest: rest.join("\n") }
}

// The keys a dict change adds, removes or rewrites — or null when anything but
// whole `"key": value` lines changed (an import, the type, a multi-line value).
export function changedKeys(before, after) {
  if (before == null || after == null) return null
  const a = parse(before)
  const b = parse(after)
  if (!a || !b || a.rest !== b.rest) return null
  const keys = new Set()
  for (const [k, line] of a.entries) if (b.entries.get(k) !== line) keys.add(k)
  for (const k of b.entries.keys()) if (!a.entries.has(k)) keys.add(k)
  return [...keys].sort()
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// A template literal with a substitution, as a pattern over the strings it can produce.
const TEMPLATE = /`((?:[^`\\]|\\.)*\$\{(?:[^`\\]|\\.)*)`/g
function templatePatterns(source) {
  const out = []
  for (const m of source.matchAll(TEMPLATE)) {
    const parts = m[1].split(/\$\{[^}]*\}/)
    // key-shaped: a static part with a dotted word ("nodes." / ".label");
    // `${a}.${b}` and file names like `${name}.png` ARE matched by this, so the
    // pattern is kept — the key test below decides whether it can build one
    if (!parts.some((p) => /[A-Za-z]\w*\.|\.[A-Za-z]\w*/.test(p))) continue
    out.push(new RegExp(`^${parts.map(escape).join("[^]*")}$`))
  }
  return out
}
// A module that reads a dict as data: a value import of a locale dict, other
// than the resolver/registry themselves.
const VALUE_IMPORT = /\bimport\s+(?!type\b)[^;'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bexport\s+(?!type\b)[^;'"]*?\bfrom\s*["']([^"']+)["']/g
function resolveSpecifier(importer, spec) {
  let p
  if (spec.startsWith("@/")) p = `frontend/src/${spec.slice(2)}`
  else if (spec.startsWith(".")) {
    const stack = importer.split("/").slice(0, -1)
    for (const part of spec.split("/")) {
      if (part === "..") stack.pop()
      else if (part !== ".") stack.push(part)
    }
    p = stack.join("/")
  } else return null
  return p.replace(/\.(?:js|ts)$/, "")
}
function readsDicts(file) {
  for (const m of file.source.matchAll(VALUE_IMPORT)) {
    const target = resolveSpecifier(file.path, m[1] ?? m[2] ?? m[3])
    if (target && LOCALE_DICT.test(`${target}.ts`)) return true
  }
  return false
}

// files: [{ path, source }] — every frontend source and test file (dicts
// excluded). Returns { users: Set(paths) } or { unsafe: reason }.
export function keyUsage(keys, files) {
  const users = new Set()
  const relevant = files.filter((f) => !LOCALE_DICT.test(f.path))
  const consumers = new Set()
  for (const f of relevant) {
    if (INFRASTRUCTURE.has(f.path)) continue
    if (readsDicts(f)) consumers.add(f.path) // reads the dicts as data
  }
  for (const c of consumers) users.add(c)
  // Where a key can be BUILT matters only outside the consumers: they run on
  // every dict change anyway (a test filtering keys by "node." reads them all).
  const builders = relevant.filter((f) => !consumers.has(f.path))
  const templates = builders.flatMap((f) => templatePatterns(f.source))
  for (const key of keys) {
    const literal = new RegExp(`(["'\`])${escape(key)}\\1`)
    let named = false
    for (const f of relevant) {
      if (literal.test(f.source)) { users.add(f.path); named = true }
    }
    if (!named) return { unsafe: `no source names "${key}" literally — it may be built at run time` }
    if (templates.some((re) => re.test(key))) return { unsafe: `a template literal can build "${key}"` }
    const dots = key.split(".")
    for (let i = 1; i < dots.length; i++) {
      const prefix = `${dots.slice(0, i).join(".")}.`
      if (builders.some((f) => new RegExp(`(["'\`])${escape(prefix)}\\1`).test(f.source))) {
        return { unsafe: `the prefix "${prefix}" appears as a literal — "${key}" may be concatenated` }
      }
    }
  }
  return { users }
}
