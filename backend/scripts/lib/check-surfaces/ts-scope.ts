/**
 * Module and class scopes for {@link renderExpr}: what a name means at the top
 * of a file (consts, helper functions and arrows) and inside a class (its own
 * methods, reachable as `this.<name>(…)`).
 */
import ts from "typescript"
import { collectLocals, returnedExpr, type Binding, type Callable, type NativeFn, type Scope } from "./render-path.js"

function callableOf(fn: ts.SignatureDeclaration & { body?: ts.Node }, scope: Scope): Callable {
  return { params: fn.parameters, body: returnedExpr(fn), scope, locals: collectLocals(fn.body) }
}

/**
 * The top-level names of a source file. `natives` are imported functions the
 * checker evaluates for real, keyed by their local name; `domains` the values
 * of finite types it imports (`UseCaseNodeType`), keyed the same way.
 */
export function moduleScope(
  sf: ts.SourceFile,
  natives: ReadonlyMap<string, NativeFn> = new Map(),
  domains: ReadonlyMap<string, readonly string[]> = new Map(),
): Scope {
  const consts = new Map<string, ts.Expression>()
  const fns = new Map<string, ts.SignatureDeclaration & { body?: ts.Node }>()
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        const init = d.initializer
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fns.set(d.name.text, init)
        else consts.set(d.name.text, init)
      }
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      fns.set(st.name.text, st)
    }
  }
  const scope: Scope = {
    lookup: (name): Binding | undefined => {
      const e = consts.get(name)
      return e ? { expr: e, scope } : undefined
    },
    callable: (name, viaThis) => {
      if (viaThis) return undefined
      const fn = fns.get(name)
      return fn ? callableOf(fn, scope) : undefined
    },
    native: (name) => (consts.has(name) || fns.has(name) ? undefined : natives.get(name)),
    domain: (typeName) => domains.get(typeName),
  }
  return scope
}

/** A class's own methods on top of its module's names. */
export function classScope(cls: ts.ClassDeclaration, module: Scope): Scope {
  const methods = new Map<string, ts.MethodDeclaration>()
  for (const m of cls.members) {
    if (ts.isMethodDeclaration(m) && m.body && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))) {
      methods.set(m.name.text, m)
    }
  }
  const scope: Scope = {
    lookup: (name) => module.lookup(name),
    callable: (name, viaThis) => {
      if (!viaThis) return module.callable(name, false)
      const m = methods.get(name)
      return m ? callableOf(m, scope) : undefined
    },
    native: (name) => module.native?.(name),
    domain: (typeName) => module.domain?.(typeName),
  }
  return scope
}
