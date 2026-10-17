// @test-watches backend/src/**/*.ts
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
 * Its file reads are declared above and are FIXED: every shipped .ts file
 * under backend/src, and nothing else. No export takes a directory or a path,
 * so a caller cannot point it at a tree the declaration does not name, and
 * every test that imports this module inherits the declaration
 * (tools/test-select/README.md, "Tests that read files"). A test that reads
 * anything else declares that itself. A guard that only parses or walks text
 * imports `source-ast.ts`, which reads nothing. `source-scan-reads.test.ts`
 * holds all of this: the exports and their parameters, every path the module
 * reads at run time, and the declaration's cover of a new file in the tree.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type ts from "typescript"
import { SRC, parseText, relPath } from "./source-ast.js"

export { SCAN_TIMEOUT_MS, SRC, lineOf, parseText, relPath, walk } from "./source-ast.js"

function collect(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Test code legitimately spells hosts out — it mocks the consts' values
      // and src/test/setup.ts pins their defaults. Neither ships or calls out.
      if (entry.name === "__tests__" || entry.name === "test" || entry.name === "node_modules") {
        continue
      }
      collect(full, acc)
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      acc.push(full)
    }
  }
  return acc
}

/** Every shipped .ts file under backend/src — tests and node_modules excluded. */
export function sourceFiles(): string[] {
  return collect(SRC, [])
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
