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

/**
 * Timeout for the tree-walking guards.
 *
 * These scan and parse source files, and a shared CI runner under parallel
 * workers is roughly an order of magnitude slower than a dev machine: the
 * literal scan measured 731ms locally and 7125ms in CI, which blew vitest's
 * 5000ms default and failed a green branch. The substring pre-filter in
 * eachSourceFile() cut that to ~50ms, so this ceiling is insurance rather
 * than the mechanism — it exists so growth in the tree degrades into a slow
 * test rather than a red build.
 */
export const SCAN_TIMEOUT_MS = 30_000

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

export function parseText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    // No parent pointers: nothing here walks upward, and setting them roughly
    // doubles the retained tree — which matters on a CI runner parsing many
    // files under parallel workers. `lineOf` passes the SourceFile explicitly
    // for exactly this reason.
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  )
}

export function parse(file: string): ts.SourceFile {
  return parseText(file, readFileSync(file, "utf8"))
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

/**
 * Visit the source files that could possibly contain `needles`, parsed.
 *
 * The substring pre-filter is a strict SUPERSET of what the AST can match: a
 * string literal containing "api.kie.ai", or a `new PutObjectCommand`, cannot
 * exist in a file whose raw text lacks that substring. So skipping the parse
 * there cannot produce a false negative — while a file that merely MENTIONS
 * the token in a comment is still parsed and still correctly excluded by the
 * AST. It is the difference between parsing ~830 files and parsing a handful,
 * which matters because these run on every CI job on a shared runner.
 */
export function eachSourceFile(
  needles: readonly string[],
  fn: (sf: ts.SourceFile, rel: string) => void,
): void {
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8")
    if (!needles.some((n) => text.includes(n))) continue
    fn(parseText(file, text), relPath(file))
  }
}
