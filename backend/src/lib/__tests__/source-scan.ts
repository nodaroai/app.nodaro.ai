/**
 * Shared source-walking helpers for the structural guard tests.
 *
 * These guards protect invariants whose violation is INVISIBLE at runtime on
 * the configurations we run daily — a reintroduced provider-host literal only
 * matters to a self-hoster behind a proxy, and a missed object ACL only
 * matters on a store without bucket policies. That makes the scanner itself
 * load-bearing: a guard that quietly stops matching is worse than no guard,
 * because it reads as coverage.
 *
 * So parse with the TypeScript compiler rather than regexing or hand-rolling
 * a tokenizer. Comments are not AST nodes, so they are excluded for free; and
 * nested templates, regex literals containing quotes, and any reformatting
 * are handled by the same parser that compiles the code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

/** Every shipped .ts file under backend/src — tests and node_modules excluded. */
export function sourceFiles(dir: string = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Test code legitimately spells hosts out — it mocks the consts' values
      // and src/test/setup.ts pins their defaults. Neither ships or calls out.
      if (entry.name === "__tests__" || entry.name === "test" || entry.name === "node_modules") {
        continue
      }
      sourceFiles(full, acc)
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      acc.push(full)
    }
  }
  return acc
}

export function relPath(file: string): string {
  return relative(SRC, file).split(sep).join("/")
}

export function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  )
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

/** Parse every source file once; the guards below each scan the same trees. */
export function eachSourceFile(fn: (sf: ts.SourceFile, rel: string) => void): void {
  for (const file of sourceFiles()) fn(parse(file), relPath(file))
}
