// tools/test-dedup/bodies.mjs
// Section (c) of the duplicate report: copy-pasted test bodies. Each `it` /
// `test` body is printed from the TypeScript AST without comments (so layout
// and comments never matter) and keyed by:
//   - the body text (only bodies of at least MIN_BODY characters: shorter ones
//     are one-line assertions that repeat by nature);
//   - its SUBJECTS: each imported identifier it uses, with the module it comes
//     from (relative specifiers resolved to repo paths) — the same assertion
//     against a different module is a different test;
//   - the file's mock/setup context: its vi.mock calls and the before/after
//     hooks of the enclosing scopes.
// Same-scope copies (one file, one describe chain, the same body) are the
// candidates. Copies across files only need the key above to match; nothing
// else is checked, so the report lists them for a human to judge (most are
// per-locale or per-engine twins on purpose).
//
// What is read, deliberately:
//   - `it` / `test` and their `.only` / `.concurrent` / `.sequential` forms.
//     `it.each` / `.for`, `.skip`, `.skipIf` / `.runIf`, `.fails` and `.todo`
//     are skipped: a parameterized body is one text run with different
//     arguments, so grouping it would report every `.each` table as copies.
//   - `describe` (and `.only` / `.concurrent` / `.sequential`) opens a scope.
//     A `describe.each(…)(…)` / `describe.skipIf(…)(…)` block does not: its
//     tests fold into the enclosing scope, so two such blocks side by side
//     can pair their tests as "same scope". Judge those by hand.
// `typescript` is passed in by the caller (loaded lazily); the grouping is pure.
import { createHash } from "node:crypto"
import { posix } from "node:path"

export const MIN_BODY = 80
const TEST_CALLS = new Set(["it", "test", "it.only", "test.only", "it.concurrent", "test.concurrent", "it.sequential", "test.sequential"])
const DESCRIBE_CALLS = new Set(["describe", "describe.only", "describe.concurrent", "describe.sequential"])
const HOOKS = new Set(["beforeEach", "beforeAll", "afterEach", "afterAll"])

const sha = (s) => createHash("sha1").update(s).digest("hex")

// `@/x` is frontend/src/x (the frontend alias); a relative specifier resolves
// against the test file; anything else (a package) stays as written.
export function resolveSpecifier(file, spec) {
  if (spec.startsWith("@/") && file.startsWith("frontend/")) return `frontend/src/${spec.slice(2)}`
  if (!spec.startsWith(".")) return spec
  return posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.[cm]?[jt]sx?$/, "")
}

// The tests of one file: [{ file, scope, title, body, subjects, context }].
export function extractTests(ts, file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const printer = ts.createPrinter({ removeComments: true })
  const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, sf)
  const nameOf = (e) => (ts.isIdentifier(e) ? e.text
    : ts.isPropertyAccessExpression(e) ? `${nameOf(e.expression)}.${e.name.text}`
      : ts.isCallExpression(e) ? `${nameOf(e.expression)}()` : "?")
  const imports = new Map()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const from = resolveSpecifier(file, st.moduleSpecifier.text)
    const c = st.importClause
    if (c.name) imports.set(c.name.text, from)
    const nb = c.namedBindings
    if (nb && ts.isNamespaceImport(nb)) imports.set(nb.name.text, from)
    else if (nb) for (const el of nb.elements) imports.set(el.name.text, from)
  }
  const mocks = []
  const hooks = new Map() // scope → hook texts
  const found = []
  const visit = (node, scope) => {
    if (ts.isCallExpression(node)) {
      const name = nameOf(node.expression)
      const first = node.arguments[0]
      const title = first ? (ts.isStringLiteralLike(first) ? first.text : first.getText(sf)) : ""
      if (name === "vi.mock" || name === "vi.doMock") mocks.push(print(node))
      if (HOOKS.has(name)) {
        const key = scope.join("\0")
        hooks.set(key, [...(hooks.get(key) ?? []), print(node)])
      }
      if (DESCRIBE_CALLS.has(name)) { for (const a of node.arguments.slice(1)) visit(a, [...scope, title]); return }
      if (TEST_CALLS.has(name)) {
        const fn = node.arguments.find((a, i) => i > 0 && (ts.isArrowFunction(a) || ts.isFunctionExpression(a)))
        if (fn) {
          const subjects = new Set()
          const walk = (n) => { if (ts.isIdentifier(n) && imports.has(n.text)) subjects.add(`${n.text}<${imports.get(n.text)}>`); ts.forEachChild(n, walk) }
          walk(fn.body)
          found.push({ file, scopePath: scope, scope: scope.join(" > "), title, body: print(fn.body), subjects: [...subjects].sort() })
        }
        return
      }
    }
    ts.forEachChild(node, (c) => visit(c, scope))
  }
  visit(sf, [])
  const mockText = [...mocks].sort().join("\n")
  return found.map(({ scopePath, ...t }) => {
    const setup = scopePath.map((_, i) => (hooks.get(scopePath.slice(0, i + 1).join("\0")) ?? []).join("\n"))
    return { ...t, context: sha(`${mockText}\n${(hooks.get("") ?? []).join("\n")}\n${setup.join("\n")}`) }
  })
}

// tests: extractTests output for every file. → { total, sameScope, crossFile }
//   sameScope: [{ file, scope, titles }] — copies = titles.length − 1
//   crossFile: [{ files, title }]        — one entry per key found in more than one file
export function duplicateBodies(tests) {
  const long = tests.filter((t) => t.body.length >= MIN_BODY)
  const group = (keyOf) => {
    const m = new Map()
    for (const t of long) { const k = keyOf(t); (m.get(k) ?? m.set(k, []).get(k)).push(t) }
    return [...m.values()]
  }
  const sameScope = group((t) => `${t.file}\0${t.scope}\0${t.body}`).filter((g) => g.length > 1)
    .map((g) => ({ file: g[0].file, scope: g[0].scope, titles: g.map((t) => t.title) }))
  const crossFile = group((t) => sha(`${t.body}\0${t.subjects.join(",")}\0${t.context}`))
    .map((g) => ({ files: [...new Set(g.map((t) => t.file))].sort(), title: g[0].title }))
    .filter((g) => g.files.length > 1)
  return { total: tests.length, long: long.length, sameScope, crossFile }
}

export const copies = (groups, sizeOf) => groups.reduce((n, g) => n + sizeOf(g) - 1, 0)
