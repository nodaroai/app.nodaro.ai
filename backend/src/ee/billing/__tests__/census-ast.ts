/**
 * Pure AST helpers shared by the deployment-payer census guards
 * (`plan-keyed-sweeps-census.test.ts`, `plan-tier-reads-census.test.ts`):
 * parse a file, name what it imports, find its top-level functions, and see
 * which table a supabase query chain reads.
 *
 * It reads no file. The tests that import it read the tree themselves and
 * declare it.
 */
import ts from "typescript"

/** `text` parsed with parent pointers: a use is told from a declaration by its parent. */
export function parseWithParents(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/** Whether `id` is a name being declared (an import, a function, a variable, a key) rather than a use. */
export function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isBindingElement(p)) return true
  return (
    (ts.isFunctionDeclaration(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isPropertyAccessExpression(p)) &&
    (p as { name?: ts.Node }).name === id
  )
}

/** Each local name the file binds to an imported one: `import { a as b }`, `const { a: b } = await import(…)`. */
export function importedNames(sf: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>()
  const visit = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n)) names.set(n.name.text, (n.propertyName ?? n.name).text)
    if (ts.isBindingElement(n) && n.propertyName && ts.isIdentifier(n.propertyName) && ts.isIdentifier(n.name)) {
      names.set(n.name.text, n.propertyName.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return names
}

/** The table a query chain reads (`supabase.from("t")…`), or null when the scan cannot see it. */
export function chainTable(expr: ts.Expression): string | null {
  let e: ts.Node = expr
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) {
      e = e.expression
    } else if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const first = e.arguments[0]
      if (e.expression.name.text === "from" && first && ts.isStringLiteralLike(first)) return first.text
      e = e.expression.expression
    } else if (ts.isPropertyAccessExpression(e)) {
      e = e.expression
    } else {
      return null
    }
  }
}

/** A string or template argument's literal text (a substitution reads as a break). */
export function literalText(e: ts.Expression): string | null {
  if (ts.isStringLiteralLike(e)) return e.text
  if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => `\u0000${s.literal.text}`).join("")
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(e.left)
    const right = literalText(e.right)
    return left === null && right === null ? null : `${left ?? "\u0000"}${right ?? "\u0000"}`
  }
  return null
}

/** The file's top-level functions by name: declarations, `const f = (…) => …` / `function` expressions, and class methods (`Class.method`). */
export function topLevelFunctions(sf: ts.SourceFile): Map<string, ts.FunctionLikeDeclaration> {
  const fns = new Map<string, ts.FunctionLikeDeclaration>()
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? unwrap(e.expression) : e
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.body) fns.set(stmt.name?.text ?? "default", stmt)
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        const init = unwrap(d.initializer)
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fns.set(d.name.text, init)
      }
    }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      for (const m of stmt.members) {
        if (ts.isMethodDeclaration(m) && m.body && ts.isIdentifier(m.name)) fns.set(`${stmt.name.text}.${m.name.text}`, m)
      }
    }
  }
  return fns
}

/** Every name a function's body uses: identifiers (by the imported name they are bound to) and property names. */
export function referencedNames(fn: ts.FunctionLikeDeclaration, canonical: (name: string) => string): Set<string> {
  const names = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && !isDeclarationName(n)) names.add(canonical(n.text))
    if (ts.isPropertyAccessExpression(n)) names.add(n.name.text)
    ts.forEachChild(n, visit)
  }
  if (fn.body) visit(fn.body)
  return names
}
