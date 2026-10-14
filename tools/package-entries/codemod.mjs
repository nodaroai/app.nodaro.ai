#!/usr/bin/env node
// Moves imports of the @nodaro/shared and @nodaro/prompts ROOTS onto the
// narrowest subpath entries (`@nodaro/shared/<entry>`, `@nodaro/prompts/<entry>`).
//
// Why: a root import loads the whole package (~110 ms of CPU per test file for
// shared, ~165 ms for prompts, measured 2026-10-13) and makes every change to
// any package module "relevant" to the importer, so test selection cannot tell
// a caption change from a pricing change. A subpath loads one domain.
//
// The symbol → entry map is read from `packages/<pkg>/src/entries/*.ts` with the
// TypeScript checker — never a hand-kept list — so a re-run after the entries
// change is always correct. The codemod is idempotent and is the source of
// truth for these specifiers: on a merge conflict in an import line, take
// either side and re-run it.
//
//   node tools/package-entries/codemod.mjs [--write] [--report out.json] [path ...]
//
// Without --write it is a dry run (prints what it would change). Paths default
// to every tracked .ts/.tsx/.mts/.mjs file under frontend, backend, packages,
// scripts and tools, minus the two packages' own index.ts and src/entries/
// (those ARE the entries).
//
// What it rewrites (each per statement, by text range — formatting, comments
// and quote style of everything else are left alone):
//   - `import { a, type B, c as d } from "@nodaro/shared"` → one import per entry,
//     keeping `type` modifiers and aliases (a group of only `type` names becomes
//     `import type { … }` so no runtime import of that entry is created);
//   - `export { … } from "<root>"` likewise;
//   - `import("<root>").X` / `typeof import("<root>")` in types;
//   - `const { a, b } = await import("<root>")` (also vi.importActual / require)
//     → one declaration per entry;
//   - a namespace binding (`import * as S from "<root>"`, or
//     `const S = await import("<root>")`) moves only when EVERY use is `S.Name`
//     and all those names live in one entry; otherwise it is reported and left;
//   - `vi.mock("<root>", factory)` / `vi.doMock` → one mock per entry, so the mock
//     keeps intercepting the subpath the code under test now imports (a root mock
//     does not intercept a subpath import). A PARTIAL mock (factory spreads
//     `importOriginal()` / `vi.importActual()`) becomes one partial mock per entry
//     that owns an override. A FULL replacement (no spread) becomes a mock of
//     EVERY entry — `() => ({})` where the entry owns none of the overrides —
//     because the root mock kept the whole real package out of the test.
//     Override keys the package does not export at all stay, inert, on the first
//     emitted mock and are reported. A mock is REFUSED (left on the root) when
//     a split would change what it does: an override that reads the real
//     module (`actual.X`) from an entry other than its own, the real module
//     used whole, or statements before its `return` that read the real module
//     or would run once per emitted entry. A spread counts as "partial" only
//     when it spreads the real module; `{ ...fixture, x }` is a full replacement
//     and the fixture is spread into every entry's mock. The real module is
//     `importOriginal` or any loader (vi.importActual / vi.importMock /
//     import() / require) except one whose argument is a literal naming another
//     module; a loader of it that is not a literal root, or a root literal in
//     any other position, is refused too. Only the literals so classified are
//     renamed per entry (a qualified `import(root).X` type to X's entry). Also
//     refused: a root the file registers more than once (mock / doMock /
//     unmock / doUnmock, any spelling — a later registration replaces an
//     earlier one only while both share the root id), a split that would emit
//     an entry the file already mocks, and a factory that reaches a loader in
//     an unusual spelling (`vi[…]`, a renamed or whole `vi`, a loader aliased
//     or destructured anywhere in the file, `arguments`);
//   - imports of the same entry in one file are merged into the first.
// Anything it cannot rewrite with certainty (side-effect/default/`export *`
// root imports, a namespace used as a whole object, a computed mock key) is left
// on the root and listed in the report; the root-import guard then fails until
// a person resolves it or allowlists it with a reason.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { runtimeClosure } from "./entries-lib.mjs"

const ts = createRequire(import.meta.url)("typescript")
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const PKG_DIRS = { "@nodaro/shared": "packages/shared", "@nodaro/prompts": "packages/prompts" }
const ROOTS = new Set(Object.keys(PKG_DIRS))
// The root-import guard's scope (frontend/src/__tests__/package-root-imports.test.ts).
const DEFAULT_GLOBS = ["frontend", "backend", "packages", "scripts", "tools"]
const EXT_RE = /\.(ts|tsx|mts|mjs)$/
const MODULE_LOADERS = new Set(["import", "vi.importActual", "vi.importMock", "require"])
const MOCKERS = new Set(["vi.mock", "vi.doMock"])
const MOCK_REGISTRARS = new Set(["mock", "doMock", "unmock", "doUnmock"])
const LOADER_PROPS = new Set(["importActual", "importMock"])

// ---------------------------------------------------------------------------
// Entry maps
// ---------------------------------------------------------------------------

/**
 * For each package: name → candidate entries, entry list, and each entry's
 * runtime closure size (the tie-break when a name is exported by two entries:
 * the file's other entries first, then the lighter entry).
 */
export function loadEntryMaps(root = repo) {
  const maps = {}
  for (const [pkg, dir] of Object.entries(PKG_DIRS)) {
    const entriesDir = path.join(root, dir, "src", "entries")
    const entries = fs.readdirSync(entriesDir).filter((f) => f.endsWith(".ts")).map((f) => f.slice(0, -3)).sort()
    const files = entries.map((e) => path.join(entriesDir, `${e}.ts`))
    const program = ts.createProgram(files, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: [],
    })
    const checker = program.getTypeChecker()
    const nameToEntries = new Map()
    const weight = {}
    entries.forEach((entry, i) => {
      const sym = checker.getSymbolAtLocation(program.getSourceFile(files[i]))
      for (const s of sym ? checker.getExportsOfModule(sym) : []) {
        const list = nameToEntries.get(s.name) ?? []
        list.push(entry)
        nameToEntries.set(s.name, list)
      }
      let bytes = 0
      for (const f of runtimeClosure(files[i])) bytes += fs.statSync(f).size
      weight[entry] = bytes
    })
    maps[pkg] = { entries, nameToEntries, weight }
  }
  return maps
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const calleeName = (call) => {
  const e = call.expression
  if (e.kind === ts.SyntaxKind.ImportKeyword) return "import"
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return `${e.expression.text}.${e.name.text}`
  return null
}

const rootArg = (call) => {
  const a = call.arguments[0]
  return a && ts.isStringLiteralLike(a) && ROOTS.has(a.text) ? a : null
}

const unwrap = (node) => {
  let n = node
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n) || ts.isNonNullExpression(n))) n = n.expression
  return n
}

/** A loader's argument with only its type-level wrappers removed: parens, `as`, `satisfies`, `<T>`, `!`. */
const unwrapArg = (node) => {
  let n = node
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n) || ts.isNonNullExpression(n))) n = n.expression
  return n
}

const propKeyName = (p) => {
  if (ts.isSpreadAssignment(p)) return null
  const n = p.name
  if (!n) return undefined
  if (ts.isIdentifier(n) || ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return n.text
  return undefined // computed
}

const lineIndent = (text, pos) => {
  const ls = text.lastIndexOf("\n", pos - 1) + 1
  return /^[ \t]*/.exec(text.slice(ls))[0]
}

const quoteOf = (lit, text) => text[lit.getStart()]

// ---------------------------------------------------------------------------
// Per-file transform
// ---------------------------------------------------------------------------

export function transformFile(file, text, maps) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const edits = []
  const notes = [] // { kind, line, detail }
  const stats = { statements: 0, specifiers: 0, mocks: 0, mockEntries: 0, typeQueries: 0, dynamic: 0, namespaces: 0 }
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const note = (k, node, detail) => notes.push({ kind: k, line: lineOf(node), detail })

  // Which entries the file already needs (for the duplicate-name tie-break).
  const fileEntries = { "@nodaro/shared": new Set(), "@nodaro/prompts": new Set() }
  const pending = [] // resolve after the first pass so tie-breaks see the whole file

  const entryOf = (pkg, name) => {
    const c = maps[pkg].nameToEntries.get(name)
    if (!c) return null
    if (c.length === 1) return c[0]
    const own = c.filter((e) => fileEntries[pkg].has(e))
    const pool = own.length ? own : c
    return [...pool].sort((a, b) => maps[pkg].weight[a] - maps[pkg].weight[b] || a.localeCompare(b))[0]
  }
  const sub = (pkg, entry) => `${pkg}/${entry}`

  // First pass: record the unambiguous entries every named import needs.
  const visitCollect = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && ROOTS.has(node.moduleSpecifier.text)) {
      const pkg = node.moduleSpecifier.text
      const els = ts.isImportDeclaration(node)
        ? (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements : [])
        : (node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [])
      for (const e of els) {
        const c = maps[pkg].nameToEntries.get((e.propertyName ?? e.name).text)
        if (c?.length === 1) fileEntries[pkg].add(c[0])
      }
    }
    ts.forEachChild(node, visitCollect)
  }
  visitCollect(sf)

  // Every module registration in the file — vi.mock / vi.doMock / vi.unmock /
  // vi.doUnmock, in ANY spelling (a renamed vi, `vi["mock"]`, a wrapped or
  // `import()` id) — counted per id. For one id a later registration replaces
  // an earlier one; once split, the two would target different entry ids and
  // both stay active, so a root registered twice is never split. "?" is an id
  // the codemod cannot read (it may be a root).
  const registrations = new Map()
  const registrationId = (arg) => {
    const a = arg && unwrapArg(arg)
    if (a && ts.isStringLiteralLike(a)) return a.text
    if (a && ts.isCallExpression(a) && a.expression.kind === ts.SyntaxKind.ImportKeyword && a.arguments[0]) {
      const b = unwrapArg(a.arguments[0])
      if (ts.isStringLiteralLike(b)) return b.text
    }
    return "?"
  }
  const countRegistrations = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression
      const m = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression) ? e.argumentExpression.text : null
      if (m && MOCK_REGISTRARS.has(m)) {
        const id = registrationId(n.arguments[0])
        registrations.set(id, (registrations.get(id) ?? 0) + 1)
      }
    }
    ts.forEachChild(n, countRegistrations)
  }
  countRegistrations(sf)

  // The spellings of vitest's `vi` in this file (`import { vi as v }`, and
  // `ns.vi` of `import * as ns from "vitest"`). Inside a mock factory a module
  // loader is recognised only as `vi.importActual(…)` / `vi.importMock(…)` /
  // `require(…)` / `import(…)` / the factory's own parameter; any other way of
  // reaching one is "odd" and refuses the mock.
  const viNames = new Set(["vi"])
  const vitestNamespaces = new Set()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier) || st.moduleSpecifier.text !== "vitest") continue
    const nb = st.importClause?.namedBindings
    if (nb && ts.isNamespaceImport(nb)) vitestNamespaces.add(nb.name.text)
    else if (nb) for (const el of nb.elements) if ((el.propertyName ?? el.name).text === "vi") viNames.add(el.name.text)
  }
  /** An identifier in a position that names something rather than reading a value. */
  const isNamePosition = (n) => {
    const p = n.parent
    if (!p) return true
    if (ts.isPropertyAccessExpression(p)) return p.name === n
    if (ts.isQualifiedName(p)) return p.right === n
    if (ts.isBindingElement(p)) return p.propertyName === n || p.name === n
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true
    if (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)) return p.name === n
    if (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) return p.name === n
    return false
  }
  /** `node` spells vi: fine only as `vi.prop`, and a loader prop only as the direct callee of a call on the literal `vi`. */
  const viOdd = (node, renamed) => {
    const p = node.parent
    if (!(ts.isPropertyAccessExpression(p) && p.expression === node)) return true
    if (!LOADER_PROPS.has(p.name.text)) return false
    return renamed || !(ts.isCallExpression(p.parent) && p.parent.expression === p)
  }
  const tainted = new Set() // names bound (anywhere in the file) to something reached through an odd use
  const oddUse = (n) => {
    if (!ts.isIdentifier(n) || isNamePosition(n)) return false
    const t = n.text
    if (tainted.has(t)) return true
    if (viNames.has(t)) return viOdd(n, t !== "vi")
    if (vitestNamespaces.has(t)) {
      const p = n.parent
      if (!(ts.isPropertyAccessExpression(p) && p.expression === n)) return true
      return p.name.text === "vi" ? viOdd(p, true) : false
    }
    if (t === "require") return !(ts.isCallExpression(n.parent) && n.parent.expression === n)
    return false
  }
  const findOdd = (node) => {
    let hit = null
    const walk = (n) => {
      if (hit) return
      if (oddUse(n)) hit = n
      else ts.forEachChild(n, walk)
    }
    walk(node)
    return hit
  }
  let taintComputed = false
  /** Fixpoint: a declaration (or assignment) that contains an odd use or a tainted name taints every name it binds. */
  const computeTaint = () => {
    if (taintComputed) return
    taintComputed = true
    const binders = []
    const collect = (n) => {
      if (ts.isVariableDeclaration(n) || ts.isParameter(n)) binders.push([n.name, n])
      else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) binders.push([n.left, n.right])
      ts.forEachChild(n, collect)
    }
    collect(sf)
    const bound = (name, out) => {
      if (ts.isIdentifier(name)) out.push(name.text)
      else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const el of name.elements) if (!ts.isOmittedExpression(el)) bound(el.name, out)
    }
    for (let grew = true; grew; ) {
      grew = false
      for (const [name, source] of binders) {
        if (!findOdd(source)) continue
        const names = []
        bound(name, names)
        for (const x of names) if (!tainted.has(x)) { tainted.add(x); grew = true }
      }
    }
  }

  /** Classify identifier uses of a namespace binding. Returns names, or null if used as a whole. */
  const namespaceUses = (local, declNameNode) => {
    const names = new Set()
    let whole = false
    const walk = (n) => {
      if (ts.isIdentifier(n) && n.text === local && n !== declNameNode) {
        const p = n.parent
        if (ts.isPropertyAccessExpression(p) && p.expression === n) names.add(p.name.text)
        else if (ts.isQualifiedName(p) && p.left === n) names.add(p.right.text)
        else if (ts.isElementAccessExpression(p) && p.expression === n && ts.isStringLiteralLike(p.argumentExpression)) names.add(p.argumentExpression.text)
        else if ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n)) { /* someone else's member */ }
        else if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === n) { /* a key */ }
        else whole = true
      }
      ts.forEachChild(n, walk)
    }
    walk(sf)
    return whole ? null : names
  }

  const resolveNamespace = (pkg, local, declNameNode, specNode, what) => {
    const names = namespaceUses(local, declNameNode)
    if (!names) return note("namespace-whole", specNode, `${what} \`${local}\` of ${pkg} is used as a whole object — kept on the root`)
    const entries = new Set()
    for (const n of names) {
      const e = entryOf(pkg, n)
      if (!e) return note("namespace-unknown", specNode, `${what} \`${local}\` reads \`${n}\`, which ${pkg} does not export — kept on the root`)
      entries.add(e)
    }
    if (entries.size !== 1) return note("namespace-split", specNode, `${what} \`${local}\` reads names from ${entries.size ? [...entries].join(", ") : "no entry"} — kept on the root`)
    const [entry] = entries
    edits.push([specNode.getStart(sf) + 1, specNode.getEnd() - 1, sub(pkg, entry)])
    stats.namespaces++
    stats.specifiers++
  }

  /** Group element texts by entry; null when a name is unknown. */
  const groupElements = (pkg, elements, node) => {
    const groups = new Map()
    for (const e of elements) {
      const name = (e.propertyName ?? e.name).text
      const entry = entryOf(pkg, name)
      if (!entry) { note("unknown-name", node, `\`${name}\` is not exported by ${pkg} — statement kept on the root`); return null }
      if (!groups.has(entry)) groups.set(entry, [])
      groups.get(entry).push(e)
    }
    return groups
  }

  /**
   * The comments around each element: `lead` (own lines before it) and `trail`
   * (after it on the same line — `a, // why`). TypeScript reports a same-line
   * comment as the NEXT element's leading comment; it is moved back here so it
   * stays with the name it annotates.
   */
  const elementComments = (elements, closeBrace) => {
    const lineAt = (pos) => sf.getLineAndCharacterOfPosition(pos).line
    const res = elements.map(() => ({ lead: [], trail: [] }))
    const ranges = (from, to) => {
      const out = []
      const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
      const slice = text.slice(from, to)
      for (let m; (m = re.exec(slice)); ) out.push({ pos: from + m.index, text: m[0] })
      return out
    }
    elements.forEach((e, i) => {
      const cs = ranges(e.getFullStart(), e.getStart(sf))
      // A comment between two names heads the NEXT name, also when it sits at
      // the end of the previous name's line (`a, // section b…\n b,` — the
      // repo writes section headers that way). Only a comment after the last
      // name, on its line, annotates a name from behind (handled below).
      res[i].lead.push(...cs.map((c) => c.text))
    })
    const last = elements[elements.length - 1]
    const after = []
    for (const c of ranges(last.getEnd(), closeBrace)) {
      if (lineAt(c.pos) === lineAt(last.getEnd())) res[res.length - 1].trail.push(c.text)
      else after.push(c.text)
    }
    return { per: res, after }
  }

  /** Rebuild an import/export statement as one statement per entry. */
  const splitStatement = (node, pkg, elements, head /* "import" | "export" */, clauseTypeOnly) => {
    const groups = groupElements(pkg, elements, node)
    if (!groups) return
    const spec = node.moduleSpecifier
    stats.statements++
    if (groups.size === 1) {
      const [entry] = groups.keys()
      edits.push([spec.getStart(sf) + 1, spec.getEnd() - 1, sub(pkg, entry)])
      stats.specifiers++
      return
    }
    const q = quoteOf(spec, text)
    const stmtText = text.slice(node.getStart(sf), node.getEnd())
    const semi = stmtText.trimEnd().endsWith(";") ? ";" : ""
    const last = elements[elements.length - 1]
    const closeBrace = text.indexOf("}", last.getEnd())
    const braceOpen = text.lastIndexOf("{", elements[0].getStart(sf))
    const { per, after } = elementComments(elements, closeBrace)
    const hasComments = per.some((c) => c.lead.length || c.trail.length) || after.length > 0
    const multiline = hasComments || text.slice(braceOpen, closeBrace).includes("\n")
    const indentBase = lineIndent(text, node.getStart(sf))
    // The element indent: from the first element that starts its own line.
    const ownLine = elements.find((e) => /\n[ \t]*$/.test(text.slice(0, e.getStart(sf)).slice(-200)) && !/\/[/*]/.test(text.slice(text.lastIndexOf("\n", e.getStart(sf) - 1), e.getStart(sf))))
    const elIndent = ownLine ? lineIndent(text, ownLine.getStart(sf)) : `${indentBase}  `
    const trailingComma = elements.hasTrailingComma || !text.slice(braceOpen, closeBrace).includes("\n")
    const index = new Map(elements.map((e, i) => [e, i]))
    const out = []
    const groupList = [...groups]
    groupList.forEach(([entry, els], gi) => {
      // A group of only `type` names becomes `import type { … }`: no runtime
      // import of that entry is created for names that erase.
      const allTypes = !clauseTypeOnly && els.every((e) => e.isTypeOnly)
      const kw = clauseTypeOnly || allTypes ? `${head} type` : head
      const target = `${q}${sub(pkg, entry)}${q}`
      const core = (e) => {
        const t = text.slice(e.getStart(sf), e.getEnd())
        return allTypes ? t.replace(/^type\s+/, "") : t
      }
      if (!multiline) {
        out.push(`${kw} { ${els.map(core).join(", ")} } from ${target}${semi}`)
      } else {
        const body = []
        els.forEach((e, k) => {
          const c = per[index.get(e)]
          for (const l of c.lead) body.push(`${elIndent}${l}`)
          const comma = k < els.length - 1 || trailingComma ? "," : ""
          body.push(`${elIndent}${core(e)}${comma}${c.trail.length ? ` ${c.trail.join(" ")}` : ""}`)
        })
        if (gi === groupList.length - 1) for (const l of after) body.push(`${elIndent}${l}`)
        out.push(`${kw} {\n${body.join("\n")}\n${indentBase}} from ${target}${semi}`)
      }
      stats.specifiers++
    })
    const replacement = out.join(`\n${indentBase}`)
    // Every comment of the statement must survive the split, verbatim.
    const comments = (t) => (t.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []).sort().join("\u0000")
    if (comments(stmtText) !== comments(replacement)) {
      stats.specifiers -= groups.size
      return note("comment-lost", node, "the split would lose or duplicate a comment — statement kept on the root")
    }
    edits.push([node.getStart(sf), node.getEnd(), replacement])
  }

  /** `const { a, b: c } = await import(root)` → one declaration per entry. */
  const splitDestructure = (decl, call, pkg, loader) => {
    const pattern = decl.name
    const names = []
    for (const el of pattern.elements) {
      if (el.dotDotDotToken) return note("dynamic-rest", call, `\`...rest\` from ${loader}(${pkg}) — kept on the root`)
      const key = el.propertyName ?? el.name
      if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key)) return note("dynamic-computed", call, `computed key from ${loader}(${pkg}) — kept on the root`)
      names.push([key.text, el])
    }
    const groups = new Map()
    for (const [n, el] of names) {
      const e = entryOf(pkg, n)
      if (!e) return note("unknown-name", call, `\`${n}\` is not exported by ${pkg} — kept on the root`)
      if (!groups.has(e)) groups.set(e, [])
      groups.get(e).push(el)
    }
    stats.dynamic++
    if (groups.size === 1) {
      const [entry] = groups.keys()
      for (const lit of loaderLiterals(call, pkg)) edits.push([lit.getStart(sf) + 1, lit.getEnd() - 1, sub(pkg, entry)])
      stats.specifiers++
      return
    }
    const list = decl.parent
    const stmt = list?.parent
    if (!ts.isVariableDeclarationList(list) || list.declarations.length !== 1 || !ts.isVariableStatement(stmt)) {
      return note("dynamic-split", call, `${loader}(${pkg}) destructures names from ${[...groups.keys()].join(", ")} outside a single-declaration statement — kept on the root`)
    }
    const indent = lineIndent(text, stmt.getStart(sf))
    const initText = text.slice(decl.initializer.getStart(sf), decl.initializer.getEnd())
    const lits = loaderLiterals(call, pkg)
    const out = []
    for (const [entry, els] of groups) {
      let init = initText
      // replace literals right-to-left inside the initializer text
      for (const lit of [...lits].sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
        const s = lit.getStart(sf) - decl.initializer.getStart(sf) + 1
        const e = lit.getEnd() - decl.initializer.getStart(sf) - 1
        init = init.slice(0, s) + sub(pkg, entry) + init.slice(e)
      }
      const pat = `{ ${els.map((el) => text.slice(el.getStart(sf), el.getEnd())).join(", ")} }`
      const typeAnn = decl.type ? `: ${text.slice(decl.type.getStart(sf), decl.type.getEnd())}` : ""
      const stmtText = text.slice(stmt.getStart(sf), stmt.getEnd())
      const semi = stmtText.trimEnd().endsWith(";") ? ";" : ""
      const kw = list.flags & ts.NodeFlags.Const ? "const" : list.flags & ts.NodeFlags.Let ? "let" : "var"
      const mods = stmt.modifiers ? stmt.modifiers.map((m) => m.getText(sf)).join(" ") + " " : ""
      out.push(`${mods}${kw} ${pat}${typeAnn} = ${init}${semi}`)
      stats.specifiers++
    }
    edits.push([stmt.getStart(sf), stmt.getEnd(), out.join(`\n${indent}`)])
  }

  /** The root string literals of a loader call: its argument and any `typeof import(root)` type argument. */
  const loaderLiterals = (call, pkg) => {
    const lits = []
    const a = rootArg(call)
    if (a && a.text === pkg) lits.push(a)
    for (const t of call.typeArguments ?? []) collectImportTypeLiterals(t, pkg, lits)
    return lits
  }
  const collectImportTypeLiterals = (node, pkg, out) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal) && node.argument.literal.text === pkg) out.push(node.argument.literal)
    ts.forEachChild(node, (c) => collectImportTypeLiterals(c, pkg, out))
  }

  const handledImportTypes = new Set()
  const handledCalls = new Set()

  // ---- mocks ----
  const splitMock = (call, pkg) => {
    const stmt = call.parent
    if (!ts.isExpressionStatement(stmt)) return note("mock-shape", call, `${calleeName(call)}(${pkg}) is not a statement — kept on the root`)
    const factory = call.arguments[1]
    const indent = lineIndent(text, stmt.getStart(sf))
    const q = quoteOf(call.arguments[0], text)
    if (!factory) return note("mock-automock", call, `${calleeName(call)}(${pkg}) without a factory (automock) — kept on the root`)
    if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) return note("mock-shape", call, `${calleeName(call)}(${pkg}) factory is not an inline function — kept on the root`)
    // Find the returned object literal.
    let obj = null
    const body = factory.body
    if (!ts.isBlock(body)) obj = unwrap(body)
    else {
      const ret = body.statements.filter(ts.isReturnStatement)
      if (ret.length === 1 && ret[0] === body.statements[body.statements.length - 1] && ret[0].expression) obj = unwrap(ret[0].expression)
    }
    if (!obj || !ts.isObjectLiteralExpression(obj)) return note("mock-shape", call, `${calleeName(call)}(${pkg}) factory does not return one object literal — kept on the root`)
    // The real module, as the factory names it: a call of its first parameter
    // (`importOriginal`) or of vi.importActual, and every local bound to one.
    const refusal = (why) => note("mock-refused", call, `${calleeName(call)}(${pkg}) ${why} — kept on the root; split it by hand`)
    const lineAt = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    const regs = registrations.get(pkg) ?? 0
    if (regs > 1) return refusal(`is one of ${regs} registrations of ${pkg} in this file (mock / doMock / unmock / doUnmock): split, a later one would no longer replace an earlier one`)
    if (registrations.has("?")) return refusal("shares the file with a mock registration whose module id the codemod cannot read, which may be this root")
    // The loader parameter must be a plain name, and the factory must not reach a
    // loader any other way (vi in another spelling or used whole, a loader
    // aliased or destructured — in the factory or bound anywhere in the file —
    // `require` passed on, `arguments`): each could load the root unseen.
    const p0 = factory.parameters[0]
    if (p0 && (!ts.isIdentifier(p0.name) || p0.dotDotDotToken)) return refusal("takes its loader parameter as a pattern or rest, which the codemod cannot follow")
    computeTaint()
    let odd = findOdd(factory)
    if (!odd) {
      const args = (n) => {
        if (odd) return
        if (ts.isIdentifier(n) && n.text === "arguments" && !isNamePosition(n)) odd = n
        else ts.forEachChild(n, args)
      }
      args(factory)
    }
    if (odd) return refusal(`reaches a module loader through \`${odd.getText(sf)}\` at line ${lineAt(odd)}, a spelling the codemod cannot follow`)
    const origParam = p0 ? p0.name.text : null
    // A module loader (vi.importActual, vi.importMock, import(), require) is an
    // ordinary value ONLY when its argument is a literal naming another module.
    // The root in any spelling, or an argument the codemod cannot read (a
    // variable, a concatenation, a template with substitutions), is the real
    // module. `loaderRootLiteral` is the literal a split renames per entry.
    const loaderArg = (u) => (u.arguments[0] ? unwrapArg(u.arguments[0]) : undefined)
    const isOtherModuleLoad = (u) => {
      const a = loaderArg(u)
      return !!a && ts.isStringLiteralLike(a) && a.text !== pkg
    }
    const isOriginalCall = (n) => {
      const u = unwrap(n)
      if (!u || !ts.isCallExpression(u)) return false
      const c = calleeName(u)
      if (origParam !== null && c === origParam) return true
      return MODULE_LOADERS.has(c ?? "") && !isOtherModuleLoad(u)
    }
    // Every loader of the real module in the factory must name the root as a
    // literal, so each split factory can load its own entry instead.
    const rootLiterals = new Set()
    let unrenamable = null
    const findLoaders = (n) => {
      if (ts.isCallExpression(n) && MODULE_LOADERS.has(calleeName(n) ?? "") && !isOtherModuleLoad(n)) {
        const a = loaderArg(n)
        if (a && ts.isStringLiteralLike(a) && a.text === pkg) rootLiterals.add(a)
        else unrenamable ??= n
      }
      ts.forEachChild(n, findLoaders)
    }
    findLoaders(factory)
    if (unrenamable) return refusal(`loads the real module with \`${unrenamable.getText(sf)}\`, which a split cannot point at an entry`)
    // The mock's own id and `typeof import(root)` types are renamed too: to the
    // emitted mock's entry, except a qualified `import(root).X` (or
    // `typeof import(root).X`), which names X and goes to the entry exporting X.
    rootLiterals.add(call.arguments[0])
    const fixedEntry = new Map() // literal → the entry it is renamed to in every emitted mock
    let unknownQualifier = null
    const collectTypeLits = (n) => {
      if (ts.isStringLiteralLike(n) && n.text === pkg && ts.isLiteralTypeNode(n.parent) && ts.isImportTypeNode(n.parent.parent)) {
        rootLiterals.add(n)
        let q = n.parent.parent.qualifier
        while (q && ts.isQualifiedName(q)) q = q.left
        if (q) {
          const e = entryOf(pkg, q.text)
          if (e) fixedEntry.set(n, e)
          else unknownQualifier ??= q
        }
      }
      ts.forEachChild(n, collectTypeLits)
    }
    collectTypeLits(call)
    if (unknownQualifier) return refusal(`names the type \`import("${pkg}").${unknownQualifier.text}\`, which no entry of ${pkg} exports`)
    // Any other spelling of the root (a helper's argument, a string value) is
    // something the codemod cannot classify, so it is neither renamed nor kept
    // as the root behind the split's back.
    let stray = null
    const findStray = (n) => {
      if (!stray && ts.isStringLiteralLike(n) && n.text === pkg && !rootLiterals.has(n)) stray = n
      ts.forEachChild(n, findStray)
    }
    findStray(call)
    if (stray) return refusal(`names the root at line ${sf.getLineAndCharacterOfPosition(stray.getStart(sf)).line + 1} in a way the codemod cannot classify`)
    const bindings = new Set()
    const otherPre = []
    for (const st of ts.isBlock(body) ? body.statements.slice(0, -1) : []) {
      const decls = ts.isVariableStatement(st) ? st.declarationList.declarations : []
      if (decls.length === 1 && ts.isIdentifier(decls[0].name) && decls[0].initializer && isOriginalCall(decls[0].initializer)) bindings.add(decls[0].name.text)
      else otherPre.push(st)
    }
    const isOriginalRef = (n) => {
      const u = unwrap(n)
      return isOriginalCall(n) || (!!u && ts.isIdentifier(u) && bindings.has(u.text))
    }
    /**
     * Names read off the real module inside `node`: `actual.X` on a binding, or
     * `(await importOriginal()).X` / `(await vi.importActual(root)).X` inline.
     * Any other use of either — a destructure, passing it on, spreading it — or
     * a reference to the loader that does not call it reads the module whole:
     * null. (`.then((m) => m.X)` also counts as whole: it errs toward refusing.)
     */
    const originalReads = (node) => {
      const names = new Set()
      let whole = false
      const use = (ref) => {
        let top = ref
        while (top.parent && (ts.isAwaitExpression(top.parent) || ts.isParenthesizedExpression(top.parent) || ts.isAsExpression(top.parent) || ts.isSatisfiesExpression(top.parent) || ts.isTypeAssertionExpression(top.parent) || ts.isNonNullExpression(top.parent))) top = top.parent
        const p = top.parent
        if (p && ts.isPropertyAccessExpression(p) && p.expression === top) names.add(p.name.text)
        else whole = true
      }
      const walk = (n) => {
        // The loader itself passed on or aliased (`pick(importOriginal, …)`,
        // `const io = importOriginal`) can read anything: whole use.
        if (ts.isIdentifier(n) && origParam !== null && n.text === origParam && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
          whole = true
          return
        }
        if (ts.isIdentifier(n) && bindings.has(n.text)) {
          const p = n.parent
          if (!(ts.isPropertyAccessExpression(p) && p.name === n)) use(n)
        } else if (ts.isCallExpression(n) && isOriginalCall(n)) {
          use(n)
          return
        }
        ts.forEachChild(n, walk)
      }
      walk(node)
      return whole ? null : names
    }
    // Partial = a spread of the REAL module. A spread of anything else (a local
    // fixture) is part of a full replacement and is copied into every entry.
    const spreads = obj.properties.filter(ts.isSpreadAssignment)
    const partial = spreads.some((sp) => isOriginalRef(sp.expression))
    const props = obj.properties.filter((p) => !ts.isSpreadAssignment(p))
    const byEntry = new Map()
    const dead = []
    for (const p of props) {
      const k = propKeyName(p)
      if (k === undefined) return note("mock-computed", call, `${calleeName(call)}(${pkg}) has a computed key — kept on the root`)
      const e = entryOf(pkg, k)
      // An override that reads the real module must read its own entry: each
      // split factory's original is that entry alone.
      const reads = originalReads(p)
      if (!reads) return refusal(`uses the real module whole inside the \`${k}\` override`)
      for (const r of reads) {
        if (entryOf(pkg, r) !== e) return refusal(`reads \`${r}\` (${entryOf(pkg, r) ?? "not exported"}) inside the \`${k}\` override (${e ?? "not exported"})`)
      }
      if (!e) { dead.push(p); continue }
      if (!byEntry.has(e)) byEntry.set(e, [])
      byEntry.get(e).push(p)
    }
    for (const sp of spreads) {
      if (isOriginalRef(sp.expression)) continue
      const r = originalReads(sp)
      if (r === null || r.size) return refusal("spreads something derived from the real module")
    }
    const emitEntries = partial
      ? [...byEntry.keys()]
      : [...maps[pkg].entries]
    if (partial && emitEntries.length === 0) return note("mock-noop", call, `${calleeName(call)}(${pkg}) overrides nothing ${pkg} exports — kept on the root`)
    // An entry this file already registers (mock / unmock of that subpath)
    // would collide with the emitted mock on one id.
    const clash = emitEntries.find((e) => registrations.has(sub(pkg, e)))
    if (clash) return refusal(`would emit a mock of ${sub(pkg, clash)}, which this file already registers`)
    // Statements before the `return` run once per emitted factory. A
    // destructure of the real module (`const { X } = await importOriginal()`)
    // lands here and reads it whole, so it is refused.
    for (const st of otherPre) {
      const r = originalReads(st)
      if (r === null || r.size) return refusal("reads the real module in a statement before its return")
      if (emitEntries.length > 1) return refusal("has statements before its return, which a split would run once per entry")
    }
    if (dead.length) note("mock-dead-keys", call, `${calleeName(call)}(${pkg}) overrides ${dead.map(propKeyName).join(", ")}, which ${pkg} does not export (inert) — kept on the ${sub(pkg, emitEntries.find((e) => byEntry.has(e)) ?? emitEntries[0])} mock`)
    const deadHome = emitEntries.find((e) => byEntry.has(e)) ?? emitEntries[0]
    const callText = text.slice(stmt.getStart(sf), stmt.getEnd())
    const base = stmt.getStart(sf)
    const objStart = obj.getStart(sf) - base
    const objEnd = obj.getEnd() - base
    const tailText = obj.properties.length ? text.slice(obj.properties[obj.properties.length - 1].getEnd(), obj.getEnd()) : null
    // Renaming follows classification: exactly the root literals collected
    // above, by position — never a textual search for the root.
    const lits = [...rootLiterals]
    /** The original text of [start, end) with every classified root literal inside it renamed to `entry`. */
    const renamed = (start, end, entry) => {
      let t = text.slice(start, end)
      for (const l of lits.filter((l) => l.getStart(sf) >= start && l.getEnd() <= end).sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
        t = t.slice(0, l.getStart(sf) + 1 - start) + sub(pkg, fixedEntry.get(l) ?? entry) + t.slice(l.getEnd() - 1 - start)
      }
      return t
    }
    const out = []
    for (const entry of emitEntries) {
      const keep = [...(byEntry.get(entry) ?? []), ...(entry === deadHome ? dead : [])]
      let t
      if (!partial && keep.length === 0 && spreads.length === 0) {
        t = `${calleeName(call)}(${q}${sub(pkg, entry)}${q}, () => ({}))`
      } else {
        const keepSet = new Set(keep)
        // object literal: `{` + kept members (each with its leading trivia) + original tail
        const members = obj.properties.filter((p) => ts.isSpreadAssignment(p) || keepSet.has(p))
        // The first member takes the original first member's leading
        // whitespace, so `({\n  a,` stays `({\n  a,` whichever member leads.
        const firstLead = /^\s*/.exec(text.slice(obj.properties[0].getFullStart(), obj.properties[0].getStart(sf)))[0]
        let objText = "{"
        members.forEach((p, i) => {
          // renamed on the original slice first, so literal offsets hold
          const own = renamed(p.getFullStart(), p.getEnd(), entry)
          objText += i ? `,${own}` : firstLead + own.replace(/^\s*/, "")
        })
        objText += tailText ?? "}"
        // whole call with the object swapped and the root literals outside it renamed
        const pieces = [[objStart, objEnd, objText]]
        for (const l of lits) {
          const s = l.getStart(sf) - base
          if (s > objStart && s < objEnd) continue // inside the object: renamed per member above
          pieces.push([s + 1, l.getEnd() - base - 1, sub(pkg, fixedEntry.get(l) ?? entry)])
        }
        t = callText
        for (const [s, e, r] of pieces.sort((a, b) => b[0] - a[0])) t = t.slice(0, s) + r + t.slice(e)
      }
      out.push(t)
      stats.mockEntries++
    }
    stats.mocks++
    stats.specifiers++
    if (!partial) {
      out.unshift(`// ${pkg} was mocked whole here; split per entry, the entries without an override stay mocked empty (tools/package-entries/codemod.mjs).`)
    }
    edits.push([stmt.getStart(sf), stmt.getEnd(), out.join(`\n${indent}`)])
    // mark the call's inner import types / loader calls as handled
    const mark = (n) => {
      if (ts.isImportTypeNode(n)) handledImportTypes.add(n)
      if (ts.isCallExpression(n)) handledCalls.add(n)
      ts.forEachChild(n, mark)
    }
    mark(call)
  }

  // ---- main walk ----
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && ROOTS.has(node.moduleSpecifier.text)) {
      const pkg = node.moduleSpecifier.text
      const c = node.importClause
      if (!c) note("side-effect", node, `side-effect import of ${pkg} — kept on the root`)
      else if (c.name) note("default", node, `default import of ${pkg} — kept on the root`)
      else if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) resolveNamespace(pkg, c.namedBindings.name.text, c.namedBindings.name, node.moduleSpecifier, "namespace import")
      else if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        if (c.namedBindings.elements.length === 0) note("empty", node, `empty import of ${pkg} — kept on the root`)
        else pending.push(() => splitStatement(node, pkg, c.namedBindings.elements, "import", c.isTypeOnly))
      }
      return
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && ROOTS.has(node.moduleSpecifier.text)) {
      const pkg = node.moduleSpecifier.text
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) note("export-star", node, `\`export *\` from ${pkg} — kept on the root`)
      else pending.push(() => splitStatement(node, pkg, node.exportClause.elements, "export", node.isTypeOnly))
      return
    }
    if (ts.isCallExpression(node) && !handledCalls.has(node)) {
      const name = calleeName(node)
      const lit = rootArg(node)
      if (lit && name && MOCKERS.has(name)) {
        const pkg = lit.text
        pending.push(() => splitMock(node, pkg))
        // the mock owns everything inside it
        const mark = (n) => {
          if (ts.isImportTypeNode(n)) handledImportTypes.add(n)
          if (ts.isCallExpression(n)) handledCalls.add(n)
          ts.forEachChild(n, mark)
        }
        ts.forEachChild(node, mark)
        return
      }
      if (lit && name && MODULE_LOADERS.has(name)) {
        const pkg = lit.text
        handledCalls.add(node)
        // walk up through await / parens / `as`
        let top = node
        while (top.parent && (ts.isAwaitExpression(top.parent) || ts.isParenthesizedExpression(top.parent) || ts.isAsExpression(top.parent) || ts.isNonNullExpression(top.parent))) top = top.parent
        const decl = top.parent
        if (decl && ts.isVariableDeclaration(decl) && decl.initializer === top) {
          if (ts.isObjectBindingPattern(decl.name)) pending.push(() => splitDestructure(decl, node, pkg, name))
          else if (ts.isIdentifier(decl.name)) {
            pending.push(() => {
              const before = edits.length
              resolveNamespace(pkg, decl.name.text, decl.name, lit, `${name}() binding`)
              if (edits.length > before) {
                for (const l of loaderLiterals(node, pkg)) if (l !== lit) edits.push([l.getStart(sf) + 1, l.getEnd() - 1, edits[edits.length - 1][2]])
                stats.dynamic++
              }
            })
          } else note("dynamic-shape", node, `${name}(${pkg}) bound to an unsupported pattern — kept on the root`)
        } else note("dynamic-shape", node, `${name}(${pkg}) not bound to a declaration — kept on the root`)
        for (const t of node.typeArguments ?? []) {
          const mark = (n) => { if (ts.isImportTypeNode(n)) handledImportTypes.add(n); ts.forEachChild(n, mark) }
          mark(t)
        }
        return
      }
    }
    if (ts.isImportTypeNode(node) && !handledImportTypes.has(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal) && ROOTS.has(node.argument.literal.text)) {
      const pkg = node.argument.literal.text
      const litNode = node.argument.literal
      if (node.qualifier) {
        let q = node.qualifier
        while (ts.isQualifiedName(q)) q = q.left
        const entry = entryOf(pkg, q.text)
        if (!entry) note("unknown-name", node, `\`${q.text}\` is not exported by ${pkg} — type query kept on the root`)
        else { edits.push([litNode.getStart(sf) + 1, litNode.getEnd() - 1, sub(pkg, entry)]); stats.typeQueries++; stats.specifiers++ }
      } else note("typeof-root", node, `\`typeof import("${pkg}")\` outside a mock — kept on the root`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  for (const run of pending) run()

  let out = applyEdits(file, text, edits)
  out = mergeSameEntryImports(file, out, kind, notes, stats)
  return { text: out, changed: out !== text, notes, stats }
}

/** Apply [start, end, replacement] edits right-to-left; drop exact duplicates; refuse overlaps. */
function applyEdits(file, text, edits) {
  const sorted = [...new Map(edits.map((e) => [`${e[0]}:${e[1]}`, e])).values()].sort((a, b) => b[0] - a[0])
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][1] > sorted[i - 1][0]) throw new Error(`${file}: overlapping edits at ${sorted[i][0]}..${sorted[i][1]} and ${sorted[i - 1][0]}..${sorted[i - 1][1]}`)
  }
  let out = text
  for (const [s, e, r] of sorted) out = out.slice(0, s) + r + out.slice(e)
  return out
}

const SUBPATH_RE = /^@nodaro\/(?:shared|prompts)\/[a-z0-9][a-z0-9-]*$/
const commentsOf = (t) => (t.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []).sort().join("\u0000")

/**
 * One import statement per subpath entry: a file whose root import split into
 * an entry it already imported from (or that imported the root twice) ends up
 * with two `from "@nodaro/shared/models"` lines; they are merged into the
 * first. Names from an `import type` statement keep an inline `type`; when
 * every statement is type-only the result is `import type`. A statement with
 * a default/namespace binding or a comment of its own (outside the braces) is
 * left alone, and so is a group whose merge would lose a comment.
 */
function mergeSameEntryImports(file, text, kind, notes, stats) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const groups = new Map()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier) || !SUBPATH_RE.test(st.moduleSpecifier.text)) continue
    const c = st.importClause
    if (!c || c.name || !c.namedBindings || !ts.isNamedImports(c.namedBindings) || c.namedBindings.elements.length === 0) continue
    // A comment heading the statement (or after it on its line) belongs to it alone.
    const lead = text.slice(st.getFullStart(), st.getStart(sf))
    const lineEnd = text.indexOf("\n", st.getEnd())
    const after = text.slice(st.getEnd(), lineEnd < 0 ? text.length : lineEnd)
    const leadOwn = lead.slice(lead.lastIndexOf("\n\n") + 1)
    if (/\/[/*]/.test(after)) continue
    const key = st.moduleSpecifier.text
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ st, headed: /\/[/*]/.test(leadOwn) })
  }
  const edits = []
  for (const [spec, list] of groups) {
    if (list.length < 2) continue
    // The first statement may carry its own header comment; the merged-away ones may not.
    if (list.slice(1).some((x) => x.headed)) {
      notes.push({ kind: "merge-skipped", line: sf.getLineAndCharacterOfPosition(list[1].st.getStart(sf)).line + 1, detail: `a second import of ${spec} has a comment of its own — not merged` })
      continue
    }
    const sts = list.map((x) => x.st)
    const allType = sts.every((st) => st.importClause.isTypeOnly)
    const first = sts[0]
    const q = text[first.moduleSpecifier.getStart(sf)]
    const firstText = text.slice(first.getStart(sf), first.getEnd())
    const semi = firstText.trimEnd().endsWith(";") ? ";" : ""
    const indentBase = lineIndent(text, first.getStart(sf))
    const lines = []
    let anyComment = false
    let multiline = false
    let trailingComma = false
    let singleSources = 0
    for (const st of sts) {
      const els = st.importClause.namedBindings.elements
      const close = text.indexOf("}", els[els.length - 1].getEnd())
      if (text.slice(st.getStart(sf), close).includes("\n")) multiline = true
      if (els.hasTrailingComma) trailingComma = true
      if (!text.slice(st.getStart(sf), close).includes("\n")) singleSources++
      els.forEach((e, i) => {
        const lead = (text.slice(e.getFullStart(), e.getStart(sf)).match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? [])
        let core = text.slice(e.getStart(sf), e.getEnd())
        if (st.importClause.isTypeOnly && !allType && !e.isTypeOnly) core = `type ${core}`
        if (allType && e.isTypeOnly) core = core.replace(/^type\s+/, "")
        const tail = i === els.length - 1 ? (text.slice(e.getEnd(), close).match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []) : []
        if (lead.length || tail.length) anyComment = true
        lines.push({ lead, core, tail })
      })
    }
    const kw = allType ? "import type" : "import"
    const target = `${q}${spec}${q}`
    const single = `${kw} { ${lines.map((l) => l.core).join(", ")} } from ${target}${semi}`
    let merged
    if (!anyComment && !multiline && single.length - indentBase.length <= 120) merged = single
    else {
      const elIndent = `${indentBase}  `
      // A list laid out fresh (every source was one line) takes the repo's
      // usual trailing comma; otherwise the multi-line sources' own style wins.
      if (singleSources === sts.length) trailingComma = true
      const body = []
      lines.forEach((l, i) => {
        for (const c of l.lead) body.push(`${elIndent}${c}`)
        const comma = i < lines.length - 1 || trailingComma ? "," : ""
        body.push(`${elIndent}${l.core}${comma}${l.tail.length ? ` ${l.tail.join(" ")}` : ""}`)
      })
      merged = `${kw} {\n${body.join("\n")}\n${indentBase}} from ${target}${semi}`
    }
    const before = sts.map((st) => text.slice(st.getStart(sf), st.getEnd())).join("\n")
    if (commentsOf(before) !== commentsOf(merged)) {
      notes.push({ kind: "merge-skipped", line: sf.getLineAndCharacterOfPosition(first.getStart(sf)).line + 1, detail: `merging the imports of ${spec} would lose a comment — not merged` })
      continue
    }
    edits.push([first.getStart(sf), first.getEnd(), merged])
    for (const st of sts.slice(1)) {
      // Remove the whole line when the statement is alone on it.
      const ls = text.lastIndexOf("\n", st.getStart(sf) - 1) + 1
      const le = text.indexOf("\n", st.getEnd())
      const alone = /^[ \t]*$/.test(text.slice(ls, st.getStart(sf))) && /^[ \t]*;?[ \t]*$/.test(text.slice(st.getEnd(), le < 0 ? text.length : le))
      edits.push(alone ? [ls, le < 0 ? text.length : le + 1, ""] : [st.getStart(sf), st.getEnd(), ""])
    }
    stats.merged = (stats.merged ?? 0) + sts.length - 1
  }
  return edits.length ? applyEdits(file, text, edits) : text
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function defaultFiles() {
  const listed = execFileSync("git", ["ls-files", "--", ...DEFAULT_GLOBS], { cwd: repo, encoding: "utf8" })
    .split("\n").filter(Boolean)
  return listed.filter((f) => EXT_RE.test(f) && !f.includes("/dist/") && !isPackageEntrySource(f))
}

export function isPackageEntrySource(f) {
  return /^packages\/(shared|prompts)\/src\/(index\.ts$|entries\/)/.test(f)
}

function main(argv) {
  const write = argv.includes("--write")
  const ri = argv.indexOf("--report")
  const reportPath = ri >= 0 ? path.resolve(argv[ri + 1]) : null
  const explicit = argv.filter((a, i) => !a.startsWith("--") && !(ri >= 0 && i === ri + 1))
  const files = explicit.length ? explicit.map((f) => path.relative(repo, path.resolve(f))) : defaultFiles()
  const maps = loadEntryMaps()
  const report = { files: {}, totals: { files: 0, statements: 0, specifiers: 0, mocks: 0, mockEntries: 0, typeQueries: 0, dynamic: 0, namespaces: 0, merged: 0 }, notes: [] }
  for (const f of files) {
    const abs = path.join(repo, f)
    const text = fs.readFileSync(abs, "utf8")
    if (!text.includes("@nodaro/shared") && !text.includes("@nodaro/prompts")) continue
    const r = transformFile(f, text, maps)
    for (const n of r.notes) report.notes.push({ file: f, ...n })
    if (!r.changed) continue
    report.files[f] = r.stats
    report.totals.files++
    for (const k of Object.keys(r.stats)) report.totals[k] = (report.totals[k] ?? 0) + r.stats[k]
    if (write) fs.writeFileSync(abs, r.text)
  }
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1))
  const t = report.totals
  console.log(`${write ? "rewrote" : "would rewrite"} ${t.files} files: ${t.specifiers} specifiers (${t.statements} import/export statements, ${t.typeQueries} type queries, ${t.dynamic} dynamic, ${t.namespaces} namespaces, ${t.mocks} mocks → ${t.mockEntries} entry mocks, ${t.merged} same-entry imports merged)`)
  for (const n of report.notes) console.log(`  ${n.kind}: ${n.file}:${n.line} — ${n.detail}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
