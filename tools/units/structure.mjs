// tools/units/structure.mjs
// The node-unit guards that need the TypeScript parser (G2, G2b, G7 of
// tools/units/README.md). Pure: the caller passes `ts` (the repo-root
// TypeScript, as tools/structure/ does) and the sources, so the frontend
// Vitest suite runs them on the real tree and on fixtures alike.

const kindOf = (ts, node) => ts.SyntaxKind[node.kind]

/** Every string literal value in a module (comments never count). */
export function stringLiterals(ts, path, source) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out = new Set()
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * G2: a unit's type id named as a string literal in a product file outside
 * the unit's own folders. `files`: [{ path, source }] (product modules);
 * `allowed(path, type)`: true for a place that may name it (the unit's
 * folders, the generated outputs, a reasoned central-mentions.json entry).
 * Returns `<path>: "<type>"` lines. A cheap text prefilter keeps the AST pass
 * to the few files that contain the id at all.
 */
export function centralMentions(ts, files, unitTypes, allowed) {
  const out = []
  if (!unitTypes.length) return out
  for (const { path, source } of files) {
    const candidates = unitTypes.filter((t) => source.includes(t) && !allowed(path, t))
    if (!candidates.length) continue
    const literals = stringLiterals(ts, path, source)
    for (const t of candidates) if (literals.has(t)) out.push(`${path}: "${t}"`)
  }
  return out.sort()
}

/**
 * G2b: a key in a unit's strings.json that is ALSO a hand-written dict line
 * (outside the `// gen:units` region) or is named by a product file outside
 * the unit's folders. A key used outside the unit stays hand-written.
 * `units`: [{ type, keys: string[] }]; `dicts`: [{ path, source }];
 * `files`: product modules [{ path, source }]; `inUnit(path, type)`.
 */
export function unitStringProblems(ts, units, dicts, files, inUnit) {
  const out = []
  const handWritten = new Map()
  for (const d of dicts) {
    let inRegion = false
    for (const line of d.source.split(/\r?\n/)) {
      if (line.trim() === "// gen:units start") inRegion = true
      else if (line.trim() === "// gen:units end") inRegion = false
      else if (!inRegion) {
        const m = line.match(/^\s*"((?:[^"\\]|\\.)+)":/)
        if (m) handWritten.set(m[1], d.path)
      }
    }
  }
  const dictPaths = new Set(dicts.map((d) => d.path))
  for (const u of units) {
    for (const k of u.keys) {
      if (handWritten.has(k)) out.push(`${u.type}: "${k}" is also hand-written in ${handWritten.get(k)} — a unit owns only keys it alone uses`)
      for (const f of files) {
        if (dictPaths.has(f.path) || inUnit(f.path, u.type) || !f.source.includes(k)) continue
        if (stringLiterals(ts, f.path, f.source).has(k)) out.push(`${u.type}: "${k}" is used by ${f.path} — keep it hand-written in the dicts, not in strings.json`)
      }
    }
  }
  return out.sort()
}

// G7: a call a unit module may make at top level — constructors with no side
// effect (React.memo, forwardRef, lazy, a zod schema, Object.freeze).
const PURE_CALLS = /^(?:(?:React\.)?(?:memo|forwardRef|lazy)|Object\.freeze|z(?:\.[A-Za-z_$][\w$]*)+)$/
const PURE_NEW = new Set(["Set", "Map", "WeakMap", "WeakSet", "RegExp"])

function isPure(ts, e) {
  if (!e) return true
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression?.(e)) return isPure(ts, e.expression)
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true
  if (ts.isClassExpression(e)) return classIsPure(ts, e)
  if (ts.isStringLiteral(e) || ts.isNumericLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isBigIntLiteral(e) || ts.isRegularExpressionLiteral(e)) return true
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword, ts.SyntaxKind.UndefinedKeyword].includes(e.kind)) return true
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) return true
  if (ts.isTemplateExpression(e)) return e.templateSpans.every((s) => isPure(ts, s.expression))
  if (ts.isArrayLiteralExpression(e)) return e.elements.every((x) => isPure(ts, ts.isSpreadElement(x) ? x.expression : x))
  if (ts.isObjectLiteralExpression(e)) {
    // A computed key evaluates when the literal does — on a method or an
    // accessor too, though their bodies run only when called.
    return e.properties.every((p) => (p.name && ts.isComputedPropertyName(p.name) && !isPure(ts, p.name.expression) ? false
      : ts.isPropertyAssignment(p) ? isPure(ts, p.initializer)
        : ts.isSpreadAssignment(p) ? isPure(ts, p.expression)
          : true)) // shorthand, methods, accessors
  }
  if (ts.isPrefixUnaryExpression(e)) return isPure(ts, e.operand)
  if (ts.isBinaryExpression(e)) return e.operatorToken.kind !== ts.SyntaxKind.EqualsToken && isPure(ts, e.left) && isPure(ts, e.right)
  if (ts.isConditionalExpression(e)) return isPure(ts, e.condition) && isPure(ts, e.whenTrue) && isPure(ts, e.whenFalse)
  if (ts.isCallExpression(e)) return (PURE_CALLS.test(e.expression.getText()) || isZodChain(ts, e.expression)) && e.arguments.every((a) => isPure(ts, a))
  if (ts.isNewExpression(e)) return ts.isIdentifier(e.expression) && PURE_NEW.has(e.expression.text) && (e.arguments ?? []).every((a) => isPure(ts, a))
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return true
  return false
}

// A zod schema built by chaining (`z.string().uuid().optional()`): a method of
// a call that is itself a pure zod call. Each link only builds a schema.
function isZodChain(ts, callee) {
  return ts.isPropertyAccessExpression(callee) && ts.isCallExpression(callee.expression) && isPure(ts, callee.expression)
    && /^z[.(]/.test(callee.expression.getText())
}

const decorated = (ts, node) => Boolean(ts.canHaveDecorators?.(node) && ts.getDecorators(node)?.length)

// What a class runs when it is DEFINED counts like top-level code: its static
// initializers and static blocks, every decorator (on the class, a member or
// a parameter — a decorator is a call made at definition), every computed
// member name (instance members too: `[compute()] = 1` evaluates its key at
// definition, only its initializer waits for `new`) and its `extends`
// expression. Instance initializers and method bodies run only later.
function classIsPure(ts, cls) {
  if (decorated(ts, cls)) return false
  return cls.members.every((m) => {
    if (ts.isClassStaticBlockDeclaration(m)) return false
    if (decorated(ts, m) || (m.parameters ?? []).some((p) => decorated(ts, p))) return false
    if (m.name && ts.isComputedPropertyName(m.name) && !isPure(ts, m.name.expression)) return false
    const isStatic = m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
    if (isStatic && ts.isPropertyDeclaration(m)) return isPure(ts, m.initializer)
    return true
  }) && !(cls.heritageClauses ?? []).some((h) => h.types.some((t) => !isPure(ts, t.expression)))
}

/**
 * G7: the top-level statements of a unit module that are not declarations
 * free of side effects. A change to such a module could break a module that
 * merely loads it, so the engine's registry rule could not trust it.
 * Returns `<path>:<line> <what>` lines.
 */
export function sideEffectProblems(ts, path, source) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out = []
  const at = (n) => `${path}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) || ts.isExportDeclaration(st)) continue
    if (ts.isClassDeclaration(st)) {
      if (!classIsPure(ts, st)) out.push(`${at(st)} class ${st.name?.text ?? "(default)"} runs code when it is defined (a decorator, a computed member name, a static initializer or block) that may have a side effect`)
      continue
    }
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) continue
    if (ts.isEmptyStatement(st)) continue
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (!isPure(ts, d.initializer)) out.push(`${at(d)} the initializer of ${d.name.getText(sf)} may have a side effect (only literals, functions and pure constructors at top level)`)
      continue
    }
    if (ts.isExportAssignment(st)) {
      if (!isPure(ts, st.expression)) out.push(`${at(st)} export default of an expression that may have a side effect`)
      continue
    }
    out.push(`${at(st)} a top-level ${kindOf(ts, st)} — unit modules hold declarations only`)
  }
  return out
}

/**
 * A composer's exports that read its composed collection but are not
 * declared. A composer is a pass-through for its registries, so a test that
 * reaches only the composer is not selected by a unit change — but an export
 * DERIVED from the collection (`getEnrichedRegistry()`, `FAMILY_RANK`, a
 * `localize*` helper over LABEL_TABLES) carries every unit to its callers. Each
 * such export must be named in registry-composers.json: `exports` (callers
 * count as enumerators unless they declare @registry-lookup) or `lookups`
 * (reviewed: it only ever answers for the one type it is given).
 * `declared`: every name in that composer's `exports` and `lookups`;
 * `collection`: the names in `exports`. "Reads the collection" starts from
 * those AND from every binding the composer imports from a node-unit
 * aggregate (`_generated/`), so `export const UNIT_TYPES = UNIT_DEFINITIONS.map(…)`
 * is caught too; it is transitive through the file's other top-level
 * declarations. A re-export of an aggregate binding (`export { UNIT_X } from
 * "…/_generated/…"`, `export * from` one — reported as "*" — or a local
 * `export { UNIT_X }` of its import) counts as reading it. Returns the
 * undeclared exported (public) names, sorted.
 */
export function composerExportProblems(ts, path, source, collection, declared) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const decls = new Map() // top-level name → { node, names: public export names }
  // The aggregate imports' bindings are part of the collection.
  const seeds = new Set(collection)
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.importClause?.isTypeOnly || !ts.isStringLiteral(st.moduleSpecifier) || !/(?:^|\/)_generated\//.test(st.moduleSpecifier.text)) continue
    const clause = st.importClause
    if (clause?.name) seeds.add(clause.name.text)
    const nb = clause?.namedBindings
    if (nb && ts.isNamespaceImport(nb)) seeds.add(nb.name.text)
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) seeds.add(el.name.text)
  }
  collection = seeds
  const isExported = (st) => Boolean(st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) decls.set(d.name.text, { node: d, names: isExported(st) ? [d.name.text] : [] })
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
      decls.set(st.name.text, { node: st, names: isExported(st) ? [st.name.text] : [] })
    }
  }
  // Re-exports of the collection itself: `export { UNIT_X } from "…/_generated/…"`,
  // `export * from "…/_generated/…"` (named "*"), and a local
  // `export { UNIT_X }` of an aggregate import. Type-only forms carry no value.
  const reExported = []
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.isTypeOnly) continue
    const fromAggregate = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && /(?:^|\/)_generated\//.test(st.moduleSpecifier.text)
    if (st.moduleSpecifier && !fromAggregate) continue
    if (!st.exportClause) { reExported.push("*"); continue }
    if (ts.isNamespaceExport(st.exportClause)) { reExported.push(st.exportClause.name.text); continue }
    for (const el of st.exportClause.elements) {
      if (el.isTypeOnly) continue
      const local = (el.propertyName ?? el.name).text
      if (fromAggregate) reExported.push(el.name.text)
      else if (decls.has(local)) decls.get(local).names.push(el.name.text)
      else if (collection.has(local)) reExported.push(el.name.text)
    }
  }
  const refs = new Map()
  for (const [name, { node }] of decls) {
    const seen = new Set()
    const visit = (n) => {
      if (ts.isIdentifier(n) && n.text !== name && decls.has(n.text)) seen.add(n.text)
      if (ts.isIdentifier(n) && collection.has(n.text)) seen.add(n.text)
      ts.forEachChild(n, visit)
    }
    ts.forEachChild(node, visit)
    refs.set(name, seen)
  }
  const reads = new Set([...collection].filter((n) => decls.has(n)))
  for (let grew = true; grew;) {
    grew = false
    for (const [name, r] of refs) {
      if (reads.has(name)) continue
      if ([...r].some((x) => reads.has(x) || collection.has(x))) { reads.add(name); grew = true }
    }
  }
  return [...[...decls].filter(([n]) => reads.has(n)).flatMap(([, d]) => d.names), ...reExported].filter((n) => !declared.has(n)).sort()
}

/**
 * The registries a module reads EVERY unit of while it LOADS (decided
 * 2026-10-18): a composer that validates or folds its collection at module
 * evaluation (`composeNodeDefinitions(LEGACY, UNIT_DEFINITIONS)` throwing on a
 * duplicate type, `unitOption` demanding an option.tsx icon, `new Map(UNITS.map((d) => [d.type, d]))`)
 * makes every test that merely imports it fail when one unit breaks — so it is
 * an enumerator of that registry, not a pass-through
 * (registry-composers.json `foldsAtLoad`, tools/test-select/registry.mjs).
 *
 * `namesById`: Map<registry id, Set<export name>> — every name a registry is
 * consumed through (the aggregates' `@registry-exports` and the composers'
 * `exports`). `modules`: Map<repo path without extension, Set<id>> — the
 * aggregates and composers, so a default, namespace or dynamic import of one is
 * known (a namespace import of a `_generated/` module it does not list counts
 * for every registry). The registry's VALUES in the module are:
 *   - a binding imported under one of its names (from any module), or the
 *     default import of a module that holds it;
 *   - `NS.<name>` of any namespace import, and a bare namespace of a module
 *     that holds it (`Object.values(NS)`);
 *   - `import("<module that holds it>")` — dynamic, awaited or not;
 *   - every top-level declaration that refers to one of these, transitively
 *     (a function, a class, or a value).
 * Never the module's own export names. The module READS the registry at load
 * when code that runs while it is evaluated uses one of them: calls it,
 * constructs it, reads a member, iterates or spreads it, destructures it,
 * operates on it, or hands a value of it to a call. A FUNCTION (or class) of
 * it handed to a call counts too — the callee may run it now — except under
 * `strict` (the @registry-lookup guard), where only a call or a read counts and a
 * function counts when handed to an iterating method (`.map`, `.forEach`, …).
 * Merely naming one is not a read: a bare alias (`export const B = A`), a
 * value in an object or array literal that is itself only named
 * (`export const API = { get }`, `export default { get }`), `typeof A`, an
 * expression statement. Code that runs at load: top-level initializers and
 * statements, a class's decorators, `extends`, computed names, static members,
 * and its constructor and instance members when it is constructed there, and
 * any function or object-literal method that is invoked or (not `strict`)
 * handed to a call there. The functions React's `memo` / `forwardRef` / `lazy`
 * (imported from "react") are given are stored, not run; their other
 * arguments are evaluated. Unparseable source counts as reading every
 * registry it names. Returns the ids, sorted.
 */
export function loadTimeRegistryReads(ts, path, source, namesById, { modules = new Map(), strict = false } = {}) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (sf.parseDiagnostics?.length) {
    return [...namesById].filter(([, names]) => [...names].some((n) => source.includes(n))).map(([id]) => id).sort()
  }
  const allIds = new Set(namesById.keys())
  const stems = new Map([...modules].map(([p, ids]) => [moduleStem(p), ids]))
  const idsOf = (spec) => {
    const stem = resolveSpecifier(path, spec)
    if (stem && stems.has(stem)) return stems.get(stem)
    return /(?:^|\/)_generated\//.test(spec) ? allIds : null
  }
  const named = new Map() // local → imported name
  const defaults = new Map() // local → ids of the module
  const namespaces = new Map() // local → ids of the module, or null (any module: only NS.<name> counts)
  const react = { names: new Set(), ns: new Set() }
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.importClause?.isTypeOnly || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const spec = st.moduleSpecifier.text
    const ids = idsOf(spec)
    const clause = st.importClause
    const nb = clause?.namedBindings
    if (spec === "react") {
      if (clause?.name) react.ns.add(clause.name.text)
      if (nb && ts.isNamespaceImport(nb)) react.ns.add(nb.name.text)
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (REACT_WRAPPERS.has((el.propertyName ?? el.name).text)) react.names.add(el.name.text)
      continue
    }
    if (clause?.name && ids) defaults.set(clause.name.text, ids)
    if (nb && ts.isNamespaceImport(nb)) namespaces.set(nb.name.text, ids)
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) named.set(el.name.text, (el.propertyName ?? el.name).text)
  }
  // Top-level declarations: name → { node, kind: "fn" | "class" | "value" }.
  const decls = new Map()
  const bindNames = (name, node, kind) => {
    if (ts.isIdentifier(name)) decls.set(name.text, { node, kind })
    else for (const el of name.elements ?? []) if (!ts.isOmittedExpression(el)) bindNames(el.name, node, "value")
  }
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = strip(ts, d.initializer)
        bindNames(d.name, d, init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? "fn" : init && ts.isClassExpression(init) ? "class" : "value")
      }
    } else if (ts.isFunctionDeclaration(st) && st.name) decls.set(st.name.text, { node: st, kind: "fn" })
    else if (ts.isClassDeclaration(st) && st.name) decls.set(st.name.text, { node: st, kind: "class" })
    else if (ts.isEnumDeclaration(st)) decls.set(st.name.text, { node: st, kind: "value" })
  }
  const out = []
  for (const [id, names] of namesById) {
    // name → kind, for the registry's values in this module
    const hot = new Map()
    for (const [local, from] of named) if (names.has(from)) hot.set(local, "value")
    for (const [local, ids] of defaults) if (ids.has(id)) hot.set(local, "value")
    const ctx = { ts, sf, id, names, hot, namespaces, idsOf, react, decls, strict }
    for (let grew = true; grew;) {
      grew = false
      for (const [name, { node, kind }] of decls) {
        if (hot.has(name) || !mentionsHot(ctx, node)) continue
        hot.set(name, kind)
        grew = true
      }
    }
    if (readsAtLoad(ctx)) out.push(id)
  }
  return out.sort()
}

const REACT_WRAPPERS = new Set(["memo", "forwardRef", "lazy"])
// Methods that run the function they are given, now.
const ITERATING = new Set(["map", "flatMap", "forEach", "filter", "reduce", "reduceRight", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "sort", "toSorted", "from"])

const moduleStem = (p) => p.replace(/\.(?:[cm]?[jt]sx?)$/, "").replace(/\/index$/, "")
// The repo path (no extension) an import specifier names: `@/…` is the
// importer's tree's src/, a relative one is resolved; a package is null.
function resolveSpecifier(importer, spec) {
  let p
  if (spec.startsWith("@/")) p = `${importer.split("/")[0]}/src/${spec.slice(2)}`
  else if (spec.startsWith(".")) p = posixJoin(importer.split("/").slice(0, -1), spec)
  else return null
  return moduleStem(p)
}
function posixJoin(dirParts, spec) {
  const parts = [...dirParts]
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") parts.pop()
    else parts.push(seg)
  }
  return parts.join("/")
}

function strip(ts, e) {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression?.(e))) e = e.expression
  return e
}
const isFnExpr = (ts, e) => Boolean(e) && (ts.isArrowFunction(e) || ts.isFunctionExpression(e))

// An identifier that names something (a property, a declaration) rather than reading a binding.
function isNameSlot(ts, n) {
  const p = n.parent
  if (!p) return false
  if (ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) return p.name === n || p.right === n
  if (ts.isShorthandPropertyAssignment(p)) return false
  if (ts.isBindingElement(p) && p.propertyName === n) return true
  return "name" in p && p.name === n
}
const isImportCall = (ts, n) => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword

// The kind ("value" | "fn" | "class") of a registry value `n` IS, or null.
// A namespace member is judged at the access, never at its bare object.
function hotRef(ctx, n) {
  const { ts, id, names, hot, namespaces, idsOf } = ctx
  if (ts.isIdentifier(n)) {
    if (isNameSlot(ts, n)) return null
    if (hot.has(n.text)) return hot.get(n.text)
    if (namespaces.has(n.text)) {
      const p = n.parent
      if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) return null
      return namespaces.get(n.text)?.has(id) ? "value" : null
    }
    return null
  }
  if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && ts.isIdentifier(n.expression) && namespaces.has(n.expression.text) && !hot.has(n.expression.text)) {
    const key = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : null
    if (key !== null) return names.has(key) ? "value" : null
    return namespaces.get(n.expression.text)?.has(id) ? "value" : null // NS[k]: any member
  }
  if (isImportCall(ts, n)) {
    const arg = n.arguments[0]
    return arg && ts.isStringLiteralLike(arg) && idsOf(arg.text)?.has(id) ? "value" : null
  }
  return null
}

function mentionsHot(ctx, node) {
  let found = false
  const visit = (n) => {
    if (found) return
    if (hotRef(ctx, n)) { found = true; return }
    ctx.ts.forEachChild(n, visit)
  }
  ctx.ts.forEachChild(node, visit)
  return found
}

// How the value of expression `n` is used where it stands. Literals and
// value-passing operators (`a ?? b`, `c ? a : b`) are looked through; going
// through a literal makes it `wrapped` (the literal holds the value, nothing reads it).
// Returns "none" | "call" | "read" | { pass: call }.
function useOf(ts, n, wrapped = false) {
  let c = n
  for (;;) {
    const p = c.parent
    if (!p) return "read"
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression?.(p)) { c = p; continue }
    if ((ts.isPropertyAssignment(p) && p.initializer === c) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) {
      if (ts.isObjectLiteralExpression(p.parent)) { c = p.parent; wrapped = true; continue }
    }
    if (ts.isArrayLiteralExpression(p)) { c = p; wrapped = true; continue }
    if ((ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) && wrapped) { c = p.parent; continue }
    if (ts.isConditionalExpression(p) && p.condition !== c) { c = p; continue }
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.CommaToken].includes(p.operatorToken.kind) && (p.right === c || p.operatorToken.kind !== ts.SyntaxKind.CommaToken)) { c = p; continue }
    break
  }
  const p = c.parent
  if (ts.isTypeOfExpression(p) || ts.isExpressionStatement(p) || ts.isExportAssignment(p) || ts.isReturnStatement(p) || ts.isVoidExpression(p)) return "none"
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === c) return wrapped ? "read" : "call"
  if (ts.isTaggedTemplateExpression(p) && p.tag === c) return "call"
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && (p.arguments ?? []).includes(c)) return { pass: p }
  if (ts.isVariableDeclaration(p) && p.initializer === c) return ts.isIdentifier(p.name) ? "none" : "read"
  if (ts.isPropertyDeclaration(p) && p.initializer === c) return "none"
  if (ts.isArrowFunction(p) && p.body === c) return "none"
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === c) return "none"
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === c) return "none"
  return "read"
}

const iterating = (ts, call) => ts.isPropertyAccessExpression(call.expression) && ITERATING.has(call.expression.name.text)

// Whether a use runs (or, not strict, may run) a function handed over.
function invokes(ctx, use) {
  if (use === "call" || use === "read") return true
  if (use === "none") return false
  return !ctx.strict || iterating(ctx.ts, use.pass)
}

// Whether a registry value used this way is read: a value handed to a call is
// read; a function or class handed to one only when it may run there.
function counts(ctx, kind, use) {
  if (use === "none") return false
  if (use === "call" || use === "read") return true
  return kind === "value" ? true : invokes(ctx, use)
}

function isReactWrapper(ctx, call) {
  const { ts, react } = ctx
  const e = call.expression
  if (ts.isIdentifier(e)) return react.names.has(e.text)
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && react.ns.has(e.expression.text) && REACT_WRAPPERS.has(e.name.text)
}

// A function (or class) handed to memo / forwardRef / lazy: an inline one, or
// the name of a local function or class.
function isFunctionArg(ctx, a) {
  const { ts, decls } = ctx
  const e = strip(ts, a)
  if (isFnExpr(ts, e) || ts.isClassExpression(e)) return true
  return ts.isIdentifier(e) && ["fn", "class"].includes(decls.get(e.text)?.kind)
}

// Whether code that runs while the module is evaluated reads the registry.
function readsAtLoad(ctx) {
  const { ts, sf } = ctx
  let found = false
  const evaluated = (n) => {
    if (found || !n) return
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return
    const kind = hotRef(ctx, n)
    if (kind) {
      if (counts(ctx, kind, useOf(ts, n))) found = true
      if (!isImportCall(ts, n)) return
    }
    if (ts.isFunctionDeclaration(n)) return
    if (isFnExpr(ts, n)) {
      if (invokes(ctx, useOf(ts, n))) { for (const p of n.parameters) evaluated(p.initializer); evaluated(n.body) }
      return
    }
    if ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) && ts.isObjectLiteralExpression(n.parent)) {
      if (ts.isComputedPropertyName(n.name)) evaluated(n.name.expression)
      if (invokes(ctx, useOf(ts, n.parent, true))) evaluated(n.body)
      return
    }
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      const use = ts.isClassExpression(n) ? useOf(ts, n) : "none"
      return classAtLoad(n, use === "call" || (use !== "none" && use !== "read" && invokes(ctx, use)))
    }
    if (ts.isCallExpression(n) && isReactWrapper(ctx, n)) {
      evaluated(n.expression)
      for (const a of n.arguments) if (!isFunctionArg(ctx, a)) evaluated(a)
      return
    }
    ts.forEachChild(n, evaluated)
  }
  const decorators = (n) => (ts.canHaveDecorators?.(n) && ts.getDecorators(n)) || []
  // A class runs its decorators, `extends`, computed names and static members
  // when it is defined; constructed at load (`new (class { … })()`), every
  // member's code runs too (the constructor, instance fields, and — it may
  // call them — its methods).
  const classAtLoad = (cls, constructed) => {
    for (const d of decorators(cls)) evaluated(d)
    for (const h of cls.heritageClauses ?? []) for (const t of h.types) evaluated(t.expression)
    for (const m of cls.members) {
      for (const d of decorators(m)) evaluated(d)
      for (const p of m.parameters ?? []) for (const d of decorators(p)) evaluated(d)
      if (m.name && ts.isComputedPropertyName(m.name)) evaluated(m.name.expression)
      const isStatic = m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
      if (ts.isClassStaticBlockDeclaration(m)) evaluated(m.body)
      else if (isStatic && ts.isPropertyDeclaration(m)) evaluated(m.initializer)
      else if (constructed) {
        for (const p of m.parameters ?? []) evaluated(p.initializer)
        evaluated(m.initializer)
        evaluated(m.body)
      }
    }
  }
  for (const st of sf.statements) {
    if (found) break
    if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) || ts.isExportDeclaration(st) || ts.isFunctionDeclaration(st)) continue
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isEmptyStatement(st)) continue
    if (ts.isModuleDeclaration(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) { evaluated(d.name); evaluated(d.initializer) }
      continue
    }
    evaluated(st)
  }
  return found
}
