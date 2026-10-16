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
  if (ts.isCallExpression(e)) return PURE_CALLS.test(e.expression.getText()) && e.arguments.every((a) => isPure(ts, a))
  if (ts.isNewExpression(e)) return ts.isIdentifier(e.expression) && PURE_NEW.has(e.expression.text) && (e.arguments ?? []).every((a) => isPure(ts, a))
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return true
  return false
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
