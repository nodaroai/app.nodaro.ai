/**
 * Every virtualizer in the frontend observes its scroll offset through the
 * shared observer (`lib/virtual/observe-scroll-offset.ts`), never the
 * library's own.
 *
 * `@tanstack/virtual-core` (3.16) ends a scroll with a debounced timer and its
 * unsubscribe leaves that timer running: a scroll just before unmount fires it
 * on the unmounted component, and under test after jsdom is gone ("window is
 * not defined"). The shared observer clears it. A virtualizer that does not
 * pass it carries the leak, so this guard reads every source file under
 * `frontend/src` and fails on:
 *
 *   - a `useVirtualizer(...)` call whose options do not set
 *     `observeElementOffset: observeScrollOffset`, or a `useWindowVirtualizer(...)`
 *     call that does not set `observeElementOffset: observeWindowScrollOffset`,
 *     the observer imported from the shared module, and no spread after it that
 *     could override it;
 *   - either hook used other than as a direct call (handed on, aliased through
 *     a variable), the library imported whole (`import * as`), or a value import
 *     of the leaky observers or the `Virtualizer` class (a virtualizer built by
 *     hand). Type-only imports are fine;
 *   - the library re-exported (`export *`, or a named re-export of a hook, a
 *     leaky observer or the class) or imported dynamically (`import(...)`):
 *     a call made through a barrel or a dynamic import would go unchecked.
 *
 * The scan is a TypeScript parse, so aliased imports (`useVirtualizer as uv`)
 * are followed. Test files are not scanned.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const SRC = path.resolve(__dirname, "../../..")
const LIBRARIES = new Set(["@tanstack/react-virtual", "@tanstack/virtual-core"])
const SHARED_MODULE = path.join(SRC, "lib/virtual/observe-scroll-offset")
/** Each hook and the shared observer it must be handed. */
const REQUIRED: Record<string, string> = {
  useVirtualizer: "observeScrollOffset",
  useWindowVirtualizer: "observeWindowScrollOffset",
}
/** Library values that bypass the shared observer when imported. */
const FORBIDDEN_VALUES = new Set(["observeElementOffset", "observeWindowOffset", "Virtualizer"])

interface Violation {
  file: string
  line: number
  message: string
}

function resolvesToShared(spec: string, file: string): boolean {
  const resolved = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(file), spec)
      : null
  return resolved !== null && resolved.replace(/\.(ts|tsx|js)$/, "") === SHARED_MODULE
}

/** Scans one source file; returns its violations and how many hook calls it checked. */
function scanSource(file: string, text: string): { violations: Violation[]; calls: number } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const violations: Violation[] = []
  const at = (node: ts.Node, message: string) =>
    violations.push({ file: path.relative(SRC, file), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, message })

  /** local name → hook name */
  const hooks = new Map<string, string>()
  /** local name → shared observer name */
  const observers = new Map<string, string>()

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      // A re-export hands the hooks to callers this scan would never connect
      // back to the library (a barrel's importers do not name it).
      if (stmt.isTypeOnly || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const spec = stmt.moduleSpecifier.text
      if (!LIBRARIES.has(spec)) continue
      const exported = stmt.exportClause
      if (!exported || ts.isNamespaceExport(exported)) {
        at(stmt, `re-exports ${spec} whole; import the hooks where they are called`)
        continue
      }
      for (const el of exported.elements) {
        if (el.isTypeOnly) continue
        const name = (el.propertyName ?? el.name).text
        if (name in REQUIRED || FORBIDDEN_VALUES.has(name)) at(el, `re-exports ${name} from ${spec}; import the hooks where they are called`)
      }
      continue
    }
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    const clause = stmt.importClause
    if (!clause) continue
    const fromLibrary = LIBRARIES.has(spec)
    const fromShared = resolvesToShared(spec, file)
    if (!fromLibrary && !fromShared) continue
    const bindings = clause.namedBindings
    if (fromLibrary && bindings && ts.isNamespaceImport(bindings) && !clause.isTypeOnly) {
      at(stmt, `imports ${spec} whole; import the hooks by name so their observer can be checked`)
      continue
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) {
      if (clause.isTypeOnly || el.isTypeOnly) continue
      const imported = (el.propertyName ?? el.name).text
      if (fromShared) observers.set(el.name.text, imported)
      else if (imported in REQUIRED) hooks.set(el.name.text, imported)
      else if (FORBIDDEN_VALUES.has(imported)) at(el, `imports ${imported} from ${spec}; use the shared observer (lib/virtual/observe-scroll-offset)`)
    }
  }

  let calls = 0
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      LIBRARIES.has(node.arguments[0].text)
    ) {
      at(node, `imports ${node.arguments[0].text} dynamically; import the hooks by name so their observer can be checked`)
    }
    if (ts.isIdentifier(node) && hooks.has(node.text) && !ts.isImportSpecifier(node.parent)) {
      const hook = hooks.get(node.text)!
      const call = node.parent
      if (!ts.isCallExpression(call) || call.expression !== node) {
        at(node, `${hook} is used other than as a direct call; call it with the shared observer`)
      } else {
        calls++
        checkCall(call, hook)
      }
    }
    ts.forEachChild(node, visit)
  }
  const checkCall = (call: ts.CallExpression, hook: string) => {
    const want = REQUIRED[hook]
    const arg = call.arguments[0]
    if (!arg || !ts.isObjectLiteralExpression(arg)) {
      at(call, `${hook} options must be an object literal that sets observeElementOffset: ${want}`)
      return
    }
    const props = arg.properties
    const idx = props.findIndex((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === "observeElementOffset")
    const prop = idx >= 0 ? props[idx] : undefined
    const value = prop && ts.isPropertyAssignment(prop) ? prop.initializer : prop && ts.isShorthandPropertyAssignment(prop) ? prop.name : undefined
    if (!value || !ts.isIdentifier(value) || observers.get(value.text) !== want) {
      at(call, `${hook} does not pass observeElementOffset: ${want} from lib/virtual/observe-scroll-offset`)
      return
    }
    if (props.slice(idx + 1).some(ts.isSpreadAssignment)) {
      at(call, `${hook} spreads options after observeElementOffset, which could override it; set it last`)
    }
  }
  visit(sf)
  return { violations, calls }
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [full] : []
  })
}

describe("virtualizer scroll-observer guard", () => {
  it("every useVirtualizer / useWindowVirtualizer in frontend/src passes the shared observer", () => {
    let calls = 0
    const violations: Violation[] = []
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8")
      if (!/@tanstack\/(react-virtual|virtual-core)/.test(text)) continue
      const r = scanSource(file, text)
      calls += r.calls
      violations.push(...r.violations)
    }
    expect(violations.map((v) => `${v.file}:${v.line} ${v.message}`)).toEqual([])
    // Not vacuous: the scan found the virtualizers this guard exists for.
    expect(calls).toBeGreaterThanOrEqual(4)
  })

  describe("the scan itself", () => {
    const FILE = path.join(SRC, "components/example.tsx")
    const scan = (text: string) => scanSource(FILE, text).violations.map((v) => v.message)
    const SHARED = `import { observeScrollOffset, observeWindowScrollOffset } from "@/lib/virtual/observe-scroll-offset"\n`

    it("passes a call that sets the shared observer", () => {
      expect(scan(`import { useVirtualizer } from "@tanstack/react-virtual"\n${SHARED}useVirtualizer({ count: 1, observeElementOffset: observeScrollOffset })`)).toEqual([])
      expect(scan(`import { useWindowVirtualizer } from "@tanstack/react-virtual"\n${SHARED}useWindowVirtualizer({ count: 1, observeElementOffset: observeWindowScrollOffset })`)).toEqual([])
    })

    it("follows a relative import of the shared module", () => {
      const file = path.join(SRC, "lib/virtual/example.ts")
      const r = scanSource(file, `import { useVirtualizer } from "@tanstack/react-virtual"\nimport { observeScrollOffset } from "./observe-scroll-offset"\nuseVirtualizer({ observeElementOffset: observeScrollOffset })`)
      expect(r.violations).toEqual([])
    })

    it("fails a call without the observer, including through an alias", () => {
      expect(scan(`import { useVirtualizer } from "@tanstack/react-virtual"\nuseVirtualizer({ count: 1 })`)).toHaveLength(1)
      expect(scan(`import { useVirtualizer as uv } from "@tanstack/react-virtual"\nuv({ count: 1 })`)).toHaveLength(1)
    })

    it("fails the wrong observer for the hook, and an observer of the same name declared elsewhere", () => {
      expect(scan(`import { useWindowVirtualizer } from "@tanstack/react-virtual"\n${SHARED}useWindowVirtualizer({ observeElementOffset: observeScrollOffset })`)).toHaveLength(1)
      expect(scan(`import { useVirtualizer } from "@tanstack/react-virtual"\nconst observeScrollOffset = () => undefined\nuseVirtualizer({ observeElementOffset: observeScrollOffset })`)).toHaveLength(1)
    })

    it("fails a spread after the observer, options that are not a literal, and a hook handed on", () => {
      expect(scan(`import { useVirtualizer } from "@tanstack/react-virtual"\n${SHARED}useVirtualizer({ observeElementOffset: observeScrollOffset, ...rest })`)).toHaveLength(1)
      expect(scan(`import { useVirtualizer } from "@tanstack/react-virtual"\nuseVirtualizer(opts)`)).toHaveLength(1)
      expect(scan(`import { useVirtualizer } from "@tanstack/react-virtual"\nconst h = useVirtualizer`)).toHaveLength(1)
    })

    it("fails a namespace import and value imports of the leaky observers or the class, but not type imports", () => {
      expect(scan(`import * as rv from "@tanstack/react-virtual"`)).toHaveLength(1)
      expect(scan(`import { observeElementOffset } from "@tanstack/virtual-core"`)).toHaveLength(1)
      expect(scan(`import { Virtualizer } from "@tanstack/react-virtual"`)).toHaveLength(1)
      expect(scan(`import type { Virtualizer } from "@tanstack/react-virtual"\nimport { type VirtualItem } from "@tanstack/react-virtual"`)).toEqual([])
    })

    it("fails a re-export of the library or of its hooks, but not a type-only one", () => {
      expect(scan(`export * from "@tanstack/react-virtual"`)).toHaveLength(1)
      expect(scan(`export * as rv from "@tanstack/react-virtual"`)).toHaveLength(1)
      expect(scan(`export { useVirtualizer } from "@tanstack/react-virtual"`)).toHaveLength(1)
      expect(scan(`export { useWindowVirtualizer as uwv } from "@tanstack/react-virtual"`)).toHaveLength(1)
      expect(scan(`export { observeWindowOffset } from "@tanstack/virtual-core"`)).toHaveLength(1)
      expect(scan(`export type { Virtualizer } from "@tanstack/react-virtual"\nexport { type VirtualItem } from "@tanstack/react-virtual"`)).toEqual([])
    })

    it("fails a dynamic import of the library", () => {
      expect(scan(`const { useVirtualizer } = await import("@tanstack/react-virtual")`)).toHaveLength(1)
      expect(scan(`void import("@tanstack/virtual-core").then((m) => m.observeElementOffset)`)).toHaveLength(1)
      expect(scan(`type M = typeof import("@tanstack/react-virtual")`)).toEqual([])
    })
  })
})
