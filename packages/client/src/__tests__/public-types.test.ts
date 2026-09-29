/**
 * Every type a resource module exports is part of the SDK's public surface —
 * it appears in a method's parameters or result — so the package entry point
 * must export it too. Twenty were missing (Pro3DRender*, AssembleNarratedVideoParams,
 * …): a caller could receive a value it could not name.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const SRC = join(__dirname, "..")

function exportedTypeNames(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const names: string[] = []
  source.forEachChild((node) => {
    const exported = ts.getModifiers(node as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (exported && (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))) names.push(node.name.text)
  })
  return names
}

function entryPointExports(): Set<string> {
  const file = join(SRC, "index.ts")
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const names = new Set<string>()
  source.forEachChild((node) => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) names.add(element.name.text)
    }
  })
  return names
}

describe("the SDK entry point", () => {
  it("exports every type its resource modules export", () => {
    const exported = entryPointExports()
    const dir = join(SRC, "resources")
    const missing = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => exportedTypeNames(join(dir, f)).map((name) => `${f}: ${name}`))
      .filter((entry) => !exported.has(entry.split(": ")[1]!))
    expect(missing).toEqual([])
  })
})
