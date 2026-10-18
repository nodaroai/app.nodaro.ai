// tools/units/price-reader.mjs
// Reads a unit's `staticCosts` object literal from backend/src/nodes/<type>/price.ee.ts
// through the TypeScript parser (the repo-root TS 5.9, as tools/structure does),
// for the editor's `priceRows` projection. Loaded lazily by gen.mjs: the
// tools self-test job has no npm install, so nothing that job imports may
// load `typescript` at module scope.
// @reads backend/src/nodes/*/price.ee.ts
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

export function loadTypeScript(root) {
  return createRequire(path.join(root, "package.json"))("typescript")
}

/**
 * The `export const staticCosts = { "<id>": <number>, … }` of one price module
 * (`as const` / `satisfies …` allowed). Throws when it is missing or is not a
 * plain literal: the projection must never guess a price.
 */
export function staticCostsOf(ts, file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== "staticCosts" || !d.initializer) continue
      let init = d.initializer
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (!ts.isObjectLiteralExpression(init)) throw new Error(`${file}: staticCosts must be an object literal`)
      const out = {}
      for (const p of init.properties) {
        if (!ts.isPropertyAssignment(p)) throw new Error(`${file}: staticCosts may only hold "<id>": <number> entries`)
        const key = ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) || ts.isNumericLiteral(p.name) ? p.name.text : null
        let v = p.initializer
        let sign = 1
        if (ts.isPrefixUnaryExpression(v) && v.operator === ts.SyntaxKind.MinusToken) { sign = -1; v = v.operand }
        if (key === null || !ts.isNumericLiteral(v)) throw new Error(`${file}: staticCosts.${key ?? "?"} must be a number literal`)
        out[key] = sign * Number(v.text)
      }
      return out
    }
  }
  throw new Error(`${file}: no exported staticCosts`)
}

/** A reader bound to one repo root: (repoRelativePath) → staticCosts. */
export function priceReader(root) {
  let ts = null
  return (rel) => {
    ts ??= loadTypeScript(root)
    return staticCostsOf(ts, rel, readFileSync(path.join(root, rel), "utf8"))
  }
}
