/**
 * The pure half of the structural guards' toolkit: parse, walk and locate.
 *
 * Nothing here touches the file system, so importing it adds no file read to
 * a test (tools/test-select/README.md, "Tests that read files"). A guard that
 * walks backend/src imports `source-scan.ts` instead, which re-exports all of
 * this and declares the one tree it reads. A test that reads files itself and
 * only needs to parse them imports this module and declares its own reads.
 *
 * Parse with the TypeScript compiler rather than regexing or hand-rolling a
 * tokenizer: comments are not AST nodes, so they are excluded for free; and
 * nested templates, regex literals containing quotes, and any reformatting are
 * handled by the same parser that compiles the code.
 * `source-scan-reads.test.ts` fails this file the moment it reads a file.
 */
import { dirname, relative, resolve, sep } from "node:path"
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

/** backend/src, absolute. */
export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

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

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}
