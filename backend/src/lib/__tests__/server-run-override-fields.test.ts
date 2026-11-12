// @test-watches backend/src/**/*.ts packages/render-rules/src/**/*.ts packages/shared/src/**/*.ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, it, expect } from "vitest"
import { SERVER_RUN_OVERRIDE_FIELDS, renderRunOverrides, usecaseRenderFinalOverrides } from "@nodaro/render-rules"
import { RUN_ONLY_NODE_FIELDS } from "@nodaro/shared/nodes"

/**
 * The node fields the server writes into a run's overrides itself are declared once
 * (`SERVER_RUN_OVERRIDE_FIELDS`, @nodaro/render-rules, beside `renderRunOverrides`; a use-case node's
 * `useCaseContinue` is with the run-only fields, `RUN_ONLY_NODE_FIELDS`), and a node unit may not name any of
 * them as an app field (tools/units/app-field-rules.mjs reads that list): the server's own write would then
 * meet the app-field check, or a caller could set what only the server should.
 *
 * This holds the declaration to the code. Every server writer of a run's per-node overrides, found with the
 * TypeScript parser over backend/src and the two shared packages:
 *  - what a function named `…Overrides` returns or fills (`{ [nodeId]: { … } }`, `out[nodeId] = { … }`);
 *  - the per-node objects inside an `inputOverrides: { … }` value;
 *  - an element written onto a map named `inputOverrides` / `overrides` (`inputOverrides[id] = { … }`).
 * A key any of them writes that is not declared fails here: declare it, and it is reserved for app fields too.
 */
const ROOT = path.resolve(__dirname, "../../../..")
const DIRS = ["backend/src", "packages/render-rules/src", "packages/shared/src"]
const files: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (!["__tests__", "node_modules", "dist", "generated", "_generated"].includes(name)) walk(abs)
    } else if (/\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name)) files.push(abs)
  }
}
for (const d of DIRS) walk(path.join(ROOT, d))

const objectKeys = (o: ts.ObjectLiteralExpression) =>
  o.properties.flatMap((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && !ts.isComputedPropertyName(p.name) ? [p.name.getText()] : [])
/** The per-node objects an override map literal writes: each `[nodeId]: { … }`, through spreads and conditionals. */
const perNodeKeys = (root: ts.Node, out: Map<string, Set<string>>, where: string) => {
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && ts.isComputedPropertyName(n.name) && ts.isObjectLiteralExpression(n.initializer)) {
      for (const k of objectKeys(n.initializer)) out.set(k, (out.get(k) ?? new Set()).add(where))
    }
    n.forEachChild(visit)
  }
  visit(root)
}
const elementWrites = (root: ts.Node, out: Map<string, Set<string>>, where: string, onlyMaps?: RegExp) => {
  const visit = (n: ts.Node) => {
    if (
      ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(n.left) && ts.isObjectLiteralExpression(n.right) &&
      (!onlyMaps || (ts.isIdentifier(n.left.expression) && onlyMaps.test(n.left.expression.text)))
    ) {
      for (const k of objectKeys(n.right)) out.set(k, (out.get(k) ?? new Set()).add(where))
    }
    n.forEachChild(visit)
  }
  visit(root)
}

/** Every key a server writer puts on a node in a run's overrides → the files that write it. */
function serverWrittenKeys(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const abs of files) {
    const text = readFileSync(abs, "utf8")
    if (!/Overrides\b|inputOverrides|overrides\[/.test(text)) continue
    const where = path.relative(ROOT, abs).split(path.sep).join("/")
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    const visit = (n: ts.Node) => {
      const fn = ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ? n : undefined
      if (fn?.name && fn.body && /Overrides$/.test(fn.name.getText())) {
        perNodeKeys(fn.body, out, where)
        elementWrites(fn.body, out, where)
      }
      if (ts.isPropertyAssignment(n) && n.name.getText() === "inputOverrides") perNodeKeys(n.initializer, out, where)
      n.forEachChild(visit)
    }
    visit(sf)
    elementWrites(sf, out, where, /^(inputOverrides|overrides)$/)
  }
  return out
}

const DECLARED = new Set<string>([...SERVER_RUN_OVERRIDE_FIELDS, ...RUN_ONLY_NODE_FIELDS])

describe("the fields the server writes into a run's overrides are declared, so no unit may expose them", () => {
  const written = serverWrittenKeys()

  it("the census finds the writers it is about (quality, editedEdl, a component's port values, useCaseContinue)", () => {
    for (const k of ["quality", "editedEdl", "__injectedPortValues", "useCaseContinue"]) expect([...written.keys()], k).toContain(k)
  })

  it("every key a server writer writes is declared", () => {
    const undeclared = [...written].filter(([k]) => !DECLARED.has(k)).map(([k, where]) => `${k} (${[...where].sort().join(", ")})`)
    expect(undeclared, "declare it in SERVER_RUN_OVERRIDE_FIELDS (packages/render-rules/src/render-final-set.ts) — gen:units then refuses it as an app field").toEqual([])
  })

  it("the writers' own output agrees", () => {
    const keysOf = (o: Record<string, Record<string, unknown>>) => Object.values(o).flatMap((v) => Object.keys(v))
    for (const k of keysOf(renderRunOverrides("r", "final", new Set(["r"])))) expect(DECLARED.has(k), k).toBe(true)
    for (const k of keysOf(usecaseRenderFinalOverrides("n", { jobId: "j" } as never, { editedEdl: {} }))) expect(DECLARED.has(k), k).toBe(true)
  })
})
